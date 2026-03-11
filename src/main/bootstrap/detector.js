'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXEC_TIMEOUT = 10000; // 10s timeout for java -version

class RuntimeDetector {
  constructor(logger, baseDir) {
    this.logger = logger;
    this.baseDir = baseDir;
    this.javaDir = path.join(baseDir, 'java');
  }

  /**
   * Parse the major Java version from `java -version` / `java --version` output.
   * Supports Oracle Java, OpenJDK, Temurin, Zulu, Corretto, GraalVM, etc.
   * Returns 0 if unparseable.
   */
  static parseMajorVersion(output) {
    if (!output || typeof output !== 'string') return 0;

    // Pattern 1: version "X.Y.Z" (most common across all vendors)
    let m = output.match(/version\s+"(\d+)(?:\.(\d+))?/);
    if (m) {
      const major = parseInt(m[1], 10);
      // Java 1.x format (e.g., "1.8.0_381") → real major = second number
      if (major === 1 && m[2]) return parseInt(m[2], 10);
      return major;
    }

    // Pattern 2: openjdk 17.0.10 or java 21 (without quotes)
    m = output.match(/(?:openjdk|java)\s+(\d+)/i);
    if (m) return parseInt(m[1], 10);

    // Pattern 3: jdk-17, jre-21, etc. in path-like output
    m = output.match(/(?:jdk|jre)[- _]?(\d+)/i);
    if (m) return parseInt(m[1], 10);

    return 0;
  }

  /**
   * Run a java executable and validate its version.
   * Returns { valid, version, path, output } or { valid: false, error }.
   */
  validateExecutable(javaPath) {
    this.logger.log(`Validating: ${javaPath}`);

    if (!fs.existsSync(javaPath)) {
      this.logger.log('  -> File not found');
      return { valid: false, error: 'File not found', path: javaPath };
    }

    try {
      // java -version outputs to stderr; 2>&1 merges streams
      const output = execSync(`"${javaPath}" -version 2>&1`, {
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
        windowsHide: true,
      });

      const version = RuntimeDetector.parseMajorVersion(output);
      const firstLine = output.split(/\r?\n/)[0] || '';
      this.logger.log(`  -> Output: ${firstLine}`);
      this.logger.log(`  -> Parsed major version: ${version}`);

      if (version >= 17) {
        return { valid: true, version, path: javaPath, output: firstLine };
      }
      return { valid: false, version, path: javaPath, error: `Version ${version} < 17` };
    } catch (err) {
      this.logger.log(`  -> Exec failed: ${err.message}`);
      return { valid: false, error: err.message, path: javaPath };
    }
  }

  /**
   * Recursively find java executables inside a directory.
   */
  findJavaExecutables(dir, maxDepth = 5) {
    const exeName = process.platform === 'win32' ? 'java.exe' : 'java';
    const results = [];

    const walk = (d, depth) => {
      if (depth > maxDepth) return;
      try {
        const entries = fs.readdirSync(d, { withFileTypes: true });
        for (const e of entries) {
          const full = path.join(d, e.name);
          if (e.isDirectory()) {
            walk(full, depth + 1);
          } else if (e.name === exeName && full.includes('bin')) {
            results.push(full);
          }
        }
      } catch {}
    };

    walk(dir, 0);
    return results;
  }

  /**
   * Step 1: Check bundled runtimes in ~/.UmuCraft/java/
   */
  detectBundled() {
    this.logger.log('--- Checking bundled runtime ---');
    this.logger.log(`Directory: ${this.javaDir}`);

    if (!fs.existsSync(this.javaDir)) {
      this.logger.log('Bundled directory does not exist');
      return null;
    }

    const candidates = this.findJavaExecutables(this.javaDir);
    this.logger.log(`Found ${candidates.length} executable(s)`);

    for (const c of candidates) {
      const r = this.validateExecutable(c);
      if (r.valid) {
        this.logger.log(`Bundled runtime valid: ${c} (Java ${r.version})`);
        return { ...r, source: 'bundled' };
      }
    }

    return null;
  }

  /**
   * Step 2: Check system Java/OpenJDK via PATH.
   */
  detectSystem() {
    this.logger.log('--- Checking system Java via PATH ---');

    try {
      const output = execSync('java -version 2>&1', {
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
        windowsHide: true,
      });

      const version = RuntimeDetector.parseMajorVersion(output);
      const firstLine = output.split(/\r?\n/)[0] || '';
      this.logger.log(`Output: ${firstLine}`);
      this.logger.log(`Parsed version: ${version}`);

      if (version >= 17) {
        // Resolve actual path
        let resolvedPath = 'java';
        try {
          const cmd = process.platform === 'win32' ? 'where java' : 'which java';
          resolvedPath = execSync(`${cmd} 2>&1`, {
            encoding: 'utf8', timeout: 5000, windowsHide: true,
          }).trim().split(/\r?\n/)[0].trim();
        } catch {}

        this.logger.log(`Resolved path: ${resolvedPath}`);
        return { valid: true, version, path: resolvedPath, output: firstLine, source: 'system' };
      }

      if (version > 0) {
        this.logger.log(`System Java ${version} is too old (need >= 17)`);
      }
    } catch (err) {
      this.logger.log(`System Java not available: ${err.message}`);
    }

    return null;
  }

  /**
   * Step 3: Check common installation directories.
   */
  detectCommonPaths() {
    this.logger.log('--- Checking common installation paths ---');

    const dirs = [];

    if (process.platform === 'win32') {
      const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
      const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      dirs.push(
        path.join(pf, 'Java'),
        path.join(pf, 'Eclipse Adoptium'),
        path.join(pf, 'AdoptOpenJDK'),
        path.join(pf, 'Zulu'),
        path.join(pf, 'Microsoft'),
        path.join(pf, 'BellSoft'),
        path.join(pf, 'Amazon Corretto'),
        path.join(pf, 'Common Files', 'Oracle', 'Java'),
        path.join(pf86, 'Java'),
      );
    } else if (process.platform === 'linux') {
      dirs.push('/usr/lib/jvm', '/usr/java', '/opt/java');
      const home = process.env.HOME || '';
      if (home) dirs.push(path.join(home, '.sdkman', 'candidates', 'java'));
    } else if (process.platform === 'darwin') {
      dirs.push('/Library/Java/JavaVirtualMachines', '/usr/local/opt/openjdk');
      const home = process.env.HOME || '';
      if (home) dirs.push(path.join(home, '.sdkman', 'candidates', 'java'));
    }

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      this.logger.log(`Scanning: ${dir}`);

      const candidates = this.findJavaExecutables(dir);
      // Prefer higher versions (heuristic: later paths first)
      candidates.sort((a, b) => b.localeCompare(a));

      for (const c of candidates) {
        const r = this.validateExecutable(c);
        if (r.valid) {
          this.logger.log(`Found compatible runtime: ${c} (Java ${r.version})`);
          return { ...r, source: 'common' };
        }
      }
    }

    this.logger.log('No compatible runtime found in common paths');
    return null;
  }

  /**
   * Full detection pipeline: bundled -> system -> common paths.
   * Returns { valid, version, path, output, source } or null.
   */
  detect() {
    let result = this.detectBundled();
    if (result) return result;

    result = this.detectSystem();
    if (result) return result;

    result = this.detectCommonPaths();
    if (result) return result;

    return null;
  }
}

module.exports = RuntimeDetector;
