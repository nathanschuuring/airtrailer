#!/usr/bin/env node
// Zet de configurator op de productpagina's.
//
//   Bron:     configurator/catalog.js (producten, prijzen, accessoires, regels)
//   Uitvoer:  in elke pagina met deze markeringen:
//
//     <!-- configurator:start product="mono" --> … <!-- configurator:end -->
//         de configurator zelf: uitvoeringen en accessoirekaarten staan als gewone HTML in de
//         pagina (leesbaar voor zoekmachines en zonder JavaScript); configurator/app.js maakt
//         ze interactief.
//     <!-- configurator:price product="mono" --> … <!-- configurator:price-end -->
//         de vanafprijs in lopende tekst
//     <!-- configurator:jsonld product="mono" --> … <!-- configurator:jsonld-end -->
//         structured data (schema.org Product) met dezelfde prijs
//
// Gebruik:  node scripts/build-configurator.mjs           bouwen
//           node scripts/build-configurator.mjs --check   alleen controleren, niets schrijven
//
// Geen afhankelijkheden: alleen Node.js (20 of nieuwer).

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalog } from '../configurator/catalog.js';
import { checkCatalog, childrenOf, formatEuro, getAccessory, maxOf, toCents } from '../configurator/engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');
const SITE = 'https://www.airtrailer.nl';

const fail = (message) => {
  console.error(`\nFout in de configurator: ${message}\n`);
  process.exit(1);
};

const esc = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const euro = (amount) => esc(formatEuro(toCents(amount)));

const problems = checkCatalog(catalog);
if (problems.length) fail(`de catalogus klopt niet:\n  ${problems.join('\n  ')}`);

// ---------------------------------------------------------------------------
// Onderdelen
// ---------------------------------------------------------------------------

const CHECK_ICON =
  '<svg class="cfg-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"/></svg>';

function priceLabel(accessory, product, id) {
  if (accessory.status === 'unavailable') return '<p class="cfg-price cfg-price--muted">Tijdelijk niet leverbaar</p>';
  if (accessory.status === 'on-request') return '<p class="cfg-price cfg-price--muted">Prijs op aanvraag</p>';
  const amount = product.priceOverrides?.[id] ?? accessory.price;
  const unit = accessory.unit ? ` <span class="cfg-price-unit">${esc(accessory.unit)}</span>` : '';
  return `<p class="cfg-price"><span class="cfg-visually-hidden">Meerprijs </span><span aria-hidden="true">+ </span>${euro(amount)}${unit}</p>`;
}

function toggleControl(id, accessory, prefix) {
  const inputId = `${prefix}-item-${id}`;
  const onRequest = accessory.status === 'on-request';
  const off = onRequest ? 'Meenemen in aanvraag' : 'Toevoegen';
  const on = onRequest ? 'In uw aanvraag' : 'Toegevoegd';
  return [
    `<div class="cfg-control cfg-toggle">`,
    `  <input type="checkbox" class="cfg-toggle-input" id="${inputId}" data-cfg-toggle="${esc(id)}" aria-describedby="${inputId}-prijs">`,
    `  <label class="cfg-toggle-label" for="${inputId}">`,
    `    <span class="cfg-toggle-off">${off}<span class="cfg-visually-hidden">: ${esc(accessory.name)}</span></span>`,
    `    <span class="cfg-toggle-on">${CHECK_ICON}${on}<span class="cfg-visually-hidden">: ${esc(accessory.name)}</span></span>`,
    `  </label>`,
    `</div>`,
  ];
}

function quantityControl(id, accessory) {
  const single = accessory.name.toLowerCase();
  return [
    `<div class="cfg-control cfg-qty" role="group" aria-label="Aantal ${esc(accessory.plural)}">`,
    `  <button type="button" class="cfg-qty-button" data-cfg-step="-1" data-cfg-for="${esc(id)}" aria-label="Eén ${esc(single)} minder"><span aria-hidden="true">−</span></button>`,
    `  <span class="cfg-qty-value" data-cfg-quantity="${esc(id)}">0</span>`,
    `  <button type="button" class="cfg-qty-button" data-cfg-step="1" data-cfg-for="${esc(id)}" aria-label="Eén ${esc(single)} meer"><span aria-hidden="true">+</span></button>`,
    `</div>`,
  ];
}

