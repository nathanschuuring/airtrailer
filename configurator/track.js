// Meetpunten van de configurator. Stuurt events naar de bestaande Google Analytics (gtag) als
// die op de pagina staat; anders gebeurt er niets. Er gaan geen persoonsgegevens mee: alleen
// het model, het accessoire, aantallen en bedragen.

export function createTracker(product) {
  const sent = new Set();

  function event(name, parameters = {}) {
    if (typeof window.gtag !== 'function') return;
    window.gtag('event', name, { configurator_model: product, ...parameters });
  }

  // Voor meetpunten die per paginabezoek maar één keer mogen tellen.
  function once(name, parameters = {}, key = name) {
    if (sent.has(key)) return;
    sent.add(key);
    event(name, parameters);
  }

  return { event, once };
}
