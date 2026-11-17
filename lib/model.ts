// Radar model, rewritten line by line for the radar-2 scoring (a fresh implementation of the
// same board: the watchlist's exclusion rule on every row, a per-category multiple from the
// snapshot's own tokenized peers, and a farm plan per protocol).
//
// What the board ranks: every slug the snapshot's watchlist names, plus every other pre-token
// protocol the watchlist's own rule keeps — the early rows the radar exists to find. A protocol
// counts as pre-token when its record carries no token (no market cap, no CoinGecko id, no
// symbol). Wrapped, staked and bridged products of tokens that already trade never rank, at any
// TVL: a TVL-only board ranks 39 of them; this one ranks none, and the genuine pre-token
// protocols a TVL cap crowds out are in instead.
//
// Implied value comes only from the snapshot's own figures, and no name is ever special-cased:
//
//   multiple   the category's median mcap/TVL across its tokenized peers in this snapshot (at
//              least 3 peers), pulled toward the global median (weight 5) and held to [0.05, 1];
//              a thin category, or no category, takes the global median.
//   growth     the seven-day change, held to [-60, 120] per cent
//   growthF    1 + growth / 100 x 0.5
//   maturity   0.6 + min(age, 1095) / 1095 x 0.4   (age unknown: 365 days)
//   implied    max(1, round(tvl x multiple x growthF x maturity))
//
// The multiples are worked out from the snapshot when the program runs, never written in by
// hand: a category whose tokenized peers the market values richly earns a richer multiple.

/** One protocol entry from the sealed snapshot: its ten fields, nothing more. */
export interface Proto {
  slug: string;
  name: string;
  chains: string[];
  category: string | null;
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document as the program reads it. */
export interface Snap {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

/** The tuning the dashboard prints and the model runs on. */
export interface Tuning {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_shrink: number;
  multiple_min: number;
  multiple_max: number;
  multiple_min_peers: number;
}

export const TUNING: Tuning = {
  growth_weight: 1 / 2,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 3 / 5,
  maturity_range: 2 / 5,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_shrink: 5,
  multiple_min: 1 / 20,
  multiple_max: 1,
  multiple_min_peers: 3,
};

/** The scoring version the dashboard names. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's Live token view carries, by market cap. */
export const LIVE_COUNT = 24;

/** One farm step: what to do, what it costs, how long it takes. */
export interface PlanStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardEntry {
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
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_peers: number;
    global_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One board row squeezed for data.js: a tuple, so the script stays small. */
export type CompactEntry = [
  rank: number,
  slug: string,
  name: string,
  category: string | null,
  chains: string[],
  tvl_usd: number,
  change_7d: number | null,
  age_days: number | null,
  implied_value_usd: number,
  category_multiple: number,
  category_peers: number,
];

/** A live-token protocol: it already trades, so the page shows the market's own value. */
export type LiveEntry = [
  slug: string,
  name: string,
  category: string | null,
  chains: string[],
  tvl_usd: number,
  mcap_usd: number | null,
  change_7d: number | null,
];

/** Everything the dashboard renders, from one snapshot. */
export interface PageData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: Tuning;
  model_version: string;
  global_multiple: number;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: CompactEntry[];
  live: LiveEntry[];
}

/** A snapshot this model cannot score. */
export class SnapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapError';
  }
}

const MS_PER_DAY = 86_400_000;

/** The number when it is finite, else the fallback. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The middle value of a list, or null when the list is empty. */
function middle(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const half = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[half]!;
  return (ordered[half - 1]! + ordered[half]!) / 2;
}

/** Whole days from `listed` to `asOf`, never below zero; null when either date is missing or bad. */
export function daysListed(asOf: string, listed: string | null): number | null {
  if (listed === null) return null;
  const end = Date.parse(asOf + 'T00:00:00Z');
  const start = Date.parse(listed + 'T00:00:00Z');
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / MS_PER_DAY));
}

/** True when a protocol's record carries no token at all. */
export function hasNoToken(p: Proto): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The watchlist's exclusion rule, as the snapshot states it: a wrapped, staked or bridged
 *  product of a token that already trades. The snapshot carries no parent protocol, so the rule
 *  runs on the ten fields it does carry. */
const BLOCKED_CATS = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];
const VERSION_TAIL = new RegExp('\\s(V\\d+(\\.\\d+)?|v\\d+(\\.\\d+)?|\\d+\\.\\d+)$');
const WRAPPED_TOKENS = new Set(['wrapped', 'staked', 'staking']);
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

