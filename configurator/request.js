// Verwerkt een aanvraag uit de configurator aan de serverzijde.
//
// De browser stuurt alleen de keuzes mee (model, uitvoering, accessoires) en het totaal dat de
// bezoeker zag. Namen en prijzen komen hier opnieuw uit de catalogus: wat er in de e-mail staat
// is dus altijd door de server berekend, nooit overgenomen uit de browser.
//
// Dit bestand kent geen mailserver. `mailer` wordt van buiten meegegeven (zie mailer.js en
// api/aanvraag.js), zodat de tests en de lokale server zonder echte e-mail kunnen draaien.

import { calculate, encodeSelection, formatEuro, summaryText, validate } from './engine.js';

const MAX_BODY_BYTES = 20_000;
const MIN_ELAPSED_MS = 2500;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Eén regel tekst: geen regeleinden (voorkomt het injecteren van e-mailheaders) en geen
// stuurtekens.
const singleLine = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, max);

const multiLine = (value, max) =>
  String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, max);

export function validateContact(raw) {
  const contact = {
    name: singleLine(raw?.name, 120),
    email: singleLine(raw?.email, 160),
    phone: singleLine(raw?.phone, 30),
    message: multiLine(raw?.message, 1500),
    copy: raw?.copy === true,
  };
  const fields = {};
  if (contact.name.length < 2) fields.name = 'Vul uw naam in.';
  if (!contact.email) fields.email = 'Vul uw e-mailadres in.';
  else if (!/^[^\s@<>,;:"]+@[^\s@<>,;:"]+\.[^\s@<>,;:"]{2,}$/.test(contact.email)) {
    fields.email = 'Dit e-mailadres lijkt niet te kloppen. Controleer het, bijvoorbeeld naam@voorbeeld.nl.';
  }
  if (contact.phone && (!/^[0-9+()\s./-]+$/.test(contact.phone) || contact.phone.replace(/\D/g, '').length < 8)) {
    fields.phone = 'Dit telefoonnummer lijkt niet te kloppen. U mag het veld ook leeg laten.';
  }
  return { contact, fields };
}

function referenceFor(now) {
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam' }).format(now).replace(/-/g, '');
  const random = Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[byte % 32]).join('');
  return `AT-${date}-${random}`;
}

const money = (cents) => formatEuro(cents, { decimals: 'always' });

