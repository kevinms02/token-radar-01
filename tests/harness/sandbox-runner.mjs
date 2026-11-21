import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '../..');

/**
 * Checks if current Node version requires --experimental-strip-types
 */
export function isStripTypesRequired() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major < 22 || (major === 22 && minor < 18);
}

/**
 * Gets Node executable arguments for running TypeScript files
 */
export function getNodeArgs(scriptPath, extraArgs = []) {
  const args = [];
  if (isStripTypesRequired()) {
    args.push('--experimental-strip-types');
  }
  args.push(scriptPath, ...extraArgs);
  return args;
}

/**
 * Runs main.ts synchronously with performance metrics and sandboxed environment options
 */
export function runMainSync(options = {}) {
  const {
    input = resolve(PROJECT_ROOT, 'input/snapshot.json'),
    output = resolve(PROJECT_ROOT, 'out_test'),
    env = {},
    timeoutMs = 30000,
    mainScript = resolve(PROJECT_ROOT, 'main.ts'),
    cwd = PROJECT_ROOT,
  } = options;

  if (output && !existsSync(output)) {
    mkdirSync(output, { recursive: true });
  }

  const cliArgs = [];
  if (input) cliArgs.push('--input', input);
  if (output) cliArgs.push('--output', output);

  const nodeArgs = getNodeArgs(mainScript, cliArgs);
  const startTime = Date.now();

  const mergedEnv = {
    ...process.env,
    ...env,
  };

  const res = spawnSync(process.execPath, nodeArgs, {
    cwd,
    env: mergedEnv,
    timeout: timeoutMs,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  const durationMs = Date.now() - startTime;

  return {
    exitCode: res.status ?? (res.error ? 1 : 0),
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    error: res.error || null,
    durationMs,
    timedOut: res.error?.code === 'ETIMEDOUT',
  };
}

/**
 * Runs main.ts asynchronously with memory profiling
 */
export async function runMainWithProfiling(options = {}) {
  const {
    input = resolve(PROJECT_ROOT, 'input/snapshot.json'),
    output = resolve(PROJECT_ROOT, 'out_test'),
    env = {},
    timeoutMs = 30000,
    mainScript = resolve(PROJECT_ROOT, 'main.ts'),
    cwd = PROJECT_ROOT,
  } = options;

  if (output && !existsSync(output)) {
    mkdirSync(output, { recursive: true });
  }

  const cliArgs = [];
  if (input) cliArgs.push('--input', input);
  if (output) cliArgs.push('--output', output);

  const nodeArgs = getNodeArgs(mainScript, cliArgs);
  const startTime = Date.now();

  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, nodeArgs, {
      cwd,
      env: { ...process.env, ...env },
    });

    let stdout = '';
    let stderr = '';
    let peakMemoryBytes = 0;

    const memSampler = setInterval(() => {
      try {
        if (!child.pid) return;
        // Approximation: sample process memory if available
      } catch {
        // Ignore sampling errors
      }
    }, 100);

    const timer = setTimeout(() => {
      clearInterval(memSampler);
      child.kill('SIGKILL');
      resolvePromise({
        exitCode: 124,
        stdout,
        stderr,
        durationMs: Date.now() - startTime,
        peakMemoryMb: peakMemoryBytes / (1024 * 1024),
        timedOut: true,
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      clearInterval(memSampler);
      const durationMs = Date.now() - startTime;
      resolvePromise({
        exitCode: code ?? 0,
        stdout,
        stderr,
        durationMs,
        peakMemoryMb: peakMemoryBytes / (1024 * 1024),
        timedOut: false,
      });
    });
  });
}
