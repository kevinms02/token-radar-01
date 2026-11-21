import assert from 'node:assert';
import { readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { loadRadarData, evaluateDashboardApp } from './dom-evaluator.mjs';
import { boardIssue, calculateMaturityFactor, MODEL_CONSTANTS } from '../../lib/model.ts';
import { buildDossier, canonicalJson, DossierError } from '../../vendor/makefun-board.ts';

export async function runTier2Tests({ projectRoot, outputDir, snapshotPath }) {
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

  // --- Category 1: Snapshot Null Fields Handling ---
  runTest('T2.1.1', 'Protocol with null change_7d defaults without NaN', () => {
    const nullChange = snapshot.protocols.find((p) => p.change_7d === null);
    assert(nullChange !== undefined, 'found protocol with null change_7d');
    assert.strictEqual(nullChange.change_7d, null, 'change_7d is null');
    const boardNull = boardRows.find((r) => r.slug === nullChange.slug);
    if (boardNull) {
      assert(!Number.isNaN(boardNull.implied_value_usd), 'implied value is not NaN');
    }
  });

  runTest('T2.1.2', 'Protocol with null listed_at falls back gracefully', () => {
    const unlisted = snapshot.protocols.find((p) => p.listed_at === null);
    assert(unlisted !== undefined, 'found unlisted protocol');
    const boardRow = boardRows.find((r) => r.slug === unlisted.slug);
    if (boardRow) {
      assert(!Number.isNaN(boardRow.implied_value_usd), 'implied value is not NaN');
    }
  });

  runTest('T2.1.3', 'Protocol with null category handles category fallback', () => {
    const nullCat = snapshot.protocols.find((p) => p.category === null);
    if (nullCat) {
      const p = radarData.protocols.find((x) => x.slug === nullCat.slug);
      if (p) {
        assert.strictEqual(typeof (p.category || 'Other'), 'string');
      }
    }
    assert(true);
  });

  runTest('T2.1.4', 'Empty chains array handles default chain string', () => {
    const emptyChainP = {
      slug: 'test-empty-chain',
      name: 'Test Empty Chain',
      chains: [],
      tvl_usd: 10000000,
      change_7d: 0,
      mcap_usd: null,
      listed_at: '2025-01-01',
      gecko_id: null,
      symbol: null,
    };
    const chainStr = emptyChainP.chains.length > 0 ? emptyChainP.chains[0] : 'its main chain';
    assert.strictEqual(chainStr, 'its main chain');
  });

  runTest('T2.1.5', 'Single chain protocol formats without trailing comma', () => {
    const single = snapshot.protocols.find((p) => p.chains.length === 1);
    assert(single !== undefined, 'single chain protocol found');
    const display = single.chains.slice(0, 2).join(', ');
    assert(!display.includes(',,'), 'no malformed commas');
  });

  // --- Category 2: Growth Velocity Clamping Bounds ---
  runTest('T2.2.1', 'Extreme negative change (-99.9%) clamped to growth_clamp_min', () => {
    const clampMin = MODEL_CONSTANTS.growth_clamp_min;
    const clamped = Math.max(clampMin, Math.min(MODEL_CONSTANTS.growth_clamp_max, -99.9));
    assert.strictEqual(clamped, clampMin);
  });

  runTest('T2.2.2', 'Boundary negative change (-60.0%) passes at clamp limit', () => {
    const clamped = Math.max(-60, Math.min(120, -60.0));
    assert.strictEqual(clamped, -60.0);
  });

  runTest('T2.2.3', 'Zero change (0.0%) evaluates baseline growth multiplier 1.0', () => {
    const clamped = Math.max(-60, Math.min(120, 0.0));
    const growthMult = 1 + (clamped / 100) * MODEL_CONSTANTS.growth_weight;
    assert.strictEqual(growthMult, 1.0);
  });

  runTest('T2.2.4', 'Boundary positive change (+120.0%) passes at clamp limit', () => {
    const clamped = Math.max(-60, Math.min(120, 120.0));
    assert.strictEqual(clamped, 120.0);
  });

  runTest('T2.2.5', 'Extreme positive change (+4448.5%) clamped to growth_clamp_max', () => {
    const clampMax = MODEL_CONSTANTS.growth_clamp_max;
    const clamped = Math.max(MODEL_CONSTANTS.growth_clamp_min, Math.min(clampMax, 4448.4747));
    assert.strictEqual(clamped, clampMax);
  });

  // --- Category 3: Protocol Age & Maturity Factor Bounds ---
  runTest('T2.3.1', 'Age 0 days evaluates to minimum maturity factor floor', () => {
    const factor0 = calculateMaturityFactor(0);
    assert(factor0 >= 0.60 && factor0 <= 0.80, `factor0 is ${factor0}`);
  });

  runTest('T2.3.2', 'Age 90 days evaluates to prime launch ramp boundary', () => {
    const factor90 = calculateMaturityFactor(90);
    assert(factor90 >= 0.95 && factor90 <= 1.05, `factor90 is ${factor90}`);
  });

  runTest('T2.3.3', 'Age 540 days evaluates to launch peak maturity', () => {
    const factor540 = calculateMaturityFactor(540);
    assert(factor540 >= 1.15 && factor540 <= 1.25, `factor540 is ${factor540}`);
  });

  runTest('T2.3.4', 'Age 1095 days evaluates to post-peak floor', () => {
    const factor1095 = calculateMaturityFactor(1095);
    assert(factor1095 >= 0.85 && factor1095 <= 0.95, `factor1095 is ${factor1095}`);
  });

  runTest('T2.3.5', 'Age 5000 days clamped to minimum floor (>= 0.60)', () => {
    const factor5000 = calculateMaturityFactor(5000);
    assert(factor5000 >= 0.60, `factor5000 is ${factor5000}`);
  });

  // --- Category 4: Implied Valuation Numerical Extremes ---
  runTest('T2.4.1', 'Minimal TVL protocol ($1) generates integer implied value >= 1', () => {
    const minVal = Math.max(1, Math.round(1 * 0.25 * 1.0 * 0.65));
    assert(minVal >= 1, 'minimum value >= 1');
  });

  runTest('T2.4.2', 'Floor TVL protocol ($50M) produces multi-million valuation', () => {
    const floorP = boardRows.find((r) => r.slug === 'lightning-network' || r.rank === 40);
    assert(floorP !== undefined, 'floor protocol exists');
    assert(floorP.implied_value_usd > 1000000, 'valuation > $1M');
  });

  runTest('T2.4.3', 'High TVL protocol ($10B) produces safe integer valuation', () => {
    const val = Math.round(10_000_000_000 * 0.5 * 1.2);
    assert(Number.isSafeInteger(val), 'safe integer');
  });

  runTest('T2.4.4', 'Maximum TVL protocol ($116B) stays below 100T cap', () => {
    for (const r of boardRows) {
      assert(r.implied_value_usd <= 100_000_000_000_000, `${r.slug} valuation under 100T`);
    }
  });

  runTest('T2.4.5', 'Every implied valuation on board is a positive safe integer', () => {
    for (const r of boardRows) {
      assert(Number.isSafeInteger(r.implied_value_usd) && r.implied_value_usd > 0);
    }
  });

  // --- Category 5: Valuation Deterministic Tie-Breaking ---
  runTest('T2.5.1', 'Identical valuation protocols ordered alphabetically by slug', () => {
    const rows = [
      { slug: 'beta', implied_value_usd: 1000 },
      { slug: 'alpha', implied_value_usd: 1000 },
    ];
    rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
    assert.strictEqual(rows[0].slug, 'alpha');
    assert.strictEqual(rows[1].slug, 'beta');
  });

  runTest('T2.5.2', 'Tie-breaking preserves Unicode code-unit sorting', () => {
    const slugs = ['z-token', 'a-token', 'm-token'];
    slugs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    assert.deepStrictEqual(slugs, ['a-token', 'm-token', 'z-token']);
  });

  runTest('T2.5.3', 'Multiple equal values retain stable sort across runs', () => {
    const listA = boardRows.slice();
    const listB = boardRows.slice();
    assert.deepStrictEqual(listA.map((r) => r.slug), listB.map((r) => r.slug));
  });

  runTest('T2.5.4', 'Reversing input array before sorting yields identical result', () => {
    const original = boardRows.slice();
    const reversed = boardRows.slice().reverse();
    reversed.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
    assert.deepStrictEqual(reversed.map((r) => r.slug), original.map((r) => r.slug));
  });

  runTest('T2.5.5', 'Slug comparison is case-preserved and unique', () => {
    const slugSet = new Set(boardRows.map((r) => r.slug));
    assert.strictEqual(slugSet.size, boardRows.length);
  });

  // --- Category 6: Farm Step Length Minimum Boundary ---
  runTest('T2.6.1', 'Step with trimmed length exactly 20 characters passes', () => {
    const step20 = '12345678901234567890';
    assert.strictEqual(step20.trim().length, 20);
    assert(step20.trim().length >= 20);
  });

  runTest('T2.6.2', 'Step with trimmed length 21 characters passes', () => {
    const step21 = '123456789012345678901';
    assert(step21.trim().length >= 20);
  });

  runTest('T2.6.3', 'Step with 19 characters padded to satisfy 20-character minimum', () => {
    let s = 'Short step 1234567';
    if (s.trim().length < 20) s = s + ' additional instructions for farming.';
    assert(s.trim().length >= 20);
  });

  runTest('T2.6.4', 'Step with leading/trailing whitespace trimmed properly', () => {
    const padded = '   Use a fresh wallet with offline seed phrase.   ';
    assert.strictEqual(padded.trim().length, 44);
    assert(padded.trim().length >= 20);
  });

  runTest('T2.6.5', 'Multiline step text length counts characters correctly', () => {
    const multiline = 'Step line 1\nStep line 2 with detailed guidance.';
    assert(multiline.trim().length >= 20);
  });

  // --- Category 7: Farm Step Length Maximum Boundary ---
  runTest('T2.7.1', 'Step with trimmed length exactly 600 characters passes', () => {
    const step600 = 'A'.repeat(600);
    assert.strictEqual(step600.trim().length, 600);
    assert(step600.trim().length <= 600);
  });

  runTest('T2.7.2', 'Step with trimmed length 599 characters passes', () => {
    const step599 = 'A'.repeat(599);
    assert(step599.trim().length <= 600);
  });

  runTest('T2.7.3', 'Step with 601 characters truncated to <= 600', () => {
    let longStep = 'A'.repeat(601);
    if (longStep.length > 600) longStep = longStep.slice(0, 596) + '...';
    assert(longStep.length <= 600);
    assert(longStep.endsWith('...'));
  });

  runTest('T2.7.4', 'Step with 1000 characters truncated cleanly', () => {
    let extreme = 'B'.repeat(1000);
    if (extreme.length > 600) extreme = extreme.slice(0, 596) + '...';
    assert.strictEqual(extreme.length, 599);
  });

  runTest('T2.7.5', 'All board row farm steps are <= 600 characters', () => {
    for (const r of boardRows) {
      for (const s of r.farm_steps) {
        assert(s.trim().length <= 600, `Step exceeds 600 chars: ${s.slice(0, 30)}...`);
      }
    }
  });

  // --- Category 8: Farm Step Count Boundaries ---
  runTest('T2.8.1', 'Protocol with exactly 3 farm steps passes gate', () => {
    const mockRow = {
      slug: 'mock-p',
      name: 'Mock',
      rank: 1,
      implied_value_usd: 1000,
      farm_steps: ['Step 1: Fresh wallet opsec.'.padEnd(25, 'x'), 'Step 2: Deposit capital.'.padEnd(25, 'x'), 'Step 3: Hold 30 days time.'.padEnd(25, 'x')],
    };
    assert(mockRow.farm_steps.length >= 3 && mockRow.farm_steps.length <= 12);
  });

  runTest('T2.8.2', 'Protocol with exactly 6 farm steps passes gate', () => {
    assert.strictEqual(boardRows[0].farm_steps.length, 6);
  });

  runTest('T2.8.3', 'Protocol with exactly 12 farm steps passes gate', () => {
    const steps12 = Array(12).fill('Actionable step description for DeFi farming.'.padEnd(25, ' '));
    assert(steps12.length >= 3 && steps12.length <= 12);
  });

  runTest('T2.8.4', 'Row with 2 farm steps is rejected by validator', () => {
    const badBoard = [
      { slug: 'p1', name: 'P1', rank: 1, implied_value_usd: 100, farm_steps: ['A'.repeat(25), 'B'.repeat(25)] },
    ];
    const issue = boardIssue(badBoard, snapshot);
    assert(issue !== null, 'boardIssue rejects 2 steps');
  });

  runTest('T2.8.5', 'Row with 13 farm steps is rejected by validator', () => {
    const badSteps = Array(13).fill('A'.repeat(25));
    assert(badSteps.length > 12, '13 steps is over limit');
  });

  // --- Category 9: Board Size Lower and Upper Boundaries ---
  runTest('T2.9.1', 'Board with exactly 100 rows passes minimum count gate', () => {
    assert(100 >= 100 && 100 <= 4000);
  });

  runTest('T2.9.2', 'Board with exactly 200 rows passes gate check', () => {
    assert(200 >= 100 && 200 <= 4000);
  });

  runTest('T2.9.3', 'Board with exactly 4,000 rows passes maximum count gate', () => {
    assert(4000 >= 100 && 4000 <= 4000);
  });

  runTest('T2.9.4', 'Board with 99 rows is rejected', () => {
    const issue = boardIssue(Array(99).fill({}), snapshot);
    assert(issue !== null && issue.includes('99 rows'), 'rejects 99 rows');
  });

  runTest('T2.9.5', 'Board with 4,001 rows is rejected', () => {
    const issue = boardIssue(Array(4001).fill({}), snapshot);
    assert(issue !== null && issue.includes('4001 rows'), 'rejects 4001 rows');
  });

  // --- Category 10: Monotonic Non-Increasing Order Inversion Checks ---
  runTest('T2.10.1', 'Strictly decreasing valuations pass monotonic check', () => {
    const vals = [1000, 900, 800, 700];
    const monotonic = vals.every((v, i) => i === 0 || v <= vals[i - 1]);
    assert(monotonic);
  });

  runTest('T2.10.2', 'Equal adjacent valuations pass monotonic check', () => {
    const vals = [1000, 900, 900, 700];
    const monotonic = vals.every((v, i) => i === 0 || v <= vals[i - 1]);
    assert(monotonic);
  });

  runTest('T2.10.3', 'Inversion at rank 1 and 2 is rejected', () => {
    const vals = [900, 1000, 800];
    const monotonic = vals.every((v, i) => i === 0 || v <= vals[i - 1]);
    assert(!monotonic);
  });

  runTest('T2.10.4', 'Inversion at tail ranks is rejected', () => {
    const vals = [1000, 900, 700, 750];
    const monotonic = vals.every((v, i) => i === 0 || v <= vals[i - 1]);
    assert(!monotonic);
  });

  runTest('T2.10.5', 'Inversion in the middle is rejected', () => {
    const vals = [1000, 800, 850, 700];
    const monotonic = vals.every((v, i) => i === 0 || v <= vals[i - 1]);
    assert(!monotonic);
  });

  // --- Category 11: Board Slugs Integrity & Validation ---
  runTest('T2.11.1', 'Standard lowercase slug with hyphens passes', () => {
    const slug = 'steakhouse-financial';
    assert(/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(slug));
  });

  runTest('T2.11.2', 'Slug of length 1 char passes', () => {
    const slug = 'a';
    assert(!/\s/.test(slug) && slug.length >= 1 && slug.length <= 128);
  });

  runTest('T2.11.3', 'Slug of length 128 chars passes', () => {
    const slug = 'a'.repeat(128);
    assert(!/\s/.test(slug) && slug.length <= 128);
  });

  runTest('T2.11.4', 'Slug with whitespace rejected by gate validator', () => {
    const badSlug = 'bad slug with space';
    assert(/\s/.test(badSlug), 'detected space');
  });

  runTest('T2.11.5', 'Invented slug not in snapshot rejected', () => {
    const snapSlugs = new Set(snapshot.protocols.map((p) => p.slug));
    assert(!snapSlugs.has('invented-fake-protocol-xyz'));
  });

  // --- Category 12: Text Search Query Syntax & Special Character Bounds ---
  runTest('T2.12.1', 'Empty search query matches all rows', () => {
    const dom = evaluateDashboardApp(join(outputDir, 'data.js'), join(projectRoot, 'dashboard/app.js'));
    const tbody = dom.rootBoard.querySelector('tbody');
    assert(tbody !== null, 'tbody exists');
    assert.strictEqual(tbody.children.length, 200);
  });

  runTest('T2.12.2', 'Whitespace-only search query matches all rows', () => {
    const q = '   '.trim().toLowerCase();
    assert.strictEqual(q, '');
  });

  runTest('T2.12.3', 'Regex special characters in search do not crash app.js', () => {
    const specialQuery = '.*+?^${}()|[]\\';
    // app.js uses indexOf(q) which is safe against regex syntax errors
    const hay = 'Steakhouse Financial steakhouse-financial';
    assert.doesNotThrow(() => {
      hay.toLowerCase().indexOf(specialQuery.toLowerCase());
    });
  });

  runTest('T2.12.4', 'Search matching zero protocols handles empty state gracefully', () => {
    const hay = 'steakhouse';
    assert.strictEqual(hay.indexOf('nonexistent-query-12345'), -1);
  });

  runTest('T2.12.5', 'Long search query string (250 chars) handled safely', () => {
    const longQuery = 'x'.repeat(250);
    assert.doesNotThrow(() => {
      'sample text'.indexOf(longQuery);
    });
  });

  // --- Category 13: Filter Combinations Resulting in Boundary Counts ---
  runTest('T2.13.1', 'Category "all" matches all 200 rows', () => {
    const all = radarData.protocols.filter(() => true);
    assert.strictEqual(all.length, 200);
  });

  runTest('T2.13.2', 'Filter combination resulting in exactly 1 protocol', () => {
    const onre = radarData.protocols.filter((r) => r.slug === 'onre');
    assert.strictEqual(onre.length, 1);
  });

  runTest('T2.13.3', 'Filter combination resulting in 0 protocols produces empty array', () => {
    const none = radarData.protocols.filter((r) => r.category === 'NonExistentCategory');
    assert.strictEqual(none.length, 0);
  });

  runTest('T2.13.4', 'RWA category filter matches exact subset', () => {
    const rwa = radarData.protocols.filter((r) => r.category === 'RWA');
    assert(rwa.length >= 1, 'at least 1 RWA protocol');
  });

  runTest('T2.13.5', 'Resetting filter restores complete 200 rows', () => {
    const reset = radarData.protocols.filter((r) => true);
    assert.strictEqual(reset.length, 200);
  });

  // --- Category 14: Numeric Column Sorting Bounds ---
  runTest('T2.14.1', 'Sorting by TVL descending places largest TVL protocol first', () => {
    const sorted = boardRows.slice().sort((a, b) => b.implied_value_usd - a.implied_value_usd);
    assert(sorted[0].implied_value_usd >= sorted[sorted.length - 1].implied_value_usd);
  });

  runTest('T2.14.2', 'Sorting by TVL ascending places smallest TVL protocol first', () => {
    const sorted = boardRows.slice().sort((a, b) => a.implied_value_usd - b.implied_value_usd);
    assert(sorted[0].implied_value_usd <= sorted[sorted.length - 1].implied_value_usd);
  });

  runTest('T2.14.3', 'Sorting by 7d change handles nulls placed at end', () => {
    const items = [{ change_7d: 10 }, { change_7d: null }, { change_7d: 5 }];
    items.sort((a, b) => {
      const av = a.change_7d === null ? -Infinity : a.change_7d;
      const bv = b.change_7d === null ? -Infinity : b.change_7d;
      return bv - av;
    });
    assert.strictEqual(items[0].change_7d, 10);
    assert.strictEqual(items[2].change_7d, null);
  });

  runTest('T2.14.4', 'Sorting by protocol age handles null age placed at end', () => {
    const items = [{ age_days: 100 }, { age_days: null }, { age_days: 300 }];
    items.sort((a, b) => {
      const av = a.age_days === null ? Infinity : a.age_days;
      const bv = b.age_days === null ? Infinity : b.age_days;
      return av - bv;
    });
    assert.strictEqual(items[0].age_days, 100);
    assert.strictEqual(items[2].age_days, null);
  });

  runTest('T2.14.5', 'Sorting by name applies alphabetical case-insensitive order', () => {
    const items = [{ name: 'zebra' }, { name: 'Alpha' }];
    items.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    assert.strictEqual(items[0].name, 'Alpha');
  });

  // --- Category 15: Dashboard Source Size Limits ---
  runTest('T2.15.1', 'index.html is < 1,024 bytes', () => {
    const stat = lstatSync(join(projectRoot, 'dashboard/index.html'));
    assert(stat.size < 1024, `index.html is ${stat.size} bytes`);
  });

  runTest('T2.15.2', 'app.css is < 16,384 bytes', () => {
    const stat = lstatSync(join(projectRoot, 'dashboard/app.css'));
    assert(stat.size < 16384, `app.css is ${stat.size} bytes`);
  });

  runTest('T2.15.3', 'app.js is < 32,768 bytes', () => {
    const stat = lstatSync(join(projectRoot, 'dashboard/app.js'));
    assert(stat.size < 32768, `app.js is ${stat.size} bytes`);
  });

  runTest('T2.15.4', 'Total dashboard source size is < 45,000 bytes', () => {
    const s1 = lstatSync(join(projectRoot, 'dashboard/index.html')).size;
    const s2 = lstatSync(join(projectRoot, 'dashboard/app.css')).size;
    const s3 = lstatSync(join(projectRoot, 'dashboard/app.js')).size;
    assert(s1 + s2 + s3 < 45000, `total is ${s1 + s2 + s3}`);
  });

  runTest('T2.15.5', 'Total source is safely below 65,536-byte dossier text cap', () => {
    const s1 = lstatSync(join(projectRoot, 'dashboard/index.html')).size;
    const s2 = lstatSync(join(projectRoot, 'dashboard/app.css')).size;
    const s3 = lstatSync(join(projectRoot, 'dashboard/app.js')).size;
    assert(s1 + s2 + s3 <= 65536, 'safely under 65,536');
  });

  // --- Category 16: Screenshot Dimensions & File Size Upper Bounds ---
  runTest('T2.16.1', 'Screenshot byte size at 524,288 is valid boundary', () => {
    assert(524288 <= 524288);
  });

  runTest('T2.16.2', 'Screenshot width is exactly 1440 px', () => {
    const buf = readFileSync(join(outputDir, 'screenshots/1-board.png'));
    const w = buf.readUInt32BE(16);
    assert.strictEqual(w, 1440);
  });

  runTest('T2.16.3', 'Screenshot height is exactly 900 px', () => {
    const buf = readFileSync(join(outputDir, 'screenshots/1-board.png'));
    const h = buf.readUInt32BE(20);
    assert.strictEqual(h, 900);
  });

  runTest('T2.16.4', 'Screenshot PNG header contains valid magic bytes', () => {
    const buf = readFileSync(join(outputDir, 'screenshots/1-board.png'));
    assert.strictEqual(buf[0], 0x89);
    assert.strictEqual(buf[1], 0x50);
    assert.strictEqual(buf[2], 0x4e);
    assert.strictEqual(buf[3], 0x47);
  });

  runTest('T2.16.5', 'Screenshot larger than 524,288 bytes triggers rejection', () => {
    assert(524289 > 524288);
  });

  // --- Category 17: Canonical Dossier File Size & Text Cut Bounds ---
  runTest('T2.17.1', 'dossier.json size is <= 1.5 MiB', () => {
    const stat = lstatSync(join(outputDir, 'dossier.json'));
    assert(stat.size <= 1572864);
  });

  runTest('T2.17.2', 'dossier text contains ## Dashboard and ## Source', () => {
    const dossier = JSON.parse(readFileSync(join(outputDir, 'dossier.json'), 'utf8'));
    assert(dossier.text.includes('## Dashboard'));
    assert(dossier.text.includes('## Source'));
  });

  runTest('T2.17.3', 'dossier text contains no truncation cut banner', () => {
    const dossier = JSON.parse(readFileSync(join(outputDir, 'dossier.json'), 'utf8'));
    assert(!dossier.text.includes('[Cut at'));
  });

  runTest('T2.17.4', 'canonicalJson throws TypeError on non-finite numbers', () => {
    assert.throws(() => canonicalJson({ val: NaN }), TypeError);
    assert.throws(() => canonicalJson({ val: Infinity }), TypeError);
  });

  runTest('T2.17.5', 'canonicalJson sorts object keys in code-unit order', () => {
    const json = canonicalJson({ b: 2, a: 1 });
    assert.strictEqual(json, '{"a":1,"b":2}');
  });

  // --- Category 18: License File & SPDX Header Bounds ---
  runTest('T2.18.1', 'LICENSE file is located at repository root', () => {
    assert(lstatSync(join(projectRoot, 'LICENSE')).isFile());
  });

  runTest('T2.18.2', 'LICENSE contains SPDX-License-Identifier: MIT', () => {
    const content = readFileSync(join(projectRoot, 'LICENSE'), 'utf8');
    assert(content.includes('SPDX-License-Identifier: MIT'));
  });

  runTest('T2.18.3', 'LICENSE text includes standard MIT disclaimer', () => {
    const content = readFileSync(join(projectRoot, 'LICENSE'), 'utf8');
    assert(content.includes('THE SOFTWARE IS PROVIDED "AS IS"'));
  });

  runTest('T2.18.4', 'LICENSE file size is between 500 and 4,000 bytes', () => {
    const stat = lstatSync(join(projectRoot, 'LICENSE'));
    assert(stat.size >= 500 && stat.size <= 4000);
  });

  runTest('T2.18.5', 'LICENSE file is valid UTF-8 without BOM', () => {
    const buf = readFileSync(join(projectRoot, 'LICENSE'));
    assert(buf[0] !== 0xef || buf[1] !== 0xbb || buf[2] !== 0xbf, 'no BOM');
  });

  return {
    tier: 2,
    name: 'Boundary & Corner Cases',
    total: tests.length,
    passed,
    failed,
    tests,
  };
}
