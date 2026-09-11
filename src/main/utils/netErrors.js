'use strict';

/**
 * Classificação e tradução de erros de rede.
 *
 * Duas stacks diferentes chegam aqui e reportam a mesma falha de formas
 * distintas: o `https` do Node usa `err.code` no estilo OpenSSL/libuv
 * (`ECONNRESET`, `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`), enquanto o `net` do
 * Electron (stack do Chromium) devolve o código embutido na mensagem
 * (`net::ERR_CONNECTION_RESET`) e frequentemente sem `err.code` nenhum.
 * Todas as funções abaixo olham código *e* mensagem por causa disso.
 */

// Falhas transitórias: a mesma requisição, repetida, tem chance real de passar.
const RETRYABLE = new Set([
  // Node / libuv
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETRESET',
  'ENETDOWN',
  'ERR_STREAM_PREMATURE_CLOSE',
  // Nossos
  'EIDLETIMEOUT',
  'ECONTENTLENGTH',
  'EHASHMISMATCH',
  // Chromium (Electron net)
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_ABORTED',
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_CONNECTION_FAILED',
  'ERR_TIMED_OUT',
  'ERR_EMPTY_RESPONSE',
  'ERR_CONTENT_LENGTH_MISMATCH',
  'ERR_INCOMPLETE_CHUNKED_ENCODING',
  'ERR_NETWORK_CHANGED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_NAME_RESOLUTION_FAILED',
  'ERR_SOCKET_NOT_CONNECTED',
  'ERR_ADDRESS_UNREACHABLE',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_HTTP2_PING_FAILED',
  'ERR_QUIC_PROTOCOL_ERROR',
  'ERR_SSL_PROTOCOL_ERROR',
]);

// Cadeia de confiança TLS quebrada. Nunca é transitório: repetir dá o mesmo
// erro. Quase sempre é antivírus ou proxy fazendo inspeção HTTPS com um
// certificado raiz que a stack usada não conhece.
const TLS_TRUST = new Set([
  // Node / OpenSSL
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_UNTRUSTED',
  'CERT_CHAIN_TOO_LONG',
  // Chromium
  'ERR_CERT_AUTHORITY_INVALID',
  'ERR_CERT_INVALID',
  'ERR_CERT_SYMANTEC_LEGACY',
  'ERR_CERT_WEAK_SIGNATURE_ALGORITHM',
  'ERR_SSL_CLIENT_AUTH_CERT_NEEDED',
]);

// Certificado válido, relógio errado (ou cert expirado de verdade).
const TLS_DATE = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_CERT_DATE_INVALID',
]);

/**
 * Extrai um código canônico do erro, venha ele do Node (`err.code`) ou do
 * Chromium (`net::ERR_FOO` dentro da mensagem).
 */
function errorCode(err) {
  if (!err) return '';
  if (err.code) return String(err.code).toUpperCase();

  const msg = String(err.message || '');
  const chromium = msg.match(/\bERR_[A-Z0-9_]+/);
  if (chromium) return chromium[0];

  // O Node às vezes só tem a mensagem ("socket hang up").
  if (/socket hang up/i.test(msg)) return 'ECONNRESET';
  if (/unable to get local issuer certificate/i.test(msg)) return 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY';
  if (/self[- ]signed certificate/i.test(msg)) return 'SELF_SIGNED_CERT_IN_CHAIN';
  if (/certificate has expired/i.test(msg)) return 'CERT_HAS_EXPIRED';

  return '';
}

function isRetryableError(err) {
  if (!err) return false;
  if (err.retryable === true) return true;
  if (err.retryable === false) return false;
  // Servidor sobrecarregado ou limitando: vale tentar de novo.
  if (typeof err.statusCode === 'number') {
    return err.statusCode === 408 || err.statusCode === 425 || err.statusCode === 429 || err.statusCode >= 500;
  }
  return RETRYABLE.has(errorCode(err));
}

function isTlsTrustError(err) {
  const code = errorCode(err);
  return TLS_TRUST.has(code) || TLS_DATE.has(code);
}

/**
 * Mensagem em PT-BR pro jogador, explicando a causa provável e o que fazer.
 * O erro técnico original continua indo pro log — isto é só a camada de cima.
 */
