const fs = require('fs');
const path = require('path');

// Ensure public folder exists
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

function createIcon(size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="100%" height="100%" fill="#1e293b"/>
  <text x="50%" y="58%" font-size="${Math.floor(size * 0.5)}" font-weight="bold" fill="#38bdf8" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">A</text>
</svg>`;

  return Buffer.from(svg);
}

// Generate files in public/
fs.writeFileSync(path.join(publicDir, 'icon-192.png'), createIcon(192));
fs.writeFileSync(path.join(publicDir, 'icon-512.png'), createIcon(512));

console.log('✅ Icons generated successfully in public/');