function slotNote(accessory) {
  const entries = Object.entries(accessory.slots ?? {});
  if (!entries.length) return '';
  return entries
    .map(([type, count]) => {
      const slot = catalog.slotTypes[type];
      const per = maxOf(accessory) > 1 ? ' per stuk' : '';
      return `<p class="cfg-tag">Gebruikt ${count} ${count === 1 ? slot.singular : slot.plural}${per}</p>`;
    })
    .join('');
}

function card(id, product, prefix) {
  const accessory = getAccessory(catalog, id);
  const titleId = `${prefix}-titel-${id}`;
  const inputId = `${prefix}-item-${id}`;
  const children = childrenOf(catalog, id);
  const featured = Boolean(accessory.image);
  const lines = [];

  lines.push(
    `<li class="cfg-card${featured ? ' cfg-card--featured' : ''}" data-cfg-card="${esc(id)}" data-cfg-status="${accessory.status}">`,
  );
  if (featured) {
    const { src, width, height, alt } = accessory.image;
    lines.push(
      `  <div class="cfg-card-media"><img src="${esc(src)}" width="${width}" height="${height}" alt="${esc(alt)}" loading="lazy" decoding="async"></div>`,
    );
  }
  lines.push(`  <div class="cfg-card-body">`);
  lines.push(`    <h5 class="cfg-card-title" id="${titleId}">${esc(accessory.name)}</h5>`);
  if (accessory.spec) lines.push(`    <p class="cfg-card-spec">${esc(accessory.spec)}</p>`);
  lines.push(`    <p class="cfg-card-benefit">${esc(accessory.benefit)}</p>`);
  const tag = slotNote(accessory);
  if (tag) lines.push(`    ${tag}`);
  if (maxOf(accessory) > 1) lines.push(`    <p class="cfg-tag">Maximaal ${maxOf(accessory)}</p>`);
  if (accessory.moreInfo) {
    lines.push(
      `    <details class="cfg-more"><summary>Meer informatie<span class="cfg-visually-hidden"> over ${esc(accessory.name)}</span></summary><p>${esc(accessory.moreInfo)}</p></details>`,
    );
  }
  lines.push(`  </div>`);

  lines.push(`  <div class="cfg-card-foot">`);
  lines.push(`    <div id="${inputId}-prijs">${priceLabel(accessory, product, id)}</div>`);
  if (accessory.status !== 'unavailable') {
    const control = maxOf(accessory) > 1 ? quantityControl(id, accessory) : toggleControl(id, accessory, prefix);
    lines.push(...control.map((line) => `    ${line}`));
  }
  lines.push(`  </div>`);

  if (children.length) {
    lines.push(`  <div class="cfg-sub" data-cfg-children="${esc(id)}">`);
    lines.push(`    <p class="cfg-sub-title">Opties bij ${esc(accessory.article)} ${esc(accessory.name.toLowerCase())}</p>`);
    lines.push(`    <ul class="cfg-sub-list">`);
    for (const childId of children) {
      const child = getAccessory(catalog, childId);
      const childInput = `${prefix}-item-${childId}`;
      lines.push(`      <li class="cfg-sub-item" data-cfg-card="${esc(childId)}" data-cfg-status="${child.status}">`);
      lines.push(`        <div class="cfg-sub-text">`);
      lines.push(`          <p class="cfg-sub-name">${esc(child.shortName ?? child.name)}</p>`);
      lines.push(`          <p class="cfg-sub-benefit">${esc(child.benefit)}</p>`);
      const childTag = slotNote(child);
      if (childTag) lines.push(`          ${childTag}`);
      lines.push(`        </div>`);
      lines.push(`        <div class="cfg-sub-foot">`);
      lines.push(`          <div id="${childInput}-prijs">${priceLabel(child, product, childId)}</div>`);
      if (child.status !== 'unavailable') lines.push(...toggleControl(childId, child, prefix).map((line) => `          ${line}`));
      lines.push(`        </div>`);
      lines.push(`      </li>`);
    }
    lines.push(`    </ul>`);
    lines.push(`  </div>`);
  }
  lines.push(`</li>`);
  return lines;
}

