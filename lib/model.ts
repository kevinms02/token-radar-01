// Quantitative Implied Valuation Model and Farming Playbook Engine
// token-radar-01 for make.fun

import type {
  BoardRow,
  FarmStep,
  LiveRow,
  ModelConstants,
  RadarData,
  RadarRow,
  Snapshot,
  SnapshotProtocol,
  ValuationBreakdown,
} from './types.ts';

export const MODEL: ModelConstants = {
  base_multiple: 0.50,
  growth_weight: 0.40,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.70,
  maturity_range: 0.30,
  maturity_days: 730,
  unknown_age_days: 365,
};

export const MODEL_VERSION = 'radar-institutional-v1';
export const EARLY_ROWS = 160;
export const LIVE_ROWS = 24;
const DAY_MS = 86_400_000;

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Calculate whole day count from protocol listing date to snapshot date */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * Sector category multiple calibrated against historical DeFi token launches.
 * Reflects fee capture velocity, capital turnover, and protocol monetization power.
 */
export function categoryMultiple(category: string | null): number {
  if (!category) return 0.50;
  const c = category.toLowerCase();
  if (c.includes('derivative') || c.includes('perp') || c.includes('option') || c.includes('basis') || c.includes('synthetics')) {
    return 1.20;
  }
  if (c.includes('dex') || c.includes('amm') || c.includes('swap') || c.includes('otc')) {
    return 0.85;
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('borrow') || c.includes('collateral')) {
    return 0.70;
  }
  if (c.includes('rwa') || c.includes('card') || c.includes('payment') || c.includes('stable')) {
    return 0.65;
  }
  if (c.includes('chain') || c.includes('bridge') || c.includes('cross chain')) {
    return 0.90;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault') || c.includes('liquidity manager')) {
    return 0.60;
  }
  if (c.includes('restak') || c.includes('staking') || c.includes('yield') || c.includes('farm')) {
    return 0.45;
  }
  if (c.includes('ai') || c.includes('agent') || c.includes('prediction')) {
    return 1.10;
  }
  return 0.50;
}

/**
 * Calculates multi-factor implied valuation for a protocol:
 * Implied Value = TVL * M_cat * V_7d * L_age * C_mult
 */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants = MODEL,
): {
  implied: number;
  breakdown: ValuationBreakdown;
} {
  const catMult = categoryMultiple(protocol.category);
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;

  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;

  const chainCount = Array.isArray(protocol.chains) ? protocol.chains.length : 1;
  const multichainMult = 1.0 + Math.min(Math.max(chainCount - 1, 0), 5) * 0.05;

  const base = protocol.tvl_usd * catMult;
  const rawImplied = base * growthMult * maturityMult * multichainMult;
  const implied = Math.max(100_000, Math.round(rawImplied));

  return {
    implied,
    breakdown: {
      base_multiple: catMult,
      growth_pct: growthPct,
      growth_multiplier: round4(growthMult),
      maturity_multiplier: round4(maturityMult),
      multichain_multiplier: round4(multichainMult),
      age_days: age,
    },
  };
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Check if protocol records no token (no mcap, no gecko_id, no symbol) */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Check if protocol is candidate for ranking */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'Ethereum';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 100_000_000) return 250;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionDescription(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('derivative') || c.includes('perp') || c.includes('option') || c.includes('basis')) {
    return `Deposit $${capital} USDC collateral into ${name} on ${chain} and open a minimal 1x delta-neutral hedge position.`;
  }
  if (c.includes('dex') || c.includes('amm') || c.includes('swap')) {
    return `Provide $${capital} liquidity to ${name}'s highest-volume pool on ${chain} and keep the position active.`;
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC into ${name} on ${chain} to accrue lending yield and keep the position active.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) {
    return `Allocate $${capital} into ${name}'s primary curated vault strategy on ${chain} and retain vault shares.`;
  }
  if (c.includes('rwa') || c.includes('card') || c.includes('payment') || c.includes('stable')) {
    return `Deposit $${capital} into ${name}'s verified yield asset vault on ${chain} and hold the allocation.`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `Stake $${capital} of base asset into ${name}'s validator pool on ${chain} and securely hold the receipt token.`;
  }
  if (c.includes('chain') || c.includes('bridge')) {
    return `Bridge $${capital} USDC to ${chain} via ${name} and perform one subsequent transaction on the destination chain.`;
  }
  return `Deposit $${capital} of USDC into ${name}'s primary pool on ${chain} and keep the position active.`;
}

