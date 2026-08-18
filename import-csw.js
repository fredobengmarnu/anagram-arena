const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, 'csw-definitions.txt');
const WORDS_OUTPUT = path.join(__dirname, 'words.txt');
const DEF_OUTPUT = path.join(__dirname, 'public', 'definitions.json');

// Expand CSW bracket abbreviations into clean POS terms
function parsePOS(posString) {
  if (!posString) return 'noun';
  const raw = posString.toLowerCase();
  
  if (raw.includes('adj')) return 'adjective';
  if (raw.includes('adv')) return 'adverb';
  if (raw.includes('prep')) return 'preposition';
  if (raw.includes('pron')) return 'pronoun';
  if (raw.includes('conj')) return 'conjunction';
  if (raw.includes('interj')) return 'interjection';
  if (raw.includes('v')) return 'verb';
  if (raw.includes('n')) return 'noun';
  
  return 'noun';
}

function cleanDefinition(rawText) {
  let def = rawText.trim();
  
  // Clean trailing punctuation and bracket artifacts
  def = def.replace(/\[.*?\]/g, '').trim();
  def = def.replace(/\s{2,}/g, ' ').trim();
  
  if (def.length > 0) {
    def = def.charAt(0).toUpperCase() + def.slice(1);
    if (!/[.!?]$/.test(def)) def += '.';
  }
  return def;
}

function processCSWDictionary() {
  console.log('📖 Processing Collins Scrabble Words lexicon...');

  if (!fs.existsSync(INPUT_FILE)) {
    console.error('❌ csw-definitions.txt not found in root directory.');
    process.exit(1);
  }

  const publicDir = path.join(__dirname, 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  const lines = fs.readFileSync(INPUT_FILE, 'utf-8').split(/\r?\n/);
  const wordsSet = new Set();
  const definitions = {};
  let totalProcessed = 0;

  for (const line of lines) {
    if (!line.trim()) continue;

    // Split strictly on the first tab delimiter
    const tabIndex = line.indexOf('\t');
    if (tabIndex === -1) continue;

    const word = line.substring(0, tabIndex).trim().toUpperCase();
    const rawDefBody = line.substring(tabIndex + 1).trim();

    // Filter strictly for 3- to 6-letter alphabetic words
    if (word.length >= 3 && word.length <= 6 && /^[A-Z]+$/.test(word)) {
      // Extract the primary POS tag from brackets
      const posMatch = rawDefBody.match(/\[(.*?)\]/);
      const posTag = posMatch ? parsePOS(posMatch[1]) : 'noun';
      
      // Clean definition and strip redundant bracket notes
      const cleanDef = cleanDefinition(rawDefBody);

      if (cleanDef.length >= 4) {
        wordsSet.add(word);
        definitions[word] = {
          pos: posTag,
          def: cleanDef
        };
        totalProcessed++;
      }
    }
  }

  const sortedWords = Array.from(wordsSet).sort();

  // Write synchronized game files
  fs.writeFileSync(WORDS_OUTPUT, sortedWords.join('\n'), 'utf-8');
  fs.writeFileSync(DEF_OUTPUT, JSON.stringify(definitions, null, 2), 'utf-8');

  const sizeMb = (fs.statSync(DEF_OUTPUT).size / (1024 * 1024)).toFixed(2);

  console.log('----------------------------------------------------');
  console.log('✨ CSW Lexicon Import Complete!');
  console.log(`📚 Curated 3-6 Letter Words: ${sortedWords.length}`);
  console.log(`💾 Generated: words.txt`);
  console.log(`💾 Generated: public/definitions.json (${sizeMb} MB)`);
  console.log('----------------------------------------------------');
}

processCSWDictionary();