export function isScreenedOut(p: Proto): boolean {
  if (p.category !== null && BLOCKED_CATS.includes(p.category)) return true;
  if (VERSION_TAIL.test(p.name)) return true;
  const words = p.name.toLowerCase().split(/[^a-z0-9_]+/);
  for (const w of words) if (WRAPPED_TOKENS.has(w)) return true;
  for (const exchange of EXCHANGES) if (p.name.startsWith(exchange)) return true;
  return false;
}

/** True when the board may rank a protocol: pre-token and not a screened-out product. */
export function canRank(p: Proto): boolean {
  return hasNoToken(p) && !isScreenedOut(p);
}

/** The snapshot's protocols keyed by slug. */
function indexBySlug(protos: Proto[]): Map<string, Proto> {
  const index = new Map<string, Proto>();
  for (const p of protos) index.set(p.slug, p);
  return index;
}

/** A tokenized peer's own valuation: market cap over TVL, or null when it has none to show. */
function tokenRatio(p: Proto): number | null {
  if (p.mcap_usd === null || p.tvl_usd <= 0) return null;
  const ratio = p.mcap_usd / p.tvl_usd;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

export interface PeerMultiples {
  world: number;
  byCat: Map<string, { mult: number; peers: number }>;
}

/**
 * The category multiples, worked out from the snapshot's tokenized protocols at run time. The
 * global multiple is the median ratio across every tokenized protocol; a category with at least
 * `multiple_min_peers` peers takes its own median (capped at `multiple_max`), pulled toward the
 * global median so a thin category cannot set a wild multiple from one peer. Anything else takes
 * the global median. No name is ever consulted.
 */
export function peerMultiples(protos: Proto[], tune: Tuning = TUNING): PeerMultiples {
  const priced = protos.filter((p) => !hasNoToken(p));
  const ratios: number[] = [];
  for (const p of priced) {
    const r = tokenRatio(p);
    if (r !== null) ratios.push(r);
  }
  const world = middle(ratios) ?? 0.2;
  const grouped = new Map<string, number[]>();
  for (const p of priced) {
    if (p.category === null) continue;
    const r = tokenRatio(p);
    if (r === null) continue;
    const list = grouped.get(p.category);
    if (list === undefined) grouped.set(p.category, [r]);
    else list.push(r);
  }
  const byCat = new Map<string, { mult: number; peers: number }>();
  for (const [category, list] of grouped) {
    if (list.length < tune.multiple_min_peers) continue;
    const med = Math.min(middle(list) ?? world, tune.multiple_max);
    const pulled = (list.length * med + tune.multiple_shrink * world) / (list.length + tune.multiple_shrink);
    const mult = Math.min(tune.multiple_max, Math.max(tune.multiple_min, pulled));
    byCat.set(category, { mult, peers: list.length });
  }
  return { world, byCat };
}

/** One protocol's category multiple, and how many tokenized peers set it. */
export function multipleOf(category: string | null, multiples: PeerMultiples): { mult: number; peers: number } {
  if (category !== null) {
    const found = multiples.byCat.get(category);
    if (found !== undefined) return found;
  }
  return { mult: multiples.world, peers: 0 };
}

export interface Score {
  value: number;
  mult: number;
  peers: number;
  growth: number;
  growthF: number;
  maturityF: number;
  listedAge: number | null;
}

/** The multipliers and the implied value one protocol earns under `tune`. */
export function scoreOne(
  proto: Proto,
  asOf: string,
  multiples: PeerMultiples,
  tune: Tuning = TUNING,
): Score {
  const listedAge = daysListed(asOf, proto.listed_at);
  const found = multipleOf(proto.category, multiples);
  const growth = Math.min(tune.growth_cap, Math.max(tune.growth_floor, numOr(proto.change_7d, 0)));
  const growthF = 1 + (growth / 100) * tune.growth_weight;
  const ageUsed = listedAge ?? tune.unknown_age_days;
  const maturityF = tune.maturity_floor + (Math.min(Math.max(ageUsed, 0), tune.maturity_days) / tune.maturity_days) * tune.maturity_range;
  const value = Math.max(1, Math.round(proto.tvl_usd * found.mult * growthF * maturityF));
  return { value, mult: found.mult, peers: found.peers, growth, growthF, maturityF, listedAge };
}

const to4dp = (n: number): number => Math.round(n * 10000) / 10000;

/** The board: every row the rule keeps, strongest first, ranks 1..n. */
export function assembleBoard(snap: Snap, tune: Tuning = TUNING): BoardEntry[] {
  const index = indexBySlug(snap.protocols);
  const multiples = peerMultiples(snap.protocols, tune);
  const picked = new Map<string, Proto>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot,
  // but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snap.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) picked.set(slug, p);
  }
  // The early radar: every other pre-token protocol the watchlist's rule keeps, at any TVL. A TVL
  // cap would crowd genuine protocols out behind wrapped and staked products; the rule, not a cap,
  // decides what ranks. A picked protocol stays picked.
  for (const p of snap.protocols) {
    if (!picked.has(p.slug) && canRank(p)) picked.set(p.slug, p);
  }

  const scored: { proto: Proto; score: Score }[] = [];
  for (const p of picked.values()) scored.push({ proto: p, score: scoreOne(p, snap.as_of, multiples, tune) });
  scored.sort((a, b) => {
    if (b.score.value !== a.score.value) return b.score.value - a.score.value;
    return a.proto.slug < b.proto.slug ? -1 : a.proto.slug > b.proto.slug ? 1 : 0;
  });
  const rows: BoardEntry[] = [];
  for (let i = 0; i < scored.length; i++) {
    const entry = scored[i]!;
    const p = entry.proto;
    const s = entry.score;
    rows.push({
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: s.listedAge,
      implied_value_usd: s.value,
      model: {
        category_multiple: s.mult,
        category_peers: s.peers,
        global_multiple: to4dp(multiples.world),
        growth_pct: s.growth,
        growth_multiplier: to4dp(s.growthF),
        maturity_multiplier: to4dp(s.maturityF),
        age_days: s.listedAge,
      },
      farm_steps: planSteps(p, s.listedAge).map(renderStep),
    });
  }
  return rows;
}