/** Formats a structured farm step into a single actionable instruction conforming to 20-600 char rules */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 590) s = `${s.slice(0, 586)}...`;
  if (s.length < 20) s = `${s} Maintain the active on-chain position.`;
  return s;
}

/** Dynamic Farming Playbook Synthesizer: 6 concrete, costed steps tailored to protocol category & TVL */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionDescription(p, capital, chain);
  const gasEstimate = capital >= 250 ? '$6.00 to $12.00' : '$2.00 to $5.00';

  return [
    {
      text: `Prepare a dedicated non-custodial wallet with sufficient native gas tokens on ${chain} for protocol interaction.`,
      cost: 'under $3.00 for setup gas transfer',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} capital deposit plus approximately ${gasEstimate} in network gas`,
      time: '15 minutes setup',
    },
    {
      text: `Perform at least one qualifying protocol action every 7 days (deposit rebalance, borrow adjustment, or swap) to build consistency.`,
      cost: 'approx $1.50 in gas per weekly transaction',
      time: '5 minutes weekly',
    },
    {
      text: `Maintain the deployed capital position for at least ${hold} consecutive days to ensure coverage across snapshot intervals.`,
      cost: `the $${capital} principal remains deployed in the protocol`,
      time: `${hold} days continuous holding`,
    },
    {
      text: `Verify accumulated reward points or allocation tiers on ${p.name}'s official interface, avoiding unauthorized third-party links.`,
      cost: 'free to inspect status',
      time: '5 minutes',
    },
    {
      text: `Record transaction hashes and timestamp entries in a tracking log to prepare for formal claim execution upon TGE announcement.`,
      cost: 'zero financial cost',
      time: '5 minutes documentation',
    },
  ];
}

/** Build the complete ranked board adhering to monotonic implied value order and 100% watchlist coverage */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();

  // 1. Mandatory 100% Watchlist Coverage (Floor)
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) {
      chosen.set(slug, p);
    }
  }

  // 2. Early Radar Discovery: Top pre-token protocols below the watchlist floor sorted by TVL
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);

  for (const p of early) {
    chosen.set(p.slug, p);
  }

  // 3. Quantitative Scoring
  const scored = [...chosen.values()].map((p) => {
    const { implied, breakdown } = impliedValue(p, snapshot.as_of, model);
    return { p, implied, breakdown, age: breakdown.age_days };
  });

  // 4. Strict Monotonic Sorting: implied_value_usd descending, then TVL descending, then slug ascending
  scored.sort((a, b) => {
    if (b.implied !== a.implied) return b.implied - a.implied;
    if (b.p.tvl_usd !== a.p.tvl_usd) return b.p.tvl_usd - a.p.tvl_usd;
    return a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0;
  });

  // 5. Rank Assignment: 1 to N
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: s.breakdown,
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    multichain_multiplier: row.model.multichain_multiplier,
    farm_steps: row.farm_steps,
  };
}

export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const earlyCount = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: earlyCount,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };

  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no valid as_of date');
  }
  if (typeof o.source !== 'string') {
    throw new SnapshotError('snapshot.json has no source field');
  }
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no positive floor_usd');
  }
  if (!Array.isArray(o.protocols)) {
    throw new SnapshotError('snapshot.json has no protocols array');
  }
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no valid watchlist of slugs');
  }

  const protocols: SnapshotProtocol[] = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (
      typeof p.slug !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.tvl_usd !== 'number' ||
      !Number.isFinite(p.tvl_usd)
    ) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks valid slug, name, or tvl_usd`);
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

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has invalid implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
