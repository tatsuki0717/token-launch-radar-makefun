// Token Radar model v2: peer-calibrated implied values for pre-token protocols.
//
// Where v1 (the starter) multiplied every protocol's TVL by one flat 0.25, this model calibrates
// the multiple from the snapshot itself. Protocols whose token already trades reveal what the
// market pays per dollar of TVL in each category, so a pre-token protocol is valued at the
// multiple its own category's live peers actually trade at:
//
//   peers(cat)  = median(mcap_usd / tvl_usd) over live protocols in the same category
//   multiple    = clamp( (n x peers(cat) + K x global_median) / (n + K), 0.04, 1.50 ),
//                 each peer's own multiple first winsorised to [0.02, 3] against wild prints
//                 with K = 4, so a thin category is shrunk toward the global median (0.205 here)
//   growthMult  = 1 + 0.22 x sign(g) x sqrt(|g| / 25),  g = clamp(change_7d, -60, 150):
//                 weekly momentum, dampened so one hot week cannot double a valuation
//   maturity    = 0.80 + 0.30 x log1p(age_days) / log1p(1825): years run with no token are
//                 evidence a launch, if it comes, is backed by a working product
//   breadth     = 1 + 0.025 x min(chains - 1, 6): distribution across chains is worth a little
//   implied     = round( tvl_usd x multiple x growthMult x maturity x breadth )
//
// No protocol name is ever special-cased: the same functions score every row, the category
// multiples are computed from the snapshot at run time, and the dashboard recomputes each row
// from the same figures so the page and board.json cannot drift apart.
//
// Board selection: every watchlist slug (the floor), plus the strongest early protocols below
// it. An early candidate must record no token and must not be a wrapped, staked or versioned
// product of something that already trades, applying the house watchlist rule's own tests as
// far as the snapshot's ten fields allow: a name ending in a version marker, a whole word
// wrapped, staked or staking, an exchange's name at the front, or a category that only ever
// names a product of a traded token (Canonical Bridge, Liquid Restaking, Restaked BTC, CEX).
// A standalone bridge or liquid-staking protocol whose name passes those tests stays in: its
// category alone is no proof it wraps a traded token. Early candidates are scored first and
// taken by implied value, never by raw TVL, so the radar ranks what its model believes.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  peer_shrink_k: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_weight: number;
  growth_scale_pct: number;
  growth_floor: number;
  growth_cap: number;
  maturity_base: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra: number;
}

export const MODEL: ModelConstants = {
  peer_shrink_k: 4,
  multiple_floor: 0.04,
  multiple_cap: 1.5,
  growth_weight: 0.22,
  growth_scale_pct: 25,
  growth_floor: -60,
  growth_cap: 150,
  maturity_base: 0.8,
  maturity_range: 0.3,
  maturity_days: 1825,
  unknown_age_days: 365,
  breadth_per_chain: 0.025,
  breadth_max_extra: 6,
};

export const MODEL_VERSION = 'radar-2';

/** How many early (below-floor) protocols the board carries, taken by implied value. */
export const EARLY_ROWS = 220;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  is_watchlist: boolean;
  signal: string;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    global_multiple: number;
    base_value_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_capital_usd: number;
  farm_gas_usd: number;
  farm_weeks: number;
  farm_steps: string[];
}

/** The dashboard's view of one row: the board row's figures plus its farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  is_watchlist: boolean;
  signal: string;
  implied_value_usd: number;
  peer_multiple: number;
  peer_count: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_capital_usd: number;
  farm_gas_usd: number;
  farm_weeks: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The peer calibration: what live tokens trade at per TVL dollar, global and per category. */
export interface PeerTable {
  global: number;
  byCategory: Map<string, { median: number; count: number }>;
}

/** Build the peer table from the snapshot's live-token protocols (market cap and TVL both recorded). */
export function peerTable(snapshot: Snapshot): PeerTable {
  const all: number[] = [];
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    // One wild print (a near-empty TVL under a real market cap) must not set a category's price:
    // each peer's multiple is winsorised to [0.02, 3] before any median is taken.
    const multiple = Math.min(3, Math.max(0.02, p.mcap_usd / p.tvl_usd));
    all.push(multiple);
    const key = p.category ?? 'Uncategorized';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [multiple]);
    else list.push(multiple);
  }
  const table: PeerTable = { global: all.length > 0 ? median(all) : MODEL.multiple_floor, byCategory: new Map() };
  for (const [key, list] of byCategory) table.byCategory.set(key, { median: median(list), count: list.length });
  return table;
}

/** One category's calibrated multiple: its peers' median shrunk toward the global median, then clamped. */
export function peerMultiple(category: string | null, peers: PeerTable, model: ModelConstants = MODEL): { multiple: number; count: number } {
  const entry = peers.byCategory.get(category ?? 'Uncategorized');
  if (entry === undefined) return { multiple: clampMultiple(peers.global, model), count: 0 };
  const shrunk = (entry.count * entry.median + model.peer_shrink_k * peers.global) / (entry.count + model.peer_shrink_k);
  return { multiple: clampMultiple(shrunk, model), count: entry.count };
}

