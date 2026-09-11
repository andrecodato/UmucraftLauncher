'use strict';
const { httpGetJson } = require('../utils/http');
const { CONFIG } = require('../utils/paths');

/**
 * Busca o `manifest.json` publicado pelo file-server.
 *
 * Era um `https.get` próprio que resolvia `JSON.parse` do corpo sem olhar o
 * status HTTP: um 404 ou uma página de portal cativo virava "Unexpected
 * token '<'". Passou a usar a camada compartilhada, que checa status, segue
 * redirect com limite, tenta de novo em falha transitória e sai pela stack
 * de rede do Electron (repositório de certificados e proxy do sistema).
 */
function fetchManifest() {
  return httpGetJson(CONFIG.MANIFEST_URL);
}

module.exports = { fetchManifest };
