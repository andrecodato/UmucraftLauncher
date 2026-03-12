'use strict';
const fs = require('fs');
const https = require('https');
const http = require('http');
const { send } = require('./ipcSender');

function downloadFile(url, destPath, progressLabel, { silent = false } = {}) {
  return new Promise((resolve, reject) => {
    let downloaded = 0;
    let total = 0;

    const request = (reqUrl) => {
      const proto = reqUrl.startsWith('https') ? https : http;
      proto.get(reqUrl, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) {
          res.resume();
          return request(res.headers.location);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`));
          return;
        }
        total = parseInt(res.headers['content-length'] || '0', 10);
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (!silent && total > 0) {
            const pct = Math.round((downloaded / total) * 100);
            send('download-progress', { label: progressLabel, percent: pct, downloaded, total });
          }
        });
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', reject);
        res.on('error', reject);
      }).on('error', reject);
    };

    request(url);
  });
}

module.exports = { downloadFile };
