/* Engineering calculators: the math behind the postmortems, runnable locally.
 * Pure functions live on window.Calcs for testability. No network calls,
 * no storage, no tracking. All defaults come from the published teardowns;
 * every card links the article its model is simplified from. */
(function () {
  'use strict';

  function num(id, fallback) {
    var el = document.getElementById(id);
    if (!el) return fallback;
    var v = parseFloat(String(el.value).replace(/,/g, ''));
    return isNaN(v) ? fallback : v;
  }

  function money(x, digits) {
    if (!isFinite(x)) return '—';
    return '$' + x.toLocaleString('en-US', {
      minimumFractionDigits: digits == null ? 2 : digits,
      maximumFractionDigits: digits == null ? 2 : digits
    });
  }

  function big(x, digits) {
    if (!isFinite(x)) return '—';
    return x.toLocaleString('en-US', {
      minimumFractionDigits: digits || 0,
      maximumFractionDigits: digits || 0
    });
  }

  var Calcs = {
    /* One agent turn priced from context mix. Matches the Cursor teardown:
       80k in (87.5% cached at $0.30/M, rest fresh at $3/M) + 1.5k out at
       $15/M lands at $0.0735, shown as ~$0.074. */
    tokenTurn: function (o) {
      var cached = o.inTokens * (o.cachePct / 100) / 1e6 * o.cachePrice;
      var fresh = o.inTokens * (1 - o.cachePct / 100) / 1e6 * o.freshPrice;
      var out = o.outTokens / 1e6 * o.outPrice;
      return { perTurn: cached + fresh + out, monthly: (cached + fresh + out) * o.turns };
    },
    /* Monthly envelope from edge rate. Simplified from the Replit/Vercel
       1M-event models: events per second x seconds per month x blended
       price per event, plus fixed platform spend. */
    rpsBill: function (o) {
      var monthly = o.rps * 2592000 * (o.pricePerM / 1e6) + o.fixedK * 1000;
      return { monthly: monthly, daily: monthly / 30, perRequest: o.rps > 0 ? monthly / (o.rps * 2592000) : 0 };
    },
    /* Compaction survival. Defaults mirror the measured median: a 575k
       window compacted to ~4.3k (0.75%), followed by ~28 re-read steps. */
    compaction: function (o) {
      var summary = o.windowTk * (o.survPct / 100);
      return { summary: summary, lostPct: 100 - o.survPct, rereadBill: o.steps * o.stepCost };
    },
    /* Prompt-cache value. Savings versus serving every input token fresh. */
    /* Retry-storm waste. Failed attempts rebilled per task, per day. */
    retryStorm: function (o) {
      var daily = o.tasksDay * o.retries * o.attemptCost;
      return { daily: daily, monthly: daily * 30 };
    },
    /* Error budget from SLO. A 30-day month has 43200 minutes; the budget
       is the unavailability fraction of that. Burn multiple expresses the
       current error rate as a multiple of the budgeted rate. */
    errorBudget: function (o) {
      var budget = (100 - o.slo) / 100 * 43200;
      var left = budget - o.consumed;
      var dailyBurn = o.burn > 0 ? o.burn * (budget / 30) : 0;
      var daysLeft = (left > 0 && dailyBurn > 0) ? left / dailyBurn : 0;
      return { budget: budget, left: left, daysLeft: daysLeft };
    },
    /* Kubernetes HPA formula. Desired replicas equal current replicas
       times current utilization over target utilization, rounded up,
       then clamped to the configured maximum. */
    hpa: function (o) {
      var raw = (o.target > 0 && o.rep > 0) ? Math.ceil(o.rep * (o.util / o.target)) : 0;
      var desired = Math.min(raw, o.max);
      return { desired: desired, delta: desired - o.rep, capped: raw > o.max };
    },
    /* Observability sampling fit. Daily ingest equals spans per second
       times bytes per span times 86400 seconds, converted to gigabytes.
       Keep rate is the budget share of the unsampled monthly cost. */
    obsSample: function (o) {
      var gbDay = o.rps * o.bytes * 86400 / 1e9;
      var monthly = gbDay * 30 * o.priceGB;
      var keepPct = monthly > 0 ? Math.min(100, (o.budget / monthly) * 100) : 100;
      return { gbDay: gbDay, monthly: monthly, keepPct: keepPct };
    },
    /* Connection pool from Little's law. Concurrent connections equal
       peak RPS times p99 latency in seconds; the pool adds a safety
       factor and spreads across pods. */
    poolSize: function (o) {
      var conc = o.rps * (o.p99ms / 1000);
      var pool = Math.ceil(conc * o.safety);
      var perPod = o.pods > 0 ? Math.ceil(pool / o.pods) : pool;
      return { conc: conc, pool: pool, perPod: perPod };
    },
    /* Downtime cost. Revenue loss equals revenue per minute over a
       43800-minute month times minutes down; SLA credit is a percent
       of the monthly cloud bill. */
    downtimeCost: function (o) {
      var loss = (o.rev / 43800) * o.mins;
      var credit = o.bill * (o.creditPct / 100);
      return { loss: loss, credit: credit, total: loss + credit };
    }
  };

  function set(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  var LIME = '#a3e635', CYAN = '#38bdf8', ROSE = '#fb7185';

  /* Paint a conic mix donut. Slices are [fraction, color]; the hole and
     center headline are pure markup in the card. Guards divide-by-zero. */
  function donut(id, slices, centerTop) {
    var el = document.getElementById(id);
    if (!el) return;
    var clean = slices.map(function (s) { return [Math.max(0, s[0] || 0), s[1]]; });
    var sum = clean.reduce(function (s, x) { return s + x[0]; }, 0);
    if (!(sum > 0)) return;
    var acc = 0, parts = clean.map(function (s) {
      var from = (acc / sum) * 100, to = ((acc + s[0]) / sum) * 100;
      acc += s[0];
      return s[1] + ' ' + from.toFixed(1) + '% ' + to.toFixed(1) + '%';
    });
    el.style.background = 'conic-gradient(' + parts.join(',') + ')';
    if (centerTop != null) set(id.replace(/-donut$/, '-mix-top'), centerTop);
  }

  function pct(part, total) {
    if (!(total > 0)) return '—';
    return (Math.max(0, Math.min(1, part / total)) * 100).toFixed(1) + '%';
  }

  function bind(ids, fn) {
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', fn);
    });
  }

  function renderToken() {
    var o = {
      inTokens: num('tk-in', 80000), cachePct: num('tk-cache', 87.5),
      cachePrice: num('tk-cachep', 0.3), freshPrice: num('tk-freshp', 3),
      outTokens: num('tk-out', 1500), outPrice: num('tk-outp', 15),
      turns: num('tk-turns', 1000000)
    };
    var r = Calcs.tokenTurn(o);
    var cached = o.inTokens * (o.cachePct / 100) / 1e6 * o.cachePrice;
    var fresh = o.inTokens * (1 - o.cachePct / 100) / 1e6 * o.freshPrice;
    var out = o.outTokens / 1e6 * o.outPrice;
    set('tk-perturn', money(r.perTurn, 4) + ' / turn');
    set('tk-monthly', money(r.monthly, 0));
    donut('tk-donut', [[cached, LIME], [fresh, CYAN], [out, ROSE]],
      isFinite(o.cachePct) ? o.cachePct.toFixed(1) + '%' : '—');
  }

  function renderRps() {
    var o = {
      rps: num('rps-rps', 1000000), pricePerM: num('rps-price', 1.8),
      fixedK: num('rps-fixed', 2600)
    };
    var r = Calcs.rpsBill(o);
    var variable = o.rps * 2592000 * (o.pricePerM / 1e6);
    var fixed = o.fixedK * 1000;
    set('rps-monthly', money(r.monthly, 0));
    set('rps-daily', money(r.daily, 0) + ' / day');
    set('rps-perreq', '$' + (r.perRequest * 100).toFixed(4) + '¢ / request');
    donut('rps-donut', [[variable, CYAN], [fixed, LIME]], pct(variable, r.monthly));
  }

  function renderCompaction() {
    var o = {
      windowTk: num('cx-win', 575000), survPct: num('cx-surv', 0.75),
      steps: num('cx-steps', 28), stepCost: num('cx-stepc', 0.074)
    };
    var r = Calcs.compaction(o);
    set('cx-summary', big(r.summary, 0) + ' tokens survive');
    set('cx-lost', r.lostPct.toFixed(2) + '% of context lost');
    set('cx-reread', money(r.rereadBill));
    var surv = isFinite(o.survPct) ? Math.max(0, Math.min(100, o.survPct)) : 0;
    donut('cx-donut', [[r.summary, LIME], [Math.max(0, o.windowTk - r.summary), ROSE]],
      surv.toFixed(1) + '%');
  }

  function renderRetry() {
    var o = {
      tasksDay: num('rt-tasks', 10000), retries: num('rt-retries', 2),
      attemptCost: num('rt-cost', 0.05)
    };
    var r = Calcs.retryStorm(o);
    set('rt-daily', money(r.daily, 0) + ' / day');
    set('rt-monthly', money(r.monthly, 0));
    var waste = Math.max(0, o.retries);
    donut('rt-donut', [[1, CYAN], [waste, ROSE]], pct(waste, 1 + waste));
  }

  function renderErrorBudget() {
    var o = {
      slo: num('eb-slo', 99.9), consumed: num('eb-used', 12),
      burn: num('eb-burn', 2)
    };
    var r = Calcs.errorBudget(o);
    set('eb-budget', big(r.budget, 1) + ' min / month');
    set('eb-left', big(r.left, 1) + ' min left');
    set('eb-days', r.daysLeft.toFixed(1));
    donut('eb-donut', [[r.left, LIME], [o.consumed, ROSE]], pct(r.left, r.budget));
  }

  function renderHpa() {
    var o = {
      rep: num('hpa-rep', 8), util: num('hpa-util', 72),
      target: num('hpa-target', 60), max: num('hpa-max', 20)
    };
    var r = Calcs.hpa(o);
    set('hpa-desired', big(r.desired, 0));
    set('hpa-delta', (r.delta >= 0 ? '+' : '') + r.delta + ' to add');
    set('hpa-cap', r.capped ? 'CAPPED, raise max' : 'within max ' + o.max);
    var swing = Math.abs(r.delta);
    donut('hpa-donut', [[o.rep, CYAN], [swing, r.delta >= 0 ? LIME : ROSE]],
      (r.delta >= 0 ? '+' : '') + r.delta);
  }

  function renderObs() {
    var r = Calcs.obsSample({
      rps: num('obs-rps', 50000), bytes: num('obs-bytes', 2048),
      priceGB: num('obs-price', 0.3), budget: num('obs-budget', 20000)
    });
    set('obs-gb', big(r.gbDay, 0) + ' GB / day');
    set('obs-cost', money(r.monthly, 0));
    set('obs-keep', r.keepPct.toFixed(1) + '% keep rate');
    var kept = r.monthly * (r.keepPct / 100);
    donut('obs-donut', [[kept, LIME], [Math.max(0, r.monthly - kept), ROSE]],
      r.keepPct.toFixed(1) + '%');
  }

  function renderPool() {
    var o = {
      rps: num('pool-rps', 10000), p99ms: num('pool-lat', 45),
      safety: num('pool-safety', 1.5), pods: num('pool-pods', 40)
    };
    var r = Calcs.poolSize(o);
    set('pool-conc', big(r.conc, 0) + ' concurrent');
    set('pool-total', big(r.pool, 0));
    set('pool-perpod', big(r.perPod, 0) + ' / pod');
    donut('pool-donut', [[r.conc, CYAN], [Math.max(0, r.pool - r.conc), LIME]],
      pct(r.conc, r.pool));
  }

  function renderDowntime() {
    var r = Calcs.downtimeCost({
      rev: num('dt-rev', 4000000), mins: num('dt-mins', 240),
      bill: num('dt-bill', 320000), creditPct: num('dt-credit', 25)
    });
    set('dt-loss', money(r.loss, 0) + ' lost');
    set('dt-sla', money(r.credit, 0) + ' credit');
    set('dt-total', money(r.total, 0));
    donut('dt-donut', [[r.loss, ROSE], [r.credit, CYAN]], pct(r.loss, r.total));
  }

  function renderAll() {
    renderToken();
    renderRps();
    renderCompaction();
    renderRetry();
    renderErrorBudget();
    renderHpa();
    renderObs();
    renderPool();
    renderDowntime();
  }

  if (typeof window !== 'undefined') {
    window.Calcs = Calcs;
    if (document.getElementById('tk-perturn')) {
      bind(['tk-in', 'tk-cache', 'tk-cachep', 'tk-freshp', 'tk-out', 'tk-outp', 'tk-turns'], renderToken);
      bind(['rps-rps', 'rps-price', 'rps-fixed'], renderRps);
      bind(['cx-win', 'cx-surv', 'cx-steps', 'cx-stepc'], renderCompaction);
      bind(['rt-tasks', 'rt-retries', 'rt-cost'], renderRetry);
      bind(['eb-slo', 'eb-used', 'eb-burn'], renderErrorBudget);
      bind(['hpa-rep', 'hpa-util', 'hpa-target', 'hpa-max'], renderHpa);
      bind(['obs-rps', 'obs-bytes', 'obs-price', 'obs-budget'], renderObs);
      bind(['pool-rps', 'pool-lat', 'pool-safety', 'pool-pods'], renderPool);
      bind(['dt-rev', 'dt-mins', 'dt-bill', 'dt-credit'], renderDowntime);
      renderAll();
    }
    /* Preset pills: data-set="id:value;id:value" sets inputs and re-renders. */
    Array.prototype.forEach.call(document.querySelectorAll('[data-set]'), function (b) {
      b.addEventListener('click', function () {
        var group = b.parentElement;
        if (group) Array.prototype.forEach.call(
          group.querySelectorAll('.radar-filter'),
          function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        b.getAttribute('data-set').split(';').forEach(function (pair) {
          var kv = pair.split(':'), el = document.getElementById(kv[0]);
          if (el && kv.length === 2) el.value = kv[1];
        });
        renderAll();
      });
    });
    /* Reset buttons: data-reset="section-id" empties that card's inputs
       and returns its result, mix headline and chart to the idle state. */
    Array.prototype.forEach.call(document.querySelectorAll('[data-reset]'), function (b) {
      b.addEventListener('click', function () {
        var sec = document.getElementById(b.getAttribute('data-reset'));
        if (!sec) return;
        Array.prototype.forEach.call(sec.querySelectorAll('input'),
          function (el) { el.value = ''; });
        Array.prototype.forEach.call(sec.querySelectorAll('.radar-filter'),
          function (x) { x.classList.remove('active'); });
        Array.prototype.forEach.call(
          sec.querySelectorAll('.calc-result-value, .radar-trend-value'),
          function (el) { el.textContent = '-'; });
        Array.prototype.forEach.call(sec.querySelectorAll('.calc-donut'),
          function (el) { el.style.background = ''; });
        var mix = sec.querySelector('.calc-donut-center span');
        if (mix) mix.textContent = '-';
      });
    });
    var tabBtns = (typeof document !== 'undefined' && document.querySelectorAll) ?
      Array.prototype.slice.call(document.querySelectorAll('.calc-tab')) : [];
    var PANELS = ['token-bill', 'rps-bill', 'compaction', 'retry-storm', 'error-budget', 'hpa-size', 'obs-sample', 'pool-size', 'downtime-cost'];
    function showPanel(id, push) {
      PANELS.forEach(function (pid) {
        var sec = document.getElementById(pid);
        if (sec) sec.hidden = (pid !== id);
      });
      tabBtns.forEach(function (b) {
        b.setAttribute('aria-selected', b.getAttribute('data-target') === id ? 'true' : 'false');
      });
      if (push !== false) {
        try {
          if (history.replaceState) history.replaceState(null, '', '#' + id);
          else location.hash = id;
        } catch (e) { /* file protocol */ }
      }
    }
    function panelFromHash() {
      var h = String(location.hash || '').replace('#', '');
      return PANELS.indexOf(h) !== -1 ? h : null;
    }
    if (tabBtns.length) {
      tabBtns.forEach(function (b) {
        b.addEventListener('click', function () { showPanel(b.getAttribute('data-target')); });
      });
      showPanel(panelFromHash() || 'token-bill', false);
      window.addEventListener('hashchange', function () {
        var id = panelFromHash();
        if (id) showPanel(id, false);
      });
    }
  }
})();