function clampMultiple(value: number, model: ModelConstants): number {
  return Math.min(model.multiple_cap, Math.max(model.multiple_floor, value));
}

/** The full scoring of one protocol: its implied value and every factor that produced it. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  peers: PeerTable,
  model: ModelConstants = MODEL,
): { implied: number; baseValue: number; peerMultiple: number; peerCount: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const peer = peerMultiple(protocol.category, peers, model);
  // The multiple the board publishes (4 decimal places) is the one the value is computed with,
  // so the dashboard's recomputation from the published figures matches to the dollar.
  const multiple = round4(peer.multiple);
  const count = peer.count;
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + model.growth_weight * Math.sign(growthPct) * Math.sqrt(Math.abs(growthPct) / model.growth_scale_pct);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_base + model.maturity_range * Math.min(Math.log1p(Math.max(ageForModel, 0)) / Math.log1p(model.maturity_days), 1);
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_extra);
  const baseValue = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(baseValue * growthMult * maturityMult * breadthMult));
  return { implied, baseValue, peerMultiple: multiple, peerCount: count, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word that marks a wrapped or staked product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Exchange names a wrapped or house product may begin with (the watchlist rule's list). */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** Categories that only ever name a product of a token that already trades. */
const PRODUCT_CATEGORIES = new Set(['Canonical Bridge', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a pre-token protocol may join the board as an early row (the watchlist's own exclusions). */
export function isEarlyRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The one-line signal a row carries: momentum first, then distress, then age, then scale. */
export function signalFor(p: SnapshotProtocol, age: number | null, growthPct: number, isWatchlist: boolean): string {
  if (growthPct >= 10) return 'Surging';
  if (growthPct <= -15) return 'Cooling';
  if (age !== null && age >= 1095) return 'Established';
  if (isWatchlist) return 'Watchlist';
  return 'Early';
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const peers = peerTable(snapshot);
  const index = bySlug(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Early candidates are scored by the same model and taken by implied value, so the board's
  // tail is the radar's own ranking of the whole pre-token universe, not a TVL size cut.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isEarlyRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, score: impliedValue(p, snapshot.as_of, peers, model) }))
    .sort((a, b) => b.score.implied - a.score.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => ({ p, score: impliedValue(p, snapshot.as_of, peers, model), isWatch: watchlist.has(p.slug) }));
  scored.sort((a, b) => b.score.implied - a.score.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const plan = farmPlan(s.p, s.score.age);
    return {
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
      token_status: 'pre-token' as const,
      age_days: s.score.age,
      is_watchlist: s.isWatch,
      signal: signalFor(s.p, s.score.age, s.score.growthPct, s.isWatch),
      implied_value_usd: s.score.implied,
      model: {
        peer_multiple: round4(s.score.peerMultiple),
        peer_count: s.score.peerCount,
        global_multiple: round4(peers.global),
        base_value_usd: Math.round(s.score.baseValue),
        growth_pct: s.score.growthPct,
        growth_multiplier: round4(s.score.growthMult),
        maturity_multiplier: round4(s.score.maturityMult),
        breadth_multiplier: round4(s.score.breadthMult),
        age_days: s.score.age,
      },
      farm_capital_usd: plan.capital,
      farm_gas_usd: plan.gasTotal,
      farm_weeks: plan.weeks,
      farm_steps: plan.steps.map(stepText),
    };
  });
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** One transaction's gas in dollars on a chain: mainnet is dear, rollups and Solana are cheap. */
function gasFor(chain: string): number {
  if (chain === 'Ethereum') return 14;
  if (chain === 'Solana') return 0.3;
  if (['Base', 'Arbitrum', 'Optimism', 'BNB Chain', 'Polygon', 'Avalanche', 'zkSync Era', 'Linea', 'Scroll', 'Mantle'].includes(chain)) return 1.5;
  return 4;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 250_000_000) return 250;
  if (p.tvl_usd >= 50_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 75;
  return 40;
}

/** How many weekly cycles a plan runs, from the protocol's age: younger records season longer. */
function weeksFor(age: number | null): number {
  if (age === null) return 6;
  if (age < 180) return 8;
  if (age < 730) return 6;
  return 4;
}

/** The category's two core actions: what a farmer actually does in this kind of protocol. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return [
      `Supply $${capital} of USDC as collateral to ${name} on ${chain} and leave the position open.`,
      `Borrow about 30% of the supplied value in the same asset, redeposit it once, then stop: one loop, never more, so liquidation stays distant.`,
    ];
  }
  if (c.includes('dex') || c.includes('derivative') || c.includes('perpetual')) {
    return [
      `Provide $${capital} split evenly across both sides of ${name}'s busiest pool on ${chain}.`,
      `Swap about $25 in each direction through ${name} so the wallet also carries genuine trade volume, not only a deposit.`,
    ];
  }
  if (c.includes('bridge')) {
    return [
      `Bridge $${capital} of USDC from Ethereum to ${chain} through ${name}.`,
      `Bridge about $40 back a week later, so the wallet shows two-way use rather than a one-off hop.`,
    ];
  }
  if (c.includes('staking') || c.includes('restak')) {
    return [
      `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet.`,
      `Delegate or restake the receipt into ${name}'s second vault or operator set if it offers one, so both layers record the wallet.`,
    ];
  }
  if (c.includes('prediction')) {
    return [
      `Fund the wallet with $${capital} and take one position in ${name}'s most liquid market.`,
      `Take small positions in two further markets on different topics, so the record is trading, not a single bet.`,
    ];
  }
  if (c.includes('stable')) {
    return [
      `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`,
      `Place half of the minted asset into the deepest pool that pairs it, so the wallet both mints and provides.`,
    ];
  }
  if (c.includes('rwa')) {
    return [
      `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it past one distribution date.`,
      `Add a second, smaller mint of about $40 after the first distribution lands, showing the position is kept, not parked.`,
    ];
  }
  if (c.includes('insurance')) {
    return [
      `Buy $${capital} of cover from ${name} on ${chain} for the longest term it sells.`,
      `Stake about $40 into ${name}'s underwriting or risk pool if it offers one, and keep the policy and the stake in one wallet.`,
    ];
  }
  // Vaults, curators, allocators, yield and everything else share the deposit shape.
  return [
    `Deposit $${capital} into ${name}'s main vault on ${chain} and keep the vault shares in the same wallet.`,
    `Make a second deposit of about $40 a week later, or split the first across a second ${name} vault, so the record shows a returning user.`,
  ];
}

/** A protocol's farm plan: seven steps with a capital figure, a gas total and a number of weeks. */
export function farmPlan(p: SnapshotProtocol, age: number | null): { steps: FarmStep[]; capital: number; gasTotal: number; weeks: number } {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const gasLabel = gas < 1 ? `$${gas.toFixed(2)}` : `$${gas}`;
  const capital = capitalFor(p);
  const weeks = weeksFor(age);
  const holdDays = weeks * 7 + 14;
  const [first, second] = actionsFor(p, capital, chain);
  const gasTotal = Math.round(gas * (weeks + 4) * 10) / 10;
  const steps: FarmStep[] = [
    {
      text: `Set up one fresh wallet for ${p.name} alone, fund it from an exchange in a single transfer, and keep its seed phrase offline.`,
      cost: `the wallet is free; about ${gasLabel} of gas for its first transaction on ${chain}`,
      time: '10 minutes, once',
    },
    { text: first, cost: `$${capital} of capital plus about ${gasLabel} of gas`, time: '20 minutes, once' },
    { text: second, cost: `about ${gasLabel} of gas; it reuses the step 2 position where it can`, time: '15 minutes, once' },
    {
      text: `Repeat one qualifying action every week for ${weeks} weeks: a small deposit, a swap, a vote or a claim inside ${p.name}, always from the same wallet.`,
      cost: `about ${gasLabel} of gas a week, about $${Math.round(gas * weeks * 10) / 10} across the season`,
      time: `10 minutes a week for ${weeks} weeks`,
    },
    {
      text: `Every Sunday, open ${p.name}'s official points or rewards page, note the balance it shows in a farm log, and take part in one governance vote or forum poll if one is open.`,
      cost: 'nothing to check; never pay anyone to claim, boost or verify points',
      time: '5 minutes a week',
    },
    {
      text: `Hold the position for at least ${holdDays} days, checking once a week that the health factor, pool share or vault share has not drifted by more than a fifth.`,
      cost: `the $${capital} stays in the position for the whole hold`,
      time: `${holdDays} days, with a 5-minute weekly check`,
    },
    {
      text: `Finish by withdrawing in one go during a low-fee window, then claim any allocation only from the link on ${p.name}'s official page and keep the farm log with the transaction hashes.`,
      cost: `about ${gasLabel} of gas to exit; a genuine claim never carries a fee`,
      time: '20 minutes, once',
    },
  ];
  return { steps, capital, gasTotal, weeks };
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
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
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's form for data.js: every figure the page shows, farm plan included. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    is_watchlist: row.is_watchlist,
    signal: row.signal,
    implied_value_usd: row.implied_value_usd,
    peer_multiple: row.model.peer_multiple,
    peer_count: row.model.peer_count,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_capital_usd: row.farm_capital_usd,
    farm_gas_usd: row.farm_gas_usd,
    farm_weeks: row.farm_weeks,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const peers = peerTable(snapshot);
  const early = board.filter((r) => !r.is_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: round4(peers.global),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
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

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows: the gate takes at least 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${r.slug} has a farm step of ${trimmed.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
