'use strict';
const { app } = require('electron');
const { ensureDirectories, BASE_DIR } = require('./utils/paths');
const { createMainWindow } = require('./windows/mainWindow');
const { createBootstrapWindow } = require('./windows/bootstrapWindow');
const { ensureDefaultProfile } = require('./services/profileService');
const { checkForAppUpdate } = require('./services/appUpdater');
const BootstrapController = require('./bootstrap/controller');
const BootstrapLogger = require('./bootstrap/logger');
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
  await new Promise((resolve) => {
    state.bootstrapWindow.webContents.once('did-finish-load', resolve);
  });

  const logger = new BootstrapLogger(BASE_DIR);
  logger.setSender(state.bootstrapWindow.webContents);

  if (app.isPackaged) {
    const updated = await checkForAppUpdate(logger);
    if (updated) return; // app is restarting to install the new version
  }

  state.bootstrapCtrl = new BootstrapController(BASE_DIR, logger);

  const result = await state.bootstrapCtrl.run();

  if (!result.ok) return;

  state.resolvedJavaPath = result.javaPath;
  state.resolvedJavaVersion = result.javaVersion;

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
