/**
 * Token Radar Type Definitions
 * make.fun competition #3 (token-radar-01)
 */

/** Protocol entry directly from the sealed snapshot.json */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** Complete sealed snapshot document */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Model constants and parameters */
export interface ModelConstants {
  version: string;
  sublinear_elasticity: number;
  growth_clamp_min: number;
  growth_clamp_max: number;
  growth_weight: number;
  breadth_weight: number;
  breadth_cap: number;
  default_category_multiple: number;
  multiple_clamp_min: number;
  multiple_clamp_max: number;
}

/** Model computation details for transparency */
export interface ModelBreakdown {
  category_multiple: number;
  base_tvl_factor: number;
  growth_pct: number;
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  age_days: number | null;
}

/** Individual row of board.json matching competition gate rules */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  implied_value_usd: number;
  farm_steps: string[];
  // Extended fields for dashboard and transparent scoring
  category?: string | null;
  chains?: string[];
  tvl_usd?: number;
  change_7d?: number | null;
  mcap_usd?: number | null;
  listed_at?: string | null;
  gecko_id?: string | null;
  symbol?: string | null;
  token_status?: 'pre-token';
  age_days?: number | null;
  model?: ModelBreakdown;
  risk_tier?: 'Low' | 'Moderate' | 'High';
  readiness_tier?: 'Launch Ready' | 'Scaling' | 'Mature';
  primary_chain?: string;
  is_watchlist?: boolean;
}

/** Root container for board.json */
export interface Board {
  rows: BoardRow[];
}

/** Live token protocol comparable from snapshot */
export interface LiveComp {
  slug: string;
  name: string;
  category: string;
  mcap_usd: number;
  tvl_usd: number;
  multiple: number;
  chains?: string[];
  change_7d?: number | null;
}

/** Enriched radar protocol combining snapshot data with calculated valuation metrics */
export interface RadarProtocol extends SnapshotProtocol {
  rank: number;
  implied_value_usd: number;
  multiple: number;
  age_days: number | null;
  farm_steps: string[];
  risk_tier: 'Low' | 'Moderate' | 'High';
  readiness_tier: 'Launch Ready' | 'Scaling' | 'Mature';
  primary_chain: string;
  is_watchlist: boolean;
  model: ModelBreakdown;
}

/** Summary statistics for dashboard KPI cards */
export interface RadarSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  median_multiple: number;
  avg_growth_7d: number;
  top_category: string;
}

/** Full data structure exported to window.RADAR in data.js */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: ModelConstants;
  watchlist_slugs: string[];
  live_comps: LiveComp[];
  summary: RadarSummary;
  protocols: RadarProtocol[];
  // Backwards compatibility aliases for dashboard renderers
  rows: RadarProtocol[];
  live: LiveComp[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}
