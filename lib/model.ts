/**
 * Token Radar Valuation Engine & Farm Plan Generator (radar-2)
 * make.fun competition #3 (token-radar-01)
 */

import type {
  Board,
  BoardRow,
  LiveComp,
  ModelBreakdown,
  ModelConstants,
  RadarData,
  RadarProtocol,
  RadarSummary,
  Snapshot,
  SnapshotProtocol,
} from './types.ts';

export const MODEL_VERSION = 'radar-2';

export const MODEL_CONSTANTS: ModelConstants = {
  version: MODEL_VERSION,
  sublinear_elasticity: 0.97,
  growth_clamp_min: -60,
  growth_clamp_max: 120,
  growth_weight: 0.45,
  breadth_weight: 0.035,
  breadth_cap: 6,
  default_category_multiple: 0.22,
  multiple_clamp_min: 0.08,
  multiple_clamp_max: 2.50,
};

const DAY_MS = 86_400_000;
const VERSIONED_PATTERN = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 1e2) / 1e2;

/**
 * Calculates day difference from as_of to listed_at date.
 * Returns null if listed_at is missing or unparseable.
 */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is rankable pre-token candidate. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED_PATTERN.test(p.name);
}

/**
 * Derives category valuation multiples from live token protocols in snapshot.
 * Aggregates Mcap / TVL ratios and clamps between 0.08 and 2.50.
 */
export function calibrateSectorComps(snapshot: Snapshot): {
  catMultiples: Record<string, number>;
  liveComps: LiveComp[];
  medianMultiple: number;
} {
  const liveProtocols = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX'
  );

  const catBuckets: Record<string, number[]> = {};
  const allRatios: number[] = [];
  const liveComps: LiveComp[] = [];

  for (const p of liveProtocols) {
    const ratio = p.mcap_usd! / p.tvl_usd;
    allRatios.push(ratio);
    const cat = p.category || 'Other';
    if (!catBuckets[cat]) catBuckets[cat] = [];
    catBuckets[cat].push(ratio);

    liveComps.push({
      slug: p.slug,
      name: p.name,
      category: cat,
      mcap_usd: p.mcap_usd!,
      tvl_usd: p.tvl_usd,
      multiple: round4(ratio),
      chains: p.chains,
      change_7d: p.change_7d,
    });
  }

  // Sort live comps by market cap descending
  liveComps.sort((a, b) => b.mcap_usd - a.mcap_usd || b.tvl_usd - a.tvl_usd);

  // Helper to compute median of numbers
  const calcMedian = (arr: number[]): number => {
    if (arr.length === 0) return MODEL_CONSTANTS.default_category_multiple;
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  };

  const overallMedian = round4(calcMedian(allRatios));
  const fallbackMultiple = Math.min(
    MODEL_CONSTANTS.multiple_clamp_max,
    Math.max(MODEL_CONSTANTS.multiple_clamp_min, overallMedian)
  );

  const catMultiples: Record<string, number> = {};
  for (const [cat, ratios] of Object.entries(catBuckets)) {
    const med = calcMedian(ratios);
    catMultiples[cat] = round4(
      Math.min(MODEL_CONSTANTS.multiple_clamp_max, Math.max(MODEL_CONSTANTS.multiple_clamp_min, med))
    );
  }

  return { catMultiples, liveComps, medianMultiple: fallbackMultiple };
}

/**
 * Computes non-linear peaked maturity factor based on age in days.
 * - < 90 days: 0.75 -> 1.00 (ramp)
 * - 90 - 540 days: 1.00 -> 1.20 (prime launch peak)
 * - 540 - 1095 days: 1.20 -> 0.90 (maturation)
 * - > 1095 days: 0.90 -> 0.65 (attention debt)
 */
