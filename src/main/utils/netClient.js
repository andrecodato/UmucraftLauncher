'use strict';
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { errorCode, isRetryableError } = require('./netErrors');

/**
 * Camada única de HTTP do launcher.
 *
 * Toda requisição passa por aqui e, sempre que possível, sai pelo módulo
 * `net` do Electron (stack de rede do Chromium) em vez do `https` do Node.
 * A diferença importa por dois motivos concretos que já quebraram o
 * launcher em produção:
 *
 *  1. **Certificados.** O `https` do Node valida contra um bundle de CAs
 *     compilado junto com o binário e ignora o repositório de certificados
 *     do sistema operacional. Quando um antivírus ou o proxy da rede faz
 *     inspeção HTTPS, ele instala o próprio certificado raiz no store do
 *     Windows — o Chromium enxerga, o Node não, e o download morre com
 *     "unable to get local issuer certificate". Isso não é um problema de
 *     internet do jogador e nenhuma quantidade de retry resolve.
 *  2. **Proxy.** O Chromium honra a configuração de proxy do sistema
 *     (inclusive PAC/WPAD, comuns em rede corporativa e universitária);
 *     o `https` do Node ignora tudo isso.
 *
 * O caminho pelo Node continua existindo como fallback para quando este
 * módulo é carregado fora de um processo Electron pronto (scripts, testes).
 *
 * Timeout é dividido em dois porque um só não serve: `CONNECT_TIMEOUT_MS`
 * mata conexão que nunca responde, e `IDLE_TIMEOUT_MS` mata download que
 * parou de receber bytes. Um timeout absoluto mataria também o download
 * lento mas saudável de quem tem internet ruim — exatamente o jogador que
 * mais precisa que funcione.
 */

const CONNECT_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;

let USER_AGENT = 'UmuCraftLauncher';
try {
  // Alguns CDNs (GitHub Releases entre eles) tratam cliente sem User-Agent
  // de forma diferente — de throttling a bloqueio direto.
  const pkg = require('../../../package.json');
  USER_AGENT = `UmuCraftLauncher/${pkg.version} (+https://github.com/andrecodato/UmucraftLauncher)`;
} catch { /* fora do bundle: fica o nome sem versão */ }

// keep-alive: sem isso, cada um dos milhares de assets do Minecraft abre um
// handshake TLS novo. Com concorrência alta é o caminho mais curto para o
// servidor cortar conexões (ECONNRESET) e para o download ficar lento à toa.
const nodeAgents = {
  'http:': new http.Agent({ keepAlive: true, keepAliveMsecs: 15_000, maxSockets: 16 }),
  'https:': new https.Agent({ keepAlive: true, keepAliveMsecs: 15_000, maxSockets: 16 }),
};

function makeNetError(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function decorateError(err, url) {
  if (err && !err.url) err.url = url;
  return err;
}

/**
 * Lê um header de resposta independente da stack: o `net` do Electron
 * entrega valores como array, o Node entrega string (menos `set-cookie`).
 */
function headerValue(headers, name) {
  if (!headers) return undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function isRedirect(statusCode) {
  return statusCode === 301 || statusCode === 302 || statusCode === 303
    || statusCode === 307 || statusCode === 308;
}

/**
 * Retorna o `net` do Electron se estivermos num processo Electron já pronto.
 * `net.request` antes do `app.whenReady()` lança, por isso a checagem.
 */
function electronNet() {
  try {
    const electron = require('electron');
    if (!electron?.net?.request) return null;
    if (!electron.app?.isReady?.()) return null;
    return electron.net;
  } catch {
    return null;
  }
}

function openViaElectron(net, url, headers, connectTimeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let req;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { req?.abort(); } catch { /* já morto */ }
      reject(decorateError(
        makeNetError('ETIMEDOUT', `Servidor não respondeu em ${Math.round(connectTimeoutMs / 1000)}s: ${url}`),
        url
      ));
    }, connectTimeoutMs);

    try {
      // `redirect: 'follow'` é o padrão do Electron e já respeita um limite
      // interno de redirects — não precisamos contar manualmente aqui.
      req = net.request({ method: 'GET', url, redirect: 'follow' });
    } catch (err) {
      clearTimeout(timer);
      settled = true;
      return reject(decorateError(err, url));
    }

    req.setHeader('User-Agent', USER_AGENT);
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined && value !== null) req.setHeader(key, String(value));
    }

    req.on('response', (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        stream: res,
        abort: () => { try { req.abort(); } catch { /* já morto */ } },
      });
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(decorateError(err, url));
    });

    req.end();
  });
}

