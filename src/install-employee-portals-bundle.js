'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const partsDir = path.join(__dirname, 'employee-portal-bundle-parts');
const encoded = fs.readdirSync(partsDir).filter(name => name.endsWith('.txt')).sort()
  .map(name => fs.readFileSync(path.join(partsDir, name), 'utf8').trim()).join('');
const payload = JSON.parse(zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8'));
for (const [relative, content] of Object.entries(payload)) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
fs.rmSync(partsDir, { recursive: true, force: true });
const placeholder = path.join(root, '__placeholder__');
if (fs.existsSync(placeholder)) fs.unlinkSync(placeholder);
fs.unlinkSync(__filename);
console.log(`[employee-portals] installed ${Object.keys(payload).length} source files`);
