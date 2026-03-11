'use strict';
const fs = require('fs');
const crypto = require('crypto');

function fileHash(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(buf).digest('hex');
  } catch {
    return null;
  }
}

module.exports = { fileHash };
