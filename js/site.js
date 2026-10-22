// Eigen scripts voor airtrailer.nl (naast de Webflow-runtime in airtrailer.js).

// Menu sluiten bij een klik buiten het paneel of met de Escape-toets.
// Hergebruikt de bestaande sluit-animatie door een klik op het kruisje te simuleren.
(function () {
  var overlay = document.querySelector('.dv-menu-bg');
  var closeButton = document.querySelector('a[data-w-id="9acd5fe6-3119-a661-dece-d8084d51b238"]');
  if (!overlay || !closeButton) return;

  function menuIsOpen() {
    return window.getComputedStyle(overlay).display !== 'none';
  }

  overlay.addEventListener('click', function (event) {
    if (event.target === overlay) closeButton.click();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && menuIsOpen()) closeButton.click();
  });
})();
