'use strict';

/**
 * Mutable application state shared across main-process modules.
 * Import this object from any module to read/write shared state.
 */
module.exports = {
  mainWindow: null,
  bootstrapWindow: null,
  bootstrapCtrl: null,
  resolvedJavaPath: null,
};
