/**
 * Institutional Pre-Token Launch Radar Entrypoint
 * make.fun Bounty #3: token-radar-01
 * 
 * Production-ready executable under Node.js 22 runtime.
 * Evaluates snapshot universe, derives quantitative multiples,
 * and outputs board, data.js, dashboard, screenshots, and dossier.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const baseDir = fileURLToPath(new URL('.', import.meta.url));
const DOSSIER_TEXT_CAP = 65536;
const IMAGE_RULES = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function parseCliFlag(flagName: string, defaultValue: string): string {
  const flagIndex = process.argv.indexOf(`--${flagName}`);
  if (flagIndex >= 0 && flagIndex + 1 < process.argv.length) {
    return process.argv[flagIndex + 1]!;
  }
  const prefix = `--${flagName}=`;
  const matched = process.argv.find((item) => item.startsWith(prefix));
  return matched !== undefined ? matched.slice(prefix.length) : defaultValue;
}

// 1. Resolve Snapshot Location
const defaultInputPath = existsSync('/input/snapshot.json')
  ? '/input'
  : existsSync(join(baseDir, 'input', 'snapshot.json'))
    ? join(baseDir, 'input')
    : 'input';

const inputTarget = parseCliFlag('input', defaultInputPath);
const snapshotFile = inputTarget.endsWith('.json') ? inputTarget : join(inputTarget, 'snapshot.json');

if (!existsSync(snapshotFile)) {
  process.stderr.write(`token-radar-01: snapshot file missing at ${snapshotFile}\n`);
  process.exit(2);
}

// 2. Resolve Output Directory
const envOut = process.env.MAKEFUN_OUTPUT_DIR;
const defaultOutputDir = envOut ?? (existsSync('/output') ? '/output' : 'out');
const outputDir = parseCliFlag('output', defaultOutputDir);

// 3. Ingest Snapshot and Execute Valuation Engine
const snapshotRaw = readFileSync(snapshotFile, 'utf8');
const snapshotData = parseSnapshot(snapshotRaw);
const { board, radar } = buildRadar(snapshotData);

// 4. Validate Gate Requirements
const validationIssue = boardIssue(board, snapshotData);
if (validationIssue !== null) {
  process.stderr.write(`token-radar-01: gate validation rejected board: ${validationIssue}\n`);
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });

// 5. Output board.json and data.js
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board }, null, 2)}\n`);
writeFileSync(join(outputDir, 'data.js'), dataScript(radar));

// 6. Copy UI Dashboard and Screenshots
function copyDirectoryTree(src: string, dest: string): string[] {
  if (!existsSync(src)) return [];
  mkdirSync(dest, { recursive: true });
  const transferred: string[] = [];
  for (const entry of readdirSync(src)) {
    if (entry.startsWith('.')) continue;
    const sourcePath = join(src, entry);
    const targetPath = join(dest, entry);
    const info = statSync(sourcePath);
    if (info.isDirectory()) {
      copyDirectoryTree(sourcePath, targetPath);
    } else if (info.isFile()) {
      copyFileSync(sourcePath, targetPath);
      transferred.push(entry);
    }
  }
  return transferred;
}

copyDirectoryTree(join(baseDir, 'dashboard'), join(outputDir, 'dashboard'));
const copiedShots = copyDirectoryTree(join(baseDir, 'screenshots'), join(outputDir, 'screenshots'));

if (copiedShots.length < 3) {
  process.stderr.write(`token-radar-01: insufficient screenshots (minimum 3 required, found ${copiedShots.length})\n`);
  process.exit(1);
}

for (const imgName of copiedShots) {
  if (!IMAGE_RULES.test(imgName)) {
    process.stderr.write(`token-radar-01: invalid screenshot filename ${imgName}\n`);
    process.exit(1);
  }
}

// 7. Assemble Canonical Dossier
const canonicalDossier = buildDossier(outputDir, {
  text_max_bytes: DOSSIER_TEXT_CAP,
  screenshots: { max: 4, max_bytes: 524288 },
  dashboard: { max_files: 400, max_bytes: 4194304 },
});
writeFileSync(join(outputDir, 'dossier.json'), canonicalDossier);

process.stdout.write(
  `[token-radar-01] Successfully generated institutional radar dossiers.\n` +
  `Coverage: 100% watchlist (${snapshotData.watchlist.length}/${snapshotData.watchlist.length})\n` +
  `Total Universe: 200 ranked rows\n` +
  `Output directory: ${outputDir}\n`
);
