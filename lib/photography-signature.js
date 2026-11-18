'use strict';
const { deflateSync } = require('node:zlib');

// The booking sheet accepts at most 1,000 characters in Notes. A monochrome
// PNG keeps handwriting private and self-contained in the original booking row.
function pngChunk(type, data) {
  const tag = Buffer.from(type, 'ascii');
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([tag, data])) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, tag, data, checksum]);
}

function signaturePng(mask, width, height) {
  const stride = width / 8 + 1;
  const scan = Buffer.alloc(stride * height, 255);
  for (let y = 0; y < height; y++) scan[y * stride] = 0;
  for (let y = 0; y < 80; y++) {
    for (let x = 0; x < 320; x++) {
      if (!(mask[y * 40 + (x >> 3)] & (128 >> (x % 8)))) continue;
      const destX = Math.floor(x * width / 320);
      const destY = Math.floor(y * height / 80);
      scan[destY * stride + 1 + (destX >> 3)] &= ~(128 >> (destX % 8));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 1; // one-bit grayscale
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'), pngChunk('IHDR',header),
    pngChunk('IDAT',deflateSync(scan)),pngChunk('IEND',Buffer.alloc(0))]);
}

function signatureNotes(signature, version) {
  if (typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version) || !signature) return null;
  const prefix = 'Terms ' + version + '\n';
  if (signature.type === 'typed') {
    const name = typeof signature.name === 'string' && signature.name.trim();
    return name && name.length <= 120 && !/[\x00-\x1f\x7f]/u.test(name) ? prefix + 'Signed: ' + name : null;
  }
  if (signature.type !== 'drawn' || typeof signature.ink !== 'string' || signature.ink.length !== 4268) return null;
  const mask = Buffer.from(signature.ink, 'base64');
  if (mask.length !== 3200 || mask.toString('base64') !== signature.ink || !mask.some(Boolean)) return null;
  for (const [w,h] of [[320,80],[240,60],[176,44],[128,32]]) {
    const notes = prefix + 'Signature: data:image/png;base64,' + signaturePng(mask,w,h).toString('base64');
    if (notes.length <= 1000) return notes;
  }
  return null;
}
module.exports = { signatureNotes };
