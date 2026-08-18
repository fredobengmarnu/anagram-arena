const fs = require('fs');
const path = require('path');

const WORDS_PATH = path.join(__dirname, 'words.txt');
const OUTPUT_DEF_PATH = path.join(__dirname, 'public', 'definitions.json');
const SOURCE_URL = 'https://raw.githubusercontent.com/adambom/dictionary/master/dictionary.json';

// Helper to expand parts of speech
function formatPOS(raw) {
  if (!raw) return 'noun';
  const p = raw.toLowerCase().replace(/[\(\)\.]/g, '').trim();
  if (p === 'n' || p === 'noun') return 'noun';
  if (p === 'v' || p === 'verb' || p.startsWith('v')) return 'verb';
  if (p === 'a' || p === 'adj' || p === 'adjective') return 'adjective';
  if (p === 'adv' || p === 'adverb') return 'adverb';
  if (p === 'prep' || p === 'preposition') return 'preposition';
  if (p === 'pron' || p === 'pronoun') return 'pronoun';
  if (p === 'conj' || p === 'conjunction') return 'conjunction';
  if (p === 'interj' || p === 'interjection') return 'interjection';
  return 'word';
}

// Clean and capitalize definition sentences
function cleanDefinition(raw) {
  let def = raw.trim();
  if (def.length === 0) return '';
  def = def.charAt(0).toUpperCase() + def.slice(1);
  if (!/[.!?]$/.test(def)) def += '.';
  return def;
}

async function curateDictionary() {
  console.log('🧹 Starting Dictionary Quality Control...');

  const publicDir = path.join(__dirname, 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  if (!fs.existsSync(WORDS_PATH)) {
    console.error('❌ words.txt not found.');
    process.exit(1);
  }

  // 1. Download Master Definition Source
  console.log('📥 Downloading master dictionary source...');
  let fullDict = {};
  try {
    const res = await fetch(SOURCE_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Node.js)' }
    });
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    fullDict = await res.json();
    console.log('✅ Master dictionary loaded successfully.');
  } catch (err) {
    console.error('❌ Failed to download dictionary source:', err.message);
    process.exit(1);
  }

  // 2. Read raw candidate words from words.txt
  const rawWords = fs.readFileSync(WORDS_PATH, 'utf-8').split(/\r?\n/);
  const candidateWords = new Set(
    rawWords
      .map(w => w.trim().toUpperCase())
      .filter(w => w.length >= 3 && w.length <= 6 && /^[A-Z]+$/.test(w))
  );

  console.log(`🔍 Evaluating ${candidateWords.size} candidate words against master definitions...`);

  const curatedWords = [];
  const curatedDefinitions = {};
  let removedCount = 0;

  for (const word of candidateWords) {
    const lower = word.toLowerCase();
    const entry = fullDict[word] || fullDict[lower];

    // DEFINITION-GATE: If the word is missing or has a trivial/empty entry, DISCARD IT.
    if (entry && typeof entry === 'string' && entry.trim().length >= 8) {
      let rawDef = entry.trim();
      let pos = 'noun';

      const match = rawDef.match(/^\(([a-z\.\s]+)\)\s*(.*)/i);
      if (match) {
        pos = formatPOS(match[1]);
        rawDef = match[2].trim();
      }

      const formattedDef = cleanDefinition(rawDef);
      if (formattedDef.length >= 8) {
        curatedWords.push(word);
        curatedDefinitions[word] = {
          pos: pos,
          def: formattedDef
        };
        continue;
      }
    }

    // Word failed quality check (obscure tournament word with no standard definition)
    removedCount++;
  }

  // 3. Sort words alphabetically
  curatedWords.sort();

  // 4. Overwrite words.txt with ONLY curated words
  fs.writeFileSync(WORDS_PATH, curatedWords.join('\n'), 'utf-8');

  // 5. Overwrite public/definitions.json (100% matched, zero placeholders)
  fs.writeFileSync(OUTPUT_DEF_PATH, JSON.stringify(curatedDefinitions), 'utf-8');

  const defSizeMb = (fs.statSync(OUTPUT_DEF_PATH).size / (1024 * 1024)).toFixed(2);

  console.log('----------------------------------------------------');
  console.log(`✨ Quality Control Completed!`);
  console.log(`🗑️  Removed ${removedCount} obscure words lacking proper definitions.`);
  console.log(`📚 Retained ${curatedWords.length} solid, verifiable English words.`);
  console.log(`💾 Updated words.txt`);
  console.log(`💾 Updated public/definitions.json (${defSizeMb} MB) — 100% definition coverage.`);
  console.log('----------------------------------------------------');
}

curateDictionary();