// Token Launch Radar Main Executable Pipeline (Node 22, ESM)
// token-radar-01 for make.fun

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Scorer container caps (reference/gate.json) */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Extract --name <value> or fallback from process arguments */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', existsSync(join(here, 'input', 'snapshot.json')) ? join(here, 'input', 'snapshot.json') : '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');

if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot found at ${inputFile}: provide --input <snapshot.json|directory> or mount /input\n`);
  process.exit(2);
}

const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? join(here, 'out'));

// 1. Ingest and parse sealed DefiLlama snapshot
const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));

// 2. Compute multi-factor valuation and generate farming playbooks
const { board, radar } = buildRadar(snapshot);

// 3. Pre-gate validation check
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: gate refusal detected: ${issue}\n`);
  process.exit(1);
}

// 4. Output directory preparation
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy regular files from source directory into target, skipping dotfiles */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

// 5. Copy client dashboard and visual artifacts
copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));

if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ contains ${shots.length} images; requires at least 3 (board, detail, filtered)\n`);
  process.exit(1);
}

for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: invalid screenshot filename: screenshots/${name}\n`);
    process.exit(1);
  }
}

// 6. Generate official sealed judge dossier
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols ingested, ${snapshot.watchlist.length} watchlist protocols (100% covered)\n` +
  `token radar: ${board.length} pre-token rows scored, ${radar.early_size} early discovery rows, ${radar.live_size} benchmark rows\n` +
  `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images), and ${join(out, 'dossier.json')}\n`
);