function describeNetworkError(err) {
  const code = errorCode(err);
  const raw = String(err && err.message ? err.message : err || 'erro desconhecido');

  if (TLS_TRUST.has(code)) {
    return 'Não foi possível validar o certificado de segurança do servidor. '
      + 'Isso costuma acontecer quando um antivírus (Kaspersky, ESET, Avast, Bitdefender) '
      + 'ou o proxy/firewall da sua rede está inspecionando conexões HTTPS. '
      + 'Desative a inspeção/varredura HTTPS do antivírus, ou tente em outra rede (ex: seu celular).';
  }

  if (TLS_DATE.has(code)) {
    return 'O certificado do servidor foi recusado por data inválida. '
      + 'Verifique se a data, a hora e o fuso horário do seu computador estão corretos e tente de novo.';
  }

  switch (code) {
    case 'ECONNRESET':
    case 'ERR_CONNECTION_RESET':
    case 'ERR_CONNECTION_CLOSED':
    case 'ERR_CONNECTION_ABORTED':
      return 'A conexão foi interrompida pelo servidor ou pela sua rede durante o download, '
        + 'mesmo após várias tentativas. Verifique sua internet (Wi-Fi instável, VPN ou antivírus '
        + 'bloqueando) e tente novamente.';

    case 'EIDLETIMEOUT':
    case 'ETIMEDOUT':
    case 'ERR_TIMED_OUT':
    case 'ERR_CONNECTION_TIMED_OUT':
      return 'O download travou sem receber dados novos. A conexão pode estar muito lenta ou '
        + 'bloqueada. Tente novamente, de preferência em outra rede.';

    case 'EAI_AGAIN':
    case 'ERR_NAME_NOT_RESOLVED':
    case 'ERR_NAME_RESOLUTION_FAILED':
      return 'Não foi possível resolver o endereço do servidor (falha de DNS). '
        + 'Verifique sua conexão com a internet ou troque o DNS (ex: 1.1.1.1).';

    case 'ECONNREFUSED':
    case 'ERR_CONNECTION_REFUSED':
      return 'O servidor recusou a conexão. Ele pode estar fora do ar no momento — tente de novo em alguns minutos.';

    case 'ERR_INTERNET_DISCONNECTED':
      return 'Sem conexão com a internet. Reconecte e tente novamente.';

    case 'EHASHMISMATCH':
      return 'O arquivo baixado chegou corrompido (verificação de integridade falhou) mesmo após '
        + 'novas tentativas. Pode ser cache intermediário do provedor ou do antivírus. '
        + 'Tente novamente mais tarde ou em outra rede.';

    case 'ECONTENTLENGTH':
    case 'ERR_CONTENT_LENGTH_MISMATCH':
    case 'ERR_INCOMPLETE_CHUNKED_ENCODING':
      return 'O download terminou incompleto. Sua conexão foi cortada no meio do arquivo. Tente novamente.';

    case 'ENOSPC':
      return 'Sem espaço em disco para concluir o download. Libere espaço e tente novamente.';

    case 'EACCES':
    case 'EPERM':
      return 'Sem permissão para gravar o arquivo. Feche o Minecraft, verifique se o antivírus não está '
        + 'bloqueando a pasta do launcher e tente novamente.';

    case 'ETOOMANYREDIRECTS':
      return 'O servidor entrou em um loop de redirecionamentos. Isso costuma indicar um portal de '
        + 'login de rede (Wi-Fi público/universitário) interceptando o download.';

    default:
      break;
  }

  if (typeof err?.statusCode === 'number') {
    if (err.statusCode === 404) return `Arquivo não encontrado no servidor (HTTP 404). ${raw}`;
    if (err.statusCode === 429) return 'O servidor está limitando downloads (HTTP 429). Aguarde alguns minutos e tente novamente.';
    if (err.statusCode >= 500) return `O servidor de download está com problemas (HTTP ${err.statusCode}). Tente novamente mais tarde.`;
    if (err.statusCode === 403) return `Acesso negado pelo servidor (HTTP 403). ${raw}`;
  }

  return raw;
}

module.exports = { errorCode, isRetryableError, isTlsTrustError, describeNetworkError };
