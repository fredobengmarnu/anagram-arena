const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

// --- DICTIONARY & ANAGRAM ENGINE ---
const DICT_PATH = path.join(__dirname, 'words.txt');
const signatureMap = new Map();
const playableRoots = [];

function loadDictionary() {
  if (!fs.existsSync(DICT_PATH)) {
    console.error('❌ words.txt not found. Please ensure words.txt is present.');
    return;
  }
  console.log('Loading dictionary...');
  const data = fs.readFileSync(DICT_PATH, 'utf-8');
  const rawWords = data.split(/\r?\n/);

  let wordCount = 0;
  for (const raw of rawWords) {
    const word = raw.trim().toUpperCase();
    if (word.length >= 3 && word.length <= 6 && /^[A-Z]+$/.test(word)) {
      const sig = word.split('').sort().join('');
      if (!signatureMap.has(sig)) {
        signatureMap.set(sig, new Set());
      }
      signatureMap.get(sig).add(word);
      wordCount++;
    }
  }

  for (const [sig, words] of signatureMap.entries()) {
    if (sig.length === 6) {
      const allSubWords = solveRack(sig);
      if (allSubWords.size >= 12) {
        playableRoots.push({ sig, rootWord: Array.from(words)[0], subWords: allSubWords });
      }
    }
  }

  console.log(`✅ Loaded ${wordCount} valid words.`);
  console.log(`✅ Generated ${playableRoots.length} playable 6-letter duel boards.`);
}

function getSubsets(chars) {
  const results = new Set();
  const n = chars.length;
  for (let i = 1; i < (1 << n); i++) {
    const sub = [];
    for (let j = 0; j < n; j++) {
      if (i & (1 << j)) sub.push(chars[j]);
    }
    if (sub.length >= 3) {
      results.add(sub.sort().join(''));
    }
  }
  return Array.from(results);
}

function solveRack(rackString) {
  const chars = rackString.split('');
  const subsets = getSubsets(chars);
  const validWords = new Set();

  for (const sub of subsets) {
    const matches = signatureMap.get(sub);
    if (matches) {
      for (const w of matches) validWords.add(w);
    }
  }
  return validWords;
}

loadDictionary();

// --- HTTP SERVER ---
const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  let filePath = path.join(__dirname, 'public', reqPath === '/' ? 'index.html' : reqPath);
  let extname = String(path.extname(filePath)).toLowerCase();

  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg'
  };

  let contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, fallback) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fallback, 'utf-8');
      });
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': extname === '.json' ? 'public, max-age=3600' : 'no-cache'
      });
      res.end(content, 'utf-8');
    }
  });
});

// --- WEBSOCKET ENGINE ---
const wss = new WebSocketServer({ server });
const queues = { TIMED: [], UNTIMED: [] };
const privateRooms = new Map();
const activeRooms = new Map();

function getScore(word) {
  const points = { 3: 100, 4: 250, 5: 600, 6: 1200 };
  return points[word.length] || 100;
}

wss.on('connection', (ws) => {
  ws.id = 'usr_' + Math.random().toString(36).substring(2, 9);
  ws.roomId = null;
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'C2S_START_SOLO') handleStartSolo(ws, msg.payload.mode);
      if (msg.type === 'C2S_FIND_MATCH') handleMatchmaking(ws, msg.payload.mode);
      if (msg.type === 'C2S_CREATE_PRIVATE') handleCreatePrivate(ws, msg.payload.mode);
      if (msg.type === 'C2S_JOIN_PRIVATE') handleJoinPrivate(ws, msg.payload.code?.toUpperCase());
      if (msg.type === 'C2S_CANCEL_MATCH') cleanPlayerQueues(ws);
      if (msg.type === 'C2S_SUBMIT_WORD') handleWordSubmission(ws, msg.payload.word?.toUpperCase());
      if (msg.type === 'C2S_FORFEIT') handleForfeit(ws);
    } catch (err) {
      console.error('Message error:', err);
    }
  });

  ws.on('close', () => handleDisconnect(ws));
});

// Keep-alive heartbeat
const pingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(pingInterval));

