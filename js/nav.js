(function () {
  var navScript = document.currentScript;
  if (navScript && navScript.src) {
    var supportScript = document.createElement('script');
    supportScript.async = true;
    supportScript.src = navScript.src.replace(/nav\.js(?:\?.*)?$/, 'support.js');
    document.head.appendChild(supportScript);
  }

  // ---- Auto lazy-load: eager for logo + first content image (LCP), lazy for the rest ----
  try {
    var imgs = document.querySelectorAll('img:not([loading])');
    var firstContentDone = false;
    for (var i = 0; i < imgs.length; i++) {
      var im = imgs[i];
      var isLogo = im.src.indexOf('logo.png') !== -1 || im.closest('.brand-logo');
      if (isLogo) {
        im.loading = 'eager';
        im.fetchPriority = 'high';
        im.decoding = 'async';
      } else if (!firstContentDone) {
        im.loading = 'eager';
        im.fetchPriority = 'high';
        im.decoding = 'async';
        firstContentDone = true;
      } else {
        im.loading = 'lazy';
        im.decoding = 'async';
      }
    }
  } catch (e) {}
  var btn = document.getElementById('navToggle');
  var nav = document.getElementById('topnav');
  if (!btn || !nav) return;
  function close() {
    nav.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  }
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    var open = nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  nav.addEventListener('click', function (e) {
    if (e.target.closest('a')) close();
  });
  document.addEventListener('click', function (e) {
    if (nav.classList.contains('open') && !e.target.closest('.topbar')) close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });
  window.addEventListener('resize', function () {
    if (window.innerWidth > 760) close();
  });
})();

(function () {
  var SUB_KEY = 'buildopsy-newsletter-subscribed';
  var POP_KEY = 'buildopsy-newsletter-popup';
  var imageRoot = (function () {
    try { return new URL('../images/', document.currentScript.src).href; } catch (err) { return '../images/'; }
  })();

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.matches || !form.matches('form[action*="embed-subscribe"]')) return;
    try { localStorage.setItem(SUB_KEY, '1'); } catch (err) {}
  }, true);

  if (!/^\/system-design\//.test(window.location.pathname)) return;
  var article = document.querySelector('article.prose');
  if (!article) return;
  var paragraphs = article.querySelectorAll('section p');
  if (paragraphs.length < 2) paragraphs = article.querySelectorAll('p');
  if (paragraphs.length < 2) return;

  var secondParagraph = paragraphs[1];
  var modal = null;
  var lastFocus = null;
  var ticking = false;

  function readState() {
    try { return JSON.parse(localStorage.getItem(POP_KEY) || '{}'); } catch (err) { return {}; }
  }

  function writeState(value) {
    try { localStorage.setItem(POP_KEY, JSON.stringify(value)); } catch (err) {}
  }

  function isSubscribed() {
    try { return localStorage.getItem(SUB_KEY) === '1'; } catch (err) { return false; }
  }

  function suppressed() {
    if (isSubscribed()) return true;
    var state = readState();
    var now = Date.now();
    return !!(state.dismissedUntil && now < state.dismissedUntil);
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('newsletter-modal-open');
    document.removeEventListener('keydown', onKeydown, true);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
    var state = readState();
    state.dismissedUntil = Date.now() + 30 * 24 * 60 * 60 * 1000;
    delete state.shownUntil;
    writeState(state);
  }

  function onKeydown(e) {
    if (e.key !== 'Tab' || !modal) return;
    var focusable = modal.querySelectorAll('button, input, a[href]');
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function buildModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'newsletter-modal';
    modal.id = 'buildopsy-newsletter-modal';
    modal.hidden = true;
    modal.innerHTML =
      '<div class="newsletter-modal-backdrop"></div>' +
      '<div class="newsletter-modal-card" role="dialog" aria-modal="true" aria-labelledby="buildopsy-newsletter-title" aria-describedby="buildopsy-newsletter-copy">' +
        '<button type="button" class="newsletter-modal-close" data-newsletter-close aria-label="Close newsletter signup">&times;</button>' +
        '<span class="fl-tag">Reader support</span>' +
        '<h2 class="newsletter-modal-title" id="buildopsy-newsletter-title">No ads. No sponsors. Just the receipts.</h2>' +
        '<div class="newsletter-modal-coffee">' +
          '<p class="newsletter-modal-copy" id="buildopsy-newsletter-copy">Buildopsy stays free and ad-free on reader support. Every teardown is free to read — <strong>what we cover and conclude is never for sale.</strong></p>' +
          '<a class="support-bmac-link newsletter-modal-bmac" href="https://buymeacoffee.com/buildopsy" target="_blank" rel="noopener noreferrer" aria-label="Support Buildopsy on Buy Me a Coffee">' +
            '<img class="bmac-dark" src="' + imageRoot + 'buymeacoffee-button-yellow.png" alt="Buy me a coffee" width="217" height="48">' +
            '<img class="bmac-light" src="' + imageRoot + 'buymeacoffee-button-black.png" alt="" aria-hidden="true" width="217" height="48">' +
          '</a>' +
        '</div>' +
        '<div class="newsletter-modal-divider"><span>or get the next one free, by email</span></div>' +
        '<form action="https://buttondown.email/api/emails/embed-subscribe/buildopsy" method="post" target="_blank">' +
          '<input type="email" name="email" required placeholder="you@example.com" class="field-input" aria-label="Email address" autocomplete="email">' +
          '<input type="hidden" name="embed" value="1">' +
          '<button class="btn btn-primary" type="submit">Get the next teardown</button>' +
        '</form>' +
        '<p class="newsletter-modal-note">No fixed schedule. Unsubscribe anytime.</p>' +
      '</div>';
    document.body.appendChild(modal);
    var closeButtons = modal.querySelectorAll('[data-newsletter-close]');
    for (var i = 0; i < closeButtons.length; i++) {
      closeButtons[i].addEventListener('click', closeModal);
    }
    modal.querySelector('form').addEventListener('submit', function () {
      try { localStorage.setItem(SUB_KEY, '1'); } catch (err) {}
      closeModal();
    });
    return modal;
  }

  function openModal() {
    if (suppressed()) return;
    buildModal();
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('newsletter-modal-open');
    document.addEventListener('keydown', onKeydown, true);
    var input = modal.querySelector('input[type="email"]');
    if (input) {
      window.setTimeout(function () { input.focus(); }, 60);
    }
  }

  function checkTrigger() {
    ticking = false;
    if (modal && !modal.hidden) return;
    if (suppressed()) return;
    if (window.scrollY < 80) return;
    var rect = secondParagraph.getBoundingClientRect();
    if (rect.bottom < window.innerHeight - 40) openModal();
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(checkTrigger);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  window.setTimeout(checkTrigger, 700);
})();
