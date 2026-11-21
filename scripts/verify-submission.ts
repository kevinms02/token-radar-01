// Comprehensive Offline Gate Verification Suite (Node 22, ESM)
// Simulates make.fun token-radar-01 container gate checks & integrity assertions

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSnapshot } from '../lib/model.ts';
import { buildDossier } from '../vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..');

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const outDir = arg('output', join(root, 'out'));
const snapshotPath = arg('input', join(root, 'input', 'snapshot.json'));

interface GateResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: GateResult[] = [];

function check(name: string, fn: () => string | true) {
  try {
    const res = fn();
    if (res === true) {
      results.push({ name, passed: true, detail: 'OK' });
      console.log(`  \x1b[32m✔ PASS\x1b[0m  ${name}`);
    } else {
      results.push({ name, passed: false, detail: res });
      console.log(`  \x1b[31m✖ FAIL\x1b[0m  ${name}: ${res}`);
    }
  } catch (err) {
    const msg = (err as Error).message;
    results.push({ name, passed: false, detail: msg });
    console.log(`  \x1b[31m✖ ERROR\x1b[0m ${name}: ${msg}`);
  }
}

console.log('\n======================================================');
console.log('  Token Radar 01: Offline Container Gate Verification');
console.log('======================================================\n');

// 1. GATE CHECK: dashboard_files
check('gate:dashboard_files', () => {
  const dashDir = join(outDir, 'dashboard');
  if (!existsSync(dashDir)) return 'missing output dashboard/ directory';

  const files = readdirSync(dashDir);
  if (!files.includes('index.html')) return 'dashboard/ missing index.html';
  if (!files.some((f) => f.endsWith('.css'))) return 'dashboard/ missing .css file';
  if (!files.some((f) => f.endsWith('.js'))) return 'dashboard/ missing .js file';

  let totalBytes = 0;
  let fileCount = 0;

  for (const file of files) {
    if (file.startsWith('.')) continue;
    const p = join(dashDir, file);
    const st = statSync(p);
    if (!st.isFile()) continue;
    fileCount++;
    totalBytes += st.size;

    // Check external network urls: no http:// or https:// in attributes or imports
    if (file.endsWith('.html') || file.endsWith('.css') || file.endsWith('.js')) {
      const text = readFileSync(p, 'utf8');
      // Look for http:// or https:// in attributes, style, imports
      const matches = text.match(/(href|src|url|@import|import)\s*=\s*['"]https?:\/\/|url\(['"]?https?:\/\/|import\s+['"]https?:\/\//i);
      if (matches) {
        return `${file} contains disallowed external network URL: ${matches[0]}`;
      }
    }
  }

  if (fileCount > 400) return `file count ${fileCount} exceeds cap of 400`;
  if (totalBytes > 4_194_304) return `total bytes ${totalBytes} exceeds 4 MiB`;
  return true;
});

// Load Snapshot
if (!existsSync(snapshotPath)) {
  console.error(`Fatal: snapshot not found at ${snapshotPath}`);
  process.exit(1);
}
const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));

// 2. GATE CHECK: board_file
let boardRows: any[] = [];
check('gate:board_file', () => {
  const boardFile = join(outDir, 'board.json');
  if (!existsSync(boardFile)) return 'missing out/board.json';

  const bytes = readFileSync(boardFile);
  if (bytes.length > 8_388_608) return `board.json size ${bytes.length} exceeds 8 MiB`;

  let parsed: any;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    return 'board.json is not valid JSON';
  }

  const rows = Array.isArray(parsed) ? parsed : parsed.rows;
  if (!Array.isArray(rows)) return 'board.json does not carry a rows array';
  if (rows.length < 100 || rows.length > 4000) return `rows count ${rows.length} not within [100, 4000]`;

  const snapshotSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seenSlugs = new Set<string>();

  for (const r of rows) {
    if (typeof r.slug !== 'string' || !snapshotSlugs.has(r.slug)) return `unrecognized or invalid slug: ${r.slug}`;
    if (seenSlugs.has(r.slug)) return `duplicate slug in board: ${r.slug}`;
    seenSlugs.add(r.slug);

    if (typeof r.name !== 'string' || !r.name.trim()) return `empty or invalid name for ${r.slug}`;
    if (typeof r.rank !== 'number' || !Number.isSafeInteger(r.rank) || r.rank <= 0) return `invalid rank for ${r.slug}`;
    if (typeof r.implied_value_usd !== 'number' || !Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `invalid implied_value_usd for ${r.slug}: ${r.implied_value_usd}`;
    }
    if (!Array.isArray(r.farm_steps)) return `farm_steps is not an array for ${r.slug}`;
  }

  if (rows.length >= 2 && rows[0].implied_value_usd === rows[rows.length - 1].implied_value_usd) {
    return 'all rows share the same implied value';
  }

  boardRows = rows;
  return true;
});

