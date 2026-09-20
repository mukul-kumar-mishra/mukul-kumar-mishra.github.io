(function () {
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
