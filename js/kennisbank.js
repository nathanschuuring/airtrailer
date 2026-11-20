// Kennisbank: zoeken op de overzichtspagina en meten van kliks op vervolgstappen.
// De pagina's werken volledig zonder dit script; het zoekveld verschijnt alleen als het script draait.

(function () {
  // --- Kliks op vervolgstappen doorgeven aan Google Analytics ---
  document.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a[data-kb-cta]');
    if (!link || typeof window.gtag !== 'function') return;
    window.gtag('event', 'kennisbank_cta', {
      cta_type: link.getAttribute('data-kb-cta'),
      link_url: link.getAttribute('href'),
      link_text: link.textContent.trim()
    });
  });

  // --- Zoeken ---
  var form = document.querySelector('[data-kb-search]');
  if (!form) return;

  var input = form.querySelector('input[type="search"]');
  var clearButton = form.querySelector('[data-kb-clear]');
  var status = form.querySelector('[data-kb-status]');
  var empty = document.querySelector('[data-kb-empty]');
  var topics = document.querySelector('.kb-categories');
  var categories = Array.prototype.slice.call(document.querySelectorAll('[data-kb-category]'));
  var items = Array.prototype.slice.call(document.querySelectorAll('[data-kb-item]')).map(function (element) {
    return {
      element: element,
      text: normalize(element.textContent + ' ' + (element.getAttribute('data-kb-terms') || ''))
    };
  });

  // Kleine letters, zonder accenten en leestekens, zodat "belgie" ook "België" vindt.
  function normalize(text) {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function update() {
    var words = normalize(input.value).split(' ').filter(Boolean);
    var visible = 0;

    items.forEach(function (item) {
      var match = words.every(function (word) {
        return item.text.indexOf(word) !== -1;
      });
      item.element.hidden = !match;
      if (match) visible++;
    });

    categories.forEach(function (category) {
      category.hidden = !category.querySelector('[data-kb-item]:not([hidden])');
    });

    clearButton.hidden = input.value === '';
    // Tijdens het zoeken maken de onderwerpknoppen plaats voor de resultaten.
    if (topics) topics.hidden = words.length !== 0;
    empty.hidden = visible !== 0;

    if (words.length === 0) {
      status.textContent = '';
    } else if (visible === 0) {
      status.textContent = 'Geen vragen gevonden voor "' + input.value.trim() + '".';
    } else {
      status.textContent = visible + ' van de ' + items.length + (items.length === 1 ? ' vraag' : ' vragen') + ' gevonden.';
    }
  }

  form.hidden = false;
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var first = document.querySelector('[data-kb-item]:not([hidden]) a');
    if (first) first.focus();
  });
  input.addEventListener('input', update);
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && input.value !== '') {
      event.stopPropagation();
      input.value = '';
      update();
    }
  });
  clearButton.addEventListener('click', function () {
    input.value = '';
    update();
    input.focus();
  });

  // Een zoekopdracht in de URL (?q=borg) wordt overgenomen, zodat een zoekresultaat deelbaar is.
  var query = new URLSearchParams(window.location.search).get('q');
  if (query) {
    input.value = query;
    update();
  }
})();
