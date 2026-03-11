'use strict';
const https = require('https');
const http = require('http');
const { CONFIG } = require('../utils/paths');

function fetchManifest() {
  return new Promise((resolve, reject) => {
    const proto = CONFIG.MANIFEST_URL.startsWith('https') ? https : http;
    proto.get(CONFIG.MANIFEST_URL, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        https.get(res.headers.location, (r2) => {
          let data = '';
          r2.on('data', c => data += c);
          r2.on('end', () => {
            try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
          });
        }).on('error', reject);
        return;
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

module.exports = { fetchManifest };
