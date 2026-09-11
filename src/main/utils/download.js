'use strict';
const fs = require('fs');
const path = require('path');
const { send } = require('./ipcSender');
const { hashFile } = require('./fileHash');
const {
  openRequest,
  withNetworkRetry,
  headerValue,
  makeNetError,
  IDLE_TIMEOUT_MS,
} = require('./netClient');

const DEFAULT_ATTEMPTS = 5;

/**
 * Baixa um arquivo com retry, retomada e verificação de integridade.
 *
 * Três decisões de desenho importam aqui, todas motivadas por bug real:
 *
 *  - **Grava em `.part` e só renomeia no fim.** A versão anterior escrevia
 *    direto no destino final. Uma conexão cortada no meio deixava um .jar
 *    truncado no disco, e como todo o código de instalação decide o que
 *    baixar com `fs.existsSync()`, o arquivo quebrado era tratado como
 *    completo para sempre. O sintoma chegava depois, como crash do
 *    Minecraft sem relação nenhuma com rede.
 *  - **Retoma com `Range` quando o servidor aceita.** Sem isso, um reset
 *    aos 90% de um arquivo grande recomeça do zero — e numa conexão que
 *    reseta, recomeçar do zero tende a resetar de novo.
 *  - **Confere o hash antes de renomear.** A Mojang publica sha1 de cada
 *    library/asset/client e o manifest do servidor publica md5 dos zips.
 *    Nada disso era verificado; corrupção silenciosa passava direto.
 */
async function downloadFile(url, destPath, progressLabel, options = {}) {
  const {
    silent = false,
    sha1 = null,
    md5 = null,
    attempts = DEFAULT_ATTEMPTS,
    idleTimeoutMs = IDLE_TIMEOUT_MS,
    onProgress = null,
    onRetry = null,
  } = options;

  const expected = sha1 ? { algo: 'sha1', value: sha1.toLowerCase() }
    : md5 ? { algo: 'md5', value: md5.toLowerCase() }
      : null;

  const partPath = `${destPath}.part`;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  // Retomada vale apenas *dentro* desta chamada. Um `.part` que sobrou de
  // uma execução anterior do launcher não é confiável: caminhos de destino
  // são reutilizados entre versões (`tmp/umulauncher-mods/mods.zip` é sempre
  // o mesmo), então retomar por cima dele juntaria a metade de um zip antigo
  // com a metade de um novo. Onde há hash isso seria pego e refeito, mas em
  // arquivo sem hash publicado (instalador do NeoForge, version.json sem
  // md5) passaria batido e geraria corrupção silenciosa.
  safeUnlink(partPath);

  const emit = (downloaded, total) => {
    if (total > 0) {
      const percent = Math.min(100, Math.round((downloaded / total) * 100));
      if (onProgress) onProgress(percent, downloaded, total);
      if (!silent) send('download-progress', { label: progressLabel, percent, downloaded, total });
    }
  };

  // Hash errado quase nunca é transitório: o caso comum é borda de CDN
  // servindo conteúdo velho para uma URL que mudou (ver CLAUDE.md). Vale
  // uma segunda tentativa (corrupção real em trânsito acontece), mas
  // repetir 5 downloads de um zip de centenas de MB contra um cache
  // envenenado só desperdiça a banda do jogador.
  const MAX_HASH_FAILURES = 2;
  let hashFailures = 0;

  try {
    await withNetworkRetry(
      async () => {
        // Só retoma se o .part de uma tentativa anterior ainda estiver lá.
        let resumeFrom = 0;
        try {
          const stat = fs.statSync(partPath);
          if (stat.isFile()) resumeFrom = stat.size;
        } catch { /* primeiro try: não existe */ }

        await fetchToPart(url, partPath, resumeFrom, { idleTimeoutMs, emit });

        if (expected) {
          const actual = await hashFile(partPath, expected.algo);
          if (actual !== expected.value) {
            // Descarta o parcial: retomar por cima de bytes corrompidos só
            // reproduz o mesmo hash errado na próxima tentativa.
            safeUnlink(partPath);
            hashFailures++;
            throw makeNetError(
              'EHASHMISMATCH',
              `${expected.algo} inválido para ${path.basename(destPath)}: esperado ${expected.value}, obteve ${actual}`,
              { url, retryable: hashFailures < MAX_HASH_FAILURES }
            );
          }
        }
      },
      {
        attempts,
        onRetry: ({ attempt, attempts: total, error, delayMs }) => {
          if (!silent) {
            send('status', `Falha de rede em ${path.basename(destPath)} (${error.code || 'erro'}), `
              + `tentando de novo em ${Math.round(delayMs / 1000)}s... (${attempt}/${total - 1})`);
          }
          if (onRetry) onRetry({ attempt, attempts: total, error, delayMs });
        },
      }
    );
  } catch (err) {
    // Nunca deixar parcial no disco após desistir: na próxima execução ele
    // seria retomado a partir de um estado que já provou não funcionar.
    safeUnlink(partPath);
    throw err;
  }

  // rename por cima de um destino existente é atômico no mesmo volume, e
  // `.part` mora ao lado do destino justamente para garantir isso.
  fs.renameSync(partPath, destPath);
}

