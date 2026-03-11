'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

class BootstrapLogger {
  constructor(baseDir) {
    this.logDir = path.join(baseDir, 'logs');
    fs.mkdirSync(this.logDir, { recursive: true });
    this.logPath = path.join(this.logDir, 'bootstrap.log');
    this._sender = null;

    const header = [
      '=== UmuCraft Bootstrap Log ===',
      `Date: ${new Date().toISOString()}`,
      `Platform: ${process.platform} ${os.arch()}`,
      `Node: ${process.version}`,
      '='.repeat(50),
      '',
    ].join('\n');
    fs.writeFileSync(this.logPath, header, 'utf8');
  }

  setSender(webContents) {
    this._sender = webContents;
  }

  log(msg) {
    const ts = new Date().toISOString().slice(11, 23);
    const line = `[${ts}] ${msg}`;
    fs.appendFileSync(this.logPath, line + '\n', 'utf8');
    console.log(`[Bootstrap] ${msg}`);
    this._emit('bootstrap-log', msg);
  }

  error(msg) {
    this.log(`ERROR: ${msg}`);
  }

  state(state, detail = '') {
    this.log(`STATE -> ${state}${detail ? ': ' + detail : ''}`);
    this._emit('bootstrap-state', { state, detail });
  }

  progress(data) {
    this._emit('bootstrap-progress', data);
  }

  _emit(channel, data) {
    if (this._sender && !this._sender.isDestroyed()) {
      this._sender.send(channel, data);
    }
  }

  getLogPath() {
    return this.logPath;
  }
}

module.exports = BootstrapLogger;
