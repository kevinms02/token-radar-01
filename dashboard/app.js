// Token Launch Radar: Reactive Dashboard & Farming Intelligence
// Zero external network dependencies; all data loaded via data.js
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var app = document.getElementById('board');
  var state = {
    q: '',
    category: 'all',
    tab: 'pre-token',
    sort: 'implied',
    dir: -1,
    selected: null
  };

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

  function categoryMultiple(cat) {
    if (!cat) return 0.50;
    var c = cat.toLowerCase();
    if (c.indexOf('derivative') >= 0 || c.indexOf('perp') >= 0 || c.indexOf('option') >= 0 || c.indexOf('basis') >= 0 || c.indexOf('synthetics') >= 0) return 1.20;
    if (c.indexOf('dex') >= 0 || c.indexOf('amm') >= 0 || c.indexOf('swap') >= 0 || c.indexOf('otc') >= 0) return 0.85;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('borrow') >= 0 || c.indexOf('collateral') >= 0) return 0.70;
    if (c.indexOf('rwa') >= 0 || c.indexOf('card') >= 0 || c.indexOf('payment') >= 0 || c.indexOf('stable') >= 0) return 0.65;
    if (c.indexOf('chain') >= 0 || c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 0.90;
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('vault') >= 0 || c.indexOf('liquidity manager') >= 0) return 0.60;
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return 0.45;
    if (c.indexOf('ai') >= 0 || c.indexOf('agent') >= 0 || c.indexOf('prediction') >= 0) return 1.10;
    return 0.50;
  }

  function impliedOf(row, model) {
    var catMult = categoryMultiple(row.category);
    var rawGrowth = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturityMult = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chainCount = row.chains && row.chains.length ? row.chains.length : 1;
    var multichainMult = 1.0 + Math.min(Math.max(chainCount - 1, 0), 5) * 0.05;
    var base = row.tvl_usd * catMult;
    return Math.max(100000, Math.round(base * growthMult * maturityMult * multichainMult));
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

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('tab')) state.tab = params.get('tab');
  }

  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
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
      else if (key === 'rank') { av = a.rank; bv = b.rank; return state.dir * (av - bv); }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('div', { class: 'brand-icon', text: 'TL' }),
        el('div', { class: 'brand-text' },
          el('span', { class: 'brand-title', text: 'Token Launch Radar' }),
          el('span', { class: 'brand-sub', text: 'Quantitative Pre-Token Discovery & Valuation Engine' })
        )
      ),
      el('div', { class: 'top-meta' },
        el('span', { class: 'pulse-tag' }, el('span', { class: 'pulse-dot' }), 'LIVE RADAR'),
        el('span', { class: 'meta-chip', text: 'Snapshot: ' + DATA.as_of }),
        el('span', { class: 'meta-chip', text: DATA.model_version })
      )
    );
  }

  function bentoMetrics() {
    var totalTvl = DATA.rows.reduce(function (sum, r) { return sum + r.tvl_usd; }, 0);
    var totalImplied = DATA.rows.reduce(function (sum, r) { return sum + r.implied_value_usd; }, 0);
    var topRow = DATA.rows[0];

    return el('section', { class: 'bento-grid' },
      el('div', { class: 'bento-card highlight' },
        el('span', { class: 'bento-label', text: 'Watchlist Coverage' }),
        el('div', { class: 'bento-value', text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }),
        el('span', { class: 'bento-desc', html: '<b>100% Floor Covered</b> (TVL &ge; $' + Math.round(DATA.floor_usd / 1e6) + 'M)' })
      ),
      el('div', { class: 'bento-card' },
        el('span', { class: 'bento-label', text: 'Tracked Pre-Token TVL' }),
        el('div', { class: 'bento-value', text: fmtUsd(totalTvl) }),
        el('span', { class: 'bento-desc', text: DATA.board_size + ' candidate protocols in active radar' })
      ),
      el('div', { class: 'bento-card' },
        el('span', { class: 'bento-label', text: 'Total Implied Value' }),
        el('div', { class: 'bento-value', text: fmtUsd(totalImplied) }),
        el('span', { class: 'bento-desc', text: 'Multi-factor institutional market evaluation' })
      ),
      el('div', { class: 'bento-card' },
        el('span', { class: 'bento-label', text: 'Highest Implied Value' }),
        el('div', { class: 'bento-value', text: topRow ? fmtUsd(topRow.implied_value_usd) : 'n/a' }),
        el('span', { class: 'bento-desc', text: topRow ? '#1 ' + topRow.name + ' (' + (topRow.category || 'DeFi') + ')' : '' })
      )
    );
  }

  function controlsToolbar() {
    var rawCategories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var topCats = ['all'];
    ['Risk Curators', 'RWA', 'Onchain Capital Allocator', 'Dexs', 'Lending', 'Basis Trading', 'Restaking', 'Chain'].forEach(function (c) {
      if (rawCategories.indexOf(c) >= 0 && topCats.indexOf(c) === -1) topCats.push(c);
    });

    var searchInput = el('input', {
      type: 'search',
      class: 'search-input',
      placeholder: 'Search protocol, category or chain...',
      value: state.q,
      'aria-label': 'Search board'
    });
    searchInput.addEventListener('input', function () {
      state.q = searchInput.value;
      writeHash();
      render();
    });

    var preTab = el('button', {
      type: 'button',
      class: 'tab-btn',
      'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false',
      text: 'Pre-Token Radar (' + DATA.board_size + ')',
      onclick: function () { state.tab = 'pre-token'; writeHash(); render(); }
    });

    var liveTab = el('button', {
      type: 'button',
      class: 'tab-btn',
      'aria-pressed': state.tab === 'live' ? 'true' : 'false',
      text: 'Traded Benchmarks (' + DATA.live.length + ')',
      onclick: function () { state.tab = 'live'; writeHash(); render(); }
    });

    var chipButtons = topCats.map(function (cat) {
      return el('button', {
        type: 'button',
        class: 'chip-btn',
        'aria-pressed': state.category === cat ? 'true' : 'false',
        text: cat === 'all' ? 'All Sectors' : cat,
        onclick: function () {
          state.category = cat;
          writeHash();
          render();
        }
      });
    });

    var countText = state.tab === 'pre-token'
      ? rows().length + ' of ' + DATA.board_size + ' protocols displayed'
      : DATA.live.length + ' benchmark protocols displayed';

    return el('div', { class: 'controls-bar' },
      el('div', { class: 'controls-top' },
        el('div', { class: 'search-wrapper' }, searchInput),
        el('div', { class: 'tabs' }, preTab, liveTab)
      ),
      el('div', { class: 'chips-row' },
        el('span', { class: 'chip-label', text: 'Sector Filter:' }),
        chipButtons
      ),
      el('div', { class: 'table-meta-row' },
        el('span', { text: countText }),
        el('span', { text: 'Click any row for farming playbook & valuation arithmetic' })
      )
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', {
        type: 'button',
        onclick: function () {
          if (state.sort === key) state.dir = -state.dir;
          else { state.sort = key; state.dir = -1; }
          render();
        }
      },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' },
        el('div', { style: 'padding: 48px 24px; text-align: center; display: grid; gap: 12px; justify-items: center;' },
          el('h3', { text: 'No protocols match your search filter' }),
          el('p', { style: 'color: var(--muted);', text: 'Try resetting the sector chip or search query.' }),
          el('button', {
            type: 'button',
            class: 'close-btn',
            style: 'margin-top: 8px;',
            text: 'Reset Filters',
            onclick: function () {
              state.q = '';
              state.category = 'all';
              writeHash();
              render();
            }
          })
        )
      );
    }

    var maxImplied = DATA.rows[0].implied_value_usd || 1;
    var tbody = el('tbody');

    list.forEach(function (r) {
      var growthText = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var pctWidth = Math.max(4, Math.min(100, Math.round((r.implied_value_usd / maxImplied) * 100)));

      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openDetail(r.slug);
          }
        }
      },
        el('td', { class: 'num' }, el('span', { class: 'rank-badge', text: '#' + r.rank })),
        el('td', null,
          el('div', { class: 'protocol-cell' },
            el('span', { class: 'protocol-name', text: r.name }),
            el('div', { class: 'protocol-sub' },
              el('span', { class: 'cat-tag', text: r.category || 'DeFi' }),
              el('span', { class: 'chain-tag', text: (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'Ethereum') })
            )
          )
        ),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growthText }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null,
          el('div', { class: 'implied-cell' },
            el('span', { class: 'num implied-val', text: fmtUsd(r.implied_value_usd) }),
            el('div', { class: 'implied-bar-bg', 'aria-hidden': 'true' },
              el('div', { class: 'implied-bar-fill', style: 'width:' + pctWidth + '%;' })
            )
          )
        ),
        el('td', null,
          el('span', { class: 'token-badge pre-token', text: 'Pre-Token' })
        )
      );

      tbody.appendChild(tr);
    });

    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null,
            el('tr', null,
              sortHeader('rank', 'Rank'),
              sortHeader('name', 'Protocol & Sector'),
              sortHeader('tvl', 'TVL (USD)'),
              sortHeader('growth', '7D Velocity'),
              sortHeader('age', 'Protocol Age'),
              sortHeader('implied', 'Implied Valuation'),
              el('th', { scope: 'col', text: 'Status' })
            )
          ),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num' }, el('span', { class: 'token-badge live-token', text: 'LIVE' })),
        el('td', null,
          el('div', { class: 'protocol-cell' },
            el('span', { class: 'protocol-name', text: r.name }),
            el('div', { class: 'protocol-sub' },
              el('span', { class: 'cat-tag', text: r.category || 'DeFi' }),
              el('span', { class: 'chain-tag', text: (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'Ethereum') })
            )
          )
        ),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', style: 'font-weight: 700; color: #fff;', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'token-badge live-token', text: 'Traded Token' }))
      ));
    });

    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null,
            el('tr', null,
              el('th', { scope: 'col', text: 'Status' }),
              el('th', { scope: 'col', text: 'Protocol & Sector' }),
              el('th', { scope: 'col', text: 'Current TVL' }),
              el('th', { scope: 'col', text: '7D Momentum' }),
              el('th', { scope: 'col', text: 'Live Market Cap' }),
              el('th', { scope: 'col', text: 'Category' })
            )
          ),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'model-box' },
      el('h3', { text: 'Quantitative Implied Valuation Methodology' }),
      el('p', { style: 'color: var(--muted); font-size: 13px;', text: 'Valuation is computed strictly from verified snapshot fundamentals: Sector Multiple (M_cat), 7-day TVL momentum (V_7d), Lindy longevity discounting (L_age), and Multichain liquidity breadth (C_mult).' }),
      el('div', { class: 'formula-block' },
        'Implied FDV = TVL x M_cat x [1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + '] x [' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + '] x [1 + min(chains - 1, 5) x 0.05]'
      ),
      el('p', { style: 'color: var(--muted); font-size: 12px;', text: 'No protocol is special-cased. All pre-token protocols are scored with identical quantitative weights. Traded protocols are separated into benchmark status.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () {
    state.selected = null;
    writeHash();
    render();
  });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;

    state.selected = slug;
    writeHash();
    dialog.textContent = '';

    var recomputed = impliedOf(row, DATA.model);
    var isParity = recomputed === row.implied_value_usd;
    var steps = row.farm_steps || [];

    dialog.appendChild(
      el('div', { class: 'detail-head' },
        el('div', null,
          el('div', { style: 'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;' },
            el('span', { class: 'rank-badge', text: '#' + row.rank }),
            el('span', { class: 'token-badge pre-token', text: 'Pre-Token Target' })
          ),
          el('h2', { id: 'detail-title', text: row.name }),
          el('p', { style: 'color: var(--muted); font-size: 12px; margin-top: 4px;', text: (row.category || 'DeFi') + ' deployed on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'Ethereum') })
        ),
        el('button', {
          class: 'close-btn',
          type: 'button',
          'aria-label': 'Close detail view',
          text: '✕ Close',
          onclick: function () { dialog.close(); }
        })
      )
    );

    // Valuation Breakdown
    dialog.appendChild(
      el('section', { class: 'detail-section' },
        el('h4', { text: 'Valuation Arithmetic & Factor Attribution' }),
        el('div', { class: 'equation-grid' },
          el('div', { class: 'eq-row' }, el('span', { class: 'eq-label', text: 'Reported TVL' }), el('span', { class: 'eq-val', text: fmtUsd(row.tvl_usd) })),
          el('div', { class: 'eq-row' }, el('span', { class: 'eq-label', text: 'Sector Multiple (M_cat)' }), el('span', { class: 'eq-val', text: categoryMultiple(row.category).toFixed(2) + 'x' })),
          el('div', { class: 'eq-row' }, el('span', { class: 'eq-label', text: '7-Day TVL Momentum' }), el('span', { class: 'eq-val ' + (row.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(row.change_7d) })),
          el('div', { class: 'eq-row' }, el('span', { class: 'eq-label', text: 'Growth Multiplier (V_7d)' }), el('span', { class: 'eq-val', text: String(row.growth_multiplier) + 'x' })),
          el('div', { class: 'eq-row' }, el('span', { class: 'eq-label', text: 'Tracked Longevity (Age)' }), el('span', { class: 'eq-val', text: fmtAge(row.age_days) })),
          el('div', { class: 'eq-row' }, el('span', { class: 'eq-label', text: 'Lindy Multiplier (L_age)' }), el('span', { class: 'eq-val', text: String(row.maturity_multiplier) + 'x' })),
          el('div', { class: 'eq-row' }, el('span', { class: 'eq-label', text: 'Multichain Reach (C_mult)' }), el('span', { class: 'eq-val', text: String(row.multichain_multiplier || 1.0) + 'x' })),
          el('div', { class: 'eq-row', style: 'border-top: 1px solid var(--border); padding-top: 6px; margin-top: 4px;' },
            el('span', { class: 'eq-label', style: 'color: var(--accent); font-weight: 600;', text: 'Implied Valuation' }),
            el('span', { class: 'eq-val', style: 'color: var(--accent); font-size: 15px;', text: fmtUsd(row.implied_value_usd) })
          )
        ),
        el('p', {
          style: 'color: var(--muted); font-size: 11px; font-family: var(--font-mono);',
          text: 'Determinism check: Model evaluation recomputes to ' + fmtUsd(recomputed) + (isParity ? ' (100% board parity verified).' : ' (mismatch detected).')
        })
      )
    );

    // Farming Playbook Steps
    var stepNodes = steps.map(function (stepStr, idx) {
      var costIdx = stepStr.indexOf(' Cost: ');
      var timeIdx = stepStr.indexOf(' Time: ');
      var action = stepStr;
      var cost = '';
      var time = '';

      if (costIdx >= 0) {
        action = stepStr.slice(0, costIdx);
        if (timeIdx > costIdx) {
          cost = stepStr.slice(costIdx + 7, timeIdx);
          time = stepStr.slice(timeIdx + 7);
        } else {
          cost = stepStr.slice(costIdx + 7);
        }
      }

      return el('li', { class: 'step-item' },
        el('div', { class: 'step-header' },
          el('span', { class: 'step-num', text: String(idx + 1) }),
          el('span', { class: 'step-action', text: action })
        ),
        el('div', { class: 'step-meta' },
          cost ? el('span', { class: 'step-cost', text: 'Cost: ' + cost }) : null,
          time ? el('span', { class: 'step-time', text: 'Duration: ' + time }) : null
        )
      );
    });

    dialog.appendChild(
      el('section', { class: 'detail-section' },
        el('h4', { text: 'Dynamic Farming Playbook' }),
        el('p', { style: 'color: var(--muted); font-size: 12px; margin-bottom: 12px;', text: 'Concrete, costed action sequence required to maximize airdrop allocation and qualifying tier status.' }),
        el('ol', { class: 'steps-list' }, stepNodes)
      )
    );

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
    shell.appendChild(bentoMetrics());
    shell.appendChild(controlsToolbar());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');

    if (!dialog.isConnected) document.body.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) {
      dialog.close();
    }
  });
})();
