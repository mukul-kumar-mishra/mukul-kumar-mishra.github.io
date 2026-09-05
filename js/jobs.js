/* System Design Jobs feed — no backend.
 * Sources (all free public APIs, fetched live in the browser):
 *   - Remotive remote-jobs API (global, English-first)
 *   - Arbeitnow job-board API pages 1-3 (remote==true only)
 * Every listing links back to its original posting and both providers are
 * credited on the page, which their API terms require. No JobPosting
 * structured data is emitted (Remotive forbids feeding jobs aggregators).
 * Geo-IP (ipwho.is, ipapi.co fallback) runs client-side only to preselect
 * the visitor's country. Nothing is stored. The module boots lazily and
 * renders progressively: Remotive paints first, Arbeitnow merges in when
 * it arrives. Every fetch carries a timeout so one slow host can never
 * stall the board. */
(function () {
  'use strict';

  var API_URL = 'https://remotive.com/api/remote-jobs?limit=100';
  var ARBEITNOW_URL = 'https://www.arbeitnow.com/api/job-board-api?page=';
  var ARBEITNOW_PAGES = [1, 2, 3];
  var REMOTIVE_BOARD = 'https://remotive.com/remote-jobs';
  var ARBEITNOW_BOARD = 'https://www.arbeitnow.com/job-board-api';
  var JOBS_TIMEOUT = 15000;
  var GEO_TIMEOUT = 7000;
  var MAX_AGE_DAYS = 30;
  var RELEVANT_KEYWORDS = ['system design', 'backend', 'software engineer',
    'software developer', 'distributed', 'infrastructure', 'platform', 'sre',
    'site reliability', 'devops', 'architect', 'database', 'data engineer',
    'cloud engineer', 'microservice', 'kubernetes', 'api', 'golang',
    'tech lead', 'engineering manager'];
  var EXCLUDE_WORDS = ['marketing', 'sales', 'copywriter', 'writer',
    'accountant', 'bookkeeping', 'recruiter', 'support', 'assistant'];

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function norm(s) { return String(s || '').toLowerCase(); }

  function fetchJSON(url, ms) {
    var ctrl = null;
    var timer = null;
    try {
      if (typeof AbortController !== 'undefined') {
        ctrl = new AbortController();
        timer = setTimeout(function () {
          try { ctrl.abort(); } catch (e) { /* old browser */ }
        }, ms || 12000);
      }
    } catch (e) { ctrl = null; }
    function done(fn) {
      return function (v) {
        if (timer) clearTimeout(timer);
        return fn(v);
      };
    }
    var opts = ctrl ? { signal: ctrl.signal } : undefined;
    return fetch(url, opts).then(function (res) {
      if (!res.ok) throw new Error('http ' + res.status);
      return res.json();
    }).then(done(function (v) { return v; }), done(function (e) { throw e; }));
  }

  function daysAgo(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return 999;
    return Math.floor((Date.now() - t) / 86400000);
  }

  function ageLabel(d) {
    if (d <= 0) return 'Today';
    if (d === 1) return '1d ago';
    return d + 'd ago';
  }

  function haystack(job) {
    return norm(job.title) + ' ' + norm((job.tags || []).join(' ')) + ' ' + norm(job.company);
  }

  function matchesAny(hay, words) {
    for (var i = 0; i < words.length; i++) {
      if (hay.indexOf(words[i]) !== -1) return true;
    }
    return false;
  }

  function isRelevant(job) {
    var hay = haystack(job);
    if (matchesAny(hay, EXCLUDE_WORDS)) return false;
    return matchesAny(hay, RELEVANT_KEYWORDS);
  }

  function isUniversal(loc) {
    var l = norm(loc).trim();
    if (!l) return true;
    if (/^(remote|homeoffice|weltweit|worldwide|anywhere|global)$/.test(l)) return true;
    return /(worldwide|weltweit|anywhere|multiple countries|various)/.test(l);
  }

  function eligible(loc, country) {
    if (isUniversal(loc)) return true;
    if (!country || !country.code) return true;
    var l = norm(loc);
    var codeRe = new RegExp('\\b' + country.code.toLowerCase().replace(/[^a-z]/g, '') + '\\b');
    if (codeRe.test(l)) return true;
    if (country.name && l.indexOf(country.name.toLowerCase()) !== -1) return true;
    return false;
  }

  function detectCountry() {
    return fetchJSON('https://ipwho.is/', GEO_TIMEOUT).then(function (g) {
      if (g && g.success !== false && g.country_code) {
        return { code: String(g.country_code).toUpperCase(), name: g.country || '' };
      }
      throw new Error('geo1');
    }).catch(function () {
      return fetchJSON('https://ipapi.co/json/', GEO_TIMEOUT).then(function (g) {
        if (g && g.country_code) {
          return { code: String(g.country_code).toUpperCase(), name: g.country_name || '' };
        }
        throw new Error('geo2');
      }).catch(function () {
        return { code: '', name: 'Worldwide' };
      });
    });
  }

  function normalizeRemotive(raw) {
    return {
      id: 'rm-' + raw.id,
      title: raw.title || 'Untitled role',
      company: raw.company_name || 'Unknown company',
      location: raw.candidate_required_location || 'Worldwide',
      url: raw.url || REMOTIVE_BOARD,
      age: daysAgo(raw.publication_date),
      tags: (raw.tags || []).slice(0, 4),
      type: raw.job_type || ''
    };
  }

  function normalizeArbeitnow(raw) {
    var iso = '';
    if (raw.created_at) {
      var ms = Number(raw.created_at) * 1000;
      if (!isNaN(ms)) iso = new Date(ms).toISOString();
    }
    var types = raw.job_types;
    return {
      id: 'an-' + (raw.slug || raw.title),
      title: raw.title || 'Untitled role',
      company: raw.company_name || 'Unknown company',
      location: raw.location || 'Remote',
      url: raw.url || ARBEITNOW_BOARD,
      age: daysAgo(iso),
      tags: (raw.tags || []).slice(0, 4),
      type: Array.isArray(types) ? types.slice(0, 2).join(', ') : (types || '')
    };
  }

  var listEl = $('jobList');
  if (!listEl) return;
  var pageSize = parseInt(listEl.getAttribute('data-page-size') || '10', 10);
  var searchEl = $('jobSearch');
  var countryEl = $('jobCountry');
  var countEl = $('jobCount');
  var moreBtn = $('jobMoreBtn');

  var pool = [];
  var seenIds = {};
  var visible = [];
  var shown = 0;
  var queryWords = [];
  var countrySel = 'ALL';
  var detected = { code: '', name: 'Worldwide' };
  var manualCountry = false;
  var settledSources = 0;
  var totalSources = 1 + ARBEITNOW_PAGES.length;
  var geoDone = false;

  function cardHTML(job) {
    var head = '<span class="chip">' + esc(job.location || 'Worldwide') + '</span>'
      + '<span class="chip">' + esc(ageLabel(job.age)) + '</span>';
    var chips = '';
    if (job.type) chips += '<span class="chip">' + esc(job.type) + '</span>';
    for (var i = 0; i < job.tags.length; i++) {
      chips += '<span class="chip">' + esc(job.tags[i]) + '</span>';
    }
    return '<article class="feature-link">'
      + '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">'
      + '<span class="fl-tag">Remote</span>' + head + '</div>'
      + '<h3><a class="feature-link-title" href="' + esc(job.url) + '" target="_blank" rel="noopener">' + esc(job.title) + '</a></h3>'
      + '<p class="fl-desc">' + esc(job.company) + ' · via ' + (job.id.indexOf('an-') === 0 ? 'Arbeitnow' : 'Remotive') + '</p>'
      + '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">' + chips + '</div>'
      + '</article>';
  }

  function allSettled() {
    return settledSources >= totalSources && geoDone;
  }

  function paintCount() {
    if (!countEl) return;
    if (!visible.length) {
      countEl.textContent = allSettled()
        ? 'No roles match these filters right now. Try All locations or clear the search.'
        : 'Loading fresh remote roles…';
      return;
    }
    countEl.textContent = 'Showing ' + shown + ' of ' + visible.length + ' fresh remote roles';
  }

  function renderMore() {
    var hasMore = shown < visible.length;
    if (moreBtn) moreBtn.style.display = hasMore ? 'inline-flex' : 'none';
    if (shown >= visible.length) { paintCount(); return; }
    var html = '';
    var slice = visible.slice(shown, shown + pageSize);
    for (var i = 0; i < slice.length; i++) html += cardHTML(slice[i]);
    listEl.insertAdjacentHTML('beforeend', html);
    shown += slice.length;
    if (moreBtn) moreBtn.style.display = shown < visible.length ? 'inline-flex' : 'none';
    paintCount();
  }

  function matchCountry(j) {
    if (countrySel === 'ALL') return true;
    if (countrySel === 'ELIGIBLE') return eligible(j.location, detected);
    return isUniversal(j.location) || j.location === countrySel;
  }

  function computeVisible() {
    return pool.filter(function (j) {
      if (!matchCountry(j)) return false;
      if (queryWords.length) {
        var hay = haystack(j);
        for (var i = 0; i < queryWords.length; i++) {
          if (hay.indexOf(queryWords[i]) === -1) return false;
        }
      }
      return true;
    });
  }

  function applyFilters() {
    visible = computeVisible();
    listEl.innerHTML = '';
    shown = 0;
    renderMore();
  }

  function refreshPreserve() {
    visible = computeVisible();
    if (!visible.length && !allSettled()) return;
    var keep = shown;
    listEl.innerHTML = '';
    shown = 0;
    var target = Math.max(keep, pageSize);
    renderMore();
    while (shown < target && shown < visible.length) renderMore();
  }

  function buildCountryOptions() {
    if (!countryEl) return;
    var freq = {};
    var order = [];
    pool.forEach(function (j) {
      var l = (j.location || '').trim();
      if (!l || isUniversal(l)) return;
      if (!freq[l]) { freq[l] = 0; order.push(l); }
      freq[l]++;
    });
    order.sort(function (a, b) { return freq[b] - freq[a]; });
    var html = '<option value="ALL">All locations</option>';
    if (detected && detected.code && detected.name) {
      html += '<option value="ELIGIBLE">Eligible in ' + esc(detected.name) + '</option>';
    }
    order.slice(0, 25).forEach(function (l) {
      html += '<option value="' + esc(l) + '">' + esc(l) + '</option>';
    });
    var keep = countryEl.value;
    countryEl.innerHTML = html;
    if (manualCountry && keep) {
      var stillThere = false;
      for (var i = 0; i < order.length; i++) { if (order[i] === keep) stillThere = true; }
      countrySel = (stillThere || keep === 'ALL' || keep === 'ELIGIBLE') ? keep : 'ALL';
    } else if (detected && detected.code) {
      countrySel = 'ELIGIBLE';
    } else {
      countrySel = 'ALL';
    }
    countryEl.value = countrySel;
  }

  function ingest(list) {
    var added = false;
    list.forEach(function (j) {
      if (!j || !j.title || seenIds[j.id] || j.age > MAX_AGE_DAYS || !isRelevant(j)) return;
      seenIds[j.id] = true;
      pool.push(j);
      added = true;
    });
    if (!added && pool.length) { paintCount(); return; }
    pool.sort(function (a, b) { return a.age - b.age; });
    buildCountryOptions();
    refreshPreserve();
  }

  function markSettled() {
    settledSources++;
    if (allSettled()) paintCount();
  }

  if (searchEl) {
    var deb = null;
    searchEl.addEventListener('input', function () {
      if (deb) clearTimeout(deb);
      deb = setTimeout(function () {
        queryWords = searchEl.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        applyFilters();
      }, 150);
    });
  }
  if (countryEl) {
    countryEl.addEventListener('change', function () {
      manualCountry = true;
      countrySel = countryEl.value;
      applyFilters();
    });
  }
  if (moreBtn) {
    moreBtn.addEventListener('click', renderMore);
  }

  function boot() {
    listEl.innerHTML = '<p class="fl-desc">Loading fresh remote roles…</p>';
    fetchJSON(API_URL, JOBS_TIMEOUT).then(function (data) {
      ingest(((data && data.jobs) || []).map(normalizeRemotive));
    }).catch(function () { /* remotive failed: arbeitnow still lands */ })
    .then(function () { markSettled(); });
    ARBEITNOW_PAGES.forEach(function (p) {
      fetchJSON(ARBEITNOW_URL + p, JOBS_TIMEOUT).then(function (data) {
        var arr = ((data && data.data) || []).filter(function (j) { return j && j.remote === true; });
        ingest(arr.map(normalizeArbeitnow));
      }).catch(function () { /* one page failed: others still land */ })
      .then(function () { markSettled(); });
    });
    detectCountry().then(function (d) {
      detected = (d && d.code) ? d : { code: '', name: 'Worldwide' };
      geoDone = true;
      if (!manualCountry) {
        buildCountryOptions();
        if (detected.code) countrySel = 'ELIGIBLE';
        else countrySel = 'ALL';
        refreshPreserve();
      } else {
        buildCountryOptions();
        refreshPreserve();
      }
    });
  }

  var started = false;
  function start() {
    if (started) return;
    started = true;
    boot();
  }
  if ('IntersectionObserver' in window) {
    var obs = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) { start(); obs.disconnect(); }
    }, { rootMargin: '600px' });
    obs.observe(listEl);
  } else {
    start();
  }
  setTimeout(start, 8000);
})();
