// Configurator in de browser. Maakt de statische kaarten op de productpagina interactief.
//
// De HTML van de kaarten komt uit scripts/build-configurator.mjs; alle regels en prijzen uit
// engine.js en catalog.js. Dit bestand regelt alleen wat de bezoeker ziet en doet.

import { catalog } from './catalog.js';
import {
  calculate,
  decodeSelection,
  emptySelection,
  encodeSelection,
  formatEuro,
  getAccessory,
  getProduct,
  maxOf,
  pickImage,
  sanitize,
  slotUsage,
  summaryText,
  tryChange,
} from './engine.js';
import { createTracker } from './track.js';

const ENDPOINT = '/api/aanvraag';
const LINK_PARAMETER = 'samenstelling';

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const money = (cents) => escapeHtml(formatEuro(cents, { decimals: 'always' }));

const REMOVE_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M3 3l10 10M13 3L3 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"/></svg>';

// Opslag kan geblokkeerd zijn (privémodus, instellingen); de configurator werkt dan gewoon door.
const storage = {
  read(area, key) {
    try {
      return window[area].getItem(key);
    } catch {
      return null;
    }
  },
  write(area, key, value) {
    try {
      if (value === null) window[area].removeItem(key);
      else window[area].setItem(key, value);
    } catch {
      /* geen opslag beschikbaar */
    }
  },
};

for (const root of document.querySelectorAll('[data-configurator]')) {
  try {
    init(root);
  } catch (error) {
    // Bij een fout blijft de statische pagina staan: prijzen leesbaar, contact bereikbaar.
    root.classList.remove('cfg--js');
    console.error('[configurator]', error);
  }
}