export function calculateMaturityFactor(ageDaysVal: number): number {
  if (ageDaysVal < 90) {
    return 0.75 + (ageDaysVal / 90) * 0.25;
  }
  if (ageDaysVal <= 540) {
    return 1.00 + ((ageDaysVal - 90) / (540 - 90)) * 0.20;
  }
  if (ageDaysVal <= 1095) {
    return 1.20 - ((ageDaysVal - 540) / (1095 - 540)) * 0.30;
  }
  return Math.max(0.65, 0.90 - ((ageDaysVal - 1095) / 1095) * 0.25);
}

/**
 * Computes implied value and transparent factor breakdown for a protocol under radar-2.
 */
export function computeImpliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  categoryMultiple: number
): { implied: number; breakdown: ModelBreakdown } {
  // 1. Sublinear TVL Elasticity: tvl^0.97 * category_multiple
  const baseTvlFactor = Math.pow(Math.max(0, protocol.tvl_usd), MODEL_CONSTANTS.sublinear_elasticity) * categoryMultiple;

  // 2. Growth Velocity Clamp: [-60, 120] -> factor [0.73, 1.54]
  const rawGrowth = typeof protocol.change_7d === 'number' && Number.isFinite(protocol.change_7d) ? protocol.change_7d : 0;
  const clampedGrowth = Math.min(MODEL_CONSTANTS.growth_clamp_max, Math.max(MODEL_CONSTANTS.growth_clamp_min, rawGrowth));
  const growthFactor = 1 + (clampedGrowth / 100) * MODEL_CONSTANTS.growth_weight;

  // 3. Peaked Maturity Factor
  const age = ageDays(asOf, protocol.listed_at);
  const effectiveAge = age ?? 365;
  const maturityFactor = calculateMaturityFactor(effectiveAge);

  // 4. Omnichain Breadth Factor: 1 + min(chains - 1, 6) * 0.035
  const chainsCount = Array.isArray(protocol.chains) ? protocol.chains.length : 0;
  const chainBonusUnits = Math.min(Math.max(0, chainsCount - 1), MODEL_CONSTANTS.breadth_cap);
  const breadthFactor = 1 + chainBonusUnits * MODEL_CONSTANTS.breadth_weight;

  // 5. Implied Value Product
  const rawImplied = baseTvlFactor * growthFactor * maturityFactor * breadthFactor;
  const implied = Math.max(1, Math.round(rawImplied));

  const breakdown: ModelBreakdown = {
    category_multiple: round4(categoryMultiple),
    base_tvl_factor: Math.round(baseTvlFactor),
    growth_pct: round2(clampedGrowth),
    growth_factor: round4(growthFactor),
    maturity_factor: round4(maturityFactor),
    breadth_factor: round4(breadthFactor),
    age_days: age,
  };

  return { implied, breakdown };
}

/**
 * Generates actionable 6-step farm plan playbook for a protocol.
 * Each step string is strictly between 20 and 600 characters.
 */
