'use strict';
const { app } = require('electron');
const { ensureDirectories, BASE_DIR } = require('./utils/paths');
const { createMainWindow } = require('./windows/mainWindow');
const { createBootstrapWindow } = require('./windows/bootstrapWindow');
const { ensureDefaultProfile } = require('./services/profileService');
const BootstrapController = require('./bootstrap/controller');
const state = require('./state');

// Register all IPC handlers
const { registerWindowIpc } = require('./ipc/windowIpc');
const { registerBootstrapIpc } = require('./ipc/bootstrapIpc');
const { registerConfigIpc } = require('./ipc/configIpc');
const { registerLauncherIpc } = require('./ipc/launcherIpc');
const { registerServerIpc } = require('./ipc/serverIpc');
const { registerUtilIpc } = require('./ipc/utilIpc');

registerWindowIpc();
registerBootstrapIpc();
registerConfigIpc();
registerLauncherIpc();
registerServerIpc();
registerUtilIpc();

// ─── BOOTSTRAP ──────────────────────────────────────────────────────────────
async function runBootstrap() {
  state.bootstrapCtrl = new BootstrapController(BASE_DIR);

  await new Promise((resolve) => {
    state.bootstrapWindow.webContents.once('did-finish-load', resolve);
  });

  state.bootstrapCtrl.setSender(state.bootstrapWindow.webContents);

  const result = await state.bootstrapCtrl.run();

  if (!result.ok) return;

  state.resolvedJavaPath = result.javaPath;

  state.bootstrapCtrl.logger.state('preparing_profile');
  try {
    await ensureDefaultProfile();
  } catch (err) {
    state.bootstrapCtrl.logger.error(`Profile preparation failed: ${err.message}`);
  }

  await new Promise(r => setTimeout(r, 800));

  createMainWindow();
  if (state.bootstrapWindow && !state.bootstrapWindow.isDestroyed()) {
    state.bootstrapWindow.close();
    state.bootstrapWindow = null;
  }
}

// ─── APP LIFECYCLE ──────────────────────────────────────────────────────────
app.whenReady().then(() => {
  ensureDirectories();
  createBootstrapWindow();
  runBootstrap();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
