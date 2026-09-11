'use strict';
const fs = require('fs');
const crypto = require('crypto');

/**
 * Hash de arquivo por streaming.
 *
 * A versão anterior fazia `readFileSync` + hash síncrono. Para o `mods.zip`
 * (centenas de MB) isso carregava o arquivo inteiro na memória e travava o
 * processo principal do Electron durante todo o cálculo — a janela congela e
 * nenhum evento de progresso chega até terminar. Streaming resolve os dois
 * problemas: memória constante e event loop livre.
 *
 * Resolve com `null` se o arquivo não puder ser lido, mantendo o contrato da
 * função antiga (quem compara com um hash esperado trata `null` como "não
 * bate", que é o comportamento correto).
 */
function hashFile(filePath, algo = 'md5') {
  return new Promise((resolve) => {
    let stream;
    try {
      stream = fs.createReadStream(filePath);
    } catch {
      return resolve(null);
    }

    const hash = crypto.createHash(algo);
    stream.on('error', () => resolve(null));
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** Atalho para md5, que é o que o `manifest.json` publica. */
function fileHash(filePath) {
  return hashFile(filePath, 'md5');
}

module.exports = { fileHash, hashFile };
