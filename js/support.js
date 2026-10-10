(function () {
  // Keep this URL current after Buy Me a Coffee payout setup is approved.
  var SUPPORT_URL = 'https://buymeacoffee.com/buildopsy';
  var validSupportUrl = /^https:\/\/(?:www\.)?buymeacoffee\.com\/[A-Za-z0-9_-]+\/?$/i;
  if (!validSupportUrl.test(SUPPORT_URL)) return;
  var scriptUrl = document.currentScript && document.currentScript.src;
  var imageRoot = scriptUrl ? new URL('../images/', scriptUrl).href : '../images/';

  function buttonImage() {
    // Yellow pops against Buildopsy's dark canvas; black has clear contrast in light mode.
    var variant = document.documentElement.classList.contains('dark') ? 'yellow' : 'black';
    return imageRoot + 'buymeacoffee-button-' + variant + '.png';
  }

  function updateButtonImages() {
    var images = document.querySelectorAll('[data-support-image]');
    var src = buttonImage();
    for (var j = 0; j < images.length; j++) images[j].src = src;
  }

  function watchTheme() {
    if ('MutationObserver' in window) {
      var observer = new MutationObserver(updateButtonImages);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      return;
    }
    var themeToggle = document.getElementById('themeToggle');
    if (themeToggle) themeToggle.addEventListener('click', function () { window.setTimeout(updateButtonImages, 0); });
  }

  var cards = document.querySelectorAll('[data-support-card]');
  for (var i = 0; i < cards.length; i++) {
    var link = cards[i].querySelector('[data-support-link]');
    if (link) link.href = SUPPORT_URL;
  }
  if (cards.length) {
    updateButtonImages();
    for (var k = 0; k < cards.length; k++) cards[k].hidden = false;
    watchTheme();
    return;
  }

  var robots = document.querySelector('meta[name="robots"]');
  if (robots && /noindex/i.test(robots.content || '')) return;
  var main = document.querySelector('main');
  if (!main) return;

  function makeCard(title, message) {
    var section = document.createElement('section');
    section.className = 'sec';
    section.setAttribute('data-support-card', 'generated');
    section.innerHTML = '<div class="support-card"><div class="support-card-copy"><span class="fl-tag">Optional support</span><h2>' + title + '</h2><p class="fl-desc">' + message + '</p></div><a class="support-bmac-link" data-support-link href="#" target="_blank" rel="noopener noreferrer" aria-label="Support Buildopsy on Buy Me a Coffee"><img data-support-image alt="Buy me a coffee" width="217" height="48"></a></div>';
    section.querySelector('[data-support-link]').href = SUPPORT_URL;
    section.querySelector('[data-support-image]').src = buttonImage();
    return section;
  }

  function placeArticleCard(article) {
    var sections = Array.prototype.slice.call(article.querySelectorAll('section'));
    var contentSections = sections.filter(function (section) {
      var heading = section.querySelector('h2');
      return !heading || !/^(sources|receipts|references|sources and method)/i.test(heading.textContent.trim());
    });
    if (!contentSections.length) {
      article.insertAdjacentElement('afterend', makeCard(
        'Found this analysis useful?',
        'Buildopsy is currently ad-free. If this source-linked case study helped you understand a system or failure, an optional coffee helps fund research and future analysis. It never changes coverage or conclusions.'
      ));
      return;
    }
    var articleIndex = Math.min(contentSections.length - 1, Math.max(1, Math.round(contentSections.length * 0.4)));
    var articleBreak = contentSections[articleIndex];
    while (articleBreak.nextElementSibling && articleBreak.nextElementSibling.tagName === 'FIGURE') {
      articleBreak = articleBreak.nextElementSibling;
    }
    articleBreak.insertAdjacentElement('afterend', makeCard(
      'Found this analysis useful?',
      'Buildopsy is currently ad-free. If this source-linked case study helped you understand a system or failure, an optional coffee helps fund research and future analysis. It never changes coverage or conclusions.'
    ));
  }

  function placeCourseCard(course) {
    var lessons = course ? course.querySelectorAll('.lesson') : main.querySelectorAll('.lesson');
    if (!lessons.length) return false;
    var lessonIndex = Math.min(lessons.length - 1, Math.max(2, Math.floor(lessons.length * 0.25)));
    lessons[lessonIndex].insertAdjacentElement('afterend', makeCard(
      'Found these lessons useful?',
      'The courses are free to read. Optional support helps fund research and maintenance for future lessons.'
    ));
    return true;
  }

  var articleType = document.querySelector('meta[property="og:type"]');
  var article = articleType && articleType.content.toLowerCase() === 'article'
    ? main.querySelector('article.prose')
    : null;
  if (article) {
    placeArticleCard(article);
    updateButtonImages();
    watchTheme();
    return;
  }

  var course = main.querySelector('.course-layout');
  if (placeCourseCard(course)) {
    updateButtonImages();
    watchTheme();
    return;
  }

  var newsletter = main.querySelector('#newsletter');
  var result = main.querySelector('section.sec .radar-card');
  if (newsletter && result) {
    var resultSection = result.closest('section.sec');
    if (resultSection) {
      resultSection.insertAdjacentElement('afterend', makeCard(
        'Did this calculator help?',
        'These browser-based calculators are free and ad-free today. Optional support helps maintain them and build new tools.'
      ));
      updateButtonImages();
      watchTheme();
    }
  }
})();