function group(entry, product, prefix) {
  const headingId = `${prefix}-groep-${entry.id}`;
  const lines = [`<section class="cfg-group" aria-labelledby="${headingId}">`];
  lines.push(`  <div class="cfg-group-head">`);
  lines.push(`    <h4 class="cfg-group-title" id="${headingId}">${esc(entry.title)}</h4>`);
  if (entry.intro) lines.push(`    <p class="cfg-group-intro">${esc(entry.intro)}</p>`);
  lines.push(`  </div>`);
  if (entry.slot) {
    const slot = catalog.slotTypes[entry.slot];
    const capacity = product.slots[entry.slot];
    lines.push(`  <div class="cfg-slots" data-cfg-slots="${esc(entry.slot)}">`);
    lines.push(`    <div class="cfg-slots-meter" aria-hidden="true">${'<span class="cfg-slots-pip"></span>'.repeat(capacity)}</div>`);
    lines.push(`    <div class="cfg-slots-text">`);
    lines.push(`      <p class="cfg-slots-status" data-cfg-slots-status>${capacity} ${capacity === 1 ? slot.singular : slot.plural} beschikbaar</p>`);
    lines.push(`      <p class="cfg-slots-why">${esc(slot.explanation)}</p>`);
    lines.push(`    </div>`);
    lines.push(`  </div>`);
  }
  lines.push(`  <ul class="cfg-cards">`);
  for (const id of entry.items) lines.push(...card(id, product, prefix).map((line) => `    ${line}`));
  lines.push(`  </ul>`);
  lines.push(`</section>`);
  return lines;
}

function variants(product, prefix) {
  const lines = [`<fieldset class="cfg-variants">`, `  <legend class="cfg-variants-legend">Kies uw uitvoering</legend>`, `  <div class="cfg-variants-list">`];
  product.variants.forEach((variant, index) => {
    const inputId = `${prefix}-uitvoering-${variant.id}`;
    let price;
    if (variant.status === 'unavailable') price = 'Tijdelijk niet leverbaar';
    else if (variant.status === 'on-request') price = 'Prijs op aanvraag';
    else price = variant.surcharge === 0 ? 'Inbegrepen' : `+ ${formatEuro(toCents(variant.surcharge))}`;
    lines.push(`    <div class="cfg-variant" data-cfg-variant-card="${esc(variant.id)}">`);
    lines.push(
      `      <input type="radio" class="cfg-variant-input" name="${prefix}-uitvoering" id="${inputId}" value="${esc(variant.id)}" data-cfg-variant${index === 0 ? ' checked' : ''}${variant.status === 'unavailable' ? ' disabled' : ''}>`,
    );
    lines.push(`      <label class="cfg-variant-label" for="${inputId}">`);
    lines.push(`        <span class="cfg-variant-mark" aria-hidden="true">${CHECK_ICON}</span>`);
    lines.push(`        <span class="cfg-variant-name">${esc(variant.name)}${variant.label ? ` <span class="cfg-variant-badge">${esc(variant.label)}</span>` : ''}</span>`);
    lines.push(`        <span class="cfg-variant-benefit">${esc(variant.benefit)}</span>`);
    lines.push(`        <span class="cfg-variant-price">${esc(price)}</span>`);
    lines.push(`      </label>`);
    if (variant.moreInfo) {
      lines.push(
        `      <details class="cfg-more"><summary>Meer informatie<span class="cfg-visually-hidden"> over ${esc(variant.name)}</span></summary><p>${esc(variant.moreInfo)}</p></details>`,
      );
    }
    lines.push(`    </div>`);
  });
  lines.push(`  </div>`, `</fieldset>`);
  return lines;
}

