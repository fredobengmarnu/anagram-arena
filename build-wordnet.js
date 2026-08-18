const fs = require('fs');
const path = require('path');
const https = require('https');

const WORDS_PATH = path.join(__dirname, 'words.txt');
const DEF_PATH = path.join(__dirname, 'public', 'definitions.json');

// Permanent, high-availability dictionary repository
const SOURCE_URL = 'https://raw.githubusercontent.com/adambom/dictionary/master/dictionary.json';

// Comprehensive primary modern adjective list (ensures adjectives are never misclassified as nouns)
const PRIMARY_ADJECTIVES = new Set([
  'LARGE', 'SMALL', 'GREAT', 'LITTLE', 'SHORT', 'TALL', 'HIGH', 'LOW', 
  'BROAD', 'WIDE', 'TIGHT', 'LOOSE', 'QUICK', 'FAST', 'SLOW', 'EARLY',
  'LATE', 'HARD', 'SOFT', 'SWEET', 'SOUR', 'BITTER', 'COLD', 'WARM',
  'HOT', 'COOL', 'DRY', 'WET', 'CLEAN', 'DIRTY', 'FRESH', 'STALE',
  'BRIGHT', 'DARK', 'LIGHT', 'HEAVY', 'SHARP', 'BLUNT', 'SMOOTH', 'ROUGH',
  'CALM', 'BOLD', 'BRAVE', 'PALE', 'BARE', 'DEEP', 'RICH', 'POOR', 'WILD',
  'FINE', 'FAIR', 'FOUL', 'DEAR', 'NEAR', 'SICK', 'WELL', 'GLAD', 'MILD',
  'PROUD', 'SHY', 'VAIN', 'BLIND', 'DEAF', 'DUMB', 'KEEN', 'LEAN', 'FAT',
  'LOUD', 'NUMB', 'RIPE', 'VAST', 'WARM', 'WEAK', 'WISE', 'FOOL', 'AGILE'
]);

// Common OCR fused words to split into standard English
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

function detectPOS(word, rawText) {
  if (PRIMARY_ADJECTIVES.has(word)) return 'adjective';

  const lower = rawText.toLowerCase();

  // Check embedded tags
  if (/\((?:a|adj|adjective)\.?\)/i.test(rawText)) return 'adjective';
  if (/\((?:v|vt|vi|verb)\.?\)/i.test(rawText)) return 'verb';
  if (/\((?:adv|adverb)\.?\)/i.test(rawText)) return 'adverb';
  if (/\((?:prep|preposition)\.?\)/i.test(rawText)) return 'preposition';
  if (/\((?:pron|pronoun)\.?\)/i.test(rawText)) return 'pronoun';
  if (/\((?:conj|conjunction)\.?\)/i.test(rawText)) return 'conjunction';
  if (/\((?:interj|interjection)\.?\)/i.test(rawText)) return 'interjection';

  // Semantic clues in definition text
  if (lower.startsWith('having ') || lower.startsWith('characterized by ') || lower.startsWith('of or pertaining to ') || lower.startsWith('relating to ')) {
    return 'adjective';
  }
  if (lower.startsWith('to ') || lower.startsWith('act of ')) {
    return 'verb';
  }

  return 'noun';
}

function cleanDefinition(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let def = rawText.trim();

  // 1. Remove bracketed notes, archaic labels, and pronunciation artifacts
  def = def.replace(/\\.*?\\/g, '');
  def = def.replace(/\[(?:Obs\.|Archaic|R\.|Colloq\.|Specif\.|Poet\.|Geol\.|Anat\.|Bot\.|Chem\.)?.*?\]/gi, '');
  def = def.replace(/\b(?:Obs\.|Archaic|Colloq\.|Prov\.)\s*/gi, '');
  def = def.replace(/^\([a-z\.\s]+\)\s*/i, '');
  def = def.replace(/^[0-9]+[\.\)]\s*/, '');
  def = def.replace(/--\s*[\w\s,]+$/g, '');

  // 2. Fix OCR run-together words
  for (let pass = 0; pass < 2; pass++) {
    for (const [pattern, replacement] of OCR_FIXES) {
      def = def.replace(pattern, replacement);
    }
  }

  // 3. Fix spacing around punctuation
  def = def.replace(/\s*([,;:])\s*/g, '$1 ');
  def = def.replace(/\s+([.!?])/g, '$1');
  def = def.replace(/^[\s,;:\.\-]+/, '').trim();
  def = def.replace(/\s{2,}/g, ' ').trim();

  // 4. Ensure proper sentence casing and trailing period
  if (def.length > 0) {
    def = def.charAt(0).toUpperCase() + def.slice(1);
    if (!/[.!?]$/.test(def)) def += '.';
  }

  return def;
}

// Resilient HTTPS downloader with automated redirect handling
function downloadJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Node.js)' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadJSON(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP Error ${res.statusCode}`));
      }

      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(rawData));
        } catch (e) {
          reject(new Error('Failed to parse downloaded JSON.'));
        }
      });
    }).on('error', reject);
  });
}

async function buildModernDictionary() {
  console.log('📦 Downloading master dictionary repository...');

  const publicDir = path.join(__dirname, 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  let fullDict = {};
  try {
    fullDict = await downloadJSON(SOURCE_URL);
    console.log('📥 Downloaded dictionary dataset.');
  } catch (err) {
    console.error('❌ Download failed:', err.message);
    process.exit(1);
  }

  console.log('🔍 Filtering and normalizing 3-6 letter modern vocabulary...');

  const curatedWords = [];
  const definitions = {};

  for (const [rawWord, rawDef] of Object.entries(fullDict)) {
    const word = rawWord.toUpperCase().trim();

    // Strict 3-6 letter alphabetic validation
    if (word.length >= 3 && word.length <= 6 && /^[A-Z]+$/.test(word)) {
      if (typeof rawDef === 'string' && rawDef.trim().length >= 10) {
        const cleaned = cleanDefinition(rawDef);
        const pos = detectPOS(word, rawDef);

        // Quality check: exclude circular entries and empty definitions
        if (cleaned.length >= 12 && !cleaned.startsWith('See ') && !cleaned.startsWith('Alt.')) {
          curatedWords.push(word);
          definitions[word] = {
            pos: pos,
            def: cleaned
          };
        }
      }
    }
  }

  curatedWords.sort();

  // Save curated files
  fs.writeFileSync(WORDS_PATH, curatedWords.join('\n'), 'utf-8');
  fs.writeFileSync(DEF_PATH, JSON.stringify(definitions), 'utf-8');

  const sizeMb = (fs.statSync(DEF_PATH).size / (1024 * 1024)).toFixed(2);

  console.log('----------------------------------------------------');
  console.log('✨ Modern Lexicon & Definition Build Complete!');
  console.log(`📚 Curated Playable Words: ${curatedWords.length}`);
  console.log(`💾 Updated: words.txt`);
  console.log(`💾 Updated: public/definitions.json (${sizeMb} MB)`);
  console.log('----------------------------------------------------');
}

buildModernDictionary();