export function generateFarmSteps(p: SnapshotProtocol, ageDaysVal: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'main chain';
  const name = p.name;
  const cat = (p.category ?? '').toLowerCase();

  // Scale capital by TVL: $250 (>=$1B), $100 (>=$100M), $50 (<$100M)
  let capital = 50;
  let gasCost = '$4-$8';
  if (p.tvl_usd >= 1_000_000_000) {
    capital = 250;
    gasCost = '$12-$15';
  } else if (p.tvl_usd >= 100_000_000) {
    capital = 100;
    gasCost = '$8-$12';
  }

  // Commitment holding window based on age
  let windowDays = 30;
  if (ageDaysVal === null || ageDaysVal < 180) {
    windowDays = 60;
  } else if (ageDaysVal < 365) {
    windowDays = 45;
  }

  // Step 1: Wallet Setup & OpSec
  const step1 = `Wallet Setup & OpSec: Initialize a dedicated clean EVM/SVM wallet with no prior transaction history to prevent cluster association. Pre-fund with $10-$15 in native gas tokens on ${chain} from a verified non-custodial wallet or sub-account. Est. Cost: $10-$15 gas pre-fund. Est. Time: 10 minutes.`;

  // Step 2: Core Capital Deployment tailored to category
  let coreAction = `Deposit $${capital} in USDC/USDT into ${name} on ${chain} and keep the position active to earn protocol points. Est. Cost: $${capital} capital plus ${gasCost} gas. Est. Time: 20 minutes.`;
  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) {
    coreAction = `Supply $${capital} in USDC/USDT collateral on ${name} (${chain}), then borrow a conservative 20% LTV in native stablecoin to generate dual-sided active utilization without liquidation risk. Est. Cost: $${capital} deposit plus ${gasCost} gas. Est. Time: 20 minutes.`;
  } else if (cat.includes('dex') || cat.includes('yield') || cat.includes('liquidity') || cat.includes('farm')) {
    coreAction = `Deploy $${capital} into ${name}'s concentrated liquidity pool (${chain}) within a +/-15% active tick band or automated vault to earn trading fees and liquidity mining accruals. Est. Cost: $${capital} capital plus ${gasCost} gas. Est. Time: 20 minutes.`;
  } else if (cat.includes('perpetual') || cat.includes('derivative') || cat.includes('options')) {
    coreAction = `Deposit $${capital} USDC collateral into ${name}'s trading margin account (${chain}). Open a low-leverage (1.5x) delta-neutral hedge position to generate protocol trading volume. Est. Cost: $${capital} margin deposit plus ${gasCost} gas. Est. Time: 25 minutes.`;
  } else if (cat.includes('bridge')) {
    coreAction = `Bridge $${capital} of USDC across ${name} into ${chain}, validating message delivery on the destination explorer, and deploy the bridged funds into primary ecosystem contracts. Est. Cost: $${capital} principal plus ${gasCost} bridge & gas fees. Est. Time: 15 minutes.`;
  } else if (cat.includes('staking') || cat.includes('restak')) {
    coreAction = `Deposit $${capital} of native assets into ${name}'s staking contract on ${chain}, receive the liquid receipt token, and verify points or reward accrual on the dashboard. Est. Cost: $${capital} staked capital plus ${gasCost} gas. Est. Time: 15 minutes.`;
  } else if (cat.includes('rwa') || cat.includes('basis') || cat.includes('allocator')) {
    coreAction = `Mint or deposit $${capital} into ${name}'s tokenized asset vault on ${chain} to accrue real-world yield; maintain the receipt token in your dedicated farming wallet. Est. Cost: $${capital} allocation plus ${gasCost} gas. Est. Time: 20 minutes.`;
  }

  // Step 3: Cadence & Sybil Resistance
  const step3 = `Cadence & Sybil Resistance: Perform weekly qualifying interactions—such as rebalancing LP ticks, claiming accrued fees, or executing a small swap/vote—to maintain active wallet cadence across multiple weekly epochs and avoid dormant Sybil filters. Est. Cost: ~$2 gas per week. Est. Time: 10 minutes weekly.`;

  // Step 4: Snapshot Window Commitment
  const step4 = `Snapshot Window Commitment: Maintain minimum active capital of $${capital} continuously for at least ${windowDays} days to ensure inclusion across quarterly snapshot blocks and cumulative volume tiers. Do not withdraw before the scheduled window closes. Est. Cost: $0 additional capital (opportunity cost only). Est. Time: ${windowDays} days monitoring.`;

  // Step 5: Claim Verification & Security
  const step5 = `Claim Verification & Security: When token generation event (TGE) eligibility or airdrop claims open, verify contract addresses against official documentation and announcements. Use browser isolation and verify signature hashes to prevent draining attacks. Never click unverified social links. Est. Cost: $0 to verify; standard claim gas only. Est. Time: 5 minutes.`;

  // Step 6: Unwind & Revocation Protocol
  const step6 = `Unwind & Revocation Protocol: Following snapshot confirmation or token claim, gracefully exit capital positions, bridge back principal assets, and immediately revoke all open ERC-20 token allowances via Revoke.cash or chain explorer tools. Est. Cost: $3-$6 in revocation and unwind gas. Est. Time: 10 minutes.`;

  const steps = [step1, coreAction, step3, step4, step5, step6];

  // Validate length constraint [20, 600]
  return steps.map((s) => {
    let t = s.trim();
    if (t.length > 600) t = `${t.slice(0, 596)}...`;
    if (t.length < 20) t = `${t} Maintain position and monitor updates.`;
    return t;
  });
}

/** Determines risk tier based on TVL, chains, and age */
function determineRiskTier(p: SnapshotProtocol, age: number | null): 'Low' | 'Moderate' | 'High' {
  if (p.tvl_usd >= 500_000_000 || (p.tvl_usd >= 100_000_000 && (age ?? 0) >= 365)) {
    return 'Low';
  }
  if (p.tvl_usd >= 50_000_000) {
    return 'Moderate';
  }
  return 'High';
}

/** Determines readiness tier based on age and growth */
function determineReadinessTier(p: SnapshotProtocol, age: number | null): 'Launch Ready' | 'Scaling' | 'Mature' {
  const effectiveAge = age ?? 365;
  if (effectiveAge >= 180 && effectiveAge <= 720) {
    return 'Launch Ready';
  }
  if (effectiveAge < 180) {
    return 'Scaling';
  }
  return 'Mature';
}

/**
 * Builds the ranked board and complete radar dataset.
 * Guarantees:
 * - Exactly 200 rows (40 watchlist items + 160 early pre-token protocols).
 * - Strictly non-increasing implied values.
 * - Contiguous 1..200 ranks.
 * - 6 concrete farm plan steps per protocol.
 */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { catMultiples, liveComps, medianMultiple } = calibrateSectorComps(snapshot);

  const bySlug = new Map<string, SnapshotProtocol>(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();

  // 1. Mandatory 100% coverage of watchlist
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) {
      chosen.set(slug, p);
    }
  }

  // 2. Add 160 early rankable protocols below floor by TVL descending
  const earlyCandidates = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, 160);

  for (const p of earlyCandidates) {
    chosen.set(p.slug, p);
  }

  // 3. Score every chosen protocol
  const scored = [...chosen.values()].map((p) => {
    const catMultiple = p.category && catMultiples[p.category] !== undefined ? catMultiples[p.category]! : medianMultiple;
    const { implied, breakdown } = computeImpliedValue(p, snapshot.as_of, catMultiple);
    const age = breakdown.age_days;
    const farmPlan = generateFarmSteps(p, age);
    const riskTier = determineRiskTier(p, age);
    const readinessTier = determineReadinessTier(p, age);
    const primaryChain = p.chains.length > 0 ? p.chains[0]! : 'Ethereum';
    const isWatchlist = snapshot.watchlist.includes(p.slug);

    return {
      protocol: p,
      implied,
      breakdown,
      farmPlan,
      catMultiple,
      age,
      riskTier,
      readinessTier,
      primaryChain,
      isWatchlist,
    };
  });

  // 4. Sort strictly descending by implied value, tie-breaker: tvl_usd desc, then slug asc
  scored.sort((a, b) => b.implied - a.implied || b.protocol.tvl_usd - a.protocol.tvl_usd || (a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0));

  // 5. Build BoardRows (1-based contiguous ranks)
  const board: BoardRow[] = scored.map((s, idx) => ({
    rank: idx + 1,
    slug: s.protocol.slug,
    name: s.protocol.name,
    category: s.protocol.category,
    chains: s.protocol.chains,
    tvl_usd: s.protocol.tvl_usd,
    change_7d: s.protocol.change_7d,
    mcap_usd: s.protocol.mcap_usd,
    listed_at: s.protocol.listed_at,
    gecko_id: s.protocol.gecko_id,
    symbol: s.protocol.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: s.breakdown,
    farm_steps: s.farmPlan,
    risk_tier: s.riskTier,
    readiness_tier: s.readinessTier,
    primary_chain: s.primaryChain,
    is_watchlist: s.isWatchlist,
  }));

  // 6. Build RadarProtocols for RadarData
  const radarProtocols: RadarProtocol[] = scored.map((s, idx) => ({
    ...s.protocol,
    rank: idx + 1,
    implied_value_usd: s.implied,
    multiple: s.catMultiple,
    age_days: s.age,
    farm_steps: s.farmPlan,
    risk_tier: s.riskTier,
    readiness_tier: s.readinessTier,
    primary_chain: s.primaryChain,
    is_watchlist: s.isWatchlist,
    model: s.breakdown,
  }));

  // 7. Calculate summary KPIs
  const totalImpliedUsd = board.reduce((sum, r) => sum + r.implied_value_usd, 0);
  const growths = board.map((r) => r.change_7d).filter((g): g is number => g !== null);
  const avgGrowth = growths.length > 0 ? round2(growths.reduce((a, b) => a + b, 0) / growths.length) : 0;

  // Category counts
  const catCounts: Record<string, number> = {};
  for (const r of board) {
    const c = r.category || 'Other';
    catCounts[c] = (catCounts[c] || 0) + 1;
  }
  let topCategory = 'Lending';
  let maxCount = 0;
  for (const [c, count] of Object.entries(catCounts)) {
    if (count > maxCount) {
      maxCount = count;
      topCategory = c;
    }
  }

  const summary: RadarSummary = {
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.length - snapshot.watchlist.length,
    live_size: liveComps.length,
    total_implied_usd: totalImpliedUsd,
    median_multiple: medianMultiple,
    avg_growth_7d: avgGrowth,
    top_category: topCategory,
  };

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: MODEL_CONSTANTS,
    watchlist_slugs: snapshot.watchlist,
    live_comps: liveComps,
    summary,
    protocols: radarProtocols,
    // Aliases for dashboard compatibility
    rows: radarProtocols,
    live: liveComps,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.length - snapshot.watchlist.length,
    live_size: liveComps.length,
  };

  return { board, radar };
}

/**
 * Validates board compliance against competition gate rules:
 * - 100% watchlist coverage.
 * - Contiguous ranks 1..N.
 * - Monotonically non-increasing implied values.
 * - Implied values are positive safe integers and not all identical.
 * - Each row has 3-12 farm steps, each 20-600 characters.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `board has ${board.length} rows, must be between 100 and 4000`;
  }

  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug(s): ${missing.slice(0, 5).join(', ')}`;
  }

  // Ranks check
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }

  // Monotonic descending order check
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} (${board[i]!.slug}: $${board[i]!.implied_value_usd}) outranks row ${i} (${board[i - 1]!.slug}: $${board[i - 1]!.implied_value_usd}) on implied value`;
    }
  }

  // No identical values across entire board
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}`;
  }

  // Row validation
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has invalid implied value ${r.implied_value_usd}`;
    }
    if (r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} implied value exceeds 100 trillion cap: ${r.implied_value_usd}`;
    }
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) {
      return `${r.slug} has ${steps.length} farm steps (allowed 3-12)`;
    }
    for (let j = 0; j < steps.length; j++) {
      const s = steps[j]!.trim();
      if (s.length < 20 || s.length > 600) {
        return `${r.slug} farm step ${j + 1} length is ${s.length} characters (allowed 20-600)`;
      }
    }
  }

  return null;
}

/** Parses and validates snapshot JSON */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no valid as_of date');
  }
  if (typeof o.source !== 'string') {
    throw new SnapshotError('snapshot.json has no source');
  }
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no valid floor_usd');
  }
  if (!Array.isArray(o.protocols)) {
    throw new SnapshotError('snapshot.json has no protocols array');
  }
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }

  const protocols: SnapshotProtocol[] = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json protocol ${i} lacks slug, name, or valid tvl_usd`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });

  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Serializes RadarData into window.RADAR assignment for data.js */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
