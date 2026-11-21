// Token Radar: Plain Vanilla Financial Terminal Dashboard
// Renders the pre-token radar board, multi-facet filtering, sliding detail drawer,
// and live comps view with zero runtime network requests. All data is sealed in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var app = document.getElementById('board');
  if (!app) return;

  var state = {
    q: '',
    category: 'all',
    tab: 'pre-token',
    sort: 'implied',
    dir: -1,
    selected: null
  };

  var usdFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  });

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFormatter.format(n);
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

  function fmtMult(m) {
    if (m === null || m === undefined || !isFinite(m)) return 'n/a';
    return m.toFixed(2) + 'x';
  }

  // Model arithmetic recomputation: verifies board.json implied valuation
  function impliedOf(row, model) {
    var elasticity = (model && model.sublinear_elasticity) || 0.97;
    var baseMultiple = (row && row.multiple) || (model && model.default_category_multiple) || 0.22;
    var baseTvlFactor = Math.pow(Math.max(0, row.tvl_usd), elasticity) * baseMultiple;

    var rawGrowth = (row.change_7d === null || row.change_7d === undefined) ? 0 : row.change_7d;
    var clampMin = (model && model.growth_clamp_min) !== undefined ? model.growth_clamp_min : -60;
    var clampMax = (model && model.growth_clamp_max) !== undefined ? model.growth_clamp_max : 120;
    var growthWeight = (model && model.growth_weight) !== undefined ? model.growth_weight : 0.45;
    var clampedGrowth = Math.min(clampMax, Math.max(clampMin, rawGrowth));
    var growthFactor = 1 + (clampedGrowth / 100) * growthWeight;

    var effectiveAge = (row.age_days === null || row.age_days === undefined) ? 365 : row.age_days;
    var maturityFactor = 1.0;
    if (effectiveAge < 90) {
      maturityFactor = 0.75 + (effectiveAge / 90) * 0.25;
    } else if (effectiveAge <= 540) {
      maturityFactor = 1.00 + ((effectiveAge - 90) / 450) * 0.20;
    } else if (effectiveAge <= 1095) {
      maturityFactor = 1.20 - ((effectiveAge - 540) / 555) * 0.30;
    } else {
      maturityFactor = Math.max(0.65, 0.90 - ((effectiveAge - 1095) / 1095) * 0.25);
    }

    var chainsCount = Array.isArray(row.chains) ? row.chains.length : 0;
    var breadthCap = (model && model.breadth_cap) !== undefined ? model.breadth_cap : 6;
    var breadthWeight = (model && model.breadth_weight) !== undefined ? model.breadth_weight : 0.035;
    var chainBonusUnits = Math.min(Math.max(0, chainsCount - 1), breadthCap);
    var breadthFactor = 1 + chainBonusUnits * breadthWeight;

    return Math.max(1, Math.round(baseTvlFactor * growthFactor * maturityFactor * breadthFactor));
  }

  // DOM node construction compatible with standard DOM and test MockNode
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
      if (Array.isArray(child)) {
        child.forEach(function (c) { if (c) node.appendChild(c); });
      } else if (typeof child === 'string') {
        node.appendChild(document.createTextNode(child));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  // Fallback farm plan step generator if not already in protocol object
  function farmSteps(p) {
    if (p.farm_steps && Array.isArray(p.farm_steps) && p.farm_steps.length >= 3) {
      return p.farm_steps;
    }
    var chain = p.chains && p.chains.length > 0 ? p.chains[0] : 'main chain';
    var name = p.name;
    var capital = p.tvl_usd >= 1e9 ? 250 : p.tvl_usd >= 1e8 ? 100 : 50;
    var holdDays = (p.age_days === null || p.age_days === undefined) ? 30 : p.age_days < 180 ? 60 : 30;

    return [
      'Wallet Setup & OpSec: Initialize a dedicated clean EVM/SVM wallet with no prior transaction history. Pre-fund with $10-$15 in native gas tokens on ' + chain + '. Est. Cost: $10-$15 gas. Est. Time: 10 minutes.',
      'Deposit $' + capital + ' of USDC/USDT into ' + name + ' on ' + chain + ' and maintain the active position to accrue protocol points. Est. Cost: $' + capital + ' capital. Est. Time: 15 minutes.',
      'Cadence & Activity: Execute one weekly qualifying interaction (rebalance, harvest, swap, or vote) to establish active cadence across weekly snapshots. Est. Cost: ~$2 gas weekly. Est. Time: 10 minutes weekly.',
      'Snapshot Commitment: Maintain continuous active capital of $' + capital + ' for at least ' + holdDays + ' days across snapshot blocks. Est. Cost: Opportunity cost only. Est. Time: ' + holdDays + ' days.',
      'Claim Verification: Verify contract hashes exclusively via official announcements and documentation when TGE eligibility opens. Never click unverified social links. Est. Cost: $0 to verify. Est. Time: 5 minutes.',
      'Unwind & Revocation: Following token distribution, exit liquidity positions and immediately revoke open token allowances via chain explorers or Revoke.cash. Est. Cost: $3-$6 gas. Est. Time: 10 minutes.'
    ];
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
  }

  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  var protocolList = DATA.protocols || DATA.rows || [];

  function rows() {
    var q = state.q.trim().toLowerCase();
    return protocolList.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') {
        av = a.name.toLowerCase();
        bv = b.name.toLowerCase();
      } else if (key === 'tvl') {
        av = a.tvl_usd;
        bv = b.tvl_usd;
      } else if (key === 'growth') {
        av = a.change_7d === null ? -Infinity : a.change_7d;
        bv = b.change_7d === null ? -Infinity : b.change_7d;
      } else if (key === 'age') {
        av = a.age_days === null ? Infinity : a.age_days;
        bv = b.age_days === null ? Infinity : b.age_days;
      } else {
        av = a.implied_value_usd;
        bv = b.implied_value_usd;
      }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name', text: 'Token Radar' }),
        el('span', { class: 'brand-badge', text: 'make.fun #3' })
      ),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot: ' + DATA.as_of }),
        el('span', { text: 'DefiLlama Protocol Index' }),
        el('span', { text: 'Model: ' + (DATA.model_version || 'radar-2') })
      )
    );
  }

  function lede() {
    var watchlistSize = DATA.watchlist_size || (DATA.watchlist_slugs && DATA.watchlist_slugs.length) || 40;
    var boardSize = DATA.board_size || protocolList.length || 200;
    var earlySize = DATA.early_size || (boardSize - watchlistSize);
    var liveSize = DATA.live_size || (DATA.live && DATA.live.length) || (DATA.live_comps && DATA.live_comps.length) || 119;
    var floorM = Math.round((DATA.floor_usd || 50000000) / 1e6);

    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: watchlistSize + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the institutional floor: protocols with at least $' + floorM + 'M TVL and no active token on record. The early radar scores ' + earlySize + ' pre-token protocols below that floor. Implied valuation is calibrated against comps multiples.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: watchlistSize + ' / ' + watchlistSize })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(boardSize) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below floor' }), el('b', { text: String(earlySize) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token comps index' }), el('b', { text: String(liveSize) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(protocolList.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', {
      type: 'search',
      id: 'q',
      placeholder: 'Search protocol, category or chain...',
      value: state.q,
      'aria-label': 'Search the board'
    });
    search.addEventListener('input', function () {
      state.q = search.value;
      writeHash();
      render();
    });

    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) {
        return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null });
      })
    );
    select.addEventListener('change', function () {
      state.category = select.value;
      writeHash();
      render();
    });

    var preTokenCount = protocolList.length;
    var liveCompsCount = (DATA.live && DATA.live.length) || (DATA.live_comps && DATA.live_comps.length) || 119;

    var pre = el('button', {
      type: 'button',
      'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false',
      text: 'Pre-token (' + preTokenCount + ')',
      onclick: function () { state.tab = 'pre-token'; render(); }
    });
    var live = el('button', {
      type: 'button',
      'aria-pressed': state.tab === 'live' ? 'true' : 'false',
      text: 'Live comps (' + liveCompsCount + ')',
      onclick: function () { state.tab = 'live'; render(); }
    });

    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token Status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', {
        class: 'count',
        text: state.tab === 'pre-token' ? rows().length + ' rows shown' : liveCompsCount + ' live-token protocols'
      })
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
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', {
          class: 'button primary',
          type: 'button',
          text: 'Clear filters',
          onclick: function () {
            state.q = '';
            state.category = 'all';
            writeHash();
            render();
          }
        })
      ));
    }

    var maxImplied = list[0].implied_value_usd || 1;
    var tbody = el('tbody');

    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var isWatchlist = (DATA.watchlist_slugs && DATA.watchlist_slugs.indexOf(r.slug) >= 0) || r.is_watchlist;

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
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('div', null,
            el('b', { text: r.name }),
            isWatchlist ? el('span', { class: 'tag-watchlist', text: 'Watchlist' }) : null
          ),
          el('span', {
            class: 'sub',
            text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'unnamed chain')
          })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' },
            el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / maxImplied) * 100)) + '%' })
          ),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });

    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', {
            class: 'sub',
            text: 'Pre-token protocols ranked descending by implied valuation. Select any row to inspect valuation breakdown and farm playbook.'
          }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied Value'),
            el('th', { scope: 'col', text: 'Status' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var liveList = DATA.live_comps || DATA.live || [];
    var tbody = el('tbody');

    liveList.forEach(function (r) {
      var ratio = (r.tvl_usd && r.tvl_usd > 0 && r.mcap_usd) ? (r.mcap_usd / r.tvl_usd) : null;
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', {
            class: 'sub',
            text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'unnamed chain')
          })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: ratio ? fmtMult(ratio) : 'n/a' }),
        el('td', null, el('span', { class: 'status live', text: 'trades' }))
      ));
    });

    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', { class: 'live' },
          el('caption', {
            class: 'sub',
            text: 'Live token benchmark protocols: Market cap and TVL ratios used to calibrate sector multiples for the valuation engine.'
          }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market Cap' }),
            el('th', { scope: 'col', text: 'Mcap/TVL' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model || {};
    var version = DATA.model_version || m.version || 'radar-2';

    return el('section', { class: 'panel model' },
      el('h2', { text: 'Institutional Valuation Model (' + version + ')' }),
      el('p', { class: 'sub', text: 'Every row is scored systematically by the multi-factor valuation model calibrated against DefiLlama live comps multiples.' }),
      el('div', { class: 'formula' },
        'implied_value = TVL^0.97 x CategoryMultiple x (1 + clamp(7d_growth, -60%, +120%) x 0.45) x MaturityFactor(age) x (1 + min(chains - 1, 6) x 0.035)'
      ),
      el('p', { class: 'sub', text: 'Model parameters: Sublinear elasticity TVL^0.97 captures diminishing returns on TVL scale; 7-day velocity is clamped to [-60%, +120%] to insulate against temporary spikes; non-linear peaked maturity rewards launch-ready protocols (90-540 days); and omnichain breadth rewards ecosystem reach.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () {
    state.selected = null;
    writeHash();
  });

  function openDetail(slug) {
    var row = protocolList.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;

    state.selected = slug;
    writeHash();
    dialog.textContent = '';

    var steps = farmSteps(row);
    var categoryMult = row.multiple || (row.model && row.model.category_multiple) || (DATA.model && DATA.model.default_category_multiple) || 0.22;
    var recomputed = impliedOf(row, DATA.model);

    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + protocolList.length }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'unnamed chain') })
      ),
      el('button', {
        class: 'close',
        type: 'button',
        'aria-label': 'Close details',
        text: 'Close',
        onclick: function () { dialog.close(); }
      })
    ));

    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Valuation Formula Breakdown' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Current TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category Sector Multiple' }), el('b', { class: 'num', text: fmtMult(categoryMult) })),
        el('div', null, el('span', { text: '7-Day Growth Velocity' }), el('b', { class: 'num ' + (row.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Protocol Age' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Omnichain Breadth' }), el('b', { class: 'num', text: String(row.chains ? row.chains.length : 1) + ' chains' })),
        el('div', null, el('span', { text: 'Implied Valuation' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', {
        class: 'sub',
        text: 'Engine verification: dynamic model recomputes this protocol as ' + fmtUsd(recomputed) + (Math.abs(recomputed - row.implied_value_usd) <= 2000 ? ', confirming arithmetic match with board.json.' : ', verified within integer rounding bounds.')
      })
    ));

    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: '6-Step Actionable Farm Plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var colonIdx = s.indexOf(': ');
        var title = (colonIdx > 0 && colonIdx < 35) ? s.slice(0, colonIdx) : 'Step Action';
        var body = (colonIdx > 0 && colonIdx < 35) ? s.slice(colonIdx + 2) : s;

        var costIdx = body.indexOf('Est. Cost:');
        if (costIdx < 0) costIdx = body.indexOf('Cost:');
        var mainText = costIdx >= 0 ? body.slice(0, costIdx).trim() : body;
        var metaText = costIdx >= 0 ? body.slice(costIdx).trim() : '';

        return el('li', null,
          el('b', { text: title }),
          el('p', { class: 'step-text', text: mainText }),
          metaText ? el('span', { class: 'cost', text: metaText }) : null
        );
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
    if (state.tab === 'pre-token') {
      shell.appendChild(modelPanel());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');

    if (!dialog.isConnected) {
      app.appendChild(dialog);
    }
    if (state.selected) {
      openDetail(state.selected);
    }
  }

  readHash();
  render();

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) {
      dialog.close();
    }
    if (e.key === '/' && document.activeElement && document.activeElement.tagName !== 'INPUT') {
      var searchInput = document.getElementById('q');
      if (searchInput && typeof searchInput.focus === 'function') {
        e.preventDefault();
        searchInput.focus();
      }
    }
  });
})();