function handleStartSolo(ws, mode) {
  if (playableRoots.length === 0) return;
  cleanPlayerQueues(ws);

  const roomId = 'solo_' + Math.random().toString(36).substring(2, 9);
  const selectedPuzzle = playableRoots[Math.floor(Math.random() * playableRoots.length)];
  const isTimed = mode === 'TIMED';
  const durationSec = isTimed ? 300 : 0;

  const roomState = {
    roomId,
    isSolo: true,
    isTimed,
    root: selectedPuzzle.rootWord,
    validWords: selectedPuzzle.subWords,
    claimedWords: new Map(),
    players: { [ws.id]: { ws, score: 0 } },
    durationSec,
    timeoutHandle: isTimed ? setTimeout(() => handleTimeExpired(roomId), durationSec * 1000) : null
  };

  activeRooms.set(roomId, roomState);
  ws.roomId = roomId;

  const scramble = selectedPuzzle.rootWord.split('').sort(() => 0.5 - Math.random()).join('');
  ws.send(JSON.stringify({
    type: 'S2C_MATCH_START',
    payload: {
      roomId,
      isSolo: true,
      isTimed,
      scramble,
      validWords: Array.from(selectedPuzzle.subWords),
      durationSec
    },
    yourId: ws.id
  }));
}

function handleMatchmaking(ws, mode = 'TIMED') {
  if (playableRoots.length === 0) return;
  cleanPlayerQueues(ws);

  const targetQueue = queues[mode] || queues.TIMED;
  if (targetQueue.length > 0) {
    const opponent = targetQueue.shift();
    createMultiplayerRoom(ws, opponent, mode);
  } else {
    targetQueue.push(ws);
    ws.send(JSON.stringify({ type: 'S2C_QUEUE_WAITING', payload: { mode } }));
  }
}

function handleCreatePrivate(ws, mode = 'TIMED') {
  cleanPlayerQueues(ws);
  const code = Math.random().toString(36).substring(2, 6).toUpperCase();
  privateRooms.set(code, { hostWs: ws, mode });
  ws.privateCode = code;
  ws.send(JSON.stringify({ type: 'S2C_PRIVATE_CREATED', payload: { code, mode } }));
}

function handleJoinPrivate(ws, code) {
  cleanPlayerQueues(ws);
  const entry = privateRooms.get(code);

  if (!entry || entry.hostWs.readyState !== WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'S2C_PRIVATE_ERROR', message: 'Room code not found or expired.' }));
    return;
  }

  privateRooms.delete(code);
  createMultiplayerRoom(entry.hostWs, ws, entry.mode);
}

function createMultiplayerRoom(p1, p2, mode) {
  const roomId = 'duel_' + Math.random().toString(36).substring(2, 9);
  const selectedPuzzle = playableRoots[Math.floor(Math.random() * playableRoots.length)];
  const isTimed = mode === 'TIMED';
  const durationSec = isTimed ? 300 : 0;

  const roomState = {
    roomId,
    isSolo: false,
    isTimed,
    root: selectedPuzzle.rootWord,
    validWords: selectedPuzzle.subWords,
    claimedWords: new Map(),
    momentum: 0,
    players: {
      [p1.id]: { ws: p1, side: 1, score: 0 },
      [p2.id]: { ws: p2, side: -1, score: 0 }
    },
    durationSec,
    timeoutHandle: isTimed ? setTimeout(() => handleTimeExpired(roomId), durationSec * 1000) : null
  };

  activeRooms.set(roomId, roomState);
  p1.roomId = roomId;
  p2.roomId = roomId;

  const scramble = selectedPuzzle.rootWord.split('').sort(() => 0.5 - Math.random()).join('');
  const initPayload = {
    type: 'S2C_MATCH_START',
    payload: {
      roomId,
      isSolo: false,
      isTimed,
      scramble,
      validWords: Array.from(selectedPuzzle.subWords),
      durationSec
    }
  };

  p1.send(JSON.stringify({ ...initPayload, yourId: p1.id, opponentId: p2.id }));
  p2.send(JSON.stringify({ ...initPayload, yourId: p2.id, opponentId: p1.id }));
}

