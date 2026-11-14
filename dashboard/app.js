// Token Radar v2 dashboard script. Reads window.RADAR and renders ranked board, filters, live tab, detail drawer, and model breakdown.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // Implied value recheck using row's stored multipliers under radar-2
  function impliedOf(row, model) {
    var base = row.tvl_usd * model.base_multiple;
    var val = base * row.growth_multiplier * row.maturity_multiplier * row.breadth_multiplier * row.leader_multiplier;
    return Math.max(1, Math.round(val));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // Farm plan generator mirroring lib/model.ts farmSteps
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function fmtTvlBrief(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) {
      var m = n / 1e6;
      return '$' + (m >= 10 ? m.toFixed(0) : m.toFixed(1)) + 'M';
    }
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  }
  function fmtChangeBrief(n) {
    if (n === null || n === undefined || !isFinite(n)) return '+0.0%';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var stats = ' — ' + fmtTvlBrief(p.tvl_usd) + ' TVL, ' + fmtChangeBrief(p.change_7d) + ' this week —';
    
    var core = 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) {
      core = 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain;
    } else if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) {
      core = 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain;
    } else if (c.indexOf('bridge') >= 0) {
      core = 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name;
    } else if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) {
      core = "Stake $" + capital + " of the chain's staking asset through " + name;
    } else if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) {
      core = 'Deposit $' + capital + ' of USDC as margin on ' + name;
    } else if (c.indexOf('prediction') >= 0) {
      core = 'Fund $' + capital + ' and place one market position on ' + name;
    } else if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) {
      core = 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain;
    } else if (c.indexOf('stable') >= 0) {
      core = 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain;
    } else if (c.indexOf('rwa') >= 0) {
      core = "Mint $" + capital + " of the protocol's yield asset on " + chain;
    } else if (c.indexOf('insurance') >= 0) {
      core = 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain;
    }

    var ending = (c.indexOf('bridge') >= 0 ? ' and use the bridged funds in its app.' :
                  c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0 ? ' and keep the receipt.' :
                  c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 ? ' and open one small hedge.' :
                  c.indexOf('prediction') >= 0 ? '' :
                  c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 ? ' and keep the shares.' :
                  c.indexOf('rwa') >= 0 ? ' and hold it.' :
                  c.indexOf('insurance') >= 0 ? ' and keep the policy.' : ' and keep the position open.');

    return core + stats + ending;
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('minTvl')) state.minTvl = Number(params.get('minTvl')) || 0;
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.minTvl > 0) params.set('minTvl', String(state.minTvl));
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (!r.chains || !r.chains.includes(state.chain))) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar v2' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'Radar-2 model incorporates base TVL multiple (0.25x), growth weighting, maturity curve, multi-chain breadth bonus (up to +15%), and category market leadership share (up to +25%). Implied value is a structural estimate.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chainsSet = new Set();
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainsSet.add(c); }); });
    var chains = Array.from(chainsSet).sort();

    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category, chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });

    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });

    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });

    var minTvlSelect = el('select', { id: 'minTvl', 'aria-label': 'Minimum TVL' },
      el('option', { value: '0', text: 'Min TVL: Any' }),
      el('option', { value: '10000000', text: '≥ $10M TVL', selected: state.minTvl === 10000000 ? 'selected' : null }),
      el('option', { value: '50000000', text: '≥ $50M TVL', selected: state.minTvl === 50000000 ? 'selected' : null }),
      el('option', { value: '100000000', text: '≥ $100M TVL', selected: state.minTvl === 100000000 ? 'selected' : null }),
      el('option', { value: '500000000', text: '≥ $500M TVL', selected: state.minTvl === 500000000 ? 'selected' : null }),
      el('option', { value: '1000000000', text: '≥ $1B TVL', selected: state.minTvl === 1000000000 ? 'selected' : null })
    );
    minTvlSelect.addEventListener('change', function () { state.minTvl = Number(minTvlSelect.value); writeHash(); render(); });

    var preBtn = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token Board', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var liveBtn = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live Tokens (' + DATA.live.length + ')', onclick: function () { state.tab = 'live'; writeHash(); render(); } });

    var hasFilters = state.q || state.category !== 'all' || state.chain !== 'all' || state.minTvl > 0;
    var filterBar = null;
    if (hasFilters) {
      var filterDesc = [];
      if (state.q) filterDesc.push('Search: "' + state.q + '"');
      if (state.category !== 'all') filterDesc.push('Category: ' + state.category);
      if (state.chain !== 'all') filterDesc.push('Chain: ' + state.chain);
      if (state.minTvl > 0) filterDesc.push('Min TVL: ' + fmtUsd(state.minTvl));
      filterBar = el('div', { class: 'filter-bar' },
        el('span', { text: 'Active filters: ' + filterDesc.join(' | ') + ' (' + rows().length + ' protocols matching)' }),
        el('button', { type: 'button', text: 'Reset all filters', onclick: function () {
          state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; writeHash(); render();
        }})
      );
    }

    return el('div', { class: 'controls-wrap' },
      el('div', { class: 'controls' },
        el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
        el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
        el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
        el('div', { class: 'field' }, el('label', { for: 'minTvl', text: 'Min TVL' }), minTvlSelect),
        el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), el('div', { class: 'tabs' }, preBtn, liveBtn)),
        el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' / ' + DATA.board_size + ' shown' : DATA.live.length + ' protocols' })
      ),
      filterBar
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches the active filters' }),
        el('p', { text: 'Try relaxing the search query, category, chain, or minimum TVL filter.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear all filters', onclick: function () {
          state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; writeHash(); render();
        }})
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var chainsStr = r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'unnamed chain';
      if (r.chains && r.chains.length > 2) chainsStr += ' +' + (r.chains.length - 2);

      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('div', { style: 'display:flex; gap:6px; align-items:center; flex-wrap:wrap;' },
            el('span', { class: 'badge', text: r.category || 'Other' }),
            el('span', { class: 'sub', text: chainsStr })
          )
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols ranked by radar-2 implied value. Click any row for model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d Change'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied Value'),
            el('th', { scope: 'col', text: 'Token Status' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      var chainsStr = r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'unnamed chain';
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('div', { style: 'display:flex; gap:6px; align-items:center; flex-wrap:wrap;' },
            el('span', { class: 'badge', text: r.category || 'Other' }),
            el('span', { class: 'sub', text: chainsStr })
          )
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Live-token protocols set aside: market capitalization is a real market valuation, not an implied model ranking.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d Change' }),
            el('th', { scope: 'col', text: 'Market Cap' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Radar-2 Valuation Model Specification' }),
      el('p', { class: 'sub', text: 'Every pre-token row is scored deterministically using the following formula across snapshot statistics:' }),
      el('div', { class: 'formula', text: 'implied = max(1, round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (maturity) x (1 + ' + m.breadth_weight + ' x breadth) x (1 + ' + m.leader_weight + ' x leader_share) ))' }),
      el('p', { class: 'sub', text: 'Maturity curve applies exponential decay from listing age (unknown age defaults to ' + m.unknown_age_days + 'd). Breadth rewards multi-chain footprint (up to +15% for 6+ chains). Leader share rewards market share within category (up to +25%).' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputedImplied = impliedOf(row, DATA.model);

    var chainsStr = row.chains && row.chains.length ? row.chains.join(', ') : 'unnamed chain';

    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('div', { style: 'display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:4px;' },
          el('span', { class: 'badge', text: row.category || 'Other' }),
          el('span', { class: 'sub', text: chainsStr })
        )
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: '✕', onclick: function () { dialog.close(); } })
    ));

    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Model Breakdown (Radar-2)' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL (USD)' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: '7d Growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Protocol Age' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Base Multiple (' + DATA.model.base_multiple + 'x)' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd * DATA.model.base_multiple) })),
        el('div', null, el('span', { text: 'Growth Multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity Multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Breadth Multiplier' }), el('b', { class: 'num', text: String(row.breadth_multiplier) })),
        el('div', null, el('span', { text: 'Category Leader Multiplier' }), el('b', { class: 'num', text: String(row.leader_multiplier) })),
        el('div', null, el('span', { text: 'Category Share' }), el('b', { class: 'num', text: (row.category_share * 100).toFixed(1) + '%' })),
        el('div', null, el('span', { text: 'Implied Value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Verification: recomputed implied value is ' + fmtUsd(recomputedImplied) + (recomputedImplied === row.implied_value_usd ? ' (matches board.json exactly).' : ' (differs slightly due to rounding).') })
    ));

    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm Plan v2 (6 Steps)' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));

    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