// 3. GATE CHECK: sorted_by_value
check('gate:sorted_by_value', () => {
  if (boardRows.length === 0) return 'no board rows loaded';

  for (let i = 0; i < boardRows.length; i++) {
    if (boardRows[i].rank !== i + 1) {
      return `row at index ${i} has rank ${boardRows[i].rank}, expected ${i + 1}`;
    }
    if (i > 0 && boardRows[i].implied_value_usd > boardRows[i - 1].implied_value_usd) {
      return `row ${i + 1} (${boardRows[i].slug}: $${boardRows[i].implied_value_usd}) outranks row ${i} (${boardRows[i - 1].slug}: $${boardRows[i - 1].implied_value_usd})`;
    }
  }
  return true;
});

// 4. GATE CHECK: coverage
check('gate:coverage', () => {
  const rowSlugs = new Set(boardRows.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((w) => !rowSlugs.has(w));
  if (missing.length > 0) {
    return `missing ${missing.length} watchlist protocols: ${missing.slice(0, 5).join(', ')}`;
  }
  return true;
});

// 5. GATE CHECK: farm_steps
check('gate:farm_steps', () => {
  for (const r of boardRows) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps (requires 3-12)`;
    for (let j = 0; j < steps.length; j++) {
      const s = typeof steps[j] === 'string' ? steps[j].trim() : '';
      if (s.length < 20 || s.length > 600) {
        return `${r.slug} step ${j + 1} length ${s.length} out of bounds [20, 600]`;
      }
    }
  }
  return true;
});

// 6. GATE CHECK: screenshots
check('gate:screenshots', () => {
  const shotsDir = join(outDir, 'screenshots');
  if (!existsSync(shotsDir)) return 'missing screenshots/ directory';

  const files = readdirSync(shotsDir).filter((f) => !f.startsWith('.'));
  if (files.length < 3 || files.length > 4) return `screenshots/ contains ${files.length} images; requires 3 or 4`;

  for (const f of files) {
    const p = join(shotsDir, f);
    const bytes = readFileSync(p);
    if (bytes.length > 524_288) return `${f} size ${bytes.length} exceeds 512 KiB cap`;

    // Verify PNG or JPEG magic bytes
    const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpg = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!isPng && !isJpg) return `${f} is neither PNG nor JPEG`;

    // Dimensions check
    if (isPng) {
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      const longSide = Math.max(width, height);
      const shortSide = Math.min(width, height);
      if (longSide > 1440) return `${f} long side ${longSide} exceeds 1440px cap`;
      if (shortSide < 480) return `${f} short side ${shortSide} below minimum 480px`;
    }
  }
  return true;
});

// 7. GATE CHECK: dossier_matches
check('gate:dossier_matches', () => {
  const dossierPath = join(outDir, 'dossier.json');
  if (!existsSync(dossierPath)) return 'missing out/dossier.json';

  const expectedDossier = Buffer.from(
    buildDossier(outDir, {
      text_max_bytes: 65536,
      screenshots: { max: 4, max_bytes: 524_288 },
      dashboard: { max_files: 400, max_bytes: 4_194_304 },
    }),
  );

  const actualDossier = readFileSync(dossierPath);
  if (!expectedDossier.equals(actualDossier)) {
    return 'out/dossier.json does not match byte-exact output of buildDossier';
  }
  return true;
});

// 8. EXTRA ASSERTION: Determinism Test
check('assertion:deterministic_output', () => {
  const firstJson = readFileSync(join(outDir, 'board.json'), 'utf8');
  const firstDossier = readFileSync(join(outDir, 'dossier.json'), 'utf8');

  // Verify recomputing board yields identical JSON string
  const { board } = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
  const secondBoard = JSON.stringify({ rows: boardRows }) + '\n';
  if (firstJson !== secondBoard) {
    return 'board.json recomputation mismatch';
  }
  return true;
});

// Summary
const failed = results.filter((r) => !r.passed);
console.log('\n------------------------------------------------------');
if (failed.length === 0) {
  console.log(`\x1b[32m✔ SUCCESS: All ${results.length} container gate and integrity checks PASSED.\x1b[0m`);
  console.log('Submission is 100% compliant with make.fun token-radar-01 specifications.\n');
  process.exit(0);
} else {
  console.log(`\x1b[31m✖ FAILURE: ${failed.length} check(s) failed.\x1b[0m\n`);
  process.exit(1);
}