function requestForm(product, prefix) {
  const field = (name) => `${prefix}-${name}`;
  return [
    `<form class="cfg-form" data-cfg-form novalidate>`,
    `  <h4 class="cfg-form-title">Vraag uw samengestelde Airtrailer aan</h4>`,
    `  <p class="cfg-form-intro">U ontvangt van ons een offerte voor precies deze samenstelling. Dit is een aanvraag, geen bestelling.</p>`,
    `  <div class="cfg-form-errors" data-cfg-form-errors role="alert" tabindex="-1" hidden></div>`,
    `  <div class="cfg-field">`,
    `    <label for="${field('naam')}">Naam</label>`,
    `    <input type="text" id="${field('naam')}" name="name" autocomplete="name" required maxlength="120" aria-describedby="${field('naam')}-fout">`,
    `    <p class="cfg-field-error" id="${field('naam')}-fout" hidden></p>`,
    `  </div>`,
    `  <div class="cfg-field">`,
    `    <label for="${field('email')}">E-mailadres</label>`,
    `    <input type="email" id="${field('email')}" name="email" autocomplete="email" inputmode="email" required maxlength="160" aria-describedby="${field('email')}-fout">`,
    `    <p class="cfg-field-error" id="${field('email')}-fout" hidden></p>`,
    `  </div>`,
    `  <div class="cfg-field">`,
    `    <label for="${field('telefoon')}">Telefoonnummer <span class="cfg-optional">(optioneel)</span></label>`,
    `    <input type="tel" id="${field('telefoon')}" name="phone" autocomplete="tel" inputmode="tel" maxlength="30" aria-describedby="${field('telefoon')}-fout">`,
    `    <p class="cfg-field-error" id="${field('telefoon')}-fout" hidden></p>`,
    `  </div>`,
    `  <div class="cfg-field">`,
    `    <label for="${field('opmerking')}">Opmerkingen <span class="cfg-optional">(optioneel)</span></label>`,
    `    <textarea id="${field('opmerking')}" name="message" rows="4" maxlength="1500" aria-describedby="${field('opmerking')}-hulp"></textarea>`,
    `    <p class="cfg-field-help" id="${field('opmerking')}-hulp">Bijvoorbeeld het merk en type van uw motor, of de datum waarop u de trailer nodig heeft.</p>`,
    `  </div>`,
    `  <div class="cfg-hp" aria-hidden="true">`,
    `    <label for="${field('website')}">Laat dit veld leeg</label>`,
    `    <input type="text" id="${field('website')}" name="website" tabindex="-1" autocomplete="off">`,
    `  </div>`,
    `  <div class="cfg-check">`,
    `    <input type="checkbox" id="${field('kopie')}" name="copy" checked>`,
    `    <label for="${field('kopie')}">Stuur mij een kopie van mijn samenstelling per e-mail</label>`,
    `  </div>`,
    `  <button type="submit" class="cfg-button cfg-button--primary cfg-button--wide" data-cfg-submit>Verstuur mijn aanvraag</button>`,
    `  <p class="cfg-privacy">Wij gebruiken uw gegevens alleen om contact met u op te nemen over deze aanvraag.</p>`,
    `</form>`,
  ];
}