function openViaNode(url, headers, connectTimeoutMs, redirects) {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) {
      return reject(decorateError(
        makeNetError('ETOOMANYREDIRECTS', `Mais de ${MAX_REDIRECTS} redirecionamentos a partir de ${url}`),
        url
      ));
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return reject(makeNetError('EBADURL', `URL inválida: ${url}`, { retryable: false, url }));
    }

    const proto = parsed.protocol === 'http:' ? http : https;
    let settled = false;
    let req;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { req?.destroy(); } catch { /* já morto */ }
      reject(decorateError(
        makeNetError('ETIMEDOUT', `Servidor não respondeu em ${Math.round(connectTimeoutMs / 1000)}s: ${url}`),
        url
      ));
    }, connectTimeoutMs);

    req = proto.get(
      url,
      {
        headers: { 'User-Agent': USER_AGENT, ...headers },
        agent: nodeAgents[parsed.protocol] || undefined,
      },
      (res) => {
        if (settled) return;

        const location = headerValue(res.headers, 'location');
        if (isRedirect(res.statusCode) && location) {
          settled = true;
          clearTimeout(timer);
          res.resume(); // libera o socket para o keep-alive
          let next;
          try {
            next = new URL(location, url).toString();
          } catch {
            return reject(makeNetError('EBADURL', `Redirect para URL inválida: ${location}`, { retryable: false, url }));
          }
          return openViaNode(next, headers, connectTimeoutMs, redirects + 1).then(resolve, reject);
        }

        settled = true;
        clearTimeout(timer);
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          stream: res,
          abort: () => { try { req.destroy(); } catch { /* já morto */ } },
        });
      }
    );

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(decorateError(err, url));
    });
  });
}

/**
 * Abre um GET e resolve com `{ statusCode, headers, stream, abort }` assim
 * que os headers chegam. O corpo ainda não foi consumido — quem chama
 * decide se faz pipe pra disco ou acumula em memória.
 */
function openRequest(url, { headers = {}, connectTimeoutMs = CONNECT_TIMEOUT_MS } = {}) {
  const net = electronNet();
  return net
    ? openViaElectron(net, url, headers, connectTimeoutMs)
    : openViaNode(url, headers, connectTimeoutMs, 0);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Backoff exponencial com jitter. O jitter existe porque baixamos com
 * concorrência: sem ele, as N requisições derrubadas pelo mesmo corte de
 * rede voltariam todas no mesmo milissegundo e derrubariam de novo.
 */
function backoffDelay(attempt, baseMs = 500, capMs = 8_000) {
  const exponential = Math.min(capMs, baseMs * 2 ** (attempt - 1));
  return Math.round(exponential / 2 + Math.random() * (exponential / 2));
}

/**
 * Executa `fn` repetindo apenas em erro classificado como transitório.
 * `onRetry({ attempt, attempts, error, delayMs })` permite avisar a UI.
 */
async function withNetworkRetry(fn, { attempts = 5, onRetry = null } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === attempts || !isRetryableError(err)) throw err;
      const delayMs = backoffDelay(attempt);
      if (onRetry) {
        try { onRetry({ attempt, attempts, error: err, delayMs }); } catch { /* aviso não pode derrubar o retry */ }
      }
      await sleep(delayMs);
    }
  }
  throw lastError;
}

/**
 * Lê o corpo inteiro em memória, com timeout de ociosidade. Só para
 * respostas pequenas (JSON de manifesto) — arquivo vai por `download.js`.
 */
function readBody(stream, { idleTimeoutMs = IDLE_TIMEOUT_MS, abort = null, limitBytes = 32 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    let timer;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { abort?.(); } catch { /* já morto */ }
      reject(err);
    };

    const armIdleTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        fail(makeNetError('EIDLETIMEOUT', `Sem dados do servidor por ${Math.round(idleTimeoutMs / 1000)}s`));
      }, idleTimeoutMs);
    };

    armIdleTimer();

    stream.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        return fail(makeNetError('ERESPONSETOOLARGE', `Resposta maior que o limite de ${limitBytes} bytes`, { retryable: false }));
      }
      chunks.push(chunk);
      armIdleTimer();
    });
    stream.on('error', (err) => fail(err));
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
  });
}

module.exports = {
  openRequest,
  readBody,
  withNetworkRetry,
  headerValue,
  isRedirect,
  makeNetError,
  errorCode,
  CONNECT_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  MAX_REDIRECTS,
  USER_AGENT,
};
