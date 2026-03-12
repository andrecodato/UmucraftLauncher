'use strict';
const https = require('https');
const http = require('http');
const { CONFIG } = require('../utils/paths');

function fetchManifest() {
  return new Promise((resolve, reject) => {
    const request = (url) => {
      const proto = url.startsWith('https') ? https : http;
      proto.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) {
          res.resume();
          return request(res.headers.location);
        }
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      }).on('error', reject);
    };
    request(CONFIG.MANIFEST_URL);
  });
}

module.exports = { fetchManifest };