// Bouwt de twee e-mails: één voor Airtrailer en (als de klant dat wil) een kopie voor de klant.
export function buildMessages({ catalog, selection, calculation, contact, reference, now, siteUrl }) {
  const product = catalog.products[selection.product];
  const when = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', dateStyle: 'long', timeStyle: 'short' }).format(now);
  const link = `${siteUrl}${product.page}?samenstelling=${encodeURIComponent(encodeSelection(selection))}#samenstellen`;
  const summary = summaryText(calculation);
  const priceList = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${catalog.priceListDate}T00:00:00Z`));
  const total = money(calculation.totalCents).replace(/ /g, ' ');

  const rows = [];
  const row = (label, value, strong = false) =>
    rows.push(
      `<tr><td style="padding:6px 16px 6px 0;border-bottom:1px solid #dadada">${strong ? '<strong>' : ''}${escapeHtml(label)}${strong ? '</strong>' : ''}</td><td style="padding:6px 0;border-bottom:1px solid #dadada;text-align:right;white-space:nowrap">${strong ? '<strong>' : ''}${escapeHtml(value)}${strong ? '</strong>' : ''}</td></tr>`,
    );
  row(calculation.base.name, money(calculation.base.cents));
  row(`Uitvoering ${calculation.variant.name}`, calculation.variant.onRequest ? 'prijs op aanvraag' : calculation.variant.isDefault ? 'inbegrepen' : money(calculation.variant.cents));
  for (const line of calculation.lines) {
    const name = `${line.quantity > 1 ? `${line.quantity} × ` : ''}${line.name}${line.spec ? ` (${line.spec})` : ''}`;
    row(name, line.onRequest ? 'prijs op aanvraag' : money(line.cents));
  }
  for (const discount of calculation.discounts) row(discount.name, money(-discount.cents));
  row('Totaal inclusief btw', money(calculation.totalCents), true);
  const table = `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;color:#333">${rows.join('')}</table>`;
  const onRequestHtml = calculation.onRequest.length
    ? `<p style="font-family:Arial,sans-serif;font-size:14px;color:#333"><strong>Niet in dit totaal (prijs op aanvraag):</strong> ${escapeHtml(calculation.onRequest.join(', '))}</p>`
    : '';
  const paragraph = (html) => `<p style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#333">${html}</p>`;

  const contactText = [
    `Naam: ${contact.name}`,
    `E-mail: ${contact.email}`,
    `Telefoon: ${contact.phone || 'niet opgegeven'}`,
    contact.message ? `\nOpmerkingen:\n${contact.message}` : 'Opmerkingen: geen',
  ].join('\n');

  const internal = {
    subject: `Aanvraag ${product.name} via configurator, ${total} (${contact.name})`,
    replyTo: { name: contact.name, address: contact.email },
    text: [
      `Nieuwe aanvraag via de configurator op ${when}.`,
      `Referentie: ${reference}`,
      '',
      contactText,
      '',
      summary,
      '',
      `De prijzen zijn door de server berekend uit de catalogus (prijslijst van ${priceList}).`,
      `Samenstelling openen: ${link}`,
    ].join('\n'),
    html: [
      paragraph(`Nieuwe aanvraag via de configurator op ${escapeHtml(when)}.<br>Referentie: <strong>${escapeHtml(reference)}</strong>`),
      paragraph(
        `<strong>${escapeHtml(contact.name)}</strong><br>${escapeHtml(contact.email)}<br>${escapeHtml(contact.phone || 'Geen telefoonnummer opgegeven')}`,
      ),
      contact.message ? paragraph(`<strong>Opmerkingen</strong><br>${escapeHtml(contact.message).replace(/\n/g, '<br>')}`) : '',
      table,
      onRequestHtml,
      paragraph(
        `De prijzen zijn door de server berekend uit de catalogus (prijslijst van ${escapeHtml(priceList)}).<br><a href="${escapeHtml(link)}">Open deze samenstelling in de configurator</a>`,
      ),
    ].join('\n'),
  };

  const customer = {
    to: { name: contact.name, address: contact.email },
    subject: `Uw aanvraag voor de ${product.name} (${reference})`,
    text: [
      `Beste ${contact.name},`,
      '',
      `Bedankt voor uw aanvraag. Wij hebben uw samenstelling ontvangen en nemen contact met u op over uw offerte.`,
      '',
      `Referentie: ${reference}`,
      '',
      summary,
      '',
      `Dit is een aanvraag, geen bestelling. De offerte die u van ons ontvangt is leidend.`,
      `Uw samenstelling bekijken of aanpassen: ${link}`,
      '',
      `Met vriendelijke groet,`,
      `Airtrailer`,
      `${catalog.contact.phone} | ${catalog.contact.email}`,
    ].join('\n'),
    html: [
      paragraph(`Beste ${escapeHtml(contact.name)},`),
      paragraph(`Bedankt voor uw aanvraag. Wij hebben uw samenstelling ontvangen en nemen contact met u op over uw offerte.`),
      paragraph(`Referentie: <strong>${escapeHtml(reference)}</strong>`),
      table,
      onRequestHtml,
      paragraph(
        `Dit is een aanvraag, geen bestelling. De offerte die u van ons ontvangt is leidend.<br><a href="${escapeHtml(link)}">Bekijk of wijzig uw samenstelling</a>`,
      ),
      paragraph(`Met vriendelijke groet,<br>Airtrailer<br>${escapeHtml(catalog.contact.phone)} | ${escapeHtml(catalog.contact.email)}`),
    ].join('\n'),
  };

  return { internal, customer };
}

