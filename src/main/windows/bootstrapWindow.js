'use strict';
const { BrowserWindow } = require('electron');
const path = require('path');
const state = require('../state');

function createBootstrapWindow() {
  state.bootstrapWindow = new BrowserWindow({
    width: 520,
    height: 400,
    resizable: false,
    frame: false,
    transparent: false,
    icon: path.join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../bootstrap-preload.js'),
    },
    backgroundColor: '#0d1117',
  });

  state.bootstrapWindow.loadFile(path.join(__dirname, '../../renderer/bootstrap.html'));
}

module.exports = { createBootstrapWindow };
