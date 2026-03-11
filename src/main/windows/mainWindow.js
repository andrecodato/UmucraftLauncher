'use strict';
const { BrowserWindow } = require('electron');
const path = require('path');
const state = require('../state');

function createMainWindow() {
  state.mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    transparent: false,
    resizable: true,
    icon: path.join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload.js'),
    },
    backgroundColor: '#0d1117',
  });

  state.mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));

  if (process.argv.includes('--dev')) {
    state.mainWindow.webContents.openDevTools();
  }
}

module.exports = { createMainWindow };