function init(root) {
  const productId = root.dataset.configurator;
  const product = getProduct(catalog, productId);
  const tracker = createTracker(productId);
  const storageKey = `airtrailer-configurator:${productId}`;
  const draftKey = `airtrailer-aanvraag-concept:${productId}`;
  const startedAt = Date.now();

  const $ = (selector, scope = root) => scope.querySelector(selector);
  const $$ = (selector, scope = root) => [...scope.querySelectorAll(selector)];

  const elements = {
    live: $('[data-cfg-live]'),
    summary: $('[data-cfg-summary-body]'),
    overview: $('[data-cfg-overview]'),
    request: $('[data-cfg-request]'),
    form: $('[data-cfg-form]'),
    bar: $('[data-cfg-bar]'),
    barPrice: $('[data-cfg-bar-price]'),
    barCount: $('[data-cfg-bar-count]'),
    image: $('[data-cfg-image]'),
    imageNote: $('[data-cfg-image-note]'),
    restored: $('[data-cfg-restored]'),
    finish: $('[data-cfg-step="3"]'),
    finishTitle: $('[data-cfg-step="3"] .cfg-step-title'),
  };
  const formMarkup = elements.request.innerHTML;

  // --- Begintoestand: gedeelde link gaat voor een bewaarde samenstelling -------------------

  let selection = emptySelection(catalog, productId);
  let origin = null;
  const url = new URL(window.location.href);
  const shared = url.searchParams.get(LINK_PARAMETER);
  const stored = storage.read('localStorage', storageKey);
  const source = shared ? decodeSelection(shared) : stored ? decodeSelection(stored) : null;
  if (source && source.product === productId) {
    const restored = sanitize(catalog, source, productId);
    selection = restored.selection;
    const isEmpty = selection.variant === product.variants[0].id && !Object.keys(selection.items).length;
    if (!isEmpty) origin = { type: shared ? 'link' : 'stored', dropped: restored.dropped };
  }
  if (shared) {
    url.searchParams.delete(LINK_PARAMETER);
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  let result = calculate(catalog, selection);
  let openConflict = null;

  root.classList.add('cfg--js');
  for (const element of $$('[data-cfg-needs-js]')) element.hidden = false;

  // --- Aankondigingen voor schermlezers -----------------------------------------------------
  // Eén korte zin per wijziging; het totaalbedrag zelf is geen live-regio.

  let announceTimer;
  function announce(message) {
    window.clearTimeout(announceTimer);
    elements.live.textContent = '';
    announceTimer = window.setTimeout(() => {
      elements.live.textContent = message;
    }, 60);
  }

  const totalSentence = () => `Totaal ${formatEuro(result.totalCents, { decimals: 'always' })}.`;

  // --- Wijzigingen doorvoeren ---------------------------------------------------------------

  function commit(next, message, { silent = false } = {}) {
    selection = next;
    result = calculate(catalog, selection);
    storage.write('localStorage', storageKey, isUntouched() ? null : encodeSelection(selection));
    closeConflict();
    render();
    if (!silent && message) announce(`${message} ${totalSentence()}`);
  }

  function isUntouched() {
    return selection.variant === product.variants[0].id && !Object.keys(selection.items).length;
  }

  function nameOf(id, quantity = 1) {
    const accessory = getAccessory(catalog, id);
    return quantity > 1 ? `${quantity} ${accessory.plural}` : accessory.name;
  }

  // Probeert een aantal te zetten. Bij een botsing verschijnt de uitleg bij het accessoire.
  function setQuantity(id, quantity, trigger) {
    const before = selection.items[id] ?? 0;
    if (quantity === before) return;
    const attempt = tryChange(catalog, selection, { type: 'set', id, quantity });
    tracker.once('configurator_start');

    if (!attempt.ok) {
      syncControls();
      tracker.event('configurator_combinatie_melding', { regel: attempt.conflict.code, accessoire: id });
      if (attempt.conflict.code === 'max' && !attempt.conflict.resolutions.length) {
        announce(attempt.conflict.message);
        showHint(id, attempt.conflict.message);
        return;
      }
      showConflict(id, attempt.conflict, trigger);
      return;
    }

    const accessory = getAccessory(catalog, id);
    let message;
    if (quantity === 0) {
      message = `${accessory.name} verwijderd.`;
      if (attempt.removed.length) message += ` Ook vervallen: ${attempt.removed.map((other) => getAccessory(catalog, other).name).join(', ')}.`;
      tracker.event('configurator_accessoire_verwijderd', { accessoire: id });
    } else if (quantity < before) {
      message = `${nameOf(id, quantity)}.`;
      tracker.event('configurator_accessoire_verwijderd', { accessoire: id, aantal: quantity });
    } else {
      message =
        accessory.status === 'on-request'
          ? `${accessory.name} staat in uw aanvraag, prijs op aanvraag.`
          : maxOf(accessory) > 1
            ? `${nameOf(id, quantity)} toegevoegd.`
            : `${accessory.name} toegevoegd.`;
      const next = calculate(catalog, attempt.selection).lines.find((line) => line.id === id);
      tracker.event('configurator_accessoire_toegevoegd', {
        accessoire: id,
        aantal: quantity,
        ...(next?.unitCents != null ? { value: next.unitCents / 100, currency: 'EUR' } : {}),
      });
    }
    commit(attempt.selection, message);
  }

  function setVariant(id, trigger) {
    if (id === selection.variant) return;
    const attempt = tryChange(catalog, selection, { type: 'variant', id });
    tracker.once('configurator_start');
    if (!attempt.ok) {
      syncControls();
      tracker.event('configurator_combinatie_melding', { regel: attempt.conflict.code, uitvoering: id });
      showConflict(null, attempt.conflict, trigger, $('.cfg-variants'));
      return;
    }
    const variant = product.variants.find((entry) => entry.id === id);
    tracker.event('configurator_uitvoering_gekozen', { uitvoering: id });
    commit(attempt.selection, `Uitvoering ${variant.name} gekozen${variant.status === 'on-request' ? ', prijs op aanvraag' : ''}.`);
  }

  function reset() {
    commit(emptySelection(catalog, productId), 'Uw samenstelling is leeggemaakt.');
    elements.restored.hidden = true;
    tracker.event('configurator_opnieuw_begonnen');
  }

  // --- Uitleg bij een onmogelijke combinatie -------------------------------------------------

  function closeConflict({ restoreFocus = false } = {}) {
    if (!openConflict) return;
    const { panel, trigger } = openConflict;
    openConflict = null;
    panel.remove();
    if (restoreFocus && trigger && document.contains(trigger)) trigger.focus();
  }

  function showConflict(id, conflict, trigger, anchor) {
    closeConflict();
    const host = anchor ?? cardOf(id);
    if (!host) {
      announce(conflict.message);
      return;
    }
    const panel = document.createElement('div');
    panel.className = 'cfg-conflict';
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-labelledby', 'cfg-conflict-title');
    panel.tabIndex = -1;
    panel.innerHTML = [
      `<p class="cfg-conflict-title" id="cfg-conflict-title">${escapeHtml(conflict.title)}</p>`,
      `<p class="cfg-conflict-text">${escapeHtml(conflict.message)}</p>`,
      `<div class="cfg-conflict-actions">`,
      ...conflict.resolutions.map(
        (resolution, index) =>
          `<button type="button" class="cfg-button cfg-button--primary" data-cfg-resolve="${index}">${escapeHtml(resolution.label)}</button>`,
      ),
      `<button type="button" class="cfg-button" data-cfg-dismiss>${conflict.resolutions.length ? 'Laat mijn samenstelling zo' : 'Sluiten'}</button>`,
      `</div>`,
    ].join('');

    panel.addEventListener('click', (event) => {
      const resolve = event.target.closest('[data-cfg-resolve]');
      if (resolve) {
        const resolution = conflict.resolutions[Number(resolve.dataset.cfgResolve)];
        tracker.event('configurator_combinatie_opgelost', { regel: conflict.code });
        commit(resolution.selection, `Gedaan: ${resolution.label.toLowerCase()}.`);
        // Terug naar de knop waar de bezoeker vandaan kwam, of anders naar de kaart zelf.
        const target = trigger && document.contains(trigger) ? trigger : host.querySelector('[data-cfg-toggle], [data-cfg-step="1"], [data-cfg-variant]:checked');
        target?.focus({ preventScroll: true });
        return;
      }
      if (event.target.closest('[data-cfg-dismiss]')) closeConflict({ restoreFocus: true });
    });
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeConflict({ restoreFocus: true });
      }
    });

    host.append(panel);
    openConflict = { panel, trigger };
    // De focus gaat naar de uitleg: een schermlezer leest titel en tekst voor, en de knoppen
    // met de oplossing volgen direct.
    panel.focus({ preventScroll: true });
    panel.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const cardOf = (id) => $(`[data-cfg-card="${CSS.escape(id)}"]`);

  // Korte toelichting onder de knop van een kaart. `kind` zegt waar de toelichting over gaat,
  // zodat ze weer verdwijnt zodra die reden vervalt.
  function setHint(card, kind, message) {
    let hint = $(':scope > [data-cfg-hint]', card);
    if (!message) {
      if (hint && hint.dataset.cfgHint === kind) hint.remove();
      return;
    }
    if (!hint) {
      hint = document.createElement('p');
      hint.className = 'cfg-hint';
      ($(':scope > .cfg-card-foot, :scope > .cfg-sub-foot', card) ?? card).after(hint);
    }
    hint.dataset.cfgHint = kind;
    hint.textContent = message;
  }

  function showHint(id, message) {
    const card = cardOf(id);
    if (card) setHint(card, 'max', message);
  }

  // --- Tekenen ------------------------------------------------------------------------------

  function syncControls() {
    for (const input of $$('[data-cfg-toggle]')) {
      const id = input.dataset.cfgToggle;
      const selected = (selection.items[id] ?? 0) > 0;
      input.checked = selected;
      cardOf(id)?.classList.toggle('is-selected', selected);
    }
    for (const output of $$('[data-cfg-quantity]')) {
      const id = output.dataset.cfgQuantity;
      const quantity = selection.items[id] ?? 0;
      const accessory = getAccessory(catalog, id);
      output.textContent = String(quantity);
      const card = cardOf(id);
      card?.classList.toggle('is-selected', quantity > 0);
      const [minus, plus] = [$(`[data-cfg-for="${CSS.escape(id)}"][data-cfg-step="-1"]`), $(`[data-cfg-for="${CSS.escape(id)}"][data-cfg-step="1"]`)];
      // aria-disabled in plaats van disabled: de focus blijft op de knop staan.
      minus?.setAttribute('aria-disabled', String(quantity === 0));
      plus?.setAttribute('aria-disabled', String(quantity >= maxOf(accessory)));
      const group = output.closest('.cfg-qty');
      group?.setAttribute('aria-label', `Aantal ${accessory.plural}: ${quantity}`);
    }
    for (const input of $$('[data-cfg-variant]')) {
      input.checked = input.value === selection.variant;
      input.closest('[data-cfg-variant-card]')?.classList.toggle('is-selected', input.checked);
    }
    for (const block of $$('[data-cfg-children]')) {
      block.hidden = !((selection.items[block.dataset.cfgChildren] ?? 0) > 0);
    }
  }

  function renderSlots() {
    const usage = slotUsage(catalog, selection);
    for (const block of $$('[data-cfg-slots]')) {
      const type = block.dataset.cfgSlots;
      const slot = catalog.slotTypes[type];
      const { used, capacity, free } = usage[type];
      $$('.cfg-slots-pip', block).forEach((pip, index) => pip.classList.toggle('is-used', index < used));
      const status = $('[data-cfg-slots-status]', block);
      if (free === 0) status.textContent = `${capacity === 2 ? 'Beide' : `Alle ${capacity}`} ${slot.plural} bezet`;
      else status.textContent = `Nog ${free} van ${capacity} ${slot.plural} vrij`;
      block.classList.toggle('is-full', free === 0);
    }
    // Kaarten die een plaats nodig hebben terwijl alles bezet is, krijgen een toelichting.
    for (const card of $$('[data-cfg-card]')) {
      const id = card.dataset.cfgCard;
      const accessory = getAccessory(catalog, id);
      const needs = Object.entries(accessory.slots ?? {});
      const quantity = selection.items[id] ?? 0;
      const atMax = quantity >= maxOf(accessory);
      if (!atMax) setHint(card, 'max', null);
      const short = needs.find(([type, perUnit]) => usage[type].free < perUnit);
      if (!short || atMax) {
        setHint(card, 'slots', null);
        continue;
      }
      const slot = catalog.slotTypes[short[0]];
      setHint(
        card,
        'slots',
        quantity > 0
          ? `Geen ${slot.singular} meer vrij voor nog een ${accessory.name.toLowerCase()}. Kiest u er toch één, dan vervalt een ander accessoire.`
          : `Geen ${slot.singular} meer vrij. Kiest u dit accessoire, dan vervalt een ander.`,
      );
    }
  }

  function renderImage() {
    const image = pickImage(catalog, selection);
    const variant = product.variants.find((entry) => entry.id === selection.variant);
    if (elements.image.getAttribute('src') !== image.src) {
      elements.image.src = image.src;
      if (image.srcset) elements.image.srcset = image.srcset;
      else elements.image.removeAttribute('srcset');
      elements.image.alt = image.alt;
      elements.image.width = image.width;
      elements.image.height = image.height;
    }
    // Geen foto van de gekozen uitvoering? Dan zeggen we dat erbij, in plaats van te doen alsof.
    const mismatch = image.shows && image.shows !== selection.variant;
    elements.imageNote.hidden = !mismatch;
    if (mismatch) {
      const shown = product.variants.find((entry) => entry.id === image.shows);
      elements.imageNote.textContent = `Afgebeeld: uitvoering ${shown?.name ?? image.shows}. Van de ${variant.name} is nog geen productfoto beschikbaar.`;
    }
  }

  function variantRows() {
    const { variant } = result;
    if (variant.isDefault && !variant.onRequest) return '';
    const price = variant.onRequest ? '<span class="cfg-on-request">Op aanvraag</span>' : money(variant.cents);
    return `<div class="cfg-line"><dt>Uitvoering ${escapeHtml(variant.name)}</dt><dd>${price}</dd></div>`;
  }

  function onRequestNote() {
    if (!result.onRequest.length) return '';
    return `<p class="cfg-note"><strong>Prijs op aanvraag:</strong> ${escapeHtml(result.onRequest.join(', '))}. ${result.onRequest.length === 1 ? 'Dit onderdeel zit' : 'Deze onderdelen zitten'} niet in het totaal; u ontvangt de prijs in uw offerte.</p>`;
  }

  function discountRows() {
    return result.discounts
      .map((discount) => `<div class="cfg-line cfg-line--discount"><dt>${escapeHtml(discount.name)}</dt><dd>${escapeHtml(formatEuro(-discount.cents, { decimals: 'always' }))}</dd></div>`)
      .join('');
  }

  function renderSummary() {
    const variantName = product.variants.length > 1 && result.variant.isDefault ? `<span class="cfg-line-sub">Uitvoering ${escapeHtml(result.variant.name)}</span>` : '';
    const items = result.lines
      .map((line) => {
        const label = `${line.quantity > 1 ? `${line.quantity} × ` : ''}${escapeHtml(line.name)}`;
        const price = line.onRequest ? '<span class="cfg-on-request">Op aanvraag</span>' : money(line.cents);
        return [
          `<li class="cfg-item${line.parent ? ' cfg-item--child' : ''}">`,
          `<span class="cfg-item-name">${label}</span>`,
          `<span class="cfg-item-price">${price}</span>`,
          `<button type="button" class="cfg-remove" data-cfg-action="remove" data-cfg-id="${escapeHtml(line.id)}" data-cfg-key="s-remove:${escapeHtml(line.id)}" aria-label="${escapeHtml(line.name)} verwijderen">${REMOVE_ICON}</button>`,
          `</li>`,
        ].join('');
      })
      .join('');

    elements.summary.innerHTML = [
      `<dl class="cfg-lines">`,
      `<div class="cfg-line"><dt>${escapeHtml(result.base.name)}${variantName}</dt><dd>${money(result.base.cents)}</dd></div>`,
      variantRows(),
      `</dl>`,
      `<p class="cfg-lines-title">Accessoires</p>`,
      items ? `<ul class="cfg-items">${items}</ul>` : `<p class="cfg-empty">Nog geen accessoires gekozen.</p>`,
      result.discounts.length ? `<dl class="cfg-lines">${discountRows()}</dl>` : '',
      `<div class="cfg-total"><span class="cfg-total-label">Totaal <span class="cfg-total-vat">incl. btw</span></span><strong class="cfg-total-price" data-cfg-total>${money(result.totalCents)}</strong></div>`,
      onRequestNote(),
      `<a class="cfg-button cfg-button--primary cfg-button--wide" href="#${elements.finish.id}" data-cfg-to-overview data-cfg-key="s-overview">Naar overzicht en aanvraag</a>`,
      isUntouched() ? '' : `<button type="button" class="cfg-link" data-cfg-action="reset" data-cfg-key="s-reset">Opnieuw beginnen</button>`,
    ].join('');
  }

  function renderOverview() {
    const image = pickImage(catalog, selection);
    const variant = product.variants.find((entry) => entry.id === selection.variant);
    const step1 = $('[data-cfg-step="1"]').id;
    const step2 = $('[data-cfg-step="2"]').id;

    const items = result.lines
      .map((line) => {
        const accessory = getAccessory(catalog, line.id);
        const multiple = maxOf(accessory) > 1;
        const price = line.onRequest ? '<span class="cfg-on-request">Op aanvraag</span>' : money(line.cents);
        const each = !line.onRequest && line.quantity > 1 ? `<span class="cfg-row-each">${line.quantity} × ${money(line.unitCents)}</span>` : '';
        const quantity = multiple
          ? [
              `<span class="cfg-qty cfg-qty--small" role="group" aria-label="Aantal ${escapeHtml(accessory.plural)}: ${line.quantity}">`,
              `<button type="button" class="cfg-qty-button" data-cfg-action="step" data-cfg-id="${escapeHtml(line.id)}" data-cfg-delta="-1" data-cfg-key="o-minus:${escapeHtml(line.id)}" aria-label="Eén ${escapeHtml(accessory.name.toLowerCase())} minder"><span aria-hidden="true">−</span></button>`,
              `<span class="cfg-qty-value">${line.quantity}</span>`,
              `<button type="button" class="cfg-qty-button" data-cfg-action="step" data-cfg-id="${escapeHtml(line.id)}" data-cfg-delta="1" data-cfg-key="o-plus:${escapeHtml(line.id)}" aria-disabled="${line.quantity >= maxOf(accessory)}" aria-label="Eén ${escapeHtml(accessory.name.toLowerCase())} meer"><span aria-hidden="true">+</span></button>`,
              `</span>`,
            ].join('')
          : '';
        return [
          `<li class="cfg-row${line.parent ? ' cfg-row--child' : ''}">`,
          `<div class="cfg-row-text"><span class="cfg-row-name">${escapeHtml(line.name)}</span>${line.spec ? `<span class="cfg-row-spec">${escapeHtml(line.spec)}</span>` : ''}${each}</div>`,
          quantity,
          `<span class="cfg-row-price">${price}</span>`,
          `<button type="button" class="cfg-remove" data-cfg-action="remove" data-cfg-id="${escapeHtml(line.id)}" data-cfg-key="o-remove:${escapeHtml(line.id)}" aria-label="${escapeHtml(line.name)} verwijderen">${REMOVE_ICON}</button>`,
          `</li>`,
        ].join('');
      })
      .join('');

    const variantLine =
      product.variants.length > 1
        ? `<p class="cfg-overview-variant">Uitvoering: ${escapeHtml(variant.name)} <a class="cfg-link" href="#${step1}" data-cfg-key="o-variant">Wijzig<span class="cfg-visually-hidden"> uitvoering</span></a></p>`
        : '';

    elements.overview.innerHTML = [
      `<div class="cfg-overview-head">`,
      `<img class="cfg-overview-image" src="${escapeHtml(image.src)}" width="${image.width}" height="${image.height}" alt="" loading="lazy" decoding="async">`,
      `<div class="cfg-overview-model"><p class="cfg-overview-name">${escapeHtml(result.base.name)}</p>${variantLine}</div>`,
      `<p class="cfg-overview-base">${money(result.base.cents)}</p>`,
      `</div>`,
      `<details class="cfg-more cfg-overview-included"><summary>Standaard inbegrepen (${product.included.length})</summary><ul>${product.included.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></details>`,
      `<p class="cfg-lines-title">Uw accessoires</p>`,
      items ? `<ul class="cfg-rows">${items}</ul>` : `<p class="cfg-empty">U heeft nog geen accessoires gekozen. Dat hoeft ook niet: de ${escapeHtml(product.name)} is compleet met de standaarduitrusting.</p>`,
      `<p class="cfg-overview-edit"><a class="cfg-link" href="#${step2}" data-cfg-key="o-edit">${items ? 'Accessoires toevoegen of wijzigen' : 'Accessoires bekijken'}</a></p>`,
      `<dl class="cfg-lines cfg-lines--totals">`,
      `<div class="cfg-line"><dt>${escapeHtml(result.base.name)}</dt><dd>${money(result.base.cents)}</dd></div>`,
      variantRows(),
      `<div class="cfg-line"><dt>Accessoires${result.itemCount ? ` (${result.itemCount})` : ''}</dt><dd>${money(result.accessoriesCents)}</dd></div>`,
      discountRows(),
      `</dl>`,
      `<div class="cfg-total cfg-total--large"><span class="cfg-total-label">Totaal <span class="cfg-total-vat">incl. btw</span></span><strong class="cfg-total-price">${money(result.totalCents)}</strong></div>`,
      onRequestNote(),
      `<div class="cfg-share">`,
      `<button type="button" class="cfg-button" data-cfg-action="copy-link" data-cfg-key="o-copy">Kopieer link naar deze samenstelling</button>`,
      `<p class="cfg-share-note" data-cfg-share-note>Uw samenstelling blijft op dit apparaat bewaard. Met de link opent u haar ook ergens anders.</p>`,
      `</div>`,
    ].join('');
  }

  function renderBar() {
    elements.barPrice.textContent = formatEuro(result.totalCents, { decimals: 'always' });
    elements.barCount.textContent = result.itemCount === 0 ? 'Zonder accessoires' : result.itemCount === 1 ? '1 accessoire' : `${result.itemCount} accessoires`;
  }

  let lastTotal = result.totalCents;
  function render() {
    // Stond de focus in een blok dat opnieuw wordt opgebouwd, dan zetten we die terug.
    const active = document.activeElement;
    const container = active?.closest?.('[data-cfg-summary-body], [data-cfg-overview]');
    const key = container ? active.dataset.cfgKey : null;

    syncControls();
    renderSlots();
    renderImage();
    renderSummary();
    renderOverview();
    renderBar();

    if (container) {
      const same = key ? $(`[data-cfg-key="${CSS.escape(key)}"]`, container) : null;
      const fallback = $('.cfg-remove, [data-cfg-key="o-edit"], [data-cfg-to-overview]', container);
      (same ?? fallback)?.focus({ preventScroll: true });
    }

    if (result.totalCents !== lastTotal) {
      lastTotal = result.totalCents;
      for (const element of $$('.cfg-total-price, [data-cfg-bar-price]')) {
        element.classList.remove('is-updated');
        void element.offsetWidth;
        element.classList.add('is-updated');
      }
    }
  }

  // --- Bediening ----------------------------------------------------------------------------

  root.addEventListener('change', (event) => {
    const toggle = event.target.closest('[data-cfg-toggle]');
    if (toggle) {
      setQuantity(toggle.dataset.cfgToggle, toggle.checked ? 1 : 0, toggle);
      return;
    }
    const variant = event.target.closest('[data-cfg-variant]');
    if (variant && variant.checked) setVariant(variant.value, variant);
  });

  root.addEventListener('click', (event) => {
    const step = event.target.closest('[data-cfg-step][data-cfg-for]');
    if (step) {
      const id = step.dataset.cfgFor;
      const delta = Number(step.dataset.cfgStep);
      const current = selection.items[id] ?? 0;
      if (delta < 0 && current === 0) return;
      setQuantity(id, current + delta, step);
      return;
    }

    const action = event.target.closest('[data-cfg-action]');
    if (action) {
      const id = action.dataset.cfgId;
      if (action.dataset.cfgAction === 'remove') setQuantity(id, 0, action);
      else if (action.dataset.cfgAction === 'step') {
        const next = (selection.items[id] ?? 0) + Number(action.dataset.cfgDelta);
        if (next > maxOf(getAccessory(catalog, id))) announce(`Maximaal ${maxOf(getAccessory(catalog, id))} ${getAccessory(catalog, id).plural}.`);
        else setQuantity(id, Math.max(0, next), action);
      } else if (action.dataset.cfgAction === 'reset') reset();
      else if (action.dataset.cfgAction === 'copy-link') copyLink();
      else if (action.dataset.cfgAction === 'edit-request') restoreForm();
      return;
    }

    // Links binnen de configurator (stappen, "naar overzicht", "wijzig"): rustig erheen scrollen
    // en de focus op de kop van die stap zetten, zodat toetsenbord en schermlezer volgen.
    const jump = event.target.closest('a[href^="#"]');
    if (jump) {
      const target = document.getElementById(jump.getAttribute('href').slice(1));
      if (target && root.contains(target)) {
        event.preventDefault();
        // De Webflow-runtime van de site vangt ankerlinks ook af (eigen scroll-animatie).
        // Binnen de configurator regelen we scrollen en focus zelf.
        event.stopPropagation();
        goTo(target);
      }
      return;
    }

    // Gemak voor muis en touch: een klik op de kaart zelf werkt als de knop.
    if (event.target.closest('a, button, input, label, summary, details, .cfg-conflict, .cfg-sub')) return;
    const card = event.target.closest('.cfg-card');
    const toggle = card && $(':scope > .cfg-card-foot [data-cfg-toggle]', card);
    if (toggle) {
      toggle.checked = !toggle.checked;
      setQuantity(toggle.dataset.cfgToggle, toggle.checked ? 1 : 0, toggle);
    }
  });

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openConflict) closeConflict({ restoreFocus: true });
  });

  function goTo(target) {
    const heading = target.querySelector('.cfg-step-title') ?? target;
    if (prefersReducedMotion()) {
      target.scrollIntoView({ block: 'start' });
      heading.focus({ preventScroll: true });
      return;
    }
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    // De focus pas verplaatsen als het scrollen klaar is; eerder breekt de beweging af.
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('scrollend', finish);
      heading.focus({ preventScroll: true });
    };
    // Browsers zonder scrollend-event krijgen een ruime vaste wachttijd.
    if ('onscrollend' in window) window.addEventListener('scrollend', finish, { once: true });
    window.setTimeout(finish, 'onscrollend' in window ? 4000 : 1600);
  }

  async function copyLink() {
    const link = new URL(window.location.origin + window.location.pathname);
    link.searchParams.set(LINK_PARAMETER, encodeSelection(selection));
    link.hash = root.id;
    const note = $('[data-cfg-share-note]');
    try {
      await navigator.clipboard.writeText(link.href);
      note.textContent = 'De link is gekopieerd. Plak hem in een bericht of bewaar hem bij uw favorieten.';
      announce('De link naar uw samenstelling is gekopieerd.');
    } catch {
      // Geen toegang tot het klembord: toon de link zodat de bezoeker hem zelf kan kopiëren.
      note.innerHTML = `Kopieer deze link: <input class="cfg-share-input" type="text" readonly value="${escapeHtml(link.href)}" aria-label="Link naar uw samenstelling">`;
      const input = $('.cfg-share-input', note);
      input.focus();
      input.select();
    }
    tracker.event('configurator_link_gekopieerd');
  }

  // --- Melding bij een teruggezette samenstelling --------------------------------------------

  if (origin) {
    const text =
      origin.type === 'link'
        ? 'U bekijkt een gedeelde samenstelling. U kunt haar hieronder aanpassen.'
        : 'Uw eerdere samenstelling staat weer voor u klaar.';
    const dropped = origin.dropped.length ? ' Een deel van de keuzes is niet meer beschikbaar en is vervallen.' : '';
    elements.restored.innerHTML = `<p>${text}${dropped}</p><button type="button" class="cfg-link" data-cfg-action="reset">Opnieuw beginnen</button>`;
    elements.restored.hidden = false;
  }

  // --- Aanvraagformulier ---------------------------------------------------------------------

  const FIELDS = ['name', 'email', 'phone', 'message'];

  function bindForm() {
    const form = $('[data-cfg-form]');
    elements.form = form;

    // Eerder ingevulde gegevens terugzetten (alleen in deze browsersessie bewaard).
    try {
      const draft = JSON.parse(storage.read('sessionStorage', draftKey) ?? 'null');
      if (draft) for (const name of FIELDS) if (typeof draft[name] === 'string') form.elements[name].value = draft[name];
    } catch {
      /* geen concept */
    }

    form.addEventListener('input', (event) => {
      tracker.once('configurator_aanvraag_gestart');
      const draft = Object.fromEntries(FIELDS.map((name) => [name, form.elements[name].value]));
      storage.write('sessionStorage', draftKey, JSON.stringify(draft));
      if (event.target.getAttribute('aria-invalid') === 'true') setFieldError(form, event.target.name, '');
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submit(form);
    });
  }

  function setFieldError(form, name, message) {
    const input = form.elements[name];
    const error = document.getElementById(`${input.id}-fout`);
    if (!error) return;
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      error.textContent = message;
      error.hidden = false;
    } else {
      input.removeAttribute('aria-invalid');
      error.textContent = '';
      error.hidden = true;
    }
  }

  function validateForm(form) {
    const errors = {};
    const name = form.elements.name.value.trim();
    const email = form.elements.email.value.trim();
    const phone = form.elements.phone.value.trim();
    if (name.length < 2) errors.name = 'Vul uw naam in.';
    if (!email) errors.email = 'Vul uw e-mailadres in.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Dit e-mailadres lijkt niet te kloppen. Controleer het, bijvoorbeeld naam@voorbeeld.nl.';
    if (phone && (!/^[0-9+()\s./-]+$/.test(phone) || phone.replace(/\D/g, '').length < 8)) {
      errors.phone = 'Dit telefoonnummer lijkt niet te kloppen. U mag het veld ook leeg laten.';
    }
    return errors;
  }

  function showFormMessage(form, html) {
    const box = $('[data-cfg-form-errors]', form);
    box.innerHTML = html;
    box.hidden = !html;
    if (html) box.focus({ preventScroll: false });
  }

  let submitting = false;
  async function submit(form) {
    if (submitting) return;
    const errors = validateForm(form);
    for (const name of ['name', 'email', 'phone']) setFieldError(form, name, errors[name] ?? '');
    const invalid = Object.keys(errors);
    if (invalid.length) {
      showFormMessage(form, '');
      form.elements[invalid[0]].focus();
      announce(invalid.length === 1 ? errors[invalid[0]] : `Er zijn ${invalid.length} velden die nog niet kloppen. ${errors[invalid[0]]}`);
      tracker.event('configurator_aanvraag_fout', { soort: 'invoer' });
      return;
    }

    const button = $('[data-cfg-submit]', form);
    const label = button.textContent;
    submitting = true;
    button.setAttribute('aria-disabled', 'true');
    button.textContent = 'Bezig met verzenden…';
    showFormMessage(form, '');

    const contact = {
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      phone: form.elements.phone.value.trim(),
      message: form.elements.message.value.trim(),
      copy: form.elements.copy.checked,
    };
    const payload = {
      type: 'configurator',
      selection,
      totalCents: result.totalCents,
      contact,
      website: form.elements.website.value,
      elapsedMs: Date.now() - startedAt,
    };

    let response;
    let body = null;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      body = await response.json().catch(() => null);
    } catch {
      response = null;
    }

    submitting = false;
    button.removeAttribute('aria-disabled');
    button.textContent = label;

    if (response?.ok && body?.ok) {
      storage.write('sessionStorage', draftKey, null);
      tracker.once(
        'configurator_aanvraag_verzonden',
        { value: result.totalCents / 100, currency: 'EUR', aantal_accessoires: result.itemCount, op_aanvraag: result.onRequest.length },
        `verzonden:${body.reference}`,
      );
      showConfirmation(contact, body);
      return;
    }

    if (response?.status === 400 && body?.fields) {
      const names = Object.keys(body.fields);
      for (const name of names) if (form.elements[name]) setFieldError(form, name, body.fields[name]);
      form.elements[names[0]]?.focus();
      tracker.event('configurator_aanvraag_fout', { soort: 'invoer' });
      return;
    }

    if (response?.status === 409 && body?.code === 'price-changed') {
      // De prijs op de server wijkt af van wat de bezoeker zag: laat de pagina verversen.
      showFormMessage(
        form,
        `<p><strong>De prijzen zijn zojuist bijgewerkt.</strong> Het totaal van uw samenstelling is nu ${money(body.totalCents)}. Laad de pagina opnieuw om de actuele prijzen te zien; uw samenstelling en gegevens blijven bewaard.</p><p><button type="button" class="cfg-button" data-cfg-reload>Pagina opnieuw laden</button></p>`,
      );
      $('[data-cfg-reload]', form)?.addEventListener('click', () => window.location.reload());
      tracker.event('configurator_aanvraag_fout', { soort: 'prijs_gewijzigd' });
      return;
    }

    if (response?.status === 422 && body?.code === 'invalid-configuration') {
      showFormMessage(
        form,
        `<p><strong>Deze samenstelling kan niet worden aangevraagd.</strong> ${escapeHtml((body.errors ?? []).join(' '))}</p><p>Pas uw accessoires aan en probeer het opnieuw.</p>`,
      );
      tracker.event('configurator_aanvraag_fout', { soort: 'samenstelling' });
      return;
    }

    if (response?.status === 429) {
      showFormMessage(form, `<p><strong>U heeft kort na elkaar meerdere aanvragen verstuurd.</strong> Wacht een paar minuten en probeer het dan opnieuw.</p>`);
      tracker.event('configurator_aanvraag_fout', { soort: 'te_vaak' });
      return;
    }

    // Verzenden lukt niet: de bezoeker verliest niets en krijgt een andere weg aangeboden.
    const { email, phone, phoneHref } = catalog.contact;
    const mailBody = [
      `Graag ontvang ik een offerte voor deze samenstelling.`,
      '',
      summaryText(result),
      '',
      `Naam: ${contact.name}`,
      contact.phone ? `Telefoon: ${contact.phone}` : null,
      contact.message ? `Opmerkingen: ${contact.message}` : null,
    ]
      .filter((line) => line !== null)
      .join('\n');
    const mailto = `mailto:${email}?subject=${encodeURIComponent(`Aanvraag ${result.productName}`)}&body=${encodeURIComponent(mailBody)}`;
    showFormMessage(
      form,
      `<p><strong>Het verzenden is niet gelukt.</strong> Uw samenstelling en gegevens staan nog klaar. Probeer het over een moment opnieuw.</p><p>Lukt het niet? <a href="${escapeHtml(mailto)}">Stuur uw samenstelling per e-mail</a> of bel <a href="${phoneHref}">${escapeHtml(phone)}</a>.</p>`,
    );
    tracker.event('configurator_aanvraag_fout', { soort: response ? `server_${response.status}` : 'netwerk' });
  }

  function showConfirmation(contact, body) {
    const firstName = contact.name.split(/\s+/)[0];
    elements.request.innerHTML = [
      `<div class="cfg-confirmation" data-cfg-confirmation tabindex="-1">`,
      `<p class="cfg-confirmation-mark" aria-hidden="true"><svg viewBox="0 0 16 16" width="28" height="28" focusable="false"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"/></svg></p>`,
      `<h4 class="cfg-form-title">Bedankt, ${escapeHtml(firstName)}. Uw aanvraag is verzonden.</h4>`,
      `<p>Wij hebben uw samenstelling ontvangen en nemen contact met u op over uw offerte.</p>`,
      `<dl class="cfg-lines">`,
      `<div class="cfg-line"><dt>Referentie</dt><dd>${escapeHtml(body.reference)}</dd></div>`,
      `<div class="cfg-line"><dt>Totaal incl. btw</dt><dd>${money(body.totalCents)}</dd></div>`,
      `</dl>`,
      body.copySent ? `<p>Een kopie is onderweg naar ${escapeHtml(contact.email)}.</p>` : contact.copy ? `<p>De kopie per e-mail kon niet worden verstuurd. Uw aanvraag is wel bij ons aangekomen.</p>` : '',
      `<p class="cfg-confirmation-next">Liever eerst kijken? U bent welkom in Kampen. <a class="cfg-link" href="/contact">Bekijk adres en openingstijden</a></p>`,
      `<button type="button" class="cfg-link" data-cfg-action="edit-request">Samenstelling wijzigen en opnieuw aanvragen</button>`,
      `</div>`,
    ].join('');
    const box = $('[data-cfg-confirmation]');
    box.focus({ preventScroll: true });
    box.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    announce('Uw aanvraag is verzonden.');
  }

  function restoreForm() {
    elements.request.innerHTML = formMarkup;
    bindForm();
    $('[data-cfg-form] input')?.focus();
  }

  // --- Zichtbaarheid: prijsbalk (mobiel) en meetpunten per stap -------------------------------

  let inView = false;
  let finishInView = false;
  const updateBar = () => {
    elements.bar.hidden = !(inView && !finishInView);
  };

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        updateBar();
      },
      { rootMargin: '-30% 0px -30% 0px' },
    ).observe(root);

    new IntersectionObserver(
      ([entry]) => {
        finishInView = entry.isIntersecting;
        updateBar();
      },
      { rootMargin: '0px 0px -25% 0px' },
    ).observe(elements.finish);

    const stepObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const step = entry.target.dataset.cfgStep;
          tracker.once('configurator_stap_bekeken', { stap: Number(step) }, `stap:${step}`);
          if (step === '3') {
            tracker.once('configurator_voltooid', {
              value: result.totalCents / 100,
              currency: 'EUR',
              aantal_accessoires: result.itemCount,
            });
          }
          stepObserver.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -40% 0px' },
    );
    for (const step of $$('.cfg-step[data-cfg-step]')) stepObserver.observe(step);
  }

  bindForm();
  render();
}
