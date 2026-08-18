const fs = require('fs');
const path = require('path');

const WORDS_PATH = path.join(__dirname, 'words.txt');
const OUTPUT_DEF_PATH = path.join(__dirname, 'public', 'definitions.json');
const SOURCE_URL = 'https://raw.githubusercontent.com/adambom/dictionary/master/dictionary.json';

// Common OCR concatenated word pairings to split
const OCR_FIXES = [
  [/\b(to|in|of|for|by|on|at|with|from|as|or|and|the|a|an)(the|a|an|be|which|that|this|it|its|their|other|one|all|any|such)\b/gi, '$1 $2'],
  [/\btobe\b/gi, 'to be'],
  [/\bofwhich\b/gi, 'of which'],
  [/\binthe\b/gi, 'in the'],
  [/\bbywhich\b/gi, 'by which'],
  [/\bfora\b/gi, 'for a'],
  [/\bwitha\b/gi, 'with a'],
  [/\baswell\b/gi, 'as well'],
  [/\bstateof\b/gi, 'state of'],
  [/\bactof\b/gi, 'act of'],
  [/\bqualityof\b/gi, 'quality of'],
  [/\bbelongingto\b/gi, 'belonging to'],
  [/\bpertainingto\b/gi, 'pertaining to'],
  [/\brelatingto\b/gi, 'relating to'],
  [/\bconsistingof\b/gi, 'consisting of'],
  [/\bcharacterizedby\b/gi, 'characterized by']
];

function formatPOS(raw) {
  if (!raw) return 'noun';
  const p = raw.toLowerCase().replace(/[\(\)\.]/g, '').trim();
  if (p === 'n' || p === 'noun') return 'noun';
  if (p.startsWith('v')) return 'verb';
  if (p === 'a' || p === 'adj' || p === 'adjective') return 'adjective';
  if (p === 'adv' || p === 'adverb') return 'adverb';
  if (p === 'prep' || p === 'preposition') return 'preposition';
  if (p === 'pron' || p === 'pronoun') return 'pronoun';
  if (p === 'conj' || p === 'conjunction') return 'conjunction';
  if (p === 'interj' || p === 'interjection') return 'interjection';
  return 'noun';
}

function sanitizeDefinition(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';

  let def = rawText;

  // 1. Remove phonetic tags, etymological brackets, and OCR artifacts: [Obs.], \...\, -- ...
  def = def.replace(/\\.*?\\/g, '');
  def = def.replace(/\[(?:Obs\.|Archaic|R\.|Colloq\.|Specif\.|Poet\.|Geol\.|Anat\.|Bot\.|Chem\.)?.*?\]/gi, '');
  def = def.replace(/\b(?:Obs\.|Archaic|Colloq\.|Prov\.)\s*/gi, '');
  def = def.replace(/--\s*[\w\s,]+$/g, ''); // Trailing attribution dashes

  // 2. Remove cross-reference circular definitions: "See under X", "Same as X."
  def = def.replace(/^(?:See|Same as|Alt\. of|Variant of)\s+[^.]+[\.]?/i, '').trim();

  // 3. Fix OCR concatenated words (run twice to catch overlapping tokens)
  for (let pass = 0; pass < 2; pass++) {
    for (const [pattern, replacement] of OCR_FIXES) {
      def = def.replace(pattern, replacement);
    }
  }

  // 4. Clean spacing around commas, colons, and semicolons
  def = def.replace(/\s*([,;:])\s*/g, '$1 ');
  def = def.replace(/\s+([.!?])/g, '$1');
  def = def.replace(/;\s*;/g, ';');
  def = def.replace(/,\s*,/g, ',');

  // 5. Clean leading punctuation and excessive whitespace
  def = def.replace(/^[\s,;:\.\-]+/, '').trim();
  def = def.replace(/\s{2,}/g, ' ').trim();

  // 6. If multiple definitions exist separated by numbers or semicolons, take the clean primary sense
  if (def.includes('1.') || def.includes('2.')) {
    const parts = def.split(/(?:[12]\.\s*)/);
    def = parts.find(p => p.trim().length >= 10) || parts[0];
  }

  // 7. Capitalize first letter and guarantee terminating period
  if (def.length > 0) {
    def = def.charAt(0).toUpperCase() + def.slice(1);
    if (!/[.!?]$/.test(def)) def += '.';
  }

  return def;
}

async function refineDictionary() {
  console.log('🧹 Scanning and refining dictionary definitions...');

  if (!fs.existsSync(WORDS_PATH)) {
    console.error('❌ words.txt not found.');
    process.exit(1);
  }

  let fullDict = {};
  try {
    const res = await fetch(SOURCE_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Node.js)' }
    });
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    fullDict = await res.json();
  } catch (err) {
    console.error('❌ Failed to fetch dictionary source:', err.message);
    process.exit(1);
  }

  const rawWords = fs.readFileSync(WORDS_PATH, 'utf-8').split(/\r?\n/);
  const candidateWords = new Set(
    rawWords
      .map(w => w.trim().toUpperCase())
      .filter(w => w.length >= 3 && w.length <= 6 && /^[A-Z]+$/.test(w))
  );

  const cleanWords = [];
  const cleanDefinitions = {};
  let discardedCount = 0;

  for (const word of candidateWords) {
    const lower = word.toLowerCase();
    const entry = fullDict[word] || fullDict[lower];

    if (entry && typeof entry === 'string') {
      let rawDef = entry.trim();
      let pos = 'noun';

      // Extract part of speech
      const match = rawDef.match(/^\(([a-z\.\s]+)\)\s*(.*)/i);
      if (match) {
        pos = formatPOS(match[1]);
        rawDef = match[2].trim();
      }

      const sanitized = sanitizeDefinition(rawDef);

      // Quality Threshold: reject trivial, uninformative, or corrupted entries
      if (sanitized.length >= 12 && !sanitized.toLowerCase().startsWith('see ') && !sanitized.toLowerCase().startsWith('alt.')) {
        cleanWords.push(word);
        cleanDefinitions[word] = {
          pos: pos,
          def: sanitized
        };
        continue;
      }
    }

    discardedCount++;
  }

  cleanWords.sort();

  // Overwrite words.txt with sanitized vocabulary list
  fs.writeFileSync(WORDS_PATH, cleanWords.join('\n'), 'utf-8');

  // Overwrite public/definitions.json with sanitized, grammatically corrected definitions
  fs.writeFileSync(OUTPUT_DEF_PATH, JSON.stringify(cleanDefinitions), 'utf-8');

  const defSizeMb = (fs.statSync(OUTPUT_DEF_PATH).size / (1024 * 1024)).toFixed(2);

  console.log('----------------------------------------------------');
  console.log(`✨ Dictionary Sanitation Complete!`);
  console.log(`🗑️  Pruned ${discardedCount} low-quality/corrupted entries.`);
  console.log(`📚 Retained ${cleanWords.length} high-quality, verified English words.`);
  console.log(`💾 Saved clean definitions to public/definitions.json (${defSizeMb} MB).`);
  console.log('----------------------------------------------------');
}

refineDictionary();