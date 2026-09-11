'use strict';
const { openRequest, readBody, withNetworkRetry, makeNetError } = require('./netClient');

/**
 * GET de JSON (manifestos da Mojang, index de runtime, lista de mods).
 *
 * Antes isto era um `https.get` cru que resolvia `JSON.parse` do corpo sem
 * olhar o status: uma resposta 404 ou uma página de portal cativo de Wi-Fi
 * chegava como HTML e o launcher reportava "Unexpected token '<' in JSON",
 * que não diz nada sobre a causa real. Agora o status é checado antes, e o
 * corpo entra na mensagem de erro truncado para o log continuar legível.
 */
async function httpGetJson(url, { attempts = 4, onRetry = null } = {}) {
  return withNetworkRetry(async () => {
    const res = await openRequest(url);

    if (res.statusCode !== 200) {
      // Consome e descarta o corpo para não deixar o socket preso.
      const body = await readBody(res.stream, { abort: res.abort, limitBytes: 64 * 1024 }).catch(() => Buffer.alloc(0));
      const preview = body.toString('utf8').replace(/\s+/g, ' ').slice(0, 200);
      throw makeNetError(
        'EHTTPSTATUS',
        `HTTP ${res.statusCode} em ${url}${preview ? ` — resposta: ${preview}` : ''}`,
        { statusCode: res.statusCode, url }
      );
    }

    const body = await readBody(res.stream, { abort: res.abort });
    const text = body.toString('utf8');
    try {
      return JSON.parse(text);
    } catch (err) {
      const preview = text.replace(/\s+/g, ' ').slice(0, 200);
      // JSON inválido num 200 quase sempre é proxy/portal cativo devolvendo
      // HTML. Repetir não resolve, então marcamos como não-transitório.
      throw makeNetError(
        'EBADJSON',
        `Resposta inválida (não é JSON) de ${url}: ${preview}`,
        { retryable: false, url, cause: err }
      );
    }
  }, { attempts, onRetry });
}

module.exports = { httpGetJson };
