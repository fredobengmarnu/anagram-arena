const fs = require('fs');
const path = require('path');

const WORDS_PATH = path.join(__dirname, 'words.txt');
const OUTPUT_PATH = path.join(__dirname, 'public', 'definitions.json');
const SOURCE_URL = 'https://raw.githubusercontent.com/adambom/dictionary/master/dictionary.json';

// Helper to expand parts of speech
function formatPOS(raw) {
  const p = raw.toLowerCase().replace(/[\(\)\.]/g, '').trim();
  if (p === 'n' || p === 'noun') return 'noun';
  if (p === 'v' || p === 'verb' || p === 'vt' || p === 'vi' || p === 'v t' || p === 'v i') return 'verb';
  if (p === 'a' || p === 'adj' || p === 'adjective') return 'adjective';
  if (p === 'adv' || p === 'adverb') return 'adverb';
  if (p === 'prep' || p === 'preposition') return 'preposition';
  if (p === 'pron' || p === 'pronoun') return 'pronoun';
  if (p === 'conj' || p === 'conjunction') return 'conjunction';
  if (p === 'interj' || p === 'interjection') return 'interjection';
  return p || 'word';
}

async function buildDefinitions() {
  console.log('📖 Building full offline dictionary definitions...');

  const publicDir = path.join(__dirname, 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  if (!fs.existsSync(WORDS_PATH)) {
    console.error('❌ words.txt not found.');
    process.exit(1);
  }

  const wordsRaw = fs.readFileSync(WORDS_PATH, 'utf-8');
  const validSet = new Set(
    wordsRaw.split(/\r?\n/)
      .map(w => w.trim().toUpperCase())
      .filter(w => w.length >= 3 && w.length <= 6 && /^[A-Z]+$/.test(w))
  );

  console.log(`🔍 Processing definitions for ${validSet.size} words...`);

  let fullDict = {};
  try {
    const response = await fetch(SOURCE_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Node.js)' }
    });

    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
    fullDict = await response.json();
    console.log('📥 Dictionary source downloaded successfully.');
  } catch (err) {
    console.warn('⚠️ Fetch error, fallback applied:', err.message);
  }

  const compactDict = {};
  let matchedCount = 0;

  for (const word of validSet) {
    const lower = word.toLowerCase();
    const entry = fullDict[word] || fullDict[lower];

    if (entry && typeof entry === 'string') {
      let rawDef = entry.trim();
      let pos = 'word';

      // Match parts of speech like (n.), (v. t.), (a.)
      const match = rawDef.match(/^\(([a-z\.\s]+)\)\s*(.*)/i);
      if (match) {
        pos = formatPOS(match[1]);
        rawDef = match[2].trim();
      }

      // Capitalize first letter and clean trailing chars
      if (rawDef.length > 0) {
        rawDef = rawDef.charAt(0).toUpperCase() + rawDef.slice(1);
        if (!/[.!?]$/.test(rawDef)) rawDef += '.';
      }

      compactDict[word] = {
        pos: pos,
        def: rawDef // Full definition preserved without arbitrary slicing
      };
      matchedCount++;
    } else {
      compactDict[word] = {
        pos: 'lexicon',
        def: 'Official tournament-legal word in the ENABLE1 lexicon.'
      };
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(compactDict));
  const sizeMb = (fs.statSync(OUTPUT_PATH).size / (1024 * 1024)).toFixed(2);
  console.log(`✅ Saved ${matchedCount} complete definitions to public/definitions.json (${sizeMb} MB)`);
}

buildDefinitions();