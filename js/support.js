(function () {
  // Add the verified Buy Me a Coffee creator-page URL here after payout setup.
  var SUPPORT_URL = 'https://buymeacoffee.com/buildopsy';
  var validSupportUrl = /^https:\/\/(?:www\.)?buymeacoffee\.com\/[A-Za-z0-9_-]+\/?$/i;
  if (!validSupportUrl.test(SUPPORT_URL)) return;

  var cards = document.querySelectorAll('[data-support-card]');
  for (var i = 0; i < cards.length; i++) {
    var link = cards[i].querySelector('[data-support-link]');
    if (!link) continue;
    link.href = SUPPORT_URL;
    cards[i].hidden = false;
  }
})();
