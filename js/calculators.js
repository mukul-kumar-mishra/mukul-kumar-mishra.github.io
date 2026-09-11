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

  function bind(ids, fn) {
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', fn);
    });
  }

  function renderToken() {
    var r = Calcs.tokenTurn({
      inTokens: num('tk-in', 80000), cachePct: num('tk-cache', 87.5),
      cachePrice: num('tk-cachep', 0.3), freshPrice: num('tk-freshp', 3),
      outTokens: num('tk-out', 1500), outPrice: num('tk-outp', 15),
      turns: num('tk-turns', 1000000)
    });
    set('tk-perturn', money(r.perTurn, 4) + ' / turn');
    set('tk-monthly', money(r.monthly, 0) + ' / month');
  }

  function renderRps() {
    var r = Calcs.rpsBill({
      rps: num('rps-rps', 1000000), pricePerM: num('rps-price', 1.8),
      fixedK: num('rps-fixed', 2600)
    });
    set('rps-monthly', money(r.monthly, 0) + ' / month');
    set('rps-daily', money(r.daily, 0) + ' / day');
    set('rps-perreq', '$' + (r.perRequest * 100).toFixed(4) + '¢ / request');
  }

  function renderCompaction() {
    var o = {
      windowTk: num('cx-win', 575000), survPct: num('cx-surv', 0.75),
      steps: num('cx-steps', 28), stepCost: num('cx-stepc', 0.074)
    };
    var r = Calcs.compaction(o);
    set('cx-summary', big(r.summary, 0) + ' tokens survive');
    set('cx-lost', r.lostPct.toFixed(2) + '% of context lost');
    set('cx-reread', money(r.rereadBill) + ' to rebuild state');
  }

  function renderRetry() {
    var r = Calcs.retryStorm({
      tasksDay: num('rt-tasks', 10000), retries: num('rt-retries', 2),
      attemptCost: num('rt-cost', 0.05)
    });
    set('rt-daily', money(r.daily, 0) + ' / day');
    set('rt-monthly', money(r.monthly, 0) + ' / month');
  }

  function renderErrorBudget() {
    var r = Calcs.errorBudget({
      slo: num('eb-slo', 99.9), consumed: num('eb-used', 12),
      burn: num('eb-burn', 2)
    });
    set('eb-budget', big(r.budget, 1) + ' min / month');
    set('eb-left', big(r.left, 1) + ' min left');
    set('eb-days', r.daysLeft.toFixed(1) + ' days to exhaustion');
  }

  function renderHpa() {
    var o = {
      rep: num('hpa-rep', 8), util: num('hpa-util', 72),
      target: num('hpa-target', 60), max: num('hpa-max', 20)
    };
    var r = Calcs.hpa(o);
    set('hpa-desired', big(r.desired, 0) + ' replicas');
    set('hpa-delta', (r.delta >= 0 ? '+' : '') + r.delta + ' to add');
    set('hpa-cap', r.capped ? 'CAPPED, raise max' : 'within max ' + o.max);
  }

  function renderObs() {
    var r = Calcs.obsSample({
      rps: num('obs-rps', 50000), bytes: num('obs-bytes', 2048),
      priceGB: num('obs-price', 0.3), budget: num('obs-budget', 20000)
    });
    set('obs-gb', big(r.gbDay, 0) + ' GB / day');
    set('obs-cost', money(r.monthly, 0) + ' / month');
    set('obs-keep', r.keepPct.toFixed(1) + '% keep rate');
  }

  function renderPool() {
    var o = {
      rps: num('pool-rps', 10000), p99ms: num('pool-lat', 45),
      safety: num('pool-safety', 1.5), pods: num('pool-pods', 40)
    };
    var r = Calcs.poolSize(o);
    set('pool-conc', big(r.conc, 0) + ' concurrent');
    set('pool-total', big(r.pool, 0) + ' connections');
    set('pool-perpod', big(r.perPod, 0) + ' / pod');
  }

  function renderDowntime() {
    var r = Calcs.downtimeCost({
      rev: num('dt-rev', 4000000), mins: num('dt-mins', 240),
      bill: num('dt-bill', 320000), creditPct: num('dt-credit', 25)
    });
    set('dt-loss', money(r.loss, 0) + ' lost');
    set('dt-sla', money(r.credit, 0) + ' credit');
    set('dt-total', money(r.total, 0) + ' exposure');
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