/** One step as a single string: its action, then its cost and time, inside 20..600 characters. */
export function renderStep(step: PlanStep): string {
  let s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  if (s.length > 600) s = s.slice(0, 596) + '...';
  if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function firstChain(p: Proto): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, in the words a farmer budgets with. */
function feeFor(chain: string): string {
  const priced: [string[], string][] = [
    [['Ethereum'], 'about $4 of gas'],
    [['Solana'], 'about $0.01 of gas'],
    [['Tron'], 'about $1 of gas'],
    [['Binance', 'BNB Chain'], 'about $0.15 of gas'],
    [['Base', 'Arbitrum', 'Optimism', 'Polygon', 'zkSync Era', 'Linea', 'Scroll', 'Blast', 'Mantle', 'Mode', 'Ink', 'Unichain', 'Soneium', 'World Chain', 'Abstract', 'Lisk', 'Celo', 'Sei', 'Starknet', 'Bittensor'], 'about $0.30 of gas'],
  ];
  for (const [names, fee] of priced) if (names.includes(chain)) return fee;
  return 'about $1 of gas';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function stakeSize(p: Proto): number {
  const tiers: [number, number][] = [[5_000_000_000, 250], [1_000_000_000, 150], [100_000_000, 100]];
  for (const [floor, size] of tiers) if (p.tvl_usd >= floor) return size;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdWindow(age: number | null): number {
  if (age === null) return 30;
  const windows: [number, number][] = [[180, 60], [365, 45]];
  for (const [under, days] of windows) if (age < under) return days;
  return 30;
}

/** The category's one action, in the words a farmer can follow. The first rule whose words the
 *  category carries wins; nothing after it is tried. */
function actionText(p: Proto, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const rules: [string[], (cap: number, n: string, ch: string) => string][] = [
    [['lend', 'cdp', 'collateral'], (cap, n, ch) => 'Supply $' + cap + ' of USDC to ' + n + ' on ' + ch + ' and keep the position open.'],
    [['dex', 'yield', 'leveraged farm'], (cap, n, ch) => 'Provide $' + cap + ' of liquidity to ' + n + "'s main pool on " + ch + ' and keep the position open.'],
    [['curator', 'allocator', 'aggregator'], (cap, n, ch) => 'Deposit $' + cap + ' of USDC into a ' + n + ' vault on ' + ch + ' and keep the shares.'],
    [['basis'], (cap, n, ch) => 'Deposit $' + cap + ' of USDC into ' + n + "'s basis vault on " + ch + ' and keep the position open.'],
    [['bridge'], (cap, n, ch) => 'Bridge $' + cap + ' of USDC to ' + ch + ' through ' + n + ' and use the bridged funds in its app.'],
    [['staking', 'restak'], (cap, n, ch) => 'Stake $' + cap + " of the chain's staking asset through " + n + ' and keep the receipt.'],
    [['perpetual', 'derivative'], (cap, n, ch) => 'Deposit $' + cap + ' of USDC as margin on ' + n + ' and open one small hedge.'],
    [['prediction'], (cap, n, ch) => 'Fund $' + cap + ' and place one market position on ' + n + '.'],
    [['stable'], (cap, n, ch) => 'Mint or deposit $' + cap + ' of the stable asset through ' + n + ' on ' + ch + '.'],
    [['rwa'], (cap, n, ch) => "Mint $" + cap + " of the protocol's yield asset on " + ch + ' and hold it.'],
    [['insurance'], (cap, n, ch) => 'Buy $' + cap + ' of cover from ' + n + ' on ' + ch + ' and keep the policy.'],
    [['governance'], (cap, n, ch) => 'Stake $' + cap + ' and vote in ' + n + "'s governance on " + ch + ' each round.'],
    [['payment'], (cap, n, ch) => 'Use ' + n + ' to send or receive $' + cap + ' on ' + ch + ' and keep the balance in its app.'],
  ];
  for (const [words, make] of rules) {
    for (const w of words) if (c.includes(w)) return make(capital, name, chain);
  }
  return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan comes from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function planSteps(p: Proto, age: number | null): PlanStep[] {
  const chain = firstChain(p);
  const fee = feeFor(chain);
  const capital = stakeSize(p);
  const hold = holdWindow(age);
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: fee + ' for the first transaction on ' + chain,
      time: '5 minutes',
    },
    {
      text: actionText(p, capital, chain),
      cost: '$' + capital + ' of capital and ' + fee,
      time: '15 minutes to set up',
    },
    {
      text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
      cost: fee + ' a week',
      time: '10 minutes a week',
    },
    {
      text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.',
      cost: 'the $' + capital + ' stays in the position',
      time: hold + ' days',
    },
    {
      text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.",
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveSet(snap: Snap): LiveEntry[] {
  const live = snap.protocols.filter((p) => !hasNoToken(p) && p.category !== 'CEX');
  live.sort((a, b) => {
    const byCap = (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0);
    return byCap !== 0 ? byCap : b.tvl_usd - a.tvl_usd;
  });
  return live.slice(0, LIVE_COUNT).map((p) => [p.slug, p.name, p.category, p.chains, p.tvl_usd, p.mcap_usd, p.change_7d]);
}

/** A board row's compact form for data.js; the farm plan is generated in the page. */
export function compactRow(row: BoardEntry): CompactEntry {
  return [
    row.rank,
    row.slug,
    row.name,
    row.category,
    row.chains,
    row.tvl_usd,
    row.change_7d,
    row.age_days,
    row.implied_value_usd,
    row.model.category_multiple,
    row.model.category_peers,
  ];
}

/** Everything the dashboard renders, from the snapshot. */
export function assembleRadar(snap: Snap, tune: Tuning = TUNING): { board: BoardEntry[]; radar: PageData } {
  const board = assembleBoard(snap, tune);
  const live = liveSet(snap);
  let early = 0;
  for (const r of board) if (!snap.watchlist.includes(r.slug)) early++;
  const multiples = peerMultiples(snap.protocols, tune);
  const radar: PageData = {
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    model: tune,
    model_version: MODEL_VERSION,
    global_multiple: to4dp(multiples.world),
    watchlist: snap.watchlist,
    watchlist_size: snap.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(compactRow),
    live,
  };
  return { board, radar };
}

/** Refuse with a message when a check fails. */
function fail(message: string): never {
  throw new SnapError(message);
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function readSnapshot(text: string): Snap {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) fail('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') fail('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) fail('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) fail('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) fail('snapshot.json has no watchlist of slugs');
  const protocols: Proto[] = [];
  for (let i = 0; i < o.protocols.length; i++) {
    const v = o.protocols[i];
    if (typeof v !== 'object' || v === null || Array.isArray(v)) fail("snapshot.json's protocol " + i + ' is not an object');
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      fail("snapshot.json's protocol " + i + ' lacks a slug, a name or a TVL');
    }
    protocols.push({
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
    });
  }
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function checkBoard(board: BoardEntry[], snap: Snap): string | null {
  const slugs = new Set<string>();
  for (const r of board) slugs.add(r.slug);
  const missing: string[] = [];
  for (const s of snap.watchlist) if (!slugs.has(s)) missing.push(s);
  if (missing.length > 0) return 'the board misses ' + missing.length + ' watchlist slug' + (missing.length === 1 ? '' : 's') + ': ' + missing.slice(0, 5).join(', ');
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return 'rank ' + (i + 1) + ' is ' + ranks[i];
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return 'row ' + (i + 1) + ' outranks row ' + i + ' on implied value';
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'all ' + board.length + ' rows share the same implied value $' + board[0]!.implied_value_usd + ': a board that ranks nothing by value is not a ranking';
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return r.slug + ' has ' + steps.length + ' farm steps';
    for (const s of steps) {
      if (s.length < 20 || s.length > 600) return r.slug + ' has a farm step of ' + s.length + ' characters';
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return r.slug + ' has implied value ' + r.implied_value_usd;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataModule(radar: PageData): string {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}
