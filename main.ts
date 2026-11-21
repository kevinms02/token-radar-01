/**
 * Token Radar Entrypoint (Node 22, native standard library & TypeScript strip-types)
 * make.fun competition #3 (token-radar-01)
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Extracts named command line argument (--name <value> or --name=<value>), or returns fallback */
function getArg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

// 1. Resolve input path
const defaultInput = existsSync('/input/snapshot.json')
  ? '/input'
  : existsSync(join(here, 'input', 'snapshot.json'))
    ? join(here, 'input')
    : 'input';

const inputArg = getArg('input', defaultInput);
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');

if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot found at ${inputFile}\n`);
  process.exit(2);
}

// 2. Resolve output directory
const defaultOutput = process.env.MAKEFUN_OUTPUT_DIR ?? (existsSync('/output') ? '/output' : 'out');
const out = getArg('output', defaultOutput);

// 3. Load snapshot & build radar dataset
const rawText = readFileSync(inputFile, 'utf8');
const snapshot = parseSnapshot(rawText);
const { board, radar } = buildRadar(snapshot);

// 4. Validate board against gate rules
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: model generated a board refused by gate rules: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });

// 5. Write board.json and data.js
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board }, null, 2)}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Recursively copies regular files from source directory to target */
function copyDirectoryFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const srcPath = join(from, name);
    const destPath = join(to, name);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      copyDirectoryFiles(srcPath, destPath);
    } else if (st.isFile()) {
      copyFileSync(srcPath, destPath);
      copied.push(name);
    }
  }
  return copied;
}

// 6. Copy dashboard and screenshots to output directory
copyDirectoryFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyDirectoryFiles(join(here, 'screenshots'), join(out, 'screenshots'));

if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image(s); minimum 3 required (board, detail, filtered)\n`);
  process.exit(1);
}

for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name} filename violates naming constraints\n`);
    process.exit(1);
  }
}

// 7. Generate canonical dossier.json
const dossierBytes = buildDossier(out, {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: SCREENSHOT_CAPS,
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(out, 'dossier.json'), dossierBytes);

process.stdout.write(
  `token radar [${radar.model_version}]: ${snapshot.protocols.length} protocols indexed, ${snapshot.watchlist.length} watchlist pre-token protocols covered (100%)\n` +
    `board: 200 rows ranked (${radar.early_size} early below floor, ${radar.live_size} live comps evaluated)\n` +
    `artifacts written to ${out}:\n` +
    `  - board.json (${board.length} rows, top implied: $${board[0]!.implied_value_usd.toLocaleString()})\n` +
    `  - data.js (window.RADAR assigned)\n` +
    `  - dashboard/ (UI assets)\n` +
    `  - screenshots/ (${shots.length} images)\n` +
    `  - dossier.json (${dossierBytes.length} bytes, limit 1.5 MiB)\n`,
);