function handleWordSubmission(ws, word) {
  const room = activeRooms.get(ws.roomId);
  if (!room) return;

  const isValid = room.validWords.has(word);
  const claimedBy = room.claimedWords.get(word);

  if (!isValid) {
    ws.send(JSON.stringify({ type: 'S2C_SUBMIT_RESULT', payload: { word, success: false, reason: 'INVALID_WORD' } }));
    return;
  }

  if (claimedBy) {
    ws.send(JSON.stringify({
      type: 'S2C_SUBMIT_RESULT',
      payload: { word, success: false, reason: claimedBy === ws.id ? 'ALREADY_CLAIMED_SELF' : 'ALREADY_CLAIMED_OPPONENT' }
    }));
    return;
  }

  room.claimedWords.set(word, ws.id);
  const points = getScore(word);
  const player = room.players[ws.id];
  
  player.score += points;
  if (!room.isSolo) room.momentum += points * player.side;
  const isFullAnagram = word.length === room.root.length;

  ws.send(JSON.stringify({
    type: 'S2C_SUBMIT_RESULT',
    payload: {
      word,
      success: true,
      points,
      currentScore: player.score,
      momentum: room.momentum || 0,
      isFullAnagram,
      claimedCount: room.claimedWords.size,
      totalWords: room.validWords.size
    }
  }));

  if (!room.isSolo) {
    const opponentId = Object.keys(room.players).find(id => id !== ws.id);
    const opponent = room.players[opponentId];
    if (opponent && opponent.ws.readyState === WebSocket.OPEN) {
      opponent.ws.send(JSON.stringify({
        type: 'S2C_OPPONENT_CLAIM',
        payload: {
          word,
          claimedBy: ws.id,
          momentum: room.momentum,
          triggerFrost: isFullAnagram,
          claimedCount: room.claimedWords.size,
          totalWords: room.validWords.size
        }
      }));
    }
  }

  if (room.claimedWords.size === room.validWords.size) {
    if (room.timeoutHandle) clearTimeout(room.timeoutHandle);
    if (room.isSolo) {
      endGame(room, ws.id, "BOARD_CLEARED");
    } else {
      const pIds = Object.keys(room.players);
      const p1Score = room.players[pIds[0]].score;
      const p2Score = room.players[pIds[1]].score;
      let winnerId = 'DRAW';
      if (p1Score > p2Score) winnerId = pIds[0];
      else if (p2Score > p1Score) winnerId = pIds[1];
      endGame(room, winnerId, "BOARD_CLEARED");
    }
  }
}

function handleForfeit(ws) {
  if (!ws.roomId || !activeRooms.has(ws.roomId)) return;
  const room = activeRooms.get(ws.roomId);
  if (room.timeoutHandle) clearTimeout(room.timeoutHandle);

  if (room.isSolo) {
    endGame(room, ws.id, 'FORFEIT');
  } else {
    const opponentId = Object.keys(room.players).find(id => id !== ws.id);
    endGame(room, opponentId, 'FORFEIT');
  }
}

function handleTimeExpired(roomId) {
  const room = activeRooms.get(roomId);
  if (!room) return;

  if (room.isSolo) {
    const soloPlayerId = Object.keys(room.players)[0];
    endGame(room, soloPlayerId, "TIME_UP");
  } else {
    const pIds = Object.keys(room.players);
    const p1Score = room.players[pIds[0]].score;
    const p2Score = room.players[pIds[1]].score;
    let winnerId = 'DRAW';
    if (p1Score > p2Score) winnerId = pIds[0];
    else if (p2Score > p1Score) winnerId = pIds[1];
    endGame(room, winnerId, "TIME_UP");
  }
}

function endGame(room, winnerId, reason) {
  Object.values(room.players).forEach(({ ws }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'S2C_GAME_OVER',
        payload: { winnerId, reason, finalMomentum: room.momentum || 0, isSolo: room.isSolo }
      }));
    }
    ws.roomId = null;
  });
  activeRooms.delete(room.roomId);
}

function cleanPlayerQueues(ws) {
  ['TIMED', 'UNTIMED'].forEach(q => {
    const idx = queues[q].indexOf(ws);
    if (idx !== -1) queues[q].splice(idx, 1);
  });
  if (ws.privateCode && privateRooms.has(ws.privateCode)) {
    privateRooms.delete(ws.privateCode);
    ws.privateCode = null;
  }
}

function handleDisconnect(ws) {
  cleanPlayerQueues(ws);
  if (ws.roomId && activeRooms.has(ws.roomId)) {
    const room = activeRooms.get(ws.roomId);
    if (room.timeoutHandle) clearTimeout(room.timeoutHandle);
    if (!room.isSolo) {
      const opponentId = Object.keys(room.players).find(id => id !== ws.id);
      if (opponentId && room.players[opponentId]?.ws.readyState === WebSocket.OPEN) {
        room.players[opponentId].ws.send(JSON.stringify({ type: 'S2C_OPPONENT_DISCONNECTED' }));
      }
    }
    activeRooms.delete(ws.roomId);
  }
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`🚀 Anagram Arena live at http://localhost:${PORT}`));