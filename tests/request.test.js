import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { catalog } from '../configurator/catalog.js';
import { calculate } from '../configurator/engine.js';
import { createRequestHandler, validateContact } from '../configurator/request.js';

const NOW = new Date('2026-11-24T16:08:00Z');
const silent = { warn() {}, error() {} };

function setup({ configured = true, failOn = null } = {}) {
  const sentMessages = [];
  const mailer = {
    configured,
    async send(message) {
      if (failOn === 'all' || (failOn === 'customer' && message.to)) throw new Error('SMTP weigert');
      sentMessages.push(message);
    },
  };
  const handle = createRequestHandler({ catalog, mailer, now: () => NOW, log: silent });
  return { handle, sentMessages };
}

const selection = { product: 'mono', variant: 'aluminium', items: { compressor: 1, fietsendrager: 2, disselslot: 1 } };
const total = calculate(catalog, selection).totalCents; // 3350 + 130 + 590 + 37,50

function body(overrides = {}) {
  return {
    type: 'configurator',
    selection,
    totalCents: total,
    contact: { name: 'Jan de Vries', email: 'jan@voorbeeld.nl', phone: '06 12345678', message: 'BMW R 1250 GS', copy: true },
    website: '',
    elapsedMs: 45000,
    ...overrides,
  };
}

function post(payload, headers = {}) {
  return new Request('https://www.airtrailer.nl/api/aanvraag', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', host: 'www.airtrailer.nl', origin: 'https://www.airtrailer.nl', 'x-forwarded-for': '203.0.113.9', ...headers },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

describe('aanvraag verwerken', () => {
  test('geldige aanvraag: mail naar Airtrailer en kopie naar de klant, met door de server berekende prijzen', async () => {
    const { handle, sentMessages } = setup();
    const response = await handle(post(body()));
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.totalCents, 410750);
    assert.equal(result.copySent, true);
    assert.match(result.reference, /^AT-20261124-[A-Z2-9]{4}$/);

    assert.equal(sentMessages.length, 2);
    const [internal, customer] = sentMessages;
    assert.equal(internal.to, undefined); // gaat naar MAIL_TO
    assert.deepEqual(internal.replyTo, { name: 'Jan de Vries', address: 'jan@voorbeeld.nl' });
    assert.match(internal.subject, /Aanvraag Airtrailer Mono via configurator, € 4\.107,50 \(Jan de Vries\)/);
    for (const expected of [
      'Airtrailer Mono: € 3.350,00',
      '- Compressor (Black+Decker ASI300): € 130,00',
      '- 2 x Fietsendrager (Ook voor e-bikes tot 25 kg) à € 295,00: € 590,00',
      '- Disselslot (ABUS-hangslot): € 37,50',
      'Totaal inclusief btw: € 4.107,50',
      'Telefoon: 06 12345678',
      'BMW R 1250 GS',
      result.reference,
      'https://www.airtrailer.nl/mono?samenstelling=mono%3Aaluminium%3Acompressor%2Cfietsendrager*2%2Cdisselslot#samenstellen',
    ]) {
      assert.ok(internal.text.includes(expected), `ontbreekt in de mail: ${expected}`);
    }
    assert.ok(internal.html.includes('€&nbsp;4.107,50') || internal.html.includes('€ 4.107,50'));

    assert.deepEqual(customer.to, { name: 'Jan de Vries', address: 'jan@voorbeeld.nl' });
    assert.ok(customer.text.includes('Totaal inclusief btw: € 4.107,50'));
    assert.ok(customer.text.includes('Dit is een aanvraag, geen bestelling.'));
    assert.ok(!customer.text.includes('BMW R 1250 GS'), 'de vrije tekst van de bezoeker hoort niet in de kopie');
  });

  test('een bedrag uit de browser wordt nooit overgenomen', async () => {
    const { handle, sentMessages } = setup();
    const response = await handle(post(body({ totalCents: 100 })));
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { ok: false, code: 'price-changed', totalCents: 410750 });
    assert.equal(sentMessages.length, 0);
  });

  test('prijzen en namen die de browser meestuurt worden genegeerd', async () => {
    const { handle, sentMessages } = setup();
    const tampered = body({
      selection: { ...selection, items: { ...selection.items }, prices: { compressor: 1 }, lines: [{ name: 'Gratis trailer', cents: 0 }] },
    });
    const response = await handle(post(tampered));
    assert.equal(response.status, 200);
    assert.ok(sentMessages[0].text.includes('Compressor (Black+Decker ASI300): € 130,00'));
    assert.ok(!sentMessages[0].text.includes('Gratis trailer'));
  });

  test('onmogelijke samenstelling wordt geweigerd', async () => {
    const { handle, sentMessages } = setup();
    const impossible = { product: 'mono', variant: 'aluminium', items: { fietsendrager: 2, opbergkist: 1 } };
    const response = await handle(post(body({ selection: impossible, totalCents: 413500 })));
    const result = await response.json();
    assert.equal(response.status, 422);
    assert.equal(result.code, 'invalid-configuration');
    assert.match(result.errors[0], /twee zijplaatsen/);
    assert.equal(sentMessages.length, 0);

    for (const bad of [null, 'mono', { product: 'duo', variant: 'x', items: {} }, { product: 'mono', variant: 'aluminium', items: { compressor: 99 } }]) {
      const res = await handle(post(body({ selection: bad })));
      assert.equal(res.status, 422);
    }
  });

  test('opties op aanvraag staan apart en tellen niet mee', async () => {
    const { handle, sentMessages } = setup();
    const wish = { product: 'mono', variant: 'black-edition', items: { 'led-verlichting': 1 } };
    const response = await handle(post(body({ selection: wish, totalCents: 335000 })));
    assert.equal(response.status, 200);
    const text = sentMessages[0].text;
    assert.ok(text.includes('Uitvoering Black Edition: prijs op aanvraag'));
    assert.ok(text.includes('- LED-verlichting: prijs op aanvraag'));
    assert.ok(text.includes('Totaal inclusief btw: € 3.350,00'));
    assert.ok(text.includes('Niet in dit totaal (prijs op aanvraag): Black Edition, LED-verlichting'));
  });

  test('ontbrekende of onjuiste contactgegevens geven een melding per veld', async () => {
    const { handle, sentMessages } = setup();
    const response = await handle(post(body({ contact: { name: ' ', email: 'geen-adres', phone: 'bel mij' } })));
    const result = await response.json();
    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys(result.fields).sort(), ['email', 'name', 'phone']);
    assert.equal(sentMessages.length, 0);

    assert.deepEqual(validateContact({ name: 'An', email: 'an@voorbeeld.nl' }).fields, {});
    assert.deepEqual(validateContact({ name: 'An', email: 'an@voorbeeld.nl', phone: '+31 (0)38 333 8477' }).fields, {});
  });

  test('regeleinden in naam of e-mail kunnen geen e-mailheaders toevoegen', async () => {
    const { handle, sentMessages } = setup();
    const response = await handle(
      post(body({ contact: { name: 'Jan\r\nBcc: iedereen@voorbeeld.nl', email: 'jan@voorbeeld.nl', message: 'regel 1\nregel 2', copy: false } })),
    );
    assert.equal(response.status, 200);
    assert.equal(sentMessages.length, 1);
    assert.ok(!/[\r\n]/.test(sentMessages[0].subject));
    assert.equal(sentMessages[0].replyTo.name, 'Jan Bcc: iedereen@voorbeeld.nl');
    assert.ok(sentMessages[0].text.includes('regel 1\nregel 2'));

    const injected = await handle(post(body({ contact: { name: 'Jan', email: 'jan@voorbeeld.nl\nBcc: x@y.nl' } })));
    assert.equal(injected.status, 400);
  });

  test('HTML in de invoer wordt onschadelijk gemaakt', async () => {
    const { handle, sentMessages } = setup();
    await handle(post(body({ contact: { name: '<script>alert(1)</script>', email: 'jan@voorbeeld.nl', message: '<img src=x onerror=alert(1)>', copy: true } })));
    for (const message of sentMessages) {
      assert.ok(!message.html.includes('<script>'));
      assert.ok(!message.html.includes('<img'));
    }
  });

  test('spam: verborgen veld ingevuld of te snel verstuurd lijkt te lukken maar verstuurt niets', async () => {
    const { handle, sentMessages } = setup();
    for (const payload of [body({ website: 'http://spam.example' }), body({ elapsedMs: 300 }), body({ elapsedMs: undefined })]) {
      const response = await handle(post(payload));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ok, true);
    }
    assert.equal(sentMessages.length, 0);
  });

  test('verzoeken van een andere website worden geweigerd', async () => {
    const { handle } = setup();
    assert.equal((await handle(post(body(), { origin: 'https://kwaadaardig.example' }))).status, 403);
    assert.equal((await handle(post(body(), { origin: 'geen-url' }))).status, 403);
    // Een preview-adres van Vercel praat met zichzelf en mag dus wel.
    const preview = new Request('https://airtrailer-git-feature.vercel.app/api/aanvraag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', host: 'airtrailer-git-feature.vercel.app', origin: 'https://airtrailer-git-feature.vercel.app' },
      body: JSON.stringify(body()),
    });
    assert.equal((await handle(preview)).status, 200);
  });

  test('alleen POST, alleen geldige JSON, niet te groot', async () => {
    const { handle } = setup();
    const get = await handle(new Request('https://www.airtrailer.nl/api/aanvraag', { headers: { host: 'www.airtrailer.nl' } }));
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST');
    assert.equal((await handle(post('{niet json'))).status, 400);
    assert.equal((await handle(post({ type: 'iets-anders' }))).status, 400);
    assert.equal((await handle(post(JSON.stringify(body({ contact: { name: 'x'.repeat(30000) } }))))).status, 413);
  });

  test('zonder ingestelde mailserver gaat niets stilletjes verloren', async () => {
    const { handle, sentMessages } = setup({ configured: false });
    const response = await handle(post(body()));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, code: 'mail-unavailable' });
    assert.equal(sentMessages.length, 0);
  });

  test('mislukt het verzenden, dan hoort de bezoeker dat; mislukt alleen de kopie, dan telt de aanvraag wel', async () => {
    const failing = setup({ failOn: 'all' });
    assert.equal((await failing.handle(post(body()))).status, 502);

    const partial = setup({ failOn: 'customer' });
    const response = await partial.handle(post(body()));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.copySent, false);
    assert.equal(partial.sentMessages.length, 1);
  });

  test('te veel aanvragen achter elkaar vanaf één adres worden afgeremd', async () => {
    const { handle } = setup();
    const statuses = [];
    for (let index = 0; index < 7; index++) statuses.push((await handle(post(body({ contact: { name: 'Jan', email: 'jan@voorbeeld.nl' } })))).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
    const other = await handle(post(body(), { 'x-forwarded-for': '198.51.100.7' }));
    assert.equal(other.status, 200);
  });
});
