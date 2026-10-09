/* Copyright (c) 2026 Buildopsy. All rights reserved. No license to reuse or
 * redistribute this source is granted.
 *
 * Engineering calculators: the math behind the postmortems, runnable locally.
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
    var d = digits == null ? 2 : digits;
    var s = Math.abs(x).toLocaleString('en-US', {
      minimumFractionDigits: d, maximumFractionDigits: d
    });
    return (x < 0 ? '-$' : '$') + s;
  }

  function big(x, digits) {
    if (!isFinite(x)) return '—';
    return x.toLocaleString('en-US', {
      minimumFractionDigits: digits || 0,
      maximumFractionDigits: digits || 0
    });
  }

  /* Input guards. Type="number" accepts anything, so bounded percentages are
     clamped and counts/rates are made non-negative before arithmetic. */
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function nonneg(v) {
    return (isFinite(v) && v > 0) ? v : 0;
  }

  var Calcs = {
    /* One agent turn priced from context mix. Matches the Cursor teardown:
       80k in (87.5% cached at $0.30/M, rest fresh at $3/M) + 1.5k out at
       $15/M lands at $0.0735, shown as ~$0.074. */
    tokenTurn: function (o) {
      var hit = clamp(o.cachePct, 0, 100) / 100;
      var inputTokens = nonneg(o.inTokens);
      var outputTokens = nonneg(o.outTokens);
      var cached = inputTokens * hit / 1e6 * nonneg(o.cachePrice);
      var fresh = inputTokens * (1 - hit) / 1e6 * nonneg(o.freshPrice);
      var out = outputTokens / 1e6 * nonneg(o.outPrice);
      var perTurn = cached + fresh + out;
      return {
        cached: cached, fresh: fresh, out: out, perTurn: perTurn,
        monthly: perTurn * nonneg(o.turns)
      };
    },
    /* Monthly envelope from edge rate. Simplified from the Replit/Vercel
       1M-event models: events per second x seconds per month x blended
       price per event, plus fixed platform spend. */
    rpsBill: function (o) {
      var rps = nonneg(o.rps);
      var variable = rps * 2592000 * (nonneg(o.pricePerM) / 1e6);
      var fixed = nonneg(o.fixedK) * 1000;
      var monthly = variable + fixed;
      return {
        monthly: monthly, daily: monthly / 30,
        variable: variable, fixed: fixed,
        perRequest: rps > 0 ? monthly / (rps * 2592000) : 0
      };
    },
    /* Compaction survival. Defaults mirror the measured median: a 575k
       window compacted to ~4.3k (0.75%), followed by ~28 re-read steps. */
    compaction: function (o) {
      var surv = clamp(o.survPct, 0, 100) / 100;
      var summary = nonneg(o.windowTk) * surv;
      return { summary: summary, lostPct: 100 - surv * 100, rereadBill: nonneg(o.steps) * nonneg(o.stepCost) };
    },
    /* Retry-storm waste. Failed attempts rebilled per task, per day. */
    retryStorm: function (o) {
      var daily = nonneg(o.tasksDay) * nonneg(o.retries) * nonneg(o.attemptCost);
      return { daily: daily, monthly: daily * 30 };
    },
    /* Error budget from SLO. A 30-day month has 43200 minutes; the budget
       is the unavailability fraction of that. Burn multiple expresses the
       current error rate as a multiple of the budgeted rate. */
    errorBudget: function (o) {
      var budget = (100 - clamp(o.slo, 0, 100)) / 100 * 43200;
      var left = budget - nonneg(o.consumed);
      var dailyBurn = nonneg(o.burn) * (budget / 30);
      var daysLeft = left <= 0 ? 0 : (dailyBurn > 0 ? left / dailyBurn : Infinity);
      return { budget: budget, left: left, daysLeft: daysLeft, exhausted: left <= 0 };
    },
    /* Basic Kubernetes HPA CPU recommendation. Apply min/max replicas around
       ceil(current replicas x current utilization / target utilization). */
    hpa: function (o) {
      var rep = Math.floor(nonneg(o.rep));
      var min = Math.max(1, Math.floor(nonneg(o.minReplicas == null ? 1 : o.minReplicas)));
      var max = Math.max(min, Math.floor(nonneg(o.max)));
      var target = nonneg(o.target);
      var raw = (target > 0 && rep > 0) ? Math.ceil(rep * (nonneg(o.util) / target)) : rep;
      var desired = Math.min(max, Math.max(min, raw));
      return {
        desired: desired, delta: desired - rep, capped: raw > max,
        min: min, max: max
      };
    },
    /* Observability sampling fit. Daily ingest equals spans per second
       times bytes per span times 86400 seconds, converted to gigabytes.
       Keep rate is the budget share of the unsampled monthly cost. */
    obsSample: function (o) {
      var gbDay = nonneg(o.rps) * nonneg(o.bytes) * 86400 / 1e9;
      var monthly = gbDay * 30 * nonneg(o.priceGB);
      var budget = nonneg(o.budget);
      var keepPct = monthly > 0 ? Math.min(100, (budget / monthly) * 100) : 100;
      return { gbDay: gbDay, monthly: monthly, keepPct: keepPct };
    },
    /* Conservative pool-sizing heuristic: peak RPS times p99 latency in
       seconds approximates concurrent work (formal Little's Law uses mean
       time in system). Add a safety factor, then spread across pods. */
    poolSize: function (o) {
      var conc = nonneg(o.rps) * (nonneg(o.p99ms) / 1000);
      var pool = Math.ceil(conc * nonneg(o.safety));
      var pods = Math.floor(nonneg(o.pods));
      var perPod = pods > 0 ? Math.ceil(pool / pods) : NaN;
      return { conc: conc, pool: pool, perPod: perPod };
    },
    /* Downtime cost. Revenue loss equals revenue per minute over a
       43800-minute month times minutes down; SLA credit is a percent
       of the monthly cloud bill. */
    downtimeCost: function (o) {
      var loss = (nonneg(o.rev) / 43800) * nonneg(o.mins);
      var credit = nonneg(o.bill) * (nonneg(o.creditPct) / 100);
      return { loss: loss, credit: credit, total: loss + credit };
    },
    /* S3 storage bill. Storage GB-month plus request fees priced per
       thousand plus retrieval GB. Defaults: 1 TiB (1,024 billable GB)
       Standard, 1M PUTs, 10M GETs, no retrieval. */
    s3Cost: function (o) {
      var storage = nonneg(o.gb) * nonneg(o.price);
      var requests = nonneg(o.puts) / 1000 * nonneg(o.putPrice) +
        nonneg(o.gets) / 1000 * nonneg(o.getPrice);
      var retrieval = nonneg(o.retGb) * nonneg(o.retPrice);
      var monthly = storage + requests + retrieval;
      return {
        storage: storage, requests: requests, retrieval: retrieval,
        monthly: monthly, perGb: nonneg(o.gb) > 0 ? monthly / nonneg(o.gb) : NaN
      };
    },
    /* Cloud egress bill. Billable gigabytes above the free allowance,
       times the price per gigabyte. */
    egressCost: function (o) {
      var billable = Math.max(0, nonneg(o.gb) - nonneg(o.free));
      var monthly = billable * nonneg(o.price);
      return { billable: billable, monthly: monthly, daily: monthly / 30 };
    },
    /* EC2 instance usage is billed while running, even when CPU-idle. The
       running percentage models powered-on time; discount is an editable
       effective-rate scenario, not a Reserved Instance/Savings Plan quote. */
    computeCost: function (o) {
      var onDemand = Math.floor(nonneg(o.count)) * nonneg(o.hr) *
        nonneg(o.hours) * (clamp(o.runningPct, 0, 100) / 100);
      var monthly = onDemand * (1 - clamp(o.disc, 0, 100) / 100);
      return { onDemand: onDemand, monthly: monthly, savings: onDemand - monthly };
    },
    /* Kubernetes cluster bill. Worker nodes plus control plane plus
       persistent volume storage. */
    k8sCost: function (o) {
      var compute = Math.floor(nonneg(o.nodes)) * nonneg(o.node);
      var control = nonneg(o.cp);
      var storage = nonneg(o.pv) * nonneg(o.pvPrice);
      return {
        compute: compute, control: control, storage: storage,
        monthly: compute + control + storage
      };
    },
    /* Data warehouse bill. Compute credits times credit price plus stored
       terabytes times storage price. */
    warehouseCost: function (o) {
      var compute = nonneg(o.credits) * nonneg(o.creditPrice);
      var storage = nonneg(o.tb) * nonneg(o.tbPrice);
      return { compute: compute, storage: storage, monthly: compute + storage };
    },
    /* Managed Postgres bill. Instances times hourly price times hours
       plus provisioned storage plus backup storage. */
    rdsCost: function (o) {
      var instance = Math.floor(nonneg(o.count)) * nonneg(o.hr) * nonneg(o.hours);
      var storage = nonneg(o.storageGb) * nonneg(o.storagePrice);
      var backup = nonneg(o.backupGb) * nonneg(o.backupPrice);
      return {
        instance: instance, storage: storage, backup: backup,
        monthly: instance + storage + backup
      };
    },
    /* Serverless bill. Requests in millions times the price per million
       plus gigabytes-seconds above the monthly free grant. */
    lambdaCost: function (o) {
      var reqM = nonneg(o.reqM);
      var freeReqM = nonneg(o.freeReqM == null ? 1 : o.freeReqM);
      var billableReqM = Math.max(0, reqM - freeReqM);
      var reqCost = billableReqM * nonneg(o.reqPrice);
      var billedMs = reqM > 0 ? Math.max(1, nonneg(o.ms)) : 0;
      var gbs = reqM * 1e6 * (billedMs / 1000) * (nonneg(o.mem) / 1024);
      var billableGbs = Math.max(0, gbs - nonneg(o.freeGbSeconds == null ? 400000 : o.freeGbSeconds));
      var compute = billableGbs * nonneg(o.gbsPrice);
      return {
        reqCost: reqCost, compute: compute, gbs: gbs,
        billableReqM: billableReqM, billableGbs: billableGbs,
        monthly: reqCost + compute
      };
    },
    /* CDN bill. Bandwidth gigabytes times price plus requests priced per
       ten thousand. */
    cdnCost: function (o) {
      var bandwidth = nonneg(o.gb) * nonneg(o.gbPrice);
      var requests = nonneg(o.reqM) * 1e6 / 10000 * nonneg(o.reqPrice);
      return { bandwidth: bandwidth, requests: requests, monthly: bandwidth + requests };
    },
    /* Observability bill. Hosts times per-host price plus log ingest
       gigabytes times price per gigabyte. */
    observabilityCost: function (o) {
      var hosts = nonneg(o.hosts) * nonneg(o.hostPrice);
      var logs = nonneg(o.logGb) * nonneg(o.logPrice);
      return { hosts: hosts, logs: logs, monthly: hosts + logs };
    },
    /* Vector database bill. Raw vector bytes with index overhead become
       stored gigabytes, plus a fixed serving pod fleet. */
    vectorCost: function (o) {
      var rawGb = nonneg(o.millions) * 1e6 * nonneg(o.dim) * 4 / 1e9;
      var storageGb = rawGb * nonneg(o.overhead);
      var storage = storageGb * nonneg(o.storagePrice);
      var compute = Math.floor(nonneg(o.pods)) * nonneg(o.podPrice);
      return {
        storageGb: storageGb, storage: storage, compute: compute,
        monthly: compute + storage
      };
    },
    /* Queue buildup during a burst, then time to drain with the post-burst
       arrival rate. Rates are messages/second and duration is in minutes. */
    queueBacklog: function (o) {
      var burstExcess = Math.max(0, nonneg(o.peakRate) - nonneg(o.serviceRate));
      var backlog = Math.ceil(burstExcess * nonneg(o.durationMin) * 60);
      var drainRate = nonneg(o.serviceRate) - nonneg(o.steadyRate);
      return {
        backlog: backlog, drainRate: drainRate,
        drainSeconds: backlog === 0 ? 0 : (drainRate > 0 ? backlog / drainRate : Infinity)
      };
    },
    /* Cache economics: origin spend avoided at the hit rate, less the
       separately supplied monthly cache cost. Rates are per million reads. */
    cacheSavings: function (o) {
      var origin = nonneg(o.requestsM) * nonneg(o.originPriceM);
      var hit = clamp(o.hitPct, 0, 100) / 100;
      var avoided = origin * hit;
      return {
        origin: origin, avoided: avoided,
        netSavings: avoided - nonneg(o.cacheMonthly),
        breakEvenHitPct: origin > 0 ? nonneg(o.cacheMonthly) / origin * 100 : Infinity
      };
    },
    /* Linear net-growth forecast; storage charges are a simple GB-month
       estimate at the projected end size, not a time-weighted billing model. */
    storageForecast: function (o) {
      var current = nonneg(o.currentGb);
      var growth = nonneg(o.growthGbDay) * nonneg(o.days);
      var projected = current + growth;
      var price = nonneg(o.priceGbMonth);
      return {
        growth: growth, projected: projected,
        currentMonthly: current * price, projectedMonthly: projected * price
      };
    },
    /* Partition planning using a user-supplied tested throughput per
       partition, desired utilization ceiling, and consumer parallelism floor. */
    kafkaPartitions: function (o) {
      var peak = nonneg(o.peakMBps);
      var perPartition = nonneg(o.partitionMBps);
      var utilization = clamp(o.utilizationPct, 1, 100) / 100;
      var throughputPartitions = perPartition > 0 ?
        Math.ceil(peak / (perPartition * utilization)) : (peak > 0 ? Infinity : 1);
      var consumers = Math.max(1, Math.floor(nonneg(o.consumers)));
      var partitions = Math.max(1, throughputPartitions, consumers);
      var maxCapacity = isFinite(partitions) ? partitions * perPartition : 0;
      return {
        partitions: partitions,
        replicaCopies: isFinite(partitions) ? partitions * Math.max(1, Math.floor(nonneg(o.replicationFactor))) : Infinity,
        maxCapacity: maxCapacity,
        utilizationPct: maxCapacity > 0 ? peak / maxCapacity * 100 : (peak > 0 ? NaN : 0)
      };
    },
    /* Lag clears only when replica apply throughput exceeds ongoing writes.
       Uses decimal GB (1 GB = 1,000 MB) and assumes constant rates. */
    replicaCatchup: function (o) {
      var lagMb = nonneg(o.lagGb) * 1000;
      var netMbPerSecond = nonneg(o.applyMBps) - nonneg(o.writeMBps);
      return {
        netMBps: netMbPerSecond,
        seconds: lagMb === 0 ? 0 : (netMbPerSecond > 0 ? lagMb / netMbPerSecond : Infinity)
      };
    },
    /* Fluid token-bucket estimate for constant demand starting with a full
       bucket. It models one token cost per request (configurable). */
    tokenBucket: function (o) {
      var capacity = nonneg(o.capacity);
      var refill = nonneg(o.refillPerSec);
      var cost = nonneg(o.tokensPerRequest);
      var requestsPerSec = nonneg(o.requestsPerSec);
      var duration = nonneg(o.durationSec);
      var offered = Math.floor(requestsPerSec * duration);
      var availableTokens = capacity + refill * duration;
      var admitted = cost > 0 ? Math.min(offered, Math.floor(availableTokens / cost)) : offered;
      return {
        sustainableRps: cost > 0 ? refill / cost : Infinity,
        burstRequests: cost > 0 ? capacity / cost : Infinity,
        offered: offered, admitted: admitted, rejected: Math.max(0, offered - admitted)
      };
    },
    /* Simple retained-object estimate: full snapshots at the configured
       cadence plus one daily incremental object throughout the retention. */
    backupRetention: function (o) {
      var days = Math.floor(nonneg(o.retentionDays));
      var interval = Math.max(1, Math.floor(nonneg(o.fullEveryDays)));
      var fullCopies = days > 0 ? Math.ceil(days / interval) : 0;
      var fullGb = fullCopies * nonneg(o.fullGb);
      var incrementalGb = days * nonneg(o.incrementalGbDay);
      var totalGb = fullGb + incrementalGb;
      return {
        fullCopies: fullCopies, fullGb: fullGb, incrementalGb: incrementalGb,
        totalGb: totalGb, monthlyCost: totalGb * nonneg(o.priceGbMonth)
      };
    },
    /* Minimum load-balancer target count for a configured per-target tested
       rate and maximum operating-utilization ceiling. */
    targetCapacity: function (o) {
      var peak = nonneg(o.peakRps);
      var perTarget = nonneg(o.targetRps);
      var utilization = clamp(o.utilizationPct, 1, 100) / 100;
      var required = perTarget > 0 ? Math.ceil(peak / (perTarget * utilization)) :
        (peak > 0 ? Infinity : 1);
      var targets = Math.max(Math.max(1, Math.floor(nonneg(o.minimum))), required);
      var safeCapacity = isFinite(targets) ? targets * perTarget * utilization : 0;
      return {
        targets: targets, safeCapacity: safeCapacity,
        headroom: Math.max(0, safeCapacity - peak)
      };
    },
    /* Availability of a majority quorum when each replica has the same
       independent availability. Correlated failures are intentionally absent. */
    quorumAvailability: function (o) {
      var replicas = Math.max(1, Math.min(25, Math.floor(nonneg(o.replicas))));
      var availability = clamp(o.nodeAvailabilityPct, 0, 100) / 100;
      var quorum = Math.floor(replicas / 2) + 1;
      var probability = 0;
      for (var k = quorum; k <= replicas; k++) {
        var combination = 1;
        for (var i = 1; i <= k; i++) combination = combination * (replicas - i + 1) / i;
        probability += combination * Math.pow(availability, k) *
          Math.pow(1 - availability, replicas - k);
      }
      return {
        replicas: replicas, quorum: quorum,
        availabilityPct: probability * 100,
        unavailabilityPct: (1 - probability) * 100
      };
    },
    /* Compare pay-as-you-go spend for utilized hours with a fixed hourly
       commitment that is paid for every hour in the month. */
    commitmentBreakEven: function (o) {
      var hours = nonneg(o.hours);
      var onDemandRate = nonneg(o.onDemandRate);
      var commitRate = nonneg(o.commitRate);
      var utilization = clamp(o.utilizationPct, 0, 100) / 100;
      var paygo = hours * onDemandRate * utilization;
      var commitment = hours * commitRate;
      return {
        paygo: paygo, commitment: commitment, savings: paygo - commitment,
        breakEvenUtilizationPct: onDemandRate > 0 ? commitRate / onDemandRate * 100 : Infinity
      };
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
    set('tk-perturn', money(r.perTurn, 4) + ' / turn');
    set('tk-monthly', money(r.monthly, 0));
    donut('tk-donut', [[r.cached, LIME], [r.fresh, CYAN], [r.out, ROSE]],
      pct(r.cached, r.perTurn));
  }

  function renderRps() {
    var o = {
      rps: num('rps-rps', 1000000), pricePerM: num('rps-price', 1.8),
      fixedK: num('rps-fixed', 2600)
    };
    var r = Calcs.rpsBill(o);
    set('rps-monthly', money(r.monthly, 0));
    set('rps-daily', money(r.daily, 0) + ' / day');
    set('rps-perreq', money(r.perRequest, 8) + ' / request');
    donut('rps-donut', [[r.variable, CYAN], [r.fixed, LIME]], pct(r.variable, r.monthly));
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
    var surv = clamp(o.survPct, 0, 100);
    donut('cx-donut', [[r.summary, LIME], [Math.max(0, nonneg(o.windowTk) - r.summary), ROSE]],
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
    var waste = nonneg(o.retries);
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
    set('eb-days', r.exhausted ? 'EXHAUSTED' :
      (isFinite(r.daysLeft) ? r.daysLeft.toFixed(1) : '∞'));
    donut('eb-donut', [[Math.max(0, r.left), LIME], [Math.min(nonneg(o.consumed), r.budget), ROSE]],
      pct(Math.max(0, r.left), r.budget));
  }

  function renderHpa() {
    var o = {
      rep: num('hpa-rep', 8), util: num('hpa-util', 72),
      target: num('hpa-target', 60), minReplicas: num('hpa-min', 1),
      max: num('hpa-max', 20)
    };
    var r = Calcs.hpa(o);
    set('hpa-desired', big(r.desired, 0));
    set('hpa-delta', r.delta > 0 ? '+' + r.delta + ' to add' :
      (r.delta < 0 ? r.delta + ' to remove' : 'no change'));
    set('hpa-cap', r.capped ? 'CAPPED, raise max' :
      'within ' + r.min + '-' + r.max + ' bounds');
    var swing = Math.abs(r.delta);
    donut('hpa-donut', [[o.rep, CYAN], [swing, r.delta >= 0 ? LIME : ROSE]],
      big(o.rep, 0));
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

  function renderS3() {
    var o = {
      gb: num('s3-gb', 1024), price: num('s3-price', 0.023),
      puts: num('s3-put', 1000000), putPrice: num('s3-putp', 0.005),
      gets: num('s3-get', 10000000), getPrice: num('s3-getp', 0.0004),
      retGb: num('s3-ret', 0), retPrice: num('s3-retp', 0)
    };
    var r = Calcs.s3Cost(o);
    set('s3-monthly', money(r.monthly, 2));
    set('s3-storage', money(r.storage, 2) + ' storage');
    set('s3-requests', money(r.requests, 2) + ' requests');
    set('s3-pergb', money(r.perGb, 4) + ' / GB');
    donut('s3-donut', [[r.storage, LIME], [r.requests, CYAN], [r.retrieval, ROSE]],
      pct(r.storage, r.monthly));
  }

  function renderEgress() {
    var o = {
      gb: num('eg-gb', 10000), price: num('eg-price', 0.09),
      free: num('eg-free', 100)
    };
    var r = Calcs.egressCost(o);
    set('eg-monthly', money(r.monthly, 0));
    set('eg-billable', big(r.billable, 0) + ' GB billed');
    set('eg-daily', money(r.daily, 0) + ' / day');
    donut('eg-donut', [[r.billable, CYAN], [nonneg(o.free), LIME]],
      pct(r.billable, r.billable + nonneg(o.free)));
  }

  function renderCompute() {
    var o = {
      count: num('ec2-count', 10), hr: num('ec2-hr', 0.096),
      hours: num('ec2-hours', 730), runningPct: num('ec2-running', 100),
      disc: num('ec2-disc', 0)
    };
    var r = Calcs.computeCost(o);
    set('ec2-monthly', money(r.monthly, 0));
    set('ec2-ondemand', money(r.onDemand, 0) + ' before discount');
    set('ec2-savings', money(r.savings, 0) + ' saved');
    donut('ec2-donut', [[r.monthly, CYAN], [r.savings, LIME]],
      pct(r.monthly, r.onDemand));
  }

  function renderK8s() {
    var o = {
      nodes: num('k8s-nodes', 6), node: num('k8s-node', 140),
      cp: num('k8s-cp', 73), pv: num('k8s-pv', 500),
      pvPrice: num('k8s-pvp', 0.10)
    };
    var r = Calcs.k8sCost(o);
    set('k8s-monthly', money(r.monthly, 0));
    set('k8s-compute', money(r.compute, 0) + ' nodes');
    set('k8s-storage', money(r.storage, 0) + ' storage');
    donut('k8s-donut', [[r.compute, CYAN], [r.control, ROSE], [r.storage, LIME]],
      pct(r.compute, r.monthly));
  }

  function renderWarehouse() {
    var o = {
      credits: num('dw-credits', 2000), creditPrice: num('dw-creditp', 3),
      tb: num('dw-tb', 10), tbPrice: num('dw-tbp', 23)
    };
    var r = Calcs.warehouseCost(o);
    set('dw-monthly', money(r.monthly, 0));
    set('dw-compute', money(r.compute, 0) + ' compute');
    set('dw-storage', money(r.storage, 0) + ' storage');
    donut('dw-donut', [[r.compute, CYAN], [r.storage, LIME]], pct(r.compute, r.monthly));
  }

  function renderRds() {
    var o = {
      count: num('rds-count', 2), hr: num('rds-hr', 0.178),
      hours: num('rds-hours', 730), storageGb: num('rds-storage', 100),
      storagePrice: num('rds-storagep', 0.115), backupGb: num('rds-backup', 50),
      backupPrice: num('rds-backupp', 0.095)
    };
    var r = Calcs.rdsCost(o);
    set('rds-monthly', money(r.monthly, 0));
    set('rds-instance', money(r.instance, 2) + ' instances');
    set('rds-storagecost', money(r.storage + r.backup, 2) + ' storage');
    donut('rds-donut', [[r.instance, CYAN], [r.storage, LIME], [r.backup, ROSE]],
      pct(r.instance, r.monthly));
  }

  function renderLambda() {
    var o = {
      reqM: num('lm-req', 100), ms: num('lm-dur', 200), mem: num('lm-mem', 512),
      reqPrice: num('lm-reqp', 0.20), gbsPrice: num('lm-gbs', 0.0000166667),
      freeReqM: num('lm-free-req', 1), freeGbSeconds: num('lm-free-gbs', 400000)
    };
    var r = Calcs.lambdaCost(o);
    set('lm-monthly', money(r.monthly, 0));
    set('lm-reqcost', money(r.reqCost, 2) + ' requests');
    set('lm-computecost', money(r.compute, 2) + ' compute');
    donut('lm-donut', [[r.compute, CYAN], [r.reqCost, LIME]], pct(r.compute, r.monthly));
  }

  function renderCdn() {
    var o = {
      gb: num('cdn-gb', 10000), gbPrice: num('cdn-gbp', 0.085),
      reqM: num('cdn-req', 100), reqPrice: num('cdn-reqp', 0.0075)
    };
    var r = Calcs.cdnCost(o);
    set('cdn-monthly', money(r.monthly, 0));
    set('cdn-bandwidth', money(r.bandwidth, 0) + ' bandwidth');
    set('cdn-requests', money(r.requests, 0) + ' requests');
    donut('cdn-donut', [[r.bandwidth, CYAN], [r.requests, LIME]], pct(r.bandwidth, r.monthly));
  }

  function renderObservability() {
    var o = {
      hosts: num('ob-hosts', 20), hostPrice: num('ob-hostp', 23),
      logGb: num('ob-loggb', 1000), logPrice: num('ob-loggbp', 0.10)
    };
    var r = Calcs.observabilityCost(o);
    set('ob-monthly', money(r.monthly, 0));
    set('ob-hostcost', money(r.hosts, 0) + ' hosts');
    set('ob-logcost', money(r.logs, 0) + ' logs');
    donut('ob-donut', [[r.hosts, CYAN], [r.logs, LIME]], pct(r.hosts, r.monthly));
  }

  function renderVector() {
    var o = {
      millions: num('vec-count', 10), dim: num('vec-dim', 1536),
      overhead: num('vec-overhead', 2), storagePrice: num('vec-storagep', 0.115),
      pods: num('vec-pods', 3), podPrice: num('vec-podp', 70)
    };
    var r = Calcs.vectorCost(o);
    set('vec-monthly', money(r.monthly, 0));
    set('vec-storagegb', big(r.storageGb, 1) + ' GB stored');
    set('vec-compute', money(r.compute, 0) + ' pods');
    donut('vec-donut', [[r.compute, CYAN], [r.storage, LIME]], pct(r.compute, r.monthly));
  }

  function renderQueue() {
    var r = Calcs.queueBacklog({
      peakRate: num('qb-peak', 1500), serviceRate: num('qb-service', 1000),
      durationMin: num('qb-duration', 10), steadyRate: num('qb-steady', 500)
    });
    set('qb-backlog', big(r.backlog, 0) + ' messages');
    set('qb-excess', big(r.drainRate, 0) + ' messages / second');
    set('qb-drain', isFinite(r.drainSeconds) ? big(r.drainSeconds / 60, 1) + ' minutes' : 'Cannot drain at these rates');
  }

  function renderCache() {
    var r = Calcs.cacheSavings({
      requestsM: num('cache-requests', 100), hitPct: num('cache-hit', 80),
      originPriceM: num('cache-origin-price', 0.5), cacheMonthly: num('cache-monthly', 20000)
    });
    set('cache-avoided', money(r.avoided, 0));
    set('cache-net', money(r.netSavings, 0));
    set('cache-breakeven', isFinite(r.breakEvenHitPct) ? r.breakEvenHitPct.toFixed(1) + '% hit rate' : '—');
  }

  function renderStorageForecast() {
    var r = Calcs.storageForecast({
      currentGb: num('sf-current', 5000), growthGbDay: num('sf-growth', 25),
      days: num('sf-days', 365), priceGbMonth: num('sf-price', 0.10)
    });
    set('sf-growth-total', big(r.growth, 0) + ' GB added');
    set('sf-projected', big(r.projected, 0) + ' GB');
    set('sf-monthly', money(r.projectedMonthly, 0) + ' / month');
    set('sf-current-cost', money(r.currentMonthly, 0) + ' / month today');
  }

  function renderKafka() {
    var r = Calcs.kafkaPartitions({
      peakMBps: num('kp-peak', 80), partitionMBps: num('kp-partition', 10),
      utilizationPct: num('kp-utilization', 70), consumers: num('kp-consumers', 12),
      replicationFactor: num('kp-replication', 3)
    });
    set('kp-partitions', isFinite(r.partitions) ? big(r.partitions, 0) : 'No finite count: add throughput');
    set('kp-replicas', isFinite(r.replicaCopies) ? big(r.replicaCopies, 0) + ' partition copies' : 'Set per-partition throughput');
    set('kp-capacity', big(r.maxCapacity, 1) + ' MB/s aggregate');
    set('kp-utilization-result', isFinite(r.utilizationPct) ? r.utilizationPct.toFixed(1) + '% of tested capacity' : 'Set nonzero tested throughput');
  }

  function renderReplicaCatchup() {
    var r = Calcs.replicaCatchup({
      lagGb: num('rc-lag', 120), writeMBps: num('rc-write', 40), applyMBps: num('rc-apply', 100)
    });
    set('rc-net', big(r.netMBps, 1) + ' MB/s net catch-up');
    set('rc-time', isFinite(r.seconds) ? big(r.seconds / 3600, 2) + ' hours' : 'Lag will not clear');
    set('rc-lag-size', big(num('rc-lag', 120), 1) + ' GB outstanding');
  }

  function renderTokenBucket() {
    var r = Calcs.tokenBucket({
      capacity: num('tb-capacity', 1000), refillPerSec: num('tb-refill', 100),
      tokensPerRequest: num('tb-cost', 1), requestsPerSec: num('tb-rps', 250),
      durationSec: num('tb-duration', 10)
    });
    set('tb-sustainable', isFinite(r.sustainableRps) ? big(r.sustainableRps, 1) + ' requests / second' : 'Unbounded at zero token cost');
    set('tb-burst', isFinite(r.burstRequests) ? big(r.burstRequests, 0) + ' requests from a full bucket' : 'Unbounded at zero token cost');
    set('tb-admitted', big(r.admitted, 0) + ' requests');
    set('tb-rejected', big(r.rejected, 0) + ' requests');
  }

  function renderBackupRetention() {
    var r = Calcs.backupRetention({
      fullGb: num('br-full', 500), incrementalGbDay: num('br-incremental', 12),
      retentionDays: num('br-days', 30), fullEveryDays: num('br-interval', 7),
      priceGbMonth: num('br-price', 0.02)
    });
    set('br-full-total', big(r.fullGb, 0) + ' GB across ' + big(r.fullCopies, 0) + ' full copies');
    set('br-incremental-total', big(r.incrementalGb, 0) + ' GB incrementals');
    set('br-total', big(r.totalGb, 0) + ' GB retained');
    set('br-monthly', money(r.monthlyCost, 0) + ' / month');
  }

  function renderTargetCapacity() {
    var r = Calcs.targetCapacity({
      peakRps: num('lt-peak', 12000), targetRps: num('lt-target', 1000),
      utilizationPct: num('lt-utilization', 70), minimum: num('lt-minimum', 2)
    });
    set('lt-count', isFinite(r.targets) ? big(r.targets, 0) + ' targets' : 'No finite count: add target capacity');
    set('lt-safe-capacity', isFinite(r.targets) ? big(r.safeCapacity, 0) + ' RPS at target utilization' : 'Set nonzero per-target capacity');
    set('lt-headroom', isFinite(r.targets) ? big(r.headroom, 0) + ' RPS spare' : 'Unable to estimate headroom');
  }

  function renderQuorum() {
    var r = Calcs.quorumAvailability({
      replicas: num('qa-replicas', 3), nodeAvailabilityPct: num('qa-node', 99.9)
    });
    var requestedReplicas = Math.floor(nonneg(num('qa-replicas', 3)));
    set('qa-quorum', big(r.quorum, 0) + ' needed from ' + big(r.replicas, 0) +
      ' replicas' + (requestedReplicas > 25 ? ' (model capped at 25)' : ''));
    set('qa-quorum-detail', 'Need ' + big(r.quorum, 0) + ' available');
    set('qa-availability', r.availabilityPct.toFixed(6) + '%');
    set('qa-unavailability', r.unavailabilityPct.toFixed(6) + '%');
  }

  function renderCommitment() {
    var r = Calcs.commitmentBreakEven({
      hours: num('cb-hours', 730), onDemandRate: num('cb-ondemand', 1),
      commitRate: num('cb-commit', 0.65), utilizationPct: num('cb-utilization', 80)
    });
    set('cb-paygo', money(r.paygo, 2));
    set('cb-cost', money(r.commitment, 2));
    set('cb-savings', money(r.savings, 2));
    set('cb-breakeven', isFinite(r.breakEvenUtilizationPct) ? r.breakEvenUtilizationPct.toFixed(1) + '% utilization' : '—');
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
    renderS3();
    renderEgress();
    renderCompute();
    renderK8s();
    renderWarehouse();
    renderRds();
    renderLambda();
    renderCdn();
    renderObservability();
    renderVector();
    renderQueue();
    renderCache();
    renderStorageForecast();
    renderKafka();
    renderReplicaCatchup();
    renderTokenBucket();
    renderBackupRetention();
    renderTargetCapacity();
    renderQuorum();
    renderCommitment();
  }

  if (typeof window !== 'undefined') {
    window.Calcs = Calcs;
    /* Boot on whichever tool the page carries: the hub hosts all nine, each
       /tools/ page hosts exactly one. Missing ids are skipped by bind/set. */
    var RESULT_IDS = ['tk-perturn', 'rps-monthly', 'cx-summary', 'rt-monthly',
      'eb-budget', 'hpa-desired', 'obs-cost', 'pool-total', 'dt-total',
      's3-monthly', 'eg-monthly', 'ec2-monthly', 'k8s-monthly',
      'dw-monthly', 'rds-monthly', 'lm-monthly', 'cdn-monthly', 'ob-monthly', 'vec-monthly',
      'qb-backlog', 'cache-net', 'sf-projected', 'kp-partitions', 'rc-time', 'tb-admitted',
      'br-total', 'lt-count', 'qa-availability', 'cb-savings'];
    var onToolPage = RESULT_IDS.some(function (id) { return !!document.getElementById(id); });
    if (onToolPage) {
      bind(['tk-in', 'tk-cache', 'tk-cachep', 'tk-freshp', 'tk-out', 'tk-outp', 'tk-turns'], renderToken);
      bind(['rps-rps', 'rps-price', 'rps-fixed'], renderRps);
      bind(['cx-win', 'cx-surv', 'cx-steps', 'cx-stepc'], renderCompaction);
      bind(['rt-tasks', 'rt-retries', 'rt-cost'], renderRetry);
      bind(['eb-slo', 'eb-used', 'eb-burn'], renderErrorBudget);
      bind(['hpa-rep', 'hpa-util', 'hpa-target', 'hpa-min', 'hpa-max'], renderHpa);
      bind(['obs-rps', 'obs-bytes', 'obs-price', 'obs-budget'], renderObs);
      bind(['pool-rps', 'pool-lat', 'pool-safety', 'pool-pods'], renderPool);
      bind(['dt-rev', 'dt-mins', 'dt-bill', 'dt-credit'], renderDowntime);
      bind(['s3-gb', 's3-price', 's3-put', 's3-putp', 's3-get', 's3-getp', 's3-ret', 's3-retp'], renderS3);
      bind(['eg-gb', 'eg-price', 'eg-free'], renderEgress);
      bind(['ec2-count', 'ec2-hr', 'ec2-hours', 'ec2-running', 'ec2-disc'], renderCompute);
      bind(['k8s-nodes', 'k8s-node', 'k8s-cp', 'k8s-pv', 'k8s-pvp'], renderK8s);
      bind(['dw-credits', 'dw-creditp', 'dw-tb', 'dw-tbp'], renderWarehouse);
      bind(['rds-count', 'rds-hr', 'rds-hours', 'rds-storage', 'rds-storagep', 'rds-backup', 'rds-backupp'], renderRds);
      bind(['lm-req', 'lm-dur', 'lm-mem', 'lm-reqp', 'lm-gbs', 'lm-free-req', 'lm-free-gbs'], renderLambda);
      bind(['cdn-gb', 'cdn-gbp', 'cdn-req', 'cdn-reqp'], renderCdn);
      bind(['ob-hosts', 'ob-hostp', 'ob-loggb', 'ob-loggbp'], renderObservability);
      bind(['vec-count', 'vec-dim', 'vec-overhead', 'vec-storagep', 'vec-pods', 'vec-podp'], renderVector);
      bind(['qb-peak', 'qb-service', 'qb-duration', 'qb-steady'], renderQueue);
      bind(['cache-requests', 'cache-hit', 'cache-origin-price', 'cache-monthly'], renderCache);
      bind(['sf-current', 'sf-growth', 'sf-days', 'sf-price'], renderStorageForecast);
      bind(['kp-peak', 'kp-partition', 'kp-utilization', 'kp-consumers', 'kp-replication'], renderKafka);
      bind(['rc-lag', 'rc-write', 'rc-apply'], renderReplicaCatchup);
      bind(['tb-capacity', 'tb-refill', 'tb-cost', 'tb-rps', 'tb-duration'], renderTokenBucket);
      bind(['br-full', 'br-incremental', 'br-days', 'br-interval', 'br-price'], renderBackupRetention);
      bind(['lt-peak', 'lt-target', 'lt-utilization', 'lt-minimum'], renderTargetCapacity);
      bind(['qa-replicas', 'qa-node'], renderQuorum);
      bind(['cb-hours', 'cb-ondemand', 'cb-commit', 'cb-utilization'], renderCommitment);
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

    var directory = document.getElementById('calculator-directory');
    if (directory) {
      var search = document.getElementById('calculatorSearch');
      var status = document.getElementById('calculatorDirectoryStatus');
      var more = document.getElementById('calculatorDirectoryMore');
      var empty = document.getElementById('calculatorDirectoryEmpty');
      var clear = document.getElementById('calculatorDirectoryClear');
      var cards = Array.prototype.slice.call(directory.querySelectorAll('[data-calculator-card]'));
      var featured = Array.prototype.slice.call(
        directory.querySelectorAll('#calculatorDirectoryFeatured [data-calculator-card]'));
      var extra = Array.prototype.slice.call(
        directory.querySelectorAll('.calc-directory-grid-more [data-calculator-card]'));

      function refreshDirectoryStatus() {
        if (!status || (search && search.value.trim())) return;
        status.textContent = more && more.open ?
          'Showing all ' + cards.length + ' calculators.' :
          'Showing ' + featured.length + ' of ' + cards.length + '. Search or expand to see all.';
      }

      function filterDirectory() {
        if (!search) return;
        var query = search.value.trim().toLowerCase();
        if (!query) {
          cards.forEach(function (card) { card.hidden = false; });
          if (more) {
            more.hidden = false;
            more.open = false;
          }
          if (empty) empty.hidden = true;
          refreshDirectoryStatus();
          return;
        }

        var matches = 0;
        var extraMatches = 0;
        cards.forEach(function (card) {
          var haystack = (card.getAttribute('data-search') || '') + ' ' + card.textContent;
          var found = haystack.toLowerCase().indexOf(query) !== -1;
          card.hidden = !found;
          if (found) {
            matches++;
            if (extra.indexOf(card) !== -1) extraMatches++;
          }
        });

        if (more) {
          more.hidden = extraMatches === 0;
          more.open = extraMatches > 0;
        }
        if (empty) empty.hidden = matches > 0;
        if (status) status.textContent = matches + ' of ' + cards.length +
          ' calculators match “' + search.value.trim() + '”.';
      }

      if (search) search.addEventListener('input', filterDirectory);
      if (clear) clear.addEventListener('click', function () {
        if (!search) return;
        search.value = '';
        filterDirectory();
        search.focus();
      });
      if (more) more.addEventListener('toggle', refreshDirectoryStatus);
      filterDirectory();
    }
  }
})();