function configurator(productId) {
  const product = catalog.products[productId];
  if (!product) fail(`onbekend product "${productId}" in een configurator-markering.`);
  const prefix = `cfg-${productId}`;
  const image = product.images.find((entry) => !Object.keys(entry.when ?? {}).length) ?? product.images[0];
  const contact = '/contact';

  const lines = [];
  lines.push(`<section class="cfg" id="samenstellen" data-configurator="${esc(productId)}" aria-labelledby="${prefix}-titel" tabindex="-1">`);
  lines.push(`  <div class="cfg-wrap">`);
  lines.push(`    <header class="cfg-intro">`);
  lines.push(`      <p class="cfg-eyebrow">Configurator</p>`);
  lines.push(`      <h2 class="cfg-title" id="${prefix}-titel">Stel uw ${esc(product.name)} samen</h2>`);
  lines.push(`      <p class="cfg-lead">Kies de uitvoering en de accessoires die bij uw gebruik passen. U ziet direct wat uw Airtrailer kost.</p>`);
  lines.push(`      <nav class="cfg-steps" aria-label="Stappen van de configurator">`);
  lines.push(`        <ol>`);
  lines.push(`          <li><a href="#${prefix}-stap-1"><span class="cfg-steps-number" aria-hidden="true">1</span><span class="cfg-visually-hidden">Stap 1: </span>Uw Airtrailer</a></li>`);
  lines.push(`          <li><a href="#${prefix}-stap-2"><span class="cfg-steps-number" aria-hidden="true">2</span><span class="cfg-visually-hidden">Stap 2: </span>Accessoires</a></li>`);
  lines.push(`          <li data-cfg-needs-js hidden><a href="#${prefix}-stap-3"><span class="cfg-steps-number" aria-hidden="true">3</span><span class="cfg-visually-hidden">Stap 3: </span>Overzicht en aanvraag</a></li>`);
  lines.push(`        </ol>`);
  lines.push(`      </nav>`);
  lines.push(`      <div class="cfg-notice" data-cfg-restored hidden></div>`);
  lines.push(`    </header>`);

  lines.push(`    <div class="cfg-layout">`);
  lines.push(`      <div class="cfg-main">`);

  // Stap 1
  lines.push(`        <section class="cfg-step" id="${prefix}-stap-1" aria-labelledby="${prefix}-stap-1-titel" data-cfg-step="1">`);
  lines.push(`          <p class="cfg-step-label">Stap 1</p>`);
  lines.push(`          <h3 class="cfg-step-title" id="${prefix}-stap-1-titel" tabindex="-1">Uw Airtrailer</h3>`);
  lines.push(`          <div class="cfg-stage">`);
  lines.push(`            <figure class="cfg-stage-figure">`);
  lines.push(
    `              <img data-cfg-image src="${esc(image.src)}"${image.srcset ? ` srcset="${esc(image.srcset)}" sizes="(max-width: 991px) 100vw, 760px"` : ''} width="${image.width}" height="${image.height}" alt="${esc(image.alt)}" loading="lazy" decoding="async">`,
  );
  lines.push(`              <figcaption class="cfg-stage-note" data-cfg-image-note hidden></figcaption>`);
  lines.push(`            </figure>`);
  lines.push(`            <div class="cfg-stage-info">`);
  lines.push(`              <p class="cfg-stage-name">${esc(product.name)}</p>`);
  lines.push(`              <p class="cfg-stage-price"><span class="cfg-stage-from">Vanaf</span> <strong>${euro(product.basePrice)}</strong> <span class="cfg-stage-vat">incl. btw</span></p>`);
  lines.push(`              <p class="cfg-stage-text">${esc(product.description)}</p>`);
  lines.push(`              <p class="cfg-included-title">Standaard inbegrepen</p>`);
  lines.push(`              <ul class="cfg-included">`);
  for (const item of product.included) lines.push(`                <li>${CHECK_ICON}<span>${esc(item)}</span></li>`);
  lines.push(`              </ul>`);
  lines.push(`            </div>`);
  lines.push(`          </div>`);
  lines.push(...variants(product, prefix).map((line) => `          ${line}`));
  lines.push(`        </section>`);

  // Stap 2
  lines.push(`        <section class="cfg-step" id="${prefix}-stap-2" aria-labelledby="${prefix}-stap-2-titel" data-cfg-step="2">`);
  lines.push(`          <p class="cfg-step-label">Stap 2</p>`);
  lines.push(`          <h3 class="cfg-step-title" id="${prefix}-stap-2-titel" tabindex="-1">Kies uw accessoires</h3>`);
  lines.push(`          <p class="cfg-step-intro">Breid uw Airtrailer uit naar wens. Alle bedragen zijn meerprijzen inclusief btw.</p>`);
  for (const entry of product.groups) lines.push(...group(entry, product, prefix).map((line) => `          ${line}`));
  lines.push(`        </section>`);
  lines.push(`      </div>`);

  // Samenvatting (desktop, blijft in beeld). app.js vult dit blok.
  lines.push(`      <aside class="cfg-aside" aria-labelledby="${prefix}-samenvatting-titel">`);
  lines.push(`        <div class="cfg-summary" data-cfg-summary>`);
  lines.push(`          <h3 class="cfg-summary-title" id="${prefix}-samenvatting-titel">Uw samenstelling</h3>`);
  lines.push(`          <div data-cfg-summary-body>`);
  lines.push(`            <dl class="cfg-lines"><div class="cfg-line"><dt>${esc(product.name)}</dt><dd>${esc(formatEuro(toCents(product.basePrice), { decimals: 'always' }))}</dd></div></dl>`);
  lines.push(`            <p class="cfg-nojs">Om accessoires te kiezen en uw prijs te berekenen is JavaScript nodig. U kunt ook via de <a href="${contact}">contactpagina</a> een prijsopgave aanvragen.</p>`);
  lines.push(`          </div>`);
  lines.push(`        </div>`);
  lines.push(`      </aside>`);
  lines.push(`    </div>`);

  // Stap 3
  lines.push(`    <section class="cfg-step cfg-finish" id="${prefix}-stap-3" aria-labelledby="${prefix}-stap-3-titel" data-cfg-step="3" data-cfg-needs-js hidden>`);
  lines.push(`      <p class="cfg-step-label">Stap 3</p>`);
  lines.push(`      <h3 class="cfg-step-title" id="${prefix}-stap-3-titel" tabindex="-1">Uw persoonlijke Airtrailer</h3>`);
  lines.push(`      <div class="cfg-finish-grid">`);
  lines.push(`        <div class="cfg-overview" data-cfg-overview></div>`);
  lines.push(`        <div class="cfg-request" data-cfg-request>`);
  lines.push(...requestForm(product, prefix).map((line) => `          ${line}`));
  lines.push(`        </div>`);
  lines.push(`      </div>`);
  lines.push(`    </section>`);
  lines.push(`  </div>`);

  // Prijsbalk (mobiel). app.js vult dit blok.
  lines.push(`  <div class="cfg-bar" data-cfg-bar hidden>`);
  lines.push(`    <div class="cfg-bar-total"><span class="cfg-bar-label">Totaal incl. btw</span><strong class="cfg-bar-price" data-cfg-bar-price>${esc(formatEuro(toCents(product.basePrice), { decimals: 'always' }))}</strong><span class="cfg-bar-count" data-cfg-bar-count></span></div>`);
  lines.push(`    <a class="cfg-button cfg-button--primary" href="#${prefix}-stap-3" data-cfg-to-overview>Overzicht</a>`);
  lines.push(`  </div>`);
  lines.push(`  <div class="cfg-visually-hidden" role="status" aria-live="polite" data-cfg-live></div>`);
  lines.push(`</section>`);
  return lines;
}