// Maakt de functie die een HTTP-verzoek afhandelt.
//   catalog   de catalogus
//   mailer    { configured: boolean, send({ to?, subject, text, html, replyTo? }) }
//             zonder `to` gaat het bericht naar Airtrailer zelf
//   now       functie die de huidige tijd geeft (voor de tests)
//   siteUrl   vaste basis-URL voor links in e-mails; standaard het adres van het verzoek
export function createRequestHandler({ catalog, mailer, now = () => new Date(), siteUrl, log = console }) {
  const recent = new Map(); // ip -> tijdstippen; geldt per serverinstantie, dus een eerste drempel, geen garantie

  function tooMany(ip, timestamp) {
    const times = (recent.get(ip) ?? []).filter((time) => timestamp - time < RATE_WINDOW_MS);
    if (times.length >= RATE_MAX) {
      recent.set(ip, times);
      return true;
    }
    times.push(timestamp);
    recent.set(ip, times);
    if (recent.size > 5000) recent.clear();
    return false;
  }

  return async function handle(request) {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ ok: false, code: 'method' }), {
        status: 405,
        headers: { Allow: 'POST', 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    const url = new URL(request.url);
    const originHeader = request.headers.get('origin');
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
    if (originHeader) {
      let originHost = null;
      try {
        originHost = new URL(originHeader).host;
      } catch {
        /* ongeldige Origin */
      }
      if (originHost !== host) return json(403, { ok: false, code: 'origin' });
    }

    let payload;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) return json(413, { ok: false, code: 'too-large' });
      payload = JSON.parse(text);
    } catch {
      return json(400, { ok: false, code: 'invalid-json' });
    }
    if (!payload || typeof payload !== 'object' || payload.type !== 'configurator') {
      return json(400, { ok: false, code: 'invalid-request' });
    }

    const moment = now();

    // Spamfilter zonder puzzel: een verborgen veld dat mensen niet invullen, en een formulier
    // dat binnen een paar tellen na het laden wordt verstuurd. Een robot krijgt hetzelfde
    // antwoord als een mens, maar er wordt niets verzonden.
    const elapsed = Number(payload.elapsedMs);
    if ((typeof payload.website === 'string' && payload.website.trim() !== '') || !Number.isFinite(elapsed) || elapsed < MIN_ELAPSED_MS) {
      log.warn?.('[aanvraag] genegeerd door het spamfilter');
      return json(200, { ok: true, reference: referenceFor(moment), totalCents: Number(payload.totalCents) || 0, copySent: false });
    }

    const { contact, fields } = validateContact(payload.contact);
    if (Object.keys(fields).length) return json(400, { ok: false, code: 'validation', fields });

    // Samenstelling streng controleren en opnieuw doorrekenen.
    const raw = payload.selection;
    const selection = {
      product: typeof raw?.product === 'string' ? raw.product : '',
      variant: typeof raw?.variant === 'string' ? raw.variant : '',
      items: raw?.items,
    };
    const errors = validate(catalog, selection);
    if (errors.length) {
      return json(422, { ok: false, code: 'invalid-configuration', errors: errors.map((error) => error.message) });
    }
    selection.items = Object.fromEntries(Object.entries(selection.items));
    const calculation = calculate(catalog, selection, {
      today: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam' }).format(moment),
    });
    if (payload.totalCents !== calculation.totalCents) {
      return json(409, { ok: false, code: 'price-changed', totalCents: calculation.totalCents });
    }

    const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'onbekend';
    if (tooMany(ip, moment.getTime())) return json(429, { ok: false, code: 'rate-limited' });

    if (!mailer?.configured) {
      log.error?.('[aanvraag] e-mail is niet ingesteld; de aanvraag kon niet worden verzonden');
      return json(503, { ok: false, code: 'mail-unavailable' });
    }

    const reference = referenceFor(moment);
    const forwardedProto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
    const base = siteUrl ?? `${forwardedProto}://${host}`;
    const messages = buildMessages({ catalog, selection, calculation, contact, reference, now: moment, siteUrl: base });

    try {
      await mailer.send(messages.internal);
    } catch (error) {
      log.error?.('[aanvraag] verzenden mislukt:', error?.message ?? error);
      return json(502, { ok: false, code: 'mail-failed' });
    }

    // De kopie voor de klant mag mislukken zonder dat de aanvraag verloren gaat.
    let copySent = false;
    if (contact.copy) {
      try {
        await mailer.send(messages.customer);
        copySent = true;
      } catch (error) {
        log.error?.('[aanvraag] kopie voor de klant mislukt:', error?.message ?? error);
      }
    }

    return json(200, { ok: true, reference, totalCents: calculation.totalCents, copySent });
  };
}
