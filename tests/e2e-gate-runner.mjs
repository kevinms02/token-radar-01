import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Auto-detect Node version and re-exec with --experimental-strip-types if needed (< 22.18)
const [major, minor] = process.versions.node.split('.').map(Number);
const needsStripTypes = major < 22 || (major === 22 && minor < 18);
if (needsStripTypes && !process.execArgv.includes('--experimental-strip-types')) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(result.status ?? 0);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

// Dynamic imports so --experimental-strip-types is guaranteed active
const { evaluateGates } = await import('./harness/gate-evaluator.mjs');
const { runMainSync } = await import('./harness/sandbox-runner.mjs');
const { runTier1Tests } = await import('./harness/tier1-features.mjs');
const { runTier2Tests } = await import('./harness/tier2-boundaries.mjs');
const { runTier3Tests } = await import('./harness/tier3-combinations.mjs');
const { runTier4Tests } = await import('./harness/tier4-workloads.mjs');

function parseCliArgs() {
  const args = process.argv.slice(2);
  let tier = null;
  let gateOnly = false;
  let input = resolve(PROJECT_ROOT, 'input/snapshot.json');
  let output = resolve(PROJECT_ROOT, 'out_test');

  for (const arg of args) {
    if (arg === '--gate-only') {
      gateOnly = true;
    } else if (arg.startsWith('--tier=')) {
      tier = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--input=')) {
      input = resolve(PROJECT_ROOT, arg.split('=')[1]);
    } else if (arg.startsWith('--output=')) {
      output = resolve(PROJECT_ROOT, arg.split('=')[1]);
    }
  }

  return { tier, gateOnly, input, output };
}

function printHeader(title) {
  console.log('\n' + '='.repeat(80));
  console.log(` ${title}`);
  console.log('='.repeat(80));
}

function printGateTable(gateReport) {
  console.log('THE 7 SEALED COMPETITION GATES:');
  const gateEntries = [
    { key: 'dashboard_files', label: '1. dashboard_files' },
    { key: 'board_file', label: '2. board_file' },
    { key: 'sorted_by_value', label: '3. sorted_by_value' },
    { key: 'coverage', label: '4. coverage' },
    { key: 'farm_steps', label: '5. farm_steps' },
    { key: 'screenshots', label: '6. screenshots' },
    { key: 'dossier_matches', label: '7. dossier_matches' },
  ];

  for (const g of gateEntries) {
    const res = gateReport.gates[g.key];
    const status = res?.pass ? '[PASS]' : '[FAIL]';
    const detail = res?.detail ? `: ${res.detail}` : '';
    console.log(`  ${status} ${g.label}${detail}`);
  }
  console.log('-'.repeat(80));
  console.log(`FINAL COMPETITION STATUS: Valid = ${gateReport.valid} (${gateReport.valid === 1 ? 'ALL 7 GATES PASSED' : 'GATE FAILURES DETECTED'})`);
}

async function main() {
  const { tier, gateOnly, input, output } = parseCliArgs();

  // Ensure output directory exists and baseline run is performed if needed
  if (!existsSync(join(output, 'board.json')) || !existsSync(join(output, 'dossier.json'))) {
    console.log(`[INIT] Baseline pipeline output not found in ${output}. Executing main.ts...`);
    const initRes = runMainSync({ input, output });
    if (initRes.exitCode !== 0) {
      console.error(`[ERROR] Failed to run baseline main.ts: ${initRes.stderr}`);
      process.exit(1);
    }
  }

  // Handle --gate-only flag
  if (gateOnly) {
    printHeader('TOKEN RADAR - 7 SEALED COMPETITION GATES EVALUATION');
    const gateReport = evaluateGates(output, input);
    printGateTable(gateReport);
    console.log('='.repeat(80) + '\n');
    process.exit(gateReport.valid === 1 ? 0 : 1);
  }

  printHeader('TOKEN RADAR (token-radar-01) - 4-TIER E2E TEST SUITE');
  console.log(`Target:      ${PROJECT_ROOT}`);
  console.log(`Snapshot:    ${input}`);
  console.log(`Output:      ${output}`);
  console.log(`Node:        ${process.version} (Strip Types: ${needsStripTypes ? 'Enabled' : 'Native'})`);
  console.log('-'.repeat(80));

  const results = [];
  const options = { projectRoot: PROJECT_ROOT, outputDir: output, snapshotPath: input };

  if (tier === null || tier === 1) {
    process.stdout.write('Executing Tier 1 (Feature Coverage: 18 features >=90 cases)... ');
    const t1 = await runTier1Tests(options);
    console.log(`${t1.passed} / ${t1.total} PASSED`);
    results.push(t1);
  }

  if (tier === null || tier === 2) {
    process.stdout.write('Executing Tier 2 (Boundary & Corner Cases: 18 categories >=90 cases)... ');
    const t2 = await runTier2Tests(options);
    console.log(`${t2.passed} / ${t2.total} PASSED`);
    results.push(t2);
  }

  if (tier === null || tier === 3) {
    process.stdout.write('Executing Tier 3 (Cross-Feature Combinations: 10 pairwise scenarios)... ');
    const t3 = await runTier3Tests(options);
    console.log(`${t3.passed} / ${t3.total} PASSED`);
    results.push(t3);
  }

  if (tier === null || tier === 4) {
    process.stdout.write('Executing Tier 4 (Real-World Workloads & Sandbox: 5 scenarios)... ');
    const t4 = await runTier4Tests(options);
    console.log(`${t4.passed} / ${t4.total} PASSED`);
    results.push(t4);
  }

  // Evaluate competition gates
  const gateReport = evaluateGates(output, input);

  printHeader('DIAGNOSTIC TEST SUMMARY REPORT');
  let totalTests = 0;
  let totalPassed = 0;
  let totalFailed = 0;

  for (const r of results) {
    totalTests += r.total;
    totalPassed += r.passed;
    totalFailed += r.failed;
    const pct = ((r.passed / r.total) * 100).toFixed(1);
    const padName = `Tier ${r.tier} (${r.name}):`.padEnd(42, ' ');
    const padCount = `${r.passed} / ${r.total} PASSED`.padStart(18, ' ');
    console.log(`  ${padName} ${padCount} (${pct}%)`);
  }

  console.log('-'.repeat(80));
  const totalPct = ((totalPassed / totalTests) * 100).toFixed(1);
  console.log(`  TOTAL TEST ASSERTIONS:                     ${String(totalPassed).padStart(3, ' ')} / ${String(totalTests).padStart(3, ' ')} PASSED (${totalPct}%)`);
  console.log('-'.repeat(80));

  printGateTable(gateReport);
  console.log('='.repeat(80) + '\n');

  // Report any failures in detail
  if (totalFailed > 0) {
    console.error('\nFAILED TEST DETAILS:');
    for (const r of results) {
      for (const t of r.tests) {
        if (!t.pass) {
          console.error(`  - [FAIL] ${t.id} ${t.name}: ${t.error}`);
        }
      }
    }
  }

  const allPassed = totalFailed === 0 && gateReport.valid === 1;
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('\n[UNHANDLED ERROR IN TEST RUNNER]', err);
  process.exit(1);
});
