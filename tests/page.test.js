import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalog } from '../configurator/catalog.js';
import { formatEuro, productItemIds, toCents } from '../configurator/engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');

describe('productpagina en catalogus lopen gelijk', () => {
  test('de pagina is opnieuw gebouwd na de laatste wijziging in de catalogus', () => {
    // Faalt deze test? Draai dan `npm run build` en commit het resultaat.
    execFileSync(process.execPath, [join(ROOT, 'scripts/build-configurator.mjs'), '--check'], { stdio: 'pipe' });
  });

  for (const product of Object.values(catalog.products)) {
    const html = read(`${product.page.replace(/^\//, '')}.html`);
    const price = formatEuro(toCents(product.basePrice));

    test(`${product.name}: vanafprijs in de tekst komt uit de catalogus`, () => {
      const match = html.match(/<!-- configurator:price product="([^"]+)" -->(.*?)<!-- configurator:price-end -->/);
      assert.ok(match, 'de prijs-markering ontbreekt');
      assert.equal(match[1], product.id);
      assert.equal(match[2], price);
    });

    test(`${product.name}: structured data noemt dezelfde prijs`, () => {
      const match = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
      assert.ok(match, 'de structured data ontbreekt');
      const data = JSON.parse(match[1]);
      assert.equal(data['@type'], 'Product');
      assert.equal(data.name, product.name);
      assert.equal(data.offers.price, (toCents(product.basePrice) / 100).toFixed(2));
      assert.equal(data.offers.priceCurrency, 'EUR');
      assert.equal(data.offers.url, `https://www.airtrailer.nl${product.page}`);
    });

    test(`${product.name}: elk accessoire staat met naam en prijs als gewone HTML in de pagina`, () => {
      for (const id of productItemIds(catalog, product.id)) {
        const accessory = catalog.accessories[id];
        assert.ok(html.includes(`data-cfg-card="${id}"`), `kaart ontbreekt: ${id}`);
        assert.ok(html.includes(accessory.name.replace(/&/g, '&amp;')), `naam ontbreekt: ${accessory.name}`);
        if (accessory.status === 'available') {
          assert.ok(html.includes(formatEuro(toCents(accessory.price))), `prijs ontbreekt: ${accessory.name}`);
        }
      }
    });

    test(`${product.name}: de bestaande productinformatie staat nog op de pagina`, () => {
      for (const text of ['Technische specificaties', 'Europees gekeurd', 'kennisbank:start']) {
        assert.ok(html.includes(text), `ontbreekt: ${text}`);
      }
      assert.ok(html.includes(`<link href="https://www.airtrailer.nl${product.page}" rel="canonical">`), 'canonical ontbreekt');
    });
  }

  test('de kennisbank noemt dezelfde basisprijs als de catalogus', () => {
    const kennisbank = JSON.parse(read('content/kennisbank.json'));
    const article = kennisbank.articles.find((entry) => entry.slug === 'prijs-airtrailer');
    const price = formatEuro(toCents(catalog.products.mono.basePrice)).replace(/ /g, ' ');
    assert.ok(article.lead.replace(/ /g, ' ').includes(price), `Artikel "Wat kost een Airtrailer?" noemt ${price} niet meer.`);
  });
});

describe('serverfunctie', () => {
  test('api/aanvraag.js laadt en antwoordt netjes zolang e-mail niet is ingesteld', async () => {
    for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_TO']) delete process.env[key];
    const { default: handler } = await import('../api/aanvraag.js');
    assert.equal(typeof handler.fetch, 'function');
    const original = console.error;
    console.error = () => {};
    try {
      const response = await handler.fetch(
        new Request('https://www.airtrailer.nl/api/aanvraag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', host: 'www.airtrailer.nl' },
          body: JSON.stringify({
            type: 'configurator',
            selection: { product: 'mono', variant: 'aluminium', items: {} },
            totalCents: toCents(catalog.products.mono.basePrice),
            contact: { name: 'Test', email: 'test@voorbeeld.nl' },
            website: '',
            elapsedMs: 10000,
          }),
        }),
      );
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, 'mail-unavailable');
    } finally {
      console.error = original;
    }
  });
});
