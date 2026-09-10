(function () {
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
