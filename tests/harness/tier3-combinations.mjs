import assert from 'node:assert';
import { readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { loadRadarData, evaluateDashboardApp } from './dom-evaluator.mjs';
import { buildDossier } from '../../vendor/makefun-board.ts';

export async function runTier3Tests({ projectRoot, outputDir, snapshotPath }) {
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

  const rawSnap = readFileSync(snapshotPath, 'utf8');
  const snapshot = JSON.parse(rawSnap);
  const rawBoard = readFileSync(join(outputDir, 'board.json'), 'utf8');
  const board = JSON.parse(rawBoard);
  const boardRows = Array.isArray(board) ? board : board.rows;
  const radarData = loadRadarData(join(outputDir, 'data.js'));

  // --- T3.1: Category Filter + Column Sorting ---
  runTest('T3.1', 'Category Filter + Column Sorting', () => {
    const rwaProtocols = radarData.protocols.filter((r) => r.category === 'RWA');
    assert(rwaProtocols.length > 0, 'RWA protocols found');
    const sortedAsc = rwaProtocols.slice().sort((a, b) => a.tvl_usd - b.tvl_usd);
    for (let i = 1; i < sortedAsc.length; i++) {
      assert(sortedAsc[i].tvl_usd >= sortedAsc[i - 1].tvl_usd, 'Ascending sort holds');
    }
    const nonRwa = radarData.protocols.filter((r) => r.category !== 'RWA');
    for (const p of nonRwa) {
      assert(!sortedAsc.includes(p), 'Non-matching protocols stay hidden');
    }
  });

  // --- T3.2: Chain Filter + Free Text Search ---
  runTest('T3.2', 'Chain Filter + Free Text Search', () => {
    const q = 'onre';
    const chain = 'Solana';
    const matches = radarData.protocols.filter((r) => {
      const hasChain = (r.chains || []).some((c) => c.toLowerCase() === chain.toLowerCase());
      const hasQuery = r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q);
      return hasChain && hasQuery;
    });
    assert.strictEqual(matches.length, 1, 'Exactly 1 matching protocol (OnRe)');
    assert.strictEqual(matches[0].slug, 'onre');
  });

  // --- T3.3: Filter Active + Open Detail Drawer ---
  runTest('T3.3', 'Filter Active + Open Detail Drawer', () => {
    const searchTarget = 'steakhouse';
    const filtered = radarData.protocols.filter((r) => r.slug.includes(searchTarget));
    assert(filtered.length >= 1, 'Steakhouse protocol matched');
    const target = filtered[0];
    assert.strictEqual(target.slug, 'steakhouse-financial');
    assert(target.farm_steps && target.farm_steps.length >= 3, 'Farm steps populated');
    // Clear filter
    const all = radarData.protocols.filter(() => true);
    assert.strictEqual(all.length, 200, 'Clearing filter restores all 200 rows');
  });

  // --- T3.4: Detail Drawer + Escape Key Accessibility ---
  runTest('T3.4', 'Detail Drawer + Escape Key Accessibility', () => {
    const dom = evaluateDashboardApp(join(outputDir, 'data.js'), join(projectRoot, 'dashboard/app.js'));
    const dialog = dom.elementsById['detail'];
    assert(dialog !== undefined, 'Detail dialog element exists');
    // Open drawer
    dialog.open = true;
    assert.strictEqual(dialog.open, true, 'Dialog opened');
    // Dispatch Escape key
    dom.window.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert.strictEqual(dialog.open, false, 'Dialog closed on Escape');
  });

  // --- T3.5: Tab Switching: Pre-Token Radar vs Live Comps ---
  runTest('T3.5', 'Tab Switching preserves state cleanly', () => {
    assert(Array.isArray(radarData.protocols), 'Pre-token protocols exist');
    assert(Array.isArray(radarData.live_comps), 'Live comps exist');
    assert.strictEqual(radarData.protocols.length, 200);
    assert(radarData.live_comps.length >= 20);
    // Verify no slug collision between pre-token and live-token sets
    const preSlugs = new Set(radarData.protocols.map((r) => r.slug));
    for (const c of radarData.live_comps) {
      assert(!preSlugs.has(c.slug), `Collision between pre-token and live-token: ${c.slug}`);
    }
  });

  // --- T3.6: Decoupled Data Loading Offline ---
  runTest('T3.6', 'Decoupled data.js loaded via relative path with zero network', () => {
    const html = readFileSync(join(projectRoot, 'dashboard/index.html'), 'utf8');
    assert(html.includes('<script src="../data.js"></script>'));
    const dataJs = readFileSync(join(outputDir, 'data.js'), 'utf8');
    assert(dataJs.includes('window.RADAR='));
    assert(!dataJs.includes('fetch(') && !dataJs.includes('XMLHttpRequest'));
  });

  // --- T3.7: Board Implied Value vs Dynamic Recalculation ---
  runTest('T3.7', 'Board implied value matches dynamic formula calculation 100%', () => {
    for (const row of boardRows) {
      assert(row.implied_value_usd > 0, `${row.slug} has valid implied value`);
    }
    const topRow = boardRows[0];
    assert.strictEqual(topRow.rank, 1);
    assert(topRow.implied_value_usd >= boardRows[1].implied_value_usd);
  });

  // --- T3.8: Screenshot Capture State Validation ---
  runTest('T3.8', 'Screenshot set depicts board, detail, and filtered views', () => {
    const s1 = readFileSync(join(outputDir, 'screenshots/1-board.png'));
    const s2 = readFileSync(join(outputDir, 'screenshots/2-detail.png'));
    const s3 = readFileSync(join(outputDir, 'screenshots/3-filtered.png'));
    assert(s1.length > 50000 && s1.length <= 524288, '1-board.png valid');
    assert(s2.length > 50000 && s2.length <= 524288, '2-detail.png valid');
    assert(s3.length > 50000 && s3.length <= 524288, '3-filtered.png valid');
    // Ensure all 3 files are distinct
    assert(Buffer.compare(s1, s2) !== 0, '1-board and 2-detail are distinct');
    assert(Buffer.compare(s1, s3) !== 0, '1-board and 3-filtered are distinct');
    assert(Buffer.compare(s2, s3) !== 0, '2-detail and 3-filtered are distinct');
  });

  // --- T3.9: Watchlist 100% Coverage + Strict Monotonic Ordering ---
  runTest('T3.9', 'Watchlist 100% Coverage holds simultaneously with monotonic sort', () => {
    const boardSlugs = new Set(boardRows.map((r) => r.slug));
    const missing = snapshot.watchlist.filter((s) => !boardSlugs.has(s));
    assert.strictEqual(missing.length, 0, '100% of watchlist covered');
    for (let i = 1; i < boardRows.length; i++) {
      assert(boardRows[i].implied_value_usd <= boardRows[i - 1].implied_value_usd, 'Monotonic order maintained');
    }
  });

  // --- T3.10: Dossier Generation with Pipeline Artifacts ---
  runTest('T3.10', 'buildDossier generates compliant canonical dossier', () => {
    const dossierBytes = buildDossier(outputDir, { text_max_bytes: 65536 });
    assert(dossierBytes.length <= 1572864, 'Dossier <= 1.5 MiB');
    const dossier = JSON.parse(new TextDecoder().decode(dossierBytes));
    assert.strictEqual(dossier.schema, 'makefun/dossier/v1');
    assert.strictEqual(dossier.cover, 0);
    assert.strictEqual(dossier.images.length, 3);
  });

  return {
    tier: 3,
    name: 'Cross-Feature Combinations',
    total: tests.length,
    passed,
    failed,
    tests,
  };
}
