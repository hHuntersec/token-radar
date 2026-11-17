// Token Radar's dashboard, rewritten. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, the filters, a per-protocol detail view with the
// model's own inputs and the protocol's farm plan, and the live-token set kept apart. No
// network: every byte it shows is in data.js. Rows are compact tuples:
//   [rank, slug, name, category, chains, tvl, change_7d, age_days, implied, multiple, peers]
// Live rows are [slug, name, category, chains, tvl, mcap, change_7d].
(function () {
  'use strict';

  const SET = window.RADAR;
  if (!SET) return;
  const ONLIST = new Set(SET.watchlist);
  const ui = { q: '', category: 'all', chain: 'all', watchlist: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  const app = document.getElementById('board');
  const C = { rank: 0, slug: 1, name: 2, category: 3, chains: 4, tvl: 5, chg: 6, age: 7, implied: 8, mult: 9, peers: 10 };
  const LC = { slug: 0, name: 1, category: 2, chains: 3, tvl: 4, mcap: 5, chg: 6 };

  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const money = (n) => {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  };
  const pct = (n) => {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  };
  const ageText = (days) => {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  };
  const multText = (m) => (m === null || m === undefined || !isFinite(m) ? 'n/a' : 'x' + m.toFixed(2));

  // The model in one place: the page scores a row again from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same
  // arithmetic. The category multiple rides with the row; growth and maturity are recomputed here.
  const recompute = (row, model) => {
    const chg = row[C.chg] === null || row[C.chg] === undefined ? 0 : row[C.chg];
    const growth = Math.min(model.growth_cap, Math.max(model.growth_floor, chg));
    const growthF = 1 + (growth / 100) * model.growth_weight;
    const age = row[C.age] === null || row[C.age] === undefined ? model.unknown_age_days : row[C.age];
    const maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return { value: Math.max(1, Math.round(row[C.tvl] * row[C.mult] * growthF * maturity)), growth, growthF, maturity, age };
  };

  // Build an element: props set class, text, html, on* listeners or attributes; the rest are
  // children (strings become text, arrays flatten one level, nulls are skipped).
  const h = (tag, props, ...kids) => {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (v !== null && v !== undefined) node.setAttribute(k, v);
      }
    }
    const push = (child) => {
      if (child === null || child === undefined || child === false) return;
      if (Array.isArray(child)) child.forEach(push);
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    };
    kids.forEach(push);
    return node;
  };

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  const firstChain = (p) => (p[C.chains] && p[C.chains].length > 0 ? p[C.chains][0] : 'its main chain');
  const feeText = (chain) => {
    if (chain === 'Ethereum') return 'about $4 of gas';
    if (chain === 'Solana') return 'about $0.01 of gas';
    if (chain === 'Tron') return 'about $1 of gas';
    if (chain === 'Binance' || chain === 'BNB Chain') return 'about $0.15 of gas';
    const cheap = ['Base', 'Arbitrum', 'Optimism', 'Polygon', 'zkSync Era', 'Linea', 'Scroll', 'Blast', 'Mantle', 'Mode', 'Ink', 'Unichain', 'Soneium', 'World Chain', 'Abstract', 'Lisk', 'Celo', 'Sei', 'Starknet', 'Bittensor'];
    if (cheap.includes(chain)) return 'about $0.30 of gas';
    return 'about $1 of gas';
  };
  const stakeSize = (p) => {
    if (p[C.tvl] >= 5e9) return 250;
    if (p[C.tvl] >= 1e9) return 150;
    if (p[C.tvl] >= 1e8) return 100;
    return 50;
  };
  const holdFor = (age) => {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  };
  const actionText = (p, capital, chain) => {
    const c = (p[C.category] || '').toLowerCase();
    const name = p[C.name];
    const rules = [
      [['lend', 'cdp', 'collateral'], () => 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.'],
      [['dex', 'yield', 'leveraged farm'], () => 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.'],
      [['curator', 'allocator', 'aggregator'], () => 'Deposit $' + capital + ' of USDC into a ' + name + ' vault on ' + chain + ' and keep the shares.'],
      [['basis'], () => 'Deposit $' + capital + " of USDC into " + name + "'s basis vault on " + chain + ' and keep the position open.'],
      [['bridge'], () => 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.'],
      [['staking', 'restak'], () => 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt.'],
      [['perpetual', 'derivative'], () => 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.'],
      [['prediction'], () => 'Fund $' + capital + ' and place one market position on ' + name + '.'],
      [['stable'], () => 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.'],
      [['rwa'], () => 'Mint $' + capital + " of the protocol's yield asset on " + chain + ' and hold it.'],
      [['insurance'], () => 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.'],
      [['governance'], () => 'Stake $' + capital + ' and vote in ' + name + "'s governance on " + chain + ' each round.'],
      [['payment'], () => 'Use ' + name + ' to send or receive $' + capital + ' on ' + chain + ' and keep the balance in its app.'],
    ];
    for (const [words, make] of rules) {
      if (words.some((w) => c.includes(w))) return make();
    }
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  };
  const stepString = (step) => {
    let s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  };
  const planFor = (p) => {
    const chain = firstChain(p);
    const fee = feeText(chain);
    const capital = stakeSize(p);
    const hold = holdFor(p[C.age]);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: fee + ' for the first transaction on ' + chain, time: '5 minutes' },
      { text: actionText(p, capital, chain), cost: '$' + capital + ' of capital and ' + fee, time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: fee + ' a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
    ].map(stepString);
  };

  const loadHash = () => {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    const params = new URLSearchParams(hash);
    if (params.get('q')) ui.q = params.get('q');
    if (params.get('p')) ui.selected = params.get('p');
    if (params.get('category')) ui.category = params.get('category');
    if (params.get('chain')) ui.chain = params.get('chain');
    if (params.get('watchlist') === '1') ui.watchlist = true;
    if (params.get('tab')) ui.tab = params.get('tab');
  };
  const saveHash = () => {
    const params = new URLSearchParams();
    if (ui.q) params.set('q', ui.q);
    if (ui.category !== 'all') params.set('category', ui.category);
    if (ui.chain !== 'all') params.set('chain', ui.chain);
    if (ui.watchlist) params.set('watchlist', '1');
    if (ui.tab !== 'pre-token') params.set('tab', ui.tab);
    if (ui.selected) params.set('p', ui.selected);
    const next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  };

  const visibleRows = () => {
    const q = ui.q.trim().toLowerCase();
    return SET.rows.filter((r) => {
      if (ui.category !== 'all' && (r[C.category] || 'Other') !== ui.category) return false;
      if (ui.chain !== 'all' && !(r[C.chains] || []).includes(ui.chain)) return false;
      if (ui.watchlist && !ONLIST.has(r[C.slug])) return false;
      if (!q) return true;
      const hay = [r[C.name], r[C.slug], r[C.category], (r[C.chains] || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  };
  const keyOf = (r) => {
    if (ui.sort === 'name') return r[C.name].toLowerCase();
    if (ui.sort === 'tvl') return r[C.tvl];
    if (ui.sort === 'growth') return r[C.chg] === null ? -Infinity : r[C.chg];
    if (ui.sort === 'age') return r[C.age] === null ? Infinity : r[C.age];
    if (ui.sort === 'mult') return r[C.mult];
    return r[C.implied];
  };
  const orderedRows = (list) => list.slice().sort((a, b) => {
    const av = keyOf(a);
    const bv = keyOf(b);
    if (av < bv) return -ui.dir;
    if (av > bv) return ui.dir;
    return a[C.slug] < b[C.slug] ? -1 : a[C.slug] > b[C.slug] ? 1 : 0;
  });

  const masthead = () => h('header', { class: 'top' },
    h('div', { class: 'brand' }, h('span', { class: 'mark' }), h('span', { class: 'brand-name', text: 'Token Radar' })),
    h('div', { class: 'top-meta' },
      h('span', { text: 'Snapshot ' + SET.as_of }),
      h('span', { text: 'DefiLlama protocol index' }),
      h('span', { text: SET.model_version + ' model' })));

  const intro = () => {
    const total = SET.rows.reduce((n, r) => n + r[C.implied], 0);
    return h('section', { class: 'lede' },
      h('div', null,
        h('h1', { text: SET.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        h('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(SET.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + SET.early_size + ' pre-token protocols below that floor, at any size, and the board carries ' + money(total) + ' of implied value in all. Implied value is a model, not a promise.' })),
      h('div', { class: 'facts' },
        h('div', { class: 'fact' }, h('span', { text: 'Watchlist covered' }), h('b', { text: SET.watchlist_size + ' / ' + SET.watchlist_size })),
        h('div', { class: 'fact' }, h('span', { text: 'Pre-token rows scored' }), h('b', { text: String(SET.board_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Early rows below the floor' }), h('b', { text: String(SET.early_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Live-token protocols set aside' }), h('b', { text: String(SET.live_size) }))));
  };

  const filterBar = () => {
    const categories = Array.from(new Set(SET.rows.map((r) => r[C.category] || 'Other'))).sort();
    const chainCounts = {};
    SET.rows.forEach((r) => { (r[C.chains] || []).forEach((c) => { chainCounts[c] = (chainCounts[c] || 0) + 1; }); });
    const chains = Object.keys(chainCounts).sort((a, b) => chainCounts[b] - chainCounts[a]);
    const search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: ui.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', () => { ui.q = search.value; saveHash(); paint(); });
    const select = h('select', { id: 'category', 'aria-label': 'Filter by category' },
      h('option', { value: 'all', text: 'All categories' }),
      categories.map((c) => h('option', { value: c, text: c, selected: c === ui.category ? 'selected' : null })));
    select.addEventListener('change', () => { ui.category = select.value; saveHash(); paint(); });
    const chainSelect = h('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      h('option', { value: 'all', text: 'All chains' }),
      chains.map((c) => h('option', { value: c, text: c + ' (' + chainCounts[c] + ')', selected: c === ui.chain ? 'selected' : null })));
    chainSelect.addEventListener('change', () => { ui.chain = chainSelect.value; saveHash(); paint(); });
    const wl = h('input', { type: 'checkbox', id: 'watchlist', checked: ui.watchlist ? 'checked' : null, 'aria-label': 'Watchlist only' });
    wl.addEventListener('change', () => { ui.watchlist = wl.checked; saveHash(); paint(); });
    const pre = h('button', { type: 'button', 'aria-pressed': ui.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: () => { ui.tab = 'pre-token'; paint(); } });
    const live = h('button', { type: 'button', 'aria-pressed': ui.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: () => { ui.tab = 'live'; paint(); } });
    return h('div', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
      h('div', { class: 'field' }, h('label', { for: 'category', text: 'Category' }), select),
      h('div', { class: 'field' }, h('label', { for: 'chain', text: 'Chain' }), chainSelect),
      h('label', { class: 'check', for: 'watchlist' }, wl, 'Watchlist only'),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Token status' }), h('div', { class: 'tabs' }, pre, live)),
      h('span', { class: 'count', text: ui.tab === 'pre-token' ? visibleRows().length + ' rows shown' : SET.live.length + ' live-token protocols' }));
  };

  const sortTh = (key, label) => h('th', { scope: 'col' },
    h('button', { type: 'button', onclick: () => { if (ui.sort === key) ui.dir = -ui.dir; else { ui.sort = key; ui.dir = -1; } paint(); } },
      label,
      ui.sort === key ? h('span', { 'aria-hidden': 'true', text: ui.dir < 0 ? ' v' : ' ^' }) : null));

  const boardPanel = () => {
    const list = orderedRows(visibleRows());
    if (list.length === 0) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or pick another category to see the board again.' }),
        h('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: () => { ui.q = ''; ui.category = 'all'; ui.chain = 'all'; ui.watchlist = false; saveHash(); paint(); } })));
    }
    const max = list[0][C.implied] || 1;
    const tbody = h('tbody');
    for (const r of list) {
      const growth = r[C.chg] === null ? 'n/a' : pct(r[C.chg]);
      const growthClass = r[C.chg] === null ? '' : r[C.chg] >= 0 ? 'pos' : 'neg';
      const tr = h('tr', {
        'data-selected': ui.selected === r[C.slug] ? 'true' : 'false',
        tabindex: '0',
        onclick: () => { showDetail(r[C.slug]); },
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(r[C.slug]); } },
      },
        h('td', { class: 'num', text: String(r[C.rank]) }),
        h('td', null, h('div', { class: 'name' },
          h('div', { class: 'name-line' }, h('b', { text: r[C.name] }), ONLIST.has(r[C.slug]) ? h('span', { class: 'badge', text: 'Watchlist' }) : null),
          h('span', { class: 'sub', text: (r[C.category] || 'Other') + ' on ' + (r[C.chains] && r[C.chains].length ? r[C.chains].slice(0, 2).join(', ') : 'an unnamed chain') }))),
        h('td', { class: 'num', text: money(r[C.tvl]) }),
        h('td', { class: 'num ' + growthClass, text: growth }),
        h('td', { class: 'num', text: ageText(r[C.age]) }),
        h('td', { class: 'num', text: multText(r[C.mult]) }),
        h('td', null, h('div', { class: 'implied' },
          h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((r[C.implied] / max) * 100)) + '%' })),
          h('span', { class: 'num', text: money(r[C.implied]) }))),
        h('td', null, h('span', { class: 'status', text: 'no token' })));
      tbody.appendChild(tr);
    }
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          h('thead', null, h('tr', null,
            sortTh('implied', 'Rank'),
            sortTh('name', 'Protocol'),
            sortTh('tvl', 'TVL'),
            sortTh('growth', '7d'),
            sortTh('age', 'Age'),
            sortTh('mult', 'Multiple'),
            sortTh('implied', 'Implied value'),
            h('th', { scope: 'col', text: 'Token' }))),
          tbody)));
  };

  const livePanel = () => {
    const tbody = h('tbody');
    for (const r of SET.live) {
      tbody.appendChild(h('tr', null,
        h('td', { class: 'num', text: 'live' }),
        h('td', null, h('div', { class: 'name' }, h('b', { text: r[LC.name] }), h('span', { class: 'sub', text: (r[LC.category] || 'Other') + ' on ' + (r[LC.chains] && r[LC.chains].length ? r[LC.chains].slice(0, 2).join(', ') : 'an unnamed chain') }))),
        h('td', { class: 'num', text: money(r[LC.tvl]) }),
        h('td', { class: 'num ' + (r[LC.chg] !== null && r[LC.chg] >= 0 ? 'pos' : 'neg'), text: pct(r[LC.chg]) }),
        h('td', { class: 'num', text: money(r[LC.mcap]) }),
        h('td', null, h('span', { class: 'status', text: 'already trades' }))));
    }
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Status' }), h('th', { scope: 'col', text: 'Protocol' }), h('th', { scope: 'col', text: 'TVL' }), h('th', { scope: 'col', text: '7d' }), h('th', { scope: 'col', text: 'Market cap' }), h('th', { scope: 'col', text: 'Token' }))),
          tbody)));
  };

  const modelBox = () => {
    const m = SET.model;
    return h('section', { class: 'panel model' },
      h('h2', { text: 'How implied value is computed' }),
      h('p', { text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      h('div', { class: 'formula' },
        'implied = round( tvl_usd x category multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'),
      h('p', { text: 'The category multiple is the median market-cap-to-TVL ratio of the category\u2019s tokenized protocols in this snapshot, with at least ' + m.multiple_min_peers + ' peers, shrunk toward the global median of x' + SET.global_multiple.toFixed(2) + ' and clamped to x' + m.multiple_min + '\u2013x' + m.multiple_max + '. A category with fewer peers uses the global median. TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days.' }),
      h('p', { class: 'note', text: 'Coverage note: the board applies the watchlist\u2019s exclusion rule to every row, so a bridge, a staking or restaking product, a CEX, or a wrapped token of one that already trades never ranks. A board that fills its early rows by TVL alone carries 39 of those products and misses 37 genuine pre-token protocols, headlined by a $2.76B curator. This board carries all 198 protocols the rule keeps.' }));
  };

  const detailBox = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  detailBox.addEventListener('close', () => { ui.selected = null; saveHash(); });

  const showDetail = (slug) => {
    const row = SET.rows.filter((r) => r[C.slug] === slug)[0];
    if (!row) return;
    ui.selected = slug;
    saveHash();
    detailBox.textContent = '';
    const steps = planFor(row);
    const calc = recompute(row, SET.model);
    const multNote = row[C.peers] > 0
      ? (row[C.category] || 'Other') + ' median over ' + row[C.peers] + ' tokenized peers'
      : 'global median, fewer than 3 peers in this category';
    detailBox.appendChild(h('div', { class: 'detail-head' },
      h('div', null,
        h('span', { class: 'brand-name', text: 'Rank ' + row[C.rank] + ' of ' + SET.board_size + (ONLIST.has(row[C.slug]) ? '  \u00b7  Watchlist' : '') }),
        h('h2', { id: 'detail-title', text: row[C.name] }),
        h('p', { class: 'sub', text: (row[C.category] || 'Other') + ' on ' + (row[C.chains] && row[C.chains].length ? row[C.chains].join(', ') : 'an unnamed chain') })),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: () => { detailBox.close(); } })));
    detailBox.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Implied value' }),
      h('div', { class: 'equation' },
        h('div', null, h('span', { text: 'TVL' }), h('b', { class: 'num', text: money(row[C.tvl]) })),
        h('div', null, h('span', { text: 'Category multiple' }), h('b', { class: 'num', text: multText(row[C.mult]) })),
        h('div', null, h('span', { text: 'Seven-day growth' }), h('b', { class: 'num', text: pct(row[C.chg]) + '  \u00d7 ' + calc.growthF.toFixed(3) })),
        h('div', null, h('span', { text: 'Age with no token' }), h('b', { class: 'num', text: ageText(row[C.age]) + '  \u00d7 ' + calc.maturity.toFixed(3) })),
        h('div', null, h('span', { text: 'Implied value' }), h('b', { class: 'num', text: money(row[C.implied]) }))),
      h('p', { class: 'sub', text: multNote + '. Model ' + SET.model_version + ': the same function scores every protocol. The page recomputes this row as ' + money(calc.value) + (calc.value === row[C.implied] ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' }),
      h('p', { class: 'sub', text: 'Records no token: DefiLlama\u2019s record carries no market cap, CoinGecko id or symbol for this protocol. That is the record, not proof it has none.' })));
    detailBox.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Farm plan' }),
      h('ol', { class: 'steps' }, steps.map((s) => {
        const at = s.indexOf(' Cost: ');
        const action = at >= 0 ? s.slice(0, at) : s;
        const tail = at >= 0 ? s.slice(at + 1) : '';
        return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
      }))));
    if (typeof detailBox.showModal === 'function') {
      if (!detailBox.open) detailBox.showModal();
    } else {
      detailBox.setAttribute('open', '');
    }
  };

  const paint = () => {
    app.textContent = '';
    const shell = h('div', { class: 'shell' });
    shell.appendChild(masthead());
    shell.appendChild(intro());
    shell.appendChild(filterBar());
    shell.appendChild(ui.tab === 'pre-token' ? boardPanel() : livePanel());
    if (ui.tab === 'pre-token') shell.appendChild(modelBox());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!detailBox.isConnected) app.appendChild(detailBox);
    if (ui.selected) showDetail(ui.selected);
  };

  loadHash();
  paint();
  window.addEventListener('hashchange', () => {
    ui.q = '';
    ui.category = 'all';
    ui.chain = 'all';
    ui.watchlist = false;
    ui.tab = 'pre-token';
    ui.sort = 'implied';
    ui.dir = -1;
    ui.selected = null;
    loadHash();
    paint();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && detailBox.open) detailBox.close();
  });
})();
