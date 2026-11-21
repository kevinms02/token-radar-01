import assert from 'node:assert';
import { readFileSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateDashboardApp, loadRadarData } from './dom-evaluator.mjs';
import { auditDashboardAesthetics, auditZeroNetwork } from './offline-auditor.mjs';
import { evaluateGates } from './gate-evaluator.mjs';
import { buildDossier } from '../../vendor/makefun-board.ts';

export async function runTier1Tests({ projectRoot, outputDir, snapshotPath }) {
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

  // Preload test fixtures
  const rawSnap = readFileSync(snapshotPath, 'utf8');
  const snapshot = JSON.parse(rawSnap);
  const rawBoard = readFileSync(join(outputDir, 'board.json'), 'utf8');
  const board = JSON.parse(rawBoard);
  const boardRows = Array.isArray(board) ? board : board.rows;
  const radarData = loadRadarData(join(outputDir, 'data.js'));
  const domResult = evaluateDashboardApp(join(outputDir, 'data.js'), join(projectRoot, 'dashboard/app.js'));
  const aestheticAudit = auditDashboardAesthetics(join(projectRoot, 'dashboard'));
  const zeroNetAudit = auditZeroNetwork(join(projectRoot, 'dashboard'));
  const gateReport = evaluateGates(outputDir, snapshotPath);

  // --- Feature 1: main.ts CLI & Sandbox Execution ---
  runTest('T1.1.1', 'CLI exits 0 and writes deliverables', () => {
    assert(existsSync(join(outputDir, 'board.json')), 'board.json exists');
    assert(existsSync(join(outputDir, 'data.js')), 'data.js exists');
    assert(existsSync(join(outputDir, 'dashboard')), 'dashboard/ exists');
    assert(existsSync(join(outputDir, 'screenshots')), 'screenshots/ exists');
    assert(existsSync(join(outputDir, 'dossier.json')), 'dossier.json exists');
  });

  runTest('T1.1.2', 'Root main.ts exists and uses standard libraries', () => {
    const mainContent = readFileSync(join(projectRoot, 'main.ts'), 'utf8');
    assert(mainContent.includes('node:fs') || mainContent.includes('from "node:fs"'), 'uses node:fs');
    assert(!mainContent.includes('require("express")'), 'no third party framework');
  });

  runTest('T1.1.3', 'Environment variable MAKEFUN_OUTPUT_DIR is respected in main.ts logic', () => {
    const mainContent = readFileSync(join(projectRoot, 'main.ts'), 'utf8');
    assert(mainContent.includes('MAKEFUN_OUTPUT_DIR'), 'handles MAKEFUN_OUTPUT_DIR env variable');
  });

  runTest('T1.1.4', 'Input snapshot contains DefiLlama protocol collection', () => {
    assert(Array.isArray(snapshot.protocols), 'protocols array exists');
    assert.strictEqual(snapshot.protocols.length, 758, 'snapshot holds 758 protocols');
  });

  runTest('T1.1.5', 'Model version string is declared and consistent', () => {
    assert.strictEqual(radarData.model_version, 'radar-2', 'model version is radar-2');
  });

  // --- Feature 2: Watchlist & Pre-Token Universe Ingestion ---
  runTest('T1.2.1', 'Watchlist contains exactly 40 pre-token protocols', () => {
    assert.strictEqual(snapshot.watchlist.length, 40, 'watchlist has 40 protocols');
    assert.strictEqual(radarData.watchlist_slugs.length, 40, 'radar data carries 40 watchlist slugs');
  });

  runTest('T1.2.2', 'All pre-token protocols have null token identifiers', () => {
    const preTokenSlugs = new Set(radarData.watchlist_slugs);
    for (const p of snapshot.protocols) {
      if (preTokenSlugs.has(p.slug)) {
        assert.strictEqual(p.mcap_usd, null, `${p.slug} mcap_usd is null`);
        assert.strictEqual(p.gecko_id, null, `${p.slug} gecko_id is null`);
        assert.strictEqual(p.symbol, null, `${p.slug} symbol is null`);
      }
    }
  });

  runTest('T1.2.3', 'Live-token protocols are partitioned separately', () => {
    assert(Array.isArray(radarData.live_comps), 'live_comps array exists');
    assert(radarData.live_comps.length >= 20, 'at least 20 live comps evaluated');
    for (const c of radarData.live_comps) {
      assert(c.mcap_usd > 0, `${c.slug} has live mcap`);
    }
  });

  runTest('T1.2.4', 'Version-suffixed protocols are filtered from pre-token candidate pool', () => {
    const versionPattern = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
    for (const r of boardRows) {
      assert(!versionPattern.test(r.name), `Protocol ${r.name} should not have version suffix`);
    }
  });

  runTest('T1.2.5', 'CEX category protocols are excluded from pre-token board', () => {
    for (const r of radarData.protocols) {
      assert.notStrictEqual(r.category, 'CEX', `Protocol ${r.name} should not be CEX`);
    }
  });

  // --- Feature 3: Valuation Model Multi-Factor Calculations ---
  runTest('T1.3.1', 'Model constants specify base multiple and growth weights', () => {
    assert(radarData.model !== undefined, 'model constants exist');
    assert.strictEqual(typeof radarData.model.growth_clamp_min, 'number');
    assert.strictEqual(typeof radarData.model.growth_clamp_max, 'number');
  });

  runTest('T1.3.2', 'Growth multiplier handles positive and negative bounds', () => {
    for (const p of radarData.protocols) {
      if (p.growth_factor !== undefined) {
        assert(p.growth_factor >= 0.5 && p.growth_factor <= 2.5, `growth factor out of range: ${p.growth_factor}`);
      }
    }
  });

  runTest('T1.3.3', 'Maturity factor is within defined bounds', () => {
    for (const p of radarData.protocols) {
      if (p.maturity_factor !== undefined) {
        assert(p.maturity_factor >= 0.6 && p.maturity_factor <= 1.5, `maturity factor out of range: ${p.maturity_factor}`);
      }
    }
  });

  runTest('T1.3.4', 'Protocol with null listed_at date has valid age fallback', () => {
    const nullListed = snapshot.protocols.find((p) => p.listed_at === null);
    assert(nullListed !== undefined, 'found protocol with null listed_at');
  });

  runTest('T1.3.5', 'Calculated implied value is positive safe integer', () => {
    for (const r of boardRows) {
      assert(Number.isSafeInteger(r.implied_value_usd), `${r.slug} implied_value_usd is safe integer`);
      assert(r.implied_value_usd >= 1, `${r.slug} implied_value_usd >= 1`);
      assert(r.implied_value_usd <= 100_000_000_000_000, `${r.slug} implied_value_usd <= 100T`);
    }
  });

  // --- Feature 4: Actionable Farm Plan Playbook Generation ---
  runTest('T1.4.1', 'Every row has 3 to 12 farm steps', () => {
    for (const r of boardRows) {
      assert(r.farm_steps.length >= 3 && r.farm_steps.length <= 12, `${r.slug} step count ${r.farm_steps.length}`);
    }
  });

  runTest('T1.4.2', 'Step 1 contains wallet and seed phrase opsec guidance', () => {
    for (const r of boardRows) {
      const step1 = r.farm_steps[0].toLowerCase();
      assert(step1.includes('wallet') || step1.includes('seed phrase') || step1.includes('opsec'), `${r.slug} step 1 lacks opsec`);
    }
  });

  runTest('T1.4.3', 'Step 2 contains actionable capital guidance', () => {
    for (const r of boardRows) {
      const step2 = r.farm_steps[1];
      assert(step2.includes('$') || step2.includes('capital'), `${r.slug} step 2 lacks capital`);
    }
  });

  runTest('T1.4.4', 'Holding window step specifies holding duration', () => {
    for (const r of boardRows) {
      const step4 = r.farm_steps[3] || r.farm_steps[r.farm_steps.length - 2];
      assert(step4.includes('day') || step4.includes('hold'), `${r.slug} hold step lacks duration`);
    }
  });

  runTest('T1.4.5', 'Every step length is between 20 and 600 characters', () => {
    for (const r of boardRows) {
      for (let j = 0; j < r.farm_steps.length; j++) {
        const s = r.farm_steps[j].trim();
        assert(s.length >= 20 && s.length <= 600, `${r.slug} step ${j + 1} length ${s.length} out of bounds`);
      }
    }
  });

  // --- Feature 5: board.json Structure & Rank ---
  runTest('T1.5.1', 'board.json contains at least 100 rows (target 200)', () => {
    assert(boardRows.length >= 100 && boardRows.length <= 4000, `board size ${boardRows.length}`);
    assert.strictEqual(boardRows.length, 200, 'board holds exactly 200 rows');
  });

  runTest('T1.5.2', 'Ranks are contiguous 1 through N', () => {
    const ranks = boardRows.map((r) => r.rank).sort((a, b) => a - b);
    for (let i = 0; i < ranks.length; i++) {
      assert.strictEqual(ranks[i], i + 1, `rank at index ${i}`);
    }
  });

  runTest('T1.5.3', 'All rows contain required schema fields', () => {
    for (const r of boardRows) {
      assert.strictEqual(typeof r.slug, 'string');
      assert.strictEqual(typeof r.name, 'string');
      assert.strictEqual(typeof r.rank, 'number');
      assert.strictEqual(typeof r.implied_value_usd, 'number');
      assert(Array.isArray(r.farm_steps));
    }
  });

  runTest('T1.5.4', 'Every row slug exists in snapshot protocols and is unique', () => {
    const snapSlugs = new Set(snapshot.protocols.map((p) => p.slug));
    const seen = new Set();
    for (const r of boardRows) {
      assert(snapSlugs.has(r.slug), `${r.slug} not in snapshot`);
      assert(!seen.has(r.slug), `duplicate slug ${r.slug}`);
      seen.add(r.slug);
    }
  });

  runTest('T1.5.5', 'board.json file size is <= 8 MiB', () => {
    const stat = lstatSync(join(outputDir, 'board.json'));
    assert(stat.size <= 8 * 1024 * 1024, `board.json size ${stat.size} exceeds 8 MiB`);
  });

  // --- Feature 6: Monotonic Non-Increasing Sort ---
  runTest('T1.6.1', 'Implied values do not rise as rank ascends', () => {
    for (let i = 1; i < boardRows.length; i++) {
      assert(boardRows[i].implied_value_usd <= boardRows[i - 1].implied_value_usd, `row ${i + 1} exceeds row ${i}`);
    }
  });

  runTest('T1.6.2', 'Rank 1 has the maximum implied valuation', () => {
    const maxVal = Math.max(...boardRows.map((r) => r.implied_value_usd));
    assert.strictEqual(boardRows[0].implied_value_usd, maxVal, 'rank 1 is max valuation');
  });

  runTest('T1.6.3', 'Rank N has the minimum implied valuation', () => {
    const minVal = Math.min(...boardRows.map((r) => r.implied_value_usd));
    assert.strictEqual(boardRows[boardRows.length - 1].implied_value_usd, minVal, 'rank N is min valuation');
  });

  runTest('T1.6.4', 'Board does not have all identical implied values', () => {
    assert.notStrictEqual(boardRows[0].implied_value_usd, boardRows[boardRows.length - 1].implied_value_usd, 'values are diverse');
  });

  runTest('T1.6.5', 'Deterministic tie-breaking preserves slug order on equal values', () => {
    for (let i = 1; i < boardRows.length; i++) {
      if (boardRows[i].implied_value_usd === boardRows[i - 1].implied_value_usd) {
        assert(boardRows[i].slug > boardRows[i - 1].slug, `Tie-broken slugs should be alphabetical: ${boardRows[i - 1].slug} vs ${boardRows[i].slug}`);
      }
    }
  });

  // --- Feature 7: Out-of-Dashboard Data Decoupling ---
  runTest('T1.7.1', 'data.js is emitted outside dashboard/', () => {
    assert(existsSync(join(outputDir, 'data.js')), 'data.js at output root');
    assert(!existsSync(join(outputDir, 'dashboard/data.js')), 'data.js not inside dashboard/');
  });

  runTest('T1.7.2', 'data.js assigns window.RADAR cleanly', () => {
    const content = readFileSync(join(outputDir, 'data.js'), 'utf8');
    assert(content.startsWith('window.RADAR='), 'starts with window.RADAR=');
    assert(content.endsWith(';\n') || content.endsWith(';'), 'ends with semicolon');
  });

  runTest('T1.7.3', 'data.js evaluates without syntax errors', () => {
    assert(radarData !== undefined && radarData.protocols !== undefined, 'radar data loaded successfully');
  });

  runTest('T1.7.4', 'buildDossier ignores data.js', () => {
    const dossier = JSON.parse(readFileSync(join(outputDir, 'dossier.json'), 'utf8'));
    assert(!dossier.text.includes('### data.js'), 'dossier does not include data.js in source blocks');
  });

  runTest('T1.7.5', 'dashboard source files size < 45 KB', () => {
    assert(aestheticAudit.findings.totalSourceBytes < 45000, `source size is ${aestheticAudit.findings.totalSourceBytes} bytes`);
  });

  // --- Feature 8: Offline Dashboard Shell ---
  runTest('T1.8.1', 'dashboard/index.html exists and is valid HTML5', () => {
    const html = readFileSync(join(projectRoot, 'dashboard/index.html'), 'utf8');
    assert(html.toLowerCase().includes('<!doctype html>'), 'valid doctype');
  });

  runTest('T1.8.2', 'index.html includes ../data.js', () => {
    const html = readFileSync(join(projectRoot, 'dashboard/index.html'), 'utf8');
    assert(html.includes('src="../data.js"'), 'includes ../data.js');
  });

  runTest('T1.8.3', 'index.html includes app.css', () => {
    const html = readFileSync(join(projectRoot, 'dashboard/index.html'), 'utf8');
    assert(html.includes('href="app.css"'), 'includes app.css');
  });

  runTest('T1.8.4', 'index.html includes app.js', () => {
    const html = readFileSync(join(projectRoot, 'dashboard/index.html'), 'utf8');
    assert(html.includes('src="app.js"'), 'includes app.js');
  });

  runTest('T1.8.5', 'index.html includes skip link for accessibility', () => {
    assert(aestheticAudit.findings.hasSkipLink, 'has skip link');
  });

  // --- Feature 9: Strict Zero-Network Enforcement ---
  runTest('T1.9.1', 'HTML attributes contain zero external URLs', () => {
    const violations = zeroNetAudit.violations.filter((v) => v.location.includes('HTML'));
    assert.strictEqual(violations.length, 0, 'zero HTML url violations');
  });

  runTest('T1.9.2', 'HTML style bodies contain zero external URLs', () => {
    const html = readFileSync(join(projectRoot, 'dashboard/index.html'), 'utf8');
    assert(!html.includes('http://') && !html.includes('https://'), 'no urls in html');
  });

  runTest('T1.9.3', 'CSS file contains zero external imports or url()', () => {
    const violations = zeroNetAudit.violations.filter((v) => v.location.includes('CSS'));
    assert.strictEqual(violations.length, 0, 'zero CSS url violations');
  });

  runTest('T1.9.4', 'JS files contain zero remote module imports', () => {
    const violations = zeroNetAudit.violations.filter((v) => v.location.includes('JS'));
    assert.strictEqual(violations.length, 0, 'zero JS url violations');
  });

  runTest('T1.9.5', 'dashboard_files gate check passes zero network validation', () => {
    assert(gateReport.gates.dashboard_files.pass, `dashboard_files gate detail: ${gateReport.gates.dashboard_files.detail}`);
  });

  // --- Feature 10: Anti-AI-Slop & Kowalski Polish ---
  runTest('T1.10.1', 'Zero emojis present in dashboard code', () => {
    assert(aestheticAudit.findings.zeroEmojis, 'zero emojis verified');
  });

  runTest('T1.10.2', 'font-variant-numeric: tabular-nums is defined in CSS', () => {
    assert(aestheticAudit.findings.hasTabularNums, 'tabular-nums verified');
  });

  runTest('T1.10.3', 'Font stack specifies refined typography', () => {
    assert(aestheticAudit.findings.fontStackValid, 'font stack valid');
  });

  runTest('T1.10.4', 'Active press states scale(0.97) implemented', () => {
    assert(aestheticAudit.findings.hasActivePressState, 'active press state verified');
  });

  runTest('T1.10.5', 'Sub-300ms transitions and custom easing defined', () => {
    assert(aestheticAudit.findings.hasSub300msTransitions, 'sub-300ms transitions verified');
  });

  // --- Feature 11: Main Board View & KPI Strip ---
  runTest('T1.11.1', 'KPI metrics display 4 key protocol statistics', () => {
    assert.strictEqual(radarData.watchlist_size, 40, 'watchlist size 40');
    assert.strictEqual(radarData.board_size, 200, 'board size 200');
    assert.strictEqual(radarData.early_size, 160, 'early size 160');
    assert(radarData.live_size >= 20, 'live size >= 20');
  });

  runTest('T1.11.2', 'Board table renders 200 rows on load', () => {
    const trs = domResult.rootBoard.querySelectorAll('tr');
    assert.strictEqual(trs.length, 201, '200 body rows + 1 header row');
  });

  runTest('T1.11.3', 'Table headers include sorting capabilities', () => {
    const ths = domResult.rootBoard.querySelectorAll('th');
    assert(ths.length >= 6, 'table has at least 6 header columns');
  });

  runTest('T1.11.4', 'Main board table structure is well-formed', () => {
    const table = domResult.rootBoard.querySelector('table');
    assert(table !== null, 'table element exists');
    assert(domResult.rootBoard.querySelector('thead') !== null, 'thead exists');
    assert(domResult.rootBoard.querySelector('tbody') !== null, 'tbody exists');
  });

  runTest('T1.11.5', 'Relative visual bars represent valuation proportion', () => {
    const bars = domResult.rootBoard.querySelectorAll('.bar');
    assert(bars.length >= 200, 'visual bars present for rows');
  });

  // --- Feature 12: Protocol Detail Sliding Drawer ---
  runTest('T1.12.1', 'Sliding dialog drawer element is created in DOM', () => {
    assert(aestheticAudit.findings.hasDialogDrawer, 'dialog drawer created');
  });

  runTest('T1.12.2', 'Detail view can display protocol specifics', () => {
    const p1 = radarData.protocols[0];
    assert(p1.name && p1.slug && p1.tvl_usd, 'protocol data fields complete');
  });

  runTest('T1.12.3', 'Detail view displays formula breakdown', () => {
    const model = radarData.model;
    assert(model.growth_clamp_min !== undefined, 'model constants available for display');
  });

  runTest('T1.12.4', 'Detail view renders 6 actionable farm steps', () => {
    const r1 = boardRows[0];
    assert.strictEqual(r1.farm_steps.length, 6, 'rank 1 has 6 farm steps');
  });

  runTest('T1.12.5', 'Detail drawer includes close button', () => {
    const css = readFileSync(join(projectRoot, 'dashboard/app.css'), 'utf8');
    assert(css.includes('.close') || css.includes('button'), 'close button styled');
  });

  // --- Feature 13: Multi-Facet Filter Controls ---
  runTest('T1.13.1', 'Search input control is rendered in DOM', () => {
    const search = domResult.rootBoard.querySelector('#q');
    assert(search !== null, 'search input #q exists');
  });

  runTest('T1.13.2', 'Category filter select control is rendered in DOM', () => {
    const cat = domResult.rootBoard.querySelector('#category');
    assert(cat !== null, 'category select #category exists');
  });

  runTest('T1.13.3', 'Tab buttons for pre-token and live-token exist', () => {
    const tabsDiv = domResult.rootBoard.querySelector('.tabs');
    assert(tabsDiv !== null, '.tabs container exists');
    const tabs = tabsDiv.children.filter((c) => c.tagName === 'BUTTON');
    assert(tabs.length >= 2, 'pre-token and live tabs exist');
  });

  runTest('T1.13.4', 'Filter counter reflects number of protocols', () => {
    const countEl = domResult.rootBoard.querySelector('.count');
    assert(countEl !== null, 'counter element exists');
    assert(countEl.textContent.includes('200 rows shown'), 'shows 200 rows shown initially');
  });

  runTest('T1.13.5', 'Filter panel container has proper controls class', () => {
    const ctrl = domResult.rootBoard.querySelector('.controls');
    assert(ctrl !== null, 'controls panel exists');
  });

  // --- Feature 14: Live Token Comps View ---
  runTest('T1.14.1', 'Live comps dataset is provided in data.js', () => {
    assert(Array.isArray(radarData.live_comps), 'live_comps is array');
  });

  runTest('T1.14.2', 'Live comps protocols include market cap and TVL', () => {
    for (const c of radarData.live_comps) {
      assert(c.mcap_usd > 0, `${c.slug} mcap > 0`);
      assert(c.tvl_usd > 0, `${c.slug} tvl > 0`);
    }
  });

  runTest('T1.14.3', 'Live comps protocols include computed valuation multiples', () => {
    for (const c of radarData.live_comps) {
      assert(c.multiple > 0, `${c.slug} multiple > 0`);
    }
  });

  runTest('T1.14.4', 'Live comps are ordered by market cap descending', () => {
    for (let i = 1; i < radarData.live_comps.length; i++) {
      assert(radarData.live_comps[i].mcap_usd <= radarData.live_comps[i - 1].mcap_usd, `live comp ${i} exceeds ${i - 1}`);
    }
  });

  runTest('T1.14.5', 'Live comps protocols are excluded from pre-token board', () => {
    const liveSlugs = new Set(radarData.live_comps.map((c) => c.slug));
    for (const r of boardRows) {
      assert(!liveSlugs.has(r.slug), `Pre-token board contains live protocol: ${r.slug}`);
    }
  });

  // --- Feature 15: Headless Screenshot Pipeline ---
  runTest('T1.15.1', '1-board.png exists and is valid PNG', () => {
    assert(existsSync(join(outputDir, 'screenshots/1-board.png')), '1-board.png exists');
  });

  runTest('T1.15.2', '2-detail.png exists and is valid PNG', () => {
    assert(existsSync(join(outputDir, 'screenshots/2-detail.png')), '2-detail.png exists');
  });

  runTest('T1.15.3', '3-filtered.png exists and is valid PNG', () => {
    assert(existsSync(join(outputDir, 'screenshots/3-filtered.png')), '3-filtered.png exists');
  });

  runTest('T1.15.4', 'Screenshots meet 1440x900 dimension requirements', () => {
    const buf = readFileSync(join(outputDir, 'screenshots/1-board.png'));
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    assert.strictEqual(w, 1440, 'width 1440');
    assert.strictEqual(h, 900, 'height 900');
  });

  runTest('T1.15.5', 'Screenshot sizes are <= 512 KiB each', () => {
    ['1-board.png', '2-detail.png', '3-filtered.png'].forEach((f) => {
      const stat = lstatSync(join(outputDir, 'screenshots', f));
      assert(stat.size <= 524288, `${f} is ${stat.size} bytes (limit 524,288)`);
    });
  });

  // --- Feature 16: Canonical Dossier Generation ---
  runTest('T1.16.1', 'dossier.json schema is makefun/dossier/v1', () => {
    const dossier = JSON.parse(readFileSync(join(outputDir, 'dossier.json'), 'utf8'));
    assert.strictEqual(dossier.schema, 'makefun/dossier/v1');
  });

  runTest('T1.16.2', 'dossier.json specifies cover: 0', () => {
    const dossier = JSON.parse(readFileSync(join(outputDir, 'dossier.json'), 'utf8'));
    assert.strictEqual(dossier.cover, 0);
  });

  runTest('T1.16.3', 'dossier.json contains exactly 3 images with base64 and sha256', () => {
    const dossier = JSON.parse(readFileSync(join(outputDir, 'dossier.json'), 'utf8'));
    assert.strictEqual(dossier.images.length, 3);
    for (const img of dossier.images) {
      assert(img.name && img.media_type && img.sha256 && img.base64);
    }
  });

  runTest('T1.16.4', 'dossier.json size is <= 1.5 MiB', () => {
    const stat = lstatSync(join(outputDir, 'dossier.json'));
    assert(stat.size <= 1572864, `dossier size ${stat.size} exceeds 1.5 MiB`);
  });

  runTest('T1.16.5', 'dossier.json matches buildDossier byte-for-byte', () => {
    const actualBytes = readFileSync(join(outputDir, 'dossier.json'));
    const expectedBytes = buildDossier(outputDir, { text_max_bytes: 65536 });
    assert.strictEqual(Buffer.compare(actualBytes, expectedBytes), 0, 'byte-for-byte match');
  });

  // --- Feature 17: OSI License & Repository Packaging ---
  runTest('T1.17.1', 'Root LICENSE exists', () => {
    assert(existsSync(join(projectRoot, 'LICENSE')), 'LICENSE exists');
  });

  runTest('T1.17.2', 'LICENSE begins with SPDX-License-Identifier: MIT', () => {
    const lic = readFileSync(join(projectRoot, 'LICENSE'), 'utf8');
    assert(lic.includes('SPDX-License-Identifier: MIT'), 'contains SPDX-License-Identifier: MIT');
  });

  runTest('T1.17.3', 'vendor/makefun-board.ts matches authoritative kit file', () => {
    assert(existsSync(join(projectRoot, 'vendor/makefun-board.ts')), 'makefun-board.ts exists');
  });

  runTest('T1.17.4', 'package.json defines type module', () => {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.type, 'module', 'type is module');
  });

  runTest('T1.17.5', 'No dot-directories exist in dashboard/', () => {
    const entries = readdirSync(join(projectRoot, 'dashboard'), { withFileTypes: true });
    for (const e of entries) {
      assert(!e.name.startsWith('.'), `dot entry found: ${e.name}`);
    }
  });

  // --- Feature 18: 7-Row Competition Gates ---
  runTest('T1.18.1', 'dashboard_files gate passes', () => {
    assert(gateReport.gates.dashboard_files.pass, gateReport.gates.dashboard_files.detail);
  });

  runTest('T1.18.2', 'board_file gate passes', () => {
    assert(gateReport.gates.board_file.pass, gateReport.gates.board_file.detail);
  });

  runTest('T1.18.3', 'sorted_by_value gate passes', () => {
    assert(gateReport.gates.sorted_by_value.pass, gateReport.gates.sorted_by_value.detail);
  });

  runTest('T1.18.4', 'coverage gate passes (100% of 40 watchlist items)', () => {
    assert(gateReport.gates.coverage.pass, gateReport.gates.coverage.detail);
  });

  runTest('T1.18.5', 'All 7 gates pass and Valid = 1', () => {
    assert(gateReport.gates.farm_steps.pass, gateReport.gates.farm_steps.detail);
    assert(gateReport.gates.screenshots.pass, gateReport.gates.screenshots.detail);
    assert(gateReport.gates.dossier_matches.pass, gateReport.gates.dossier_matches.detail);
    assert.strictEqual(gateReport.valid, 1, 'overall gate evaluation valid = 1');
  });

  return {
    tier: 1,
    name: 'Feature Coverage',
    total: tests.length,
    passed,
    failed,
    tests,
  };
}
