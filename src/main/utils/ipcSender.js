'use strict';
const state = require('../state');

function send(event, data) {
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send(event, data);
  }
}

function log(msg) {
  console.log(`[Launcher] ${msg}`);
  send('log', msg);
}

module.exports = { send, log };