/**
 * Uma tentativa: abre a requisição (com `Range` se estamos retomando),
 * escreve no `.part` e resolve quando o corpo termina íntegro.
 */
function fetchToPart(url, partPath, resumeFrom, { idleTimeoutMs, emit }) {
  return new Promise((resolve, reject) => {
    const headers = resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-` } : {};

    openRequest(url, { headers }).then((res) => {
      const { statusCode, headers: resHeaders, stream, abort } = res;

      // Redirects já foram seguidos pela camada de baixo; qualquer coisa que
      // não seja 200/206 aqui é falha. `statusCode` vai junto no erro para
      // `isRetryableError` decidir se 429/5xx merecem nova tentativa.
      if (statusCode !== 200 && statusCode !== 206) {
        stream.resume();
        return reject(makeNetError('EHTTPSTATUS', `HTTP ${statusCode} em ${url}`, { statusCode, url }));
      }

      // Pedimos Range mas o servidor mandou o arquivo inteiro: recomeça o
      // `.part` do zero, senão o arquivo sairia com o prefixo duplicado.
      let startAt = resumeFrom;
      if (resumeFrom > 0 && statusCode === 200) {
        startAt = 0;
        safeUnlink(partPath);
      }

      const contentLength = parseInt(headerValue(resHeaders, 'content-length') || '0', 10) || 0;
      const total = contentLength > 0 ? startAt + contentLength : 0;

      const file = fs.createWriteStream(partPath, startAt > 0 ? { flags: 'a' } : { flags: 'w' });
      let downloaded = startAt;
      let settled = false;
      let idleTimer;

      const cleanup = () => { clearTimeout(idleTimer); };

      const fail = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        try { abort(); } catch { /* já morto */ }
        // O `.part` fica no disco de propósito: é o ponto de retomada.
        file.destroy();
        reject(err);
      };

      const armIdleTimer = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          fail(makeNetError(
            'EIDLETIMEOUT',
            `Download de ${path.basename(partPath)} parado há ${Math.round(idleTimeoutMs / 1000)}s`,
            { url }
          ));
        }, idleTimeoutMs);
      };

      armIdleTimer();

      stream.on('data', (chunk) => {
        downloaded += chunk.length;
        armIdleTimer();
        emit(downloaded, total);
      });

      stream.on('error', fail);
      file.on('error', fail);

      stream.pipe(file);

      file.on('finish', () => {
        if (settled) return;
        cleanup();

        // Corte limpo no meio de uma resposta chega aqui como "terminou":
        // o socket fechou, o pipe fechou o arquivo, nenhum 'error' disparou.
        // Comparar com o content-length é o que separa o arquivo completo do
        // truncado — sem isso o `.part` seria promovido a arquivo bom.
        if (total > 0 && downloaded !== total) {
          settled = true;
          return reject(makeNetError(
            'ECONTENTLENGTH',
            `Download incompleto de ${path.basename(partPath)}: ${downloaded}/${total} bytes`,
            { url }
          ));
        }

        // `close` garante o flush ao disco antes de qualquer hash/rename.
        file.close((err) => {
          if (settled) return;
          settled = true;
          if (err) return reject(err);
          resolve();
        });
      });
    }, reject);
  });
}

function safeUnlink(filePath) {
  try { fs.unlinkSync(filePath); } catch { /* já não existe */ }
}

module.exports = { downloadFile };