function jsonLd(productId) {
  const product = catalog.products[productId];
  if (!product) fail(`onbekend product "${productId}" in een jsonld-markering.`);
  const image = product.images.find((entry) => !Object.keys(entry.when ?? {}).length) ?? product.images[0];
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    image: SITE + image.src,
    brand: { '@type': 'Brand', name: 'Airtrailer' },
    offers: {
      '@type': 'Offer',
      url: SITE + product.page,
      priceCurrency: catalog.currency,
      price: (toCents(product.basePrice) / 100).toFixed(2),
    },
  };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

// ---------------------------------------------------------------------------
// Markeringen vullen
// ---------------------------------------------------------------------------

const attributesOf = (raw) => Object.fromEntries([...raw.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));

const BLOCK = /^([ \t]*)(<!-- configurator:start([^>]*?)-->)[\s\S]*?(<!-- configurator:end -->)/gm;
const PRICE = /(<!-- configurator:price([^>]*?)-->)[\s\S]*?(<!-- configurator:price-end -->)/g;
const JSONLD = /^([ \t]*)(<!-- configurator:jsonld([^>]*?)-->)[\s\S]*?(<!-- configurator:jsonld-end -->)/gm;

const changed = [];
const built = [];

for (const file of readdirSync(ROOT).filter((name) => name.endsWith('.html'))) {
  const source = readFileSync(join(ROOT, file), 'utf8');
  if (!source.includes('<!-- configurator:')) continue;

  let result = source.replace(BLOCK, (_, indent, start, raw, end) => {
    const { product } = attributesOf(raw);
    built.push(`${file} (${product})`);
    return [indent + start, ...configurator(product).map((line) => indent + line), indent + end].join('\n');
  });
  result = result.replace(PRICE, (_, start, raw, end) => {
    const product = catalog.products[attributesOf(raw).product];
    if (!product) fail(`${file}: onbekend product in een prijs-markering.`);
    return start + euro(product.basePrice) + end;
  });
  result = result.replace(JSONLD, (_, indent, start, raw, end) => {
    return [indent + start, indent + jsonLd(attributesOf(raw).product), indent + end].join('\n');
  });

  // Verwijzingen binnen de configurator moeten kloppen.
  const ids = new Set([...result.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  for (const match of result.matchAll(/\s(?:aria-labelledby|aria-describedby|for)="([^"]+)"/g)) {
    for (const id of match[1].split(/\s+/)) {
      if (!ids.has(id)) fail(`${file}: verwijzing naar ontbrekend id "${id}".`);
    }
  }
  const duplicates = [...result.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]).filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicates.length) fail(`${file}: dubbele id's: ${[...new Set(duplicates)].join(', ')}`);

  if (result !== source) {
    changed.push(file);
    if (!CHECK_ONLY) writeFileSync(join(ROOT, file), result);
  }
}

if (CHECK_ONLY && changed.length) {
  fail(`de pagina's lopen achter op de catalogus. Draai "node scripts/build-configurator.mjs".\n  ${changed.join('\n  ')}`);
}

console.log(
  [
    `Configurator: ${built.length ? built.join(', ') : 'geen pagina met een configurator-markering gevonden'}.`,
    CHECK_ONLY ? 'Alles is bijgewerkt.' : changed.length ? `Bijgewerkt: ${changed.join(', ')}.` : 'Geen wijzigingen.',
  ].join(' '),
);
