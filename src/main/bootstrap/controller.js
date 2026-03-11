'use strict';
const BootstrapLogger = require('./logger');
const RuntimeDetector = require('./detector');
const RuntimeInstaller = require('./installer');

/**
 * Orchestrates the bootstrap flow with clear state transitions:
 *
 *   checking_bundled -> runtime_found | checking_system
 *   checking_system  -> runtime_found | checking_common
 *   checking_common  -> runtime_found | runtime_not_found
 *   runtime_not_found -> downloading_runtime
 *   downloading_runtime -> extracting_runtime -> validating_runtime -> runtime_found
 *   runtime_found -> completed
 *   (any step)    -> failed
 */
class BootstrapController {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.logger = new BootstrapLogger(baseDir);
    this.detector = new RuntimeDetector(this.logger, baseDir);
    this.installer = new RuntimeInstaller(this.logger, baseDir);
    this.state = 'idle';
    this.result = null;
    this.error = null;
  }

  setSender(webContents) {
    this.logger.setSender(webContents);
  }

  setState(state, detail) {
    this.state = state;
    this.logger.state(state, detail || '');
  }

  /**
   * Run the full bootstrap: detect -> install if needed -> validate.
   * Returns { ok, javaPath, javaVersion, source } or { ok: false, error }.
   */
  async run() {
    this.error = null;
    this.result = null;

    try {
      // Step 1: Detect bundled
      this.setState('checking_bundled');
      let found = this.detector.detectBundled();

      // Step 2: Detect system
      if (!found) {
        this.setState('checking_system');
        found = this.detector.detectSystem();
      }

      // Step 3: Detect common paths
      if (!found) {
        this.setState('checking_common');
        found = this.detector.detectCommonPaths();
      }

      // If found, we're done
      if (found) {
        this.setState('runtime_found', `Java ${found.version} at ${found.path} (${found.source})`);
        this.result = found;
        this.setState('completed');
        return {
          ok: true,
          javaPath: found.path,
          javaVersion: found.version,
          source: found.source,
        };
      }

      // Step 4: Not found — download and install
      this.setState('runtime_not_found');
      this.logger.log('No compatible Java runtime found. Will download Adoptium JDK 21.');

      this.setState('downloading_runtime');
      const installResult = await this.installer.install((pct, downloaded, total) => {
        this.logger.progress({
          phase: 'downloading',
          percent: pct,
          downloaded,
          total,
        });
      });

      this.setState('validating_runtime');
      if (!installResult.valid) {
        throw new Error('Installed runtime validation failed');
      }

      this.result = { ...installResult, source: 'installed' };
      this.setState('runtime_found', `Java ${installResult.version} (freshly installed)`);
      this.setState('completed');

      return {
        ok: true,
        javaPath: installResult.path,
        javaVersion: installResult.version,
        source: 'installed',
      };
    } catch (err) {
      this.error = err.message;
      this.setState('failed', err.message);
      this.logger.error(err.stack || err.message);
      return { ok: false, error: err.message };
    }
  }

  getLogPath() {
    return this.logger.getLogPath();
  }
}

module.exports = BootstrapController;
