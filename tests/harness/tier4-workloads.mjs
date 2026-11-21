import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runMainSync } from './sandbox-runner.mjs';
import { evaluateGates } from './gate-evaluator.mjs';
import { auditZeroNetwork } from './offline-auditor.mjs';

function sha256File(path) {
  const buf = readFileSync(path);
  return createHash('sha256').update(buf).digest('hex');
}

export async function runTier4Tests({ projectRoot, outputDir, snapshotPath }) {
  const tests = [];
  let passed = 0;
  let failed = 0;

  function runTest(id, name, fn) {
    try {
      fn();
      passed++;
      tests.push({ id, name, pass: true });
    } catch (err) {
      failed++;
      tests.push({ id, name, pass: false, error: err.message });
    }
  }

  // --- T4.1: Sandbox Container Execution Simulation ---
  runTest('T4.1', 'Sandbox Container Execution Simulation', () => {
    const sandboxOut = join(projectRoot, 'test-sandbox-out');
    try {
      const res = runMainSync({
        input: snapshotPath,
        output: sandboxOut,
        timeoutMs: 15000,
      });
      assert.strictEqual(res.exitCode, 0, `main.ts exited with code ${res.exitCode}: ${res.stderr}`);
      assert(res.durationMs < 15000, `Execution took ${res.durationMs}ms (budget 15,000ms)`);
      assert(existsSync(join(sandboxOut, 'board.json')), 'board.json written');
      assert(existsSync(join(sandboxOut, 'dossier.json')), 'dossier.json written');
    } finally {
      if (existsSync(sandboxOut)) {
        rmSync(sandboxOut, { recursive: true, force: true });
      }
    }
  });

  // --- T4.2: Consecutive 2-Run Determinism Verification ---
  runTest('T4.2', 'Consecutive 2-Run Determinism Verification', () => {
    const run1Dir = join(projectRoot, 'test-run-1');
    const run2Dir = join(projectRoot, 'test-run-2');
    try {
      const res1 = runMainSync({ input: snapshotPath, output: run1Dir });
      assert.strictEqual(res1.exitCode, 0, 'Run 1 exited 0');
      const res2 = runMainSync({ input: snapshotPath, output: run2Dir });
      assert.strictEqual(res2.exitCode, 0, 'Run 2 exited 0');

      // Compare digests of key deliverables
      const filesToCompare = [
        'board.json',
        'data.js',
        'dashboard/index.html',
        'dashboard/app.css',
        'dashboard/app.js',
        'screenshots/1-board.png',
        'screenshots/2-detail.png',
        'screenshots/3-filtered.png',
        'dossier.json',
      ];

      for (const f of filesToCompare) {
        const hash1 = sha256File(join(run1Dir, f));
        const hash2 = sha256File(join(run2Dir, f));
        assert.strictEqual(hash1, hash2, `File ${f} digest mismatch between consecutive runs: ${hash1} vs ${hash2}`);
      }
    } finally {
      if (existsSync(run1Dir)) rmSync(run1Dir, { recursive: true, force: true });
      if (existsSync(run2Dir)) rmSync(run2Dir, { recursive: true, force: true });
    }
  });

  // --- T4.3: Strict Zero-Network & Offline Audit ---
  runTest('T4.3', 'Strict Zero-Network & Offline Audit', () => {
    const audit = auditZeroNetwork(join(projectRoot, 'dashboard'));
    assert(audit.clean, `Zero-network audit found violations: ${JSON.stringify(audit.violations)}`);
  });

  // --- T4.4: Complete 7-Gate Validation Suite ---
  runTest('T4.4', 'Complete 7-Gate Validation Suite', () => {
    const report = evaluateGates(outputDir, snapshotPath);
    assert.strictEqual(report.valid, 1, `Gate validation failed. Report: ${JSON.stringify(report.gates)}`);
    assert(report.gates.dashboard_files.pass, 'dashboard_files gate PASS');
    assert(report.gates.board_file.pass, 'board_file gate PASS');
    assert(report.gates.sorted_by_value.pass, 'sorted_by_value gate PASS');
    assert(report.gates.coverage.pass, 'coverage gate PASS');
    assert(report.gates.farm_steps.pass, 'farm_steps gate PASS');
    assert(report.gates.screenshots.pass, 'screenshots gate PASS');
    assert(report.gates.dossier_matches.pass, 'dossier_matches gate PASS');
  });

  // --- T4.5: Fault-Injection & Corrupt Input Resilience ---
  runTest('T4.5', 'Fault-Injection & Corrupt Input Resilience', () => {
    const nonExistentInput = join(projectRoot, 'tests/fixtures/non-existent.json');
    const corruptInput = join(projectRoot, 'tests/fixtures/corrupt-snapshot.json');
    const dummyOut = join(projectRoot, 'test-corrupt-out');

    try {
      // 1. Missing file
      const resMissing = runMainSync({ input: nonExistentInput, output: dummyOut });
      assert.notStrictEqual(resMissing.exitCode, 0, 'Missing snapshot should exit non-zero');

      // 2. Corrupt file structure
      const resCorrupt = runMainSync({ input: corruptInput, output: dummyOut });
      assert.notStrictEqual(resCorrupt.exitCode, 0, 'Corrupt snapshot should exit non-zero');
    } finally {
      if (existsSync(dummyOut)) rmSync(dummyOut, { recursive: true, force: true });
    }
  });

  return {
    tier: 4,
    name: 'Real-World Workloads & Platform Sandbox Simulation',
    total: tests.length,
    passed,
    failed,
    tests,
  };
}
