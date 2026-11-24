// Rekenhart van de configurator: combinatieregels en prijsberekening.
//
// Dit bestand bevat geen HTML en geen browser-code. Dezelfde functies draaien in de browser
// (configurator/app.js), op de server (api/aanvraag.js) en in de tests. Alle gegevens komen
// uit de catalogus die als eerste argument wordt meegegeven.
//
// Een samenstelling ("selection") ziet er zo uit:
//   { product: 'mono', variant: 'aluminium', items: { compressor: 1, fietsendrager: 2 } }
//
// Bedragen worden intern in hele centen gerekend, zodat optellen nooit afrondingsfouten geeft.

// ---------------------------------------------------------------------------
// Bedragen
// ---------------------------------------------------------------------------

export function toCents(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    throw new Error(`Ongeldig bedrag: ${amount}`);
  }
  const cents = Math.round(amount * 100);
  if (Math.abs(cents - amount * 100) > 1e-6) {
    throw new Error(`Bedrag heeft meer dan twee decimalen: ${amount}`);
  }
  return cents;
}

const NBSP = ' ';

// 335000 -> "€ 3.350" (decimals: 'auto') of "€ 3.350,00" (decimals: 'always').
// Bewust zonder Intl, zodat browser, server en tests exact dezelfde tekst geven.
export function formatEuro(cents, { decimals = 'auto' } = {}) {
  if (!Number.isInteger(cents)) throw new Error(`Geen heel aantal centen: ${cents}`);
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const euros = Math.floor(absolute / 100);
  const rest = absolute % 100;
  const grouped = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const withDecimals = decimals === 'always' || rest !== 0;
  const text = withDecimals ? `${grouped},${String(rest).padStart(2, '0')}` : grouped;
  return `${negative ? '−' + NBSP : ''}€${NBSP}${text}`;
}

// ---------------------------------------------------------------------------
// Catalogus lezen
// ---------------------------------------------------------------------------

export function getProduct(catalog, productId) {
  const product = catalog.products[productId];
  if (!product) throw new Error(`Onbekend product: ${productId}`);
  return product;
}

export function getAccessory(catalog, id) {
  return Object.prototype.hasOwnProperty.call(catalog.accessories, id) ? catalog.accessories[id] : null;
}

export function childrenOf(catalog, parentId) {
  return Object.keys(catalog.accessories).filter((id) => catalog.accessories[id].parent === parentId);
}

// Alle accessoires van een product, in de volgorde van de pagina; keuzes onder een accessoire
// (parent) volgen direct op dat accessoire.
export function productItemIds(catalog, productId) {
  const product = getProduct(catalog, productId);
  const ids = [];
  for (const group of product.groups) {
    for (const id of group.items) {
      ids.push(id, ...childrenOf(catalog, id));
    }
  }
  return ids;
}

export function maxOf(accessory) {
  return accessory.max ?? 1;
}

function requiresOf(accessory) {
  const required = [...(accessory.requires ?? [])];
  if (accessory.parent && !required.includes(accessory.parent)) required.push(accessory.parent);
  return required;
}

function excludesBetween(catalog, a, b) {
  const first = getAccessory(catalog, a);
  const second = getAccessory(catalog, b);
  return Boolean(first?.excludes?.includes(b) || second?.excludes?.includes(a));
}

function matchesWhen(when, selection) {
  if (!when) return true;
  if (when.variant && when.variant !== selection.variant) return false;
  if (when.items && !when.items.every((id) => (selection.items[id] ?? 0) > 0)) return false;
  return true;
}

// Prijs per stuk in centen, of null bij "prijs op aanvraag".
export function unitPriceCents(catalog, selection, id) {
  const accessory = getAccessory(catalog, id);
  if (!accessory || accessory.status !== 'available') return null;
  const product = getProduct(catalog, selection.product);
  for (const rule of accessory.priceWhen ?? []) {
    if (matchesWhen(rule.when, selection)) return toCents(rule.price);
  }
  const override = product.priceOverrides?.[id];
  return toCents(override ?? accessory.price);
}

// ---------------------------------------------------------------------------
// Zinnen bouwen
// ---------------------------------------------------------------------------

const NUMBER_WORDS = ['nul', 'één', 'twee', 'drie', 'vier', 'vijf', 'zes', 'zeven', 'acht', 'negen', 'tien'];
const numberWord = (n) => NUMBER_WORDS[n] ?? String(n);

// "Aluminium opbergkist" -> "aluminium opbergkist"; "SCM-gekeurd…" en "LED-…" blijven staan.
function lowerFirst(text) {
  return /^[A-Z][a-zà-ÿ]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

const capitalize = (text) => text[0].toUpperCase() + text.slice(1);

// "de aluminium opbergkist", "twee fietsendragers"
export function describe(catalog, id, quantity = 1) {
  const accessory = getAccessory(catalog, id);
  if (quantity === 1) return accessory.phrase ?? `${accessory.article} ${lowerFirst(accessory.name)}`;
  return `${numberWord(quantity)} ${accessory.plural}`;
}

// Wat de bezoeker al gekozen heeft: "één fietsendrager" bij een accessoire dat u vaker kunt
// kiezen, anders "de aluminium opbergkist".
function describeHeld(catalog, id, quantity) {
  const accessory = getAccessory(catalog, id);
  if (quantity === 1 && maxOf(accessory) > 1) return `één ${lowerFirst(accessory.name)}`;
  return describe(catalog, id, quantity);
}

function describeAdded(catalog, id, currentQuantity) {
  const accessory = getAccessory(catalog, id);
  if (maxOf(accessory) === 1) return describe(catalog, id, 1);
  return currentQuantity > 0 ? `een extra ${lowerFirst(accessory.name)}` : `een ${lowerFirst(accessory.name)}`;
}

function joinList(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} en ${parts[parts.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Samenstelling
// ---------------------------------------------------------------------------

export function emptySelection(catalog, productId) {
  const product = getProduct(catalog, productId);
  return { product: productId, variant: product.variants[0].id, items: {} };
}

const cloneSelection = (selection) => ({ ...selection, items: { ...selection.items } });

// Bezetting van de montageplaatsen: { side: { used, capacity, free, occupants: [{ id, quantity, slots }] } }
export function slotUsage(catalog, selection) {
  const product = getProduct(catalog, selection.product);
  const usage = {};
  for (const [type, capacity] of Object.entries(product.slots ?? {})) {
    usage[type] = { used: 0, capacity, free: capacity, occupants: [] };
  }
  for (const [id, quantity] of Object.entries(selection.items)) {
    const accessory = getAccessory(catalog, id);
    if (!accessory || !quantity) continue;
    for (const [type, perUnit] of Object.entries(accessory.slots ?? {})) {
      if (!usage[type]) usage[type] = { used: 0, capacity: 0, free: 0, occupants: [] };
      usage[type].used += perUnit * quantity;
      usage[type].occupants.push({ id, quantity, slots: perUnit });
    }
  }
  for (const entry of Object.values(usage)) entry.free = entry.capacity - entry.used;
  return usage;
}

// Strenge controle. Geeft een lijst fouten terug; een lege lijst betekent: deze samenstelling
// kan zo worden aangevraagd. De server gebruikt dit om niets te accepteren wat de browser
// niet had mogen toestaan.
export function validate(catalog, selection) {
  const errors = [];
  const error = (code, message, extra = {}) => errors.push({ code, message, ...extra });

  if (!selection || typeof selection !== 'object') {
    return [{ code: 'invalid', message: 'De samenstelling ontbreekt.' }];
  }
  const product = catalog.products[selection.product];
  if (!product) return [{ code: 'product', message: 'Dit model bestaat niet.' }];

  const variant = product.variants.find((entry) => entry.id === selection.variant);
  if (!variant) error('variant', 'Deze uitvoering bestaat niet.');
  else if (variant.status === 'unavailable') error('variant', `De uitvoering ${variant.name} is niet leverbaar.`);

  if (!selection.items || typeof selection.items !== 'object' || Array.isArray(selection.items)) {
    error('invalid', 'De lijst met accessoires is ongeldig.');
    return errors;
  }

  const allowed = new Set(productItemIds(catalog, selection.product));
  for (const [id, quantity] of Object.entries(selection.items)) {
    const accessory = getAccessory(catalog, id);
    if (!accessory || !allowed.has(id)) {
      error('unknown', `Het accessoire "${id}" is niet beschikbaar voor de ${product.name}.`, { id });
      continue;
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      error('quantity', `Het aantal voor ${describe(catalog, id)} is ongeldig.`, { id });
      continue;
    }
    if (accessory.status === 'unavailable') {
      error('unavailable', `${capitalize(describe(catalog, id))} is op dit moment niet leverbaar.`, { id });
    }
    if (quantity > maxOf(accessory)) {
      error('max', `U kunt maximaal ${numberWord(maxOf(accessory))} keer ${describe(catalog, id)} kiezen.`, { id });
    }
    if (accessory.onlyVariants && !accessory.onlyVariants.includes(selection.variant)) {
      error('variant-only', `${capitalize(describe(catalog, id))} is niet leverbaar bij deze uitvoering.`, { id });
    }
    for (const required of requiresOf(accessory)) {
      if (!(selection.items[required] > 0)) {
        error('requires', `${capitalize(describe(catalog, id))} kan alleen samen met ${describe(catalog, required)}.`, {
          id,
          required,
        });
      }
    }
    for (const other of Object.keys(selection.items)) {
      if (other < id && excludesBetween(catalog, id, other)) {
        error('excludes', `${capitalize(describe(catalog, id))} en ${describe(catalog, other)} kunnen niet samen.`, {
          id,
          other,
        });
      }
    }
  }

  for (const [type, usage] of Object.entries(slotUsage(catalog, selection))) {
    if (usage.used > usage.capacity) {
      const slot = catalog.slotTypes[type];
      error('slots', `Er zijn ${numberWord(usage.capacity)} ${slot.plural} en u heeft er ${numberWord(usage.used)} nodig.`, {
        slot: type,
      });
    }
  }
  return errors;
}

// Verwijdert een accessoire en alles wat daarvan afhangt. Geeft de ids terug die zijn meegegaan.
function removeWithDependents(catalog, selection, id) {
  const removed = [];
  delete selection.items[id];
  let changed = true;
  while (changed) {
    changed = false;
    for (const other of Object.keys(selection.items)) {
      const accessory = getAccessory(catalog, other);
      if (accessory && requiresOf(accessory).some((required) => !(selection.items[required] > 0))) {
        delete selection.items[other];
        removed.push(other);
        changed = true;
      }
    }
  }
  return removed;
}

// Probeert een wijziging door te voeren.
//   change: { type: 'set', id, quantity }   aantal van een accessoire zetten (0 = verwijderen)
//           { type: 'variant', id }         andere uitvoering kiezen
//
// Geeft terug:
//   { ok: true, selection, removed: [ids die automatisch zijn vervallen] }
//   { ok: false, conflict: { code, title, message, resolutions: [{ label, selection }] } }
//
// Een resolutie is een kant-en-klare nieuwe samenstelling: de pagina hoeft die alleen over te
// nemen als de bezoeker op de knop klikt.
export function tryChange(catalog, current, change) {
  const product = getProduct(catalog, current.product);
  const next = cloneSelection(current);

  if (change.type === 'variant') {
    const variant = product.variants.find((entry) => entry.id === change.id);
    if (!variant || variant.status === 'unavailable') {
      return conflict('unavailable', 'Niet leverbaar', 'Deze uitvoering is op dit moment niet leverbaar.');
    }
    next.variant = variant.id;
    const blocked = Object.keys(next.items).filter((id) => {
      const only = getAccessory(catalog, id)?.onlyVariants;
      return only && !only.includes(variant.id);
    });
    if (blocked.length) {
      const resolved = cloneSelection(next);
      for (const id of blocked) removeWithDependents(catalog, resolved, id);
      const names = joinList(blocked.map((id) => describe(catalog, id, next.items[id])));
      return conflict(
        'variant-only',
        `Niet te combineren met ${variant.name}`,
        `${capitalize(names)} ${blocked.length === 1 && next.items[blocked[0]] === 1 ? 'is' : 'zijn'} niet leverbaar bij de uitvoering ${variant.name}.`,
        [{ label: `Kies ${variant.name} en laat ${names} vervallen`, selection: resolved }],
      );
    }
    return { ok: true, selection: next, removed: [] };
  }

  const { id } = change;
  const accessory = getAccessory(catalog, id);
  const quantity = change.quantity;
  if (!accessory || !productItemIds(catalog, current.product).includes(id)) {
    return conflict('unknown', 'Niet beschikbaar', `Dit accessoire is niet beschikbaar voor de ${product.name}.`);
  }
  if (!Number.isInteger(quantity) || quantity < 0) {
    return conflict('quantity', 'Ongeldig aantal', 'Dit aantal is niet mogelijk.');
  }

  const before = current.items[id] ?? 0;
  if (quantity <= before) {
    if (quantity === 0) {
      const removed = removeWithDependents(catalog, next, id);
      return { ok: true, selection: next, removed };
    }
    next.items[id] = quantity;
    return { ok: true, selection: next, removed: [] };
  }

  // Vanaf hier wordt er iets toegevoegd.
  if (accessory.status === 'unavailable') {
    return conflict('unavailable', 'Niet leverbaar', `${capitalize(describe(catalog, id))} is op dit moment niet leverbaar.`);
  }
  if (quantity > maxOf(accessory)) {
    const max = maxOf(accessory);
    return conflict(
      'max',
      'Maximum bereikt',
      max === 1
        ? `U kunt ${describe(catalog, id)} één keer kiezen.`
        : `Op de ${product.name} passen maximaal ${numberWord(max)} ${accessory.plural}.`,
    );
  }
  if (accessory.onlyVariants && !accessory.onlyVariants.includes(current.variant)) {
    const resolutions = accessory.onlyVariants
      .map((variantId) => product.variants.find((entry) => entry.id === variantId))
      .filter((variant) => variant && variant.status !== 'unavailable')
      .map((variant) => {
        const attempt = tryChange(catalog, { ...cloneSelection(current), variant: variant.id }, change);
        return attempt.ok ? { label: `Kies de uitvoering ${variant.name}`, selection: attempt.selection } : null;
      })
      .filter(Boolean);
    return conflict(
      'variant-only',
      'Niet bij deze uitvoering',
      `${capitalize(describe(catalog, id))} is alleen leverbaar bij ${joinList(
        accessory.onlyVariants.map((variantId) => product.variants.find((entry) => entry.id === variantId)?.name ?? variantId),
      )}.`,
      resolutions,
    );
  }

  next.items[id] = quantity;

  // Vereiste onderdelen gaan automatisch mee als dat zonder verdere botsing kan.
  const missing = requiresOf(accessory).filter((required) => !(next.items[required] > 0));
  if (missing.length) {
    let withRequired = cloneSelection(current);
    let possible = true;
    for (const required of missing) {
      const attempt = tryChange(catalog, withRequired, { type: 'set', id: required, quantity: 1 });
      if (!attempt.ok) {
        possible = false;
        break;
      }
      withRequired = attempt.selection;
    }
    const names = joinList(missing.map((required) => describe(catalog, required)));
    if (!possible) {
      return conflict('requires', 'Hoort bij een ander accessoire', `${capitalize(describe(catalog, id))} kan alleen samen met ${names}.`);
    }
    const attempt = tryChange(catalog, withRequired, change);
    if (!attempt.ok) return attempt;
    return conflict(
      'requires',
      'Hoort bij een ander accessoire',
      `${capitalize(describe(catalog, id))} kan alleen samen met ${names}.`,
      [{ label: `Voeg ook ${names} toe`, selection: attempt.selection }],
    );
  }

  // Accessoires die elkaar uitsluiten.
  const clashing = Object.keys(current.items).filter((other) => other !== id && excludesBetween(catalog, id, other));
  if (clashing.length) {
    const resolved = cloneSelection(current);
    for (const other of clashing) removeWithDependents(catalog, resolved, other);
    const names = joinList(clashing.map((other) => describe(catalog, other, current.items[other])));
    const attempt = tryChange(catalog, resolved, change);
    return conflict(
      'excludes',
      'Deze combinatie kan niet',
      `${capitalize(describe(catalog, id))} kan niet samen met ${names} worden gemonteerd.`,
      attempt.ok ? [{ label: `Vervang ${names} door ${describe(catalog, id)}`, selection: attempt.selection }] : [],
    );
  }

  // Montageplaatsen.
  const usageBefore = slotUsage(catalog, current);
  const added = quantity - before;
  for (const [type, perUnit] of Object.entries(accessory.slots ?? {})) {
    const usage = usageBefore[type] ?? { used: 0, capacity: 0, free: 0, occupants: [] };
    const needed = perUnit * added;
    if (needed <= usage.free) continue;

    const slot = catalog.slotTypes[type];
    const shortage = needed - usage.free;
    const occupants = usage.occupants;
    const occupied = joinList(occupants.map((entry) => describeHeld(catalog, entry.id, entry.quantity)));
    const newcomer = describeAdded(catalog, id, before);

    const resolutions = [];
    for (const entry of occupants) {
      if (entry.id === id) continue;
      const unitsToFree = Math.ceil(shortage / entry.slots);
      if (unitsToFree > entry.quantity) continue;
      const resolved = cloneSelection(current);
      const remaining = entry.quantity - unitsToFree;
      if (remaining === 0) removeWithDependents(catalog, resolved, entry.id);
      else resolved.items[entry.id] = remaining;
      const attempt = tryChange(catalog, resolved, change);
      if (!attempt.ok) continue;
      const leaving =
        unitsToFree < entry.quantity ? `${numberWord(unitsToFree)} ${unitsToFree === 1 ? lowerFirst(getAccessory(catalog, entry.id).name) : getAccessory(catalog, entry.id).plural}` : describe(catalog, entry.id, entry.quantity);
      resolutions.push({ label: `Vervang ${leaving} door ${newcomer}`, selection: attempt.selection, replaces: entry.id });
    }

    // Is er maar één accessoire dat plaats kan maken, noem het dan bij naam.
    const candidates = occupants.filter((entry) => resolutions.some((resolution) => resolution.replaces === entry.id));
    const single = candidates.length === 1 ? candidates[0] : null;
    let consequence;
    if (single) {
      const leaving = single.quantity > 1 ? `één van de ${getAccessory(catalog, single.id).plural}` : describe(catalog, single.id);
      consequence = `Om ${newcomer} te plaatsen, moet ${leaving} vervallen.`;
    } else if (resolutions.length) {
      consequence = `Om ${newcomer} te plaatsen, moet één van deze accessoires vervallen.`;
    } else {
      consequence = `Er is geen plaats meer voor ${newcomer}.`;
    }

    const capacityText =
      usage.free === 0
        ? `De ${product.name} heeft ${numberWord(usage.capacity)} ${usage.capacity === 1 ? slot.singular : slot.plural} en die ${usage.capacity === 1 ? 'is' : usage.capacity === 2 ? 'zijn allebei' : 'zijn allemaal'} bezet: u heeft ${occupied} gekozen.`
        : `De ${product.name} heeft ${numberWord(usage.capacity)} ${usage.capacity === 1 ? slot.singular : slot.plural}; daarvan is er nog ${numberWord(usage.free)} vrij. U heeft ${occupied} gekozen.`;

    const title =
      usage.free > 0
        ? `Te weinig vrije ${slot.plural}`
        : `${usage.capacity === 2 ? 'Beide' : 'Alle'} ${slot.plural} zijn bezet`;
    return conflict('slots', title, `${capacityText} ${consequence}`, resolutions, { slot: type });
  }

  return { ok: true, selection: next, removed: [] };
}

function conflict(code, title, message, resolutions = [], extra = {}) {
  return { ok: false, conflict: { code, title, message, resolutions, ...extra } };
}

// Maakt van willekeurige invoer (opgeslagen samenstelling, gedeelde link) een geldige
// samenstelling. Wat niet (meer) kan, vervalt en komt in `dropped` te staan.
export function sanitize(catalog, raw, fallbackProduct) {
  const productId = raw && catalog.products[raw.product] ? raw.product : fallbackProduct;
  let selection = emptySelection(catalog, productId);
  const dropped = [];
  if (!raw || typeof raw !== 'object') return { selection, dropped };

  if (raw.variant && raw.variant !== selection.variant) {
    const attempt = tryChange(catalog, selection, { type: 'variant', id: raw.variant });
    if (attempt.ok) selection = attempt.selection;
    else dropped.push(String(raw.variant));
  }

  const wanted = raw.items && typeof raw.items === 'object' && !Array.isArray(raw.items) ? raw.items : {};
  // In catalogusvolgorde, zodat een accessoire altijd vóór zijn onderliggende keuzes komt.
  for (const id of productItemIds(catalog, productId)) {
    if (!Object.prototype.hasOwnProperty.call(wanted, id)) continue;
    const accessory = getAccessory(catalog, id);
    let quantity = Number(wanted[id]);
    if (!Number.isInteger(quantity) || quantity < 1) continue;
    quantity = Math.min(quantity, maxOf(accessory));
    let placed = false;
    for (let attemptQuantity = quantity; attemptQuantity >= 1 && !placed; attemptQuantity--) {
      const attempt = tryChange(catalog, selection, { type: 'set', id, quantity: attemptQuantity });
      if (attempt.ok) {
        selection = attempt.selection;
        placed = true;
      }
    }
    if (!placed) dropped.push(id);
  }
  for (const id of Object.keys(wanted)) {
    if (!getAccessory(catalog, id) && !dropped.includes(id)) dropped.push(String(id).slice(0, 60));
  }
  return { selection, dropped };
}

// ---------------------------------------------------------------------------
// Prijs
// ---------------------------------------------------------------------------

function todayInAmsterdam() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam' }).format(new Date());
}

function promotionApplies(promotion, selection, today) {
  if (promotion.active === false) return false;
  if (promotion.products && !promotion.products.includes(selection.product)) return false;
  if (promotion.variants && !promotion.variants.includes(selection.variant)) return false;
  if (promotion.validFrom && today < promotion.validFrom) return false;
  if (promotion.validUntil && today > promotion.validUntil) return false;
  return (promotion.items ?? []).every((id) => (selection.items[id] ?? 0) > 0);
}

// Rekent een samenstelling volledig door. Alle bedragen in centen.
//
//   base               { name, cents }
//   variant            { id, name, cents | null, onRequest }
//   lines              [{ id, name, spec, parent, quantity, unitCents | null, cents | null, onRequest }]
//   accessoriesCents   som van de geprijsde accessoires
//   discounts          [{ id, name, cents }]   (alleen acties die echt van toepassing zijn)
//   totalCents         basis + uitvoering + accessoires − kortingen
//   onRequest          namen van gekozen onderdelen zonder prijs (tellen niet mee in het totaal)
//   itemCount          aantal gekozen accessoires (stuks)
export function calculate(catalog, selection, { today = todayInAmsterdam() } = {}) {
  const product = getProduct(catalog, selection.product);
  const variant = product.variants.find((entry) => entry.id === selection.variant) ?? product.variants[0];
  const baseCents = toCents(product.basePrice);

  const variantOnRequest = variant.status !== 'available' || variant.surcharge == null;
  const variantCents = variantOnRequest ? null : toCents(variant.surcharge);

  const lines = [];
  const onRequest = [];
  let accessoriesCents = 0;
  let itemCount = 0;

  if (variantOnRequest) onRequest.push(variant.name);

  for (const id of productItemIds(catalog, selection.product)) {
    const quantity = selection.items[id] ?? 0;
    if (!quantity) continue;
    const accessory = getAccessory(catalog, id);
    const unitCents = unitPriceCents(catalog, selection, id);
    const cents = unitCents == null ? null : unitCents * quantity;
    lines.push({
      id,
      name: accessory.name,
      spec: accessory.spec ?? '',
      parent: accessory.parent ?? null,
      quantity,
      unitCents,
      cents,
      onRequest: unitCents == null,
    });
    itemCount += quantity;
    if (cents == null) onRequest.push(accessory.name);
    else accessoriesCents += cents;
  }

  const discounts = [];
  for (const promotion of catalog.promotions ?? []) {
    if (!promotionApplies(promotion, selection, today)) continue;
    // Een bundelvoordeel kan nooit hoger zijn dan de prijs van de accessoires waar het om gaat.
    const bundleCents = lines
      .filter((line) => promotion.items.includes(line.id) && line.cents != null)
      .reduce((sum, line) => sum + line.cents, 0);
    const cents = Math.min(toCents(promotion.discount), bundleCents);
    if (cents > 0) discounts.push({ id: promotion.id, name: promotion.name, cents });
  }
  const discountCents = discounts.reduce((sum, discount) => sum + discount.cents, 0);

  return {
    product: product.id,
    productName: product.name,
    base: { name: product.name, cents: baseCents },
    variant: { id: variant.id, name: variant.name, cents: variantCents, onRequest: variantOnRequest, isDefault: variant.id === product.variants[0].id },
    lines,
    accessoriesCents,
    discounts,
    discountCents,
    totalCents: baseCents + (variantCents ?? 0) + accessoriesCents - discountCents,
    onRequest,
    itemCount,
  };
}

// De samenstelling als platte tekst, voor e-mails. `calculation` is de uitkomst van calculate().
export function summaryText(calculation) {
  const money = (cents) => formatEuro(cents, { decimals: 'always' }).replace(/\u00a0/g, ' ');
  const rows = [`${calculation.base.name}: ${money(calculation.base.cents)}`];
  if (!calculation.variant.isDefault || calculation.variant.onRequest) {
    rows.push(`Uitvoering ${calculation.variant.name}: ${calculation.variant.onRequest ? 'prijs op aanvraag' : money(calculation.variant.cents)}`);
  } else {
    rows.push(`Uitvoering: ${calculation.variant.name}`);
  }
  rows.push('');
  if (calculation.lines.length) {
    rows.push('Accessoires:');
    for (const line of calculation.lines) {
      const name = line.spec ? `${line.name} (${line.spec})` : line.name;
      if (line.onRequest) rows.push(`- ${line.quantity > 1 ? `${line.quantity} x ` : ''}${name}: prijs op aanvraag`);
      else if (line.quantity > 1) rows.push(`- ${line.quantity} x ${name} à ${money(line.unitCents)}: ${money(line.cents)}`);
      else rows.push(`- ${name}: ${money(line.cents)}`);
    }
  } else {
    rows.push('Accessoires: geen');
  }
  rows.push('');
  for (const discount of calculation.discounts) rows.push(`${discount.name}: - ${money(discount.cents)}`);
  rows.push(`Totaal inclusief btw: ${money(calculation.totalCents)}`);
  if (calculation.onRequest.length) {
    rows.push(`Niet in dit totaal (prijs op aanvraag): ${calculation.onRequest.join(', ')}`);
  }
  return rows.join('\n');
}

// ---------------------------------------------------------------------------
// Samenstelling als korte tekst (voor een deelbare link)
// ---------------------------------------------------------------------------

// { product: 'mono', variant: 'aluminium', items: { compressor: 1, fietsendrager: 2 } }
//   -> "mono:aluminium:compressor,fietsendrager*2"
export function encodeSelection(selection) {
  const items = Object.entries(selection.items)
    .filter(([, quantity]) => quantity > 0)
    .map(([id, quantity]) => (quantity > 1 ? `${id}*${quantity}` : id));
  return [selection.product, selection.variant, items.join(',')].join(':');
}

export function decodeSelection(text) {
  if (typeof text !== 'string' || text.length > 600) return null;
  const [product, variant, list = ''] = text.split(':');
  if (!product) return null;
  const items = {};
  for (const part of list.split(',')) {
    if (!part) continue;
    const [id, quantity] = part.split('*');
    if (!/^[a-z0-9-]{1,60}$/.test(id)) continue;
    items[id] = quantity === undefined ? 1 : Number.parseInt(quantity, 10);
  }
  return { product, variant, items };
}

// Controleert de catalogus zelf. Wordt gebruikt door het build-script en de tests, zodat een
// tikfout in een id of een bedrag niet ongemerkt op de site komt.
export function checkCatalog(catalog) {
  const problems = [];
  const accessoryIds = new Set(Object.keys(catalog.accessories));
  const statuses = ['available', 'on-request', 'unavailable'];

  for (const [id, accessory] of Object.entries(catalog.accessories)) {
    if (!/^[a-z0-9-]+$/.test(id)) problems.push(`Accessoire "${id}": gebruik alleen kleine letters, cijfers en streepjes.`);
    for (const field of ['name', 'article', 'plural', 'benefit']) {
      if (!accessory[field]) problems.push(`Accessoire "${id}": veld "${field}" ontbreekt.`);
    }
    if (!statuses.includes(accessory.status)) problems.push(`Accessoire "${id}": onbekende status "${accessory.status}".`);
    if (accessory.status === 'available') {
      try {
        toCents(accessory.price);
      } catch (cause) {
        problems.push(`Accessoire "${id}": ${cause.message}. Zonder prijs hoort de status "on-request" te zijn.`);
      }
    }
    for (const field of ['requires', 'excludes']) {
      for (const other of accessory[field] ?? []) {
        if (!accessoryIds.has(other)) problems.push(`Accessoire "${id}": ${field} verwijst naar onbekend accessoire "${other}".`);
      }
    }
    if (accessory.parent && !accessoryIds.has(accessory.parent)) {
      problems.push(`Accessoire "${id}": parent "${accessory.parent}" bestaat niet.`);
    }
    for (const type of Object.keys(accessory.slots ?? {})) {
      if (!catalog.slotTypes?.[type]) problems.push(`Accessoire "${id}": onbekende montageplaats "${type}".`);
    }
    if (accessory.max !== undefined && (!Number.isInteger(accessory.max) || accessory.max < 1)) {
      problems.push(`Accessoire "${id}": max moet een heel getal vanaf 1 zijn.`);
    }
    for (const rule of accessory.priceWhen ?? []) {
      try {
        toCents(rule.price);
      } catch (cause) {
        problems.push(`Accessoire "${id}": priceWhen: ${cause.message}`);
      }
    }
  }

  for (const [productId, product] of Object.entries(catalog.products)) {
    if (product.id !== productId) problems.push(`Product "${productId}": id komt niet overeen met de sleutel.`);
    try {
      toCents(product.basePrice);
    } catch (cause) {
      problems.push(`Product "${productId}": basisprijs: ${cause.message}`);
    }
    if (!product.variants?.length) problems.push(`Product "${productId}": er is geen uitvoering.`);
    else if (product.variants[0].status !== 'available' || product.variants[0].surcharge !== 0) {
      problems.push(`Product "${productId}": de eerste uitvoering is de standaard en moet leverbaar zijn zonder meerprijs.`);
    }
    const seen = new Set();
    for (const variant of product.variants ?? []) {
      if (!statuses.includes(variant.status)) problems.push(`Product "${productId}", uitvoering "${variant.id}": onbekende status.`);
      if (variant.status === 'available') {
        try {
          toCents(variant.surcharge);
        } catch (cause) {
          problems.push(`Product "${productId}", uitvoering "${variant.id}": meerprijs: ${cause.message}`);
        }
      }
    }
    for (const group of product.groups ?? []) {
      for (const id of group.items) {
        if (!accessoryIds.has(id)) problems.push(`Product "${productId}", groep "${group.id}": onbekend accessoire "${id}".`);
        else if (catalog.accessories[id].parent) problems.push(`Product "${productId}": "${id}" is een keuze onder "${catalog.accessories[id].parent}" en hoort niet los in een groep.`);
        if (seen.has(id)) problems.push(`Product "${productId}": accessoire "${id}" staat in meer dan één groep.`);
        seen.add(id);
      }
    }
    for (const [id, price] of Object.entries(product.priceOverrides ?? {})) {
      if (!accessoryIds.has(id)) problems.push(`Product "${productId}": priceOverrides verwijst naar onbekend accessoire "${id}".`);
      try {
        toCents(price);
      } catch (cause) {
        problems.push(`Product "${productId}": priceOverrides "${id}": ${cause.message}`);
      }
    }
    if (!product.images?.length) problems.push(`Product "${productId}": er is geen productbeeld.`);
  }

  for (const promotion of catalog.promotions ?? []) {
    if (!promotion.id || !promotion.name) problems.push('Een promotie mist een id of naam.');
    if (!promotion.items?.length) problems.push(`Promotie "${promotion.id}": er zijn geen accessoires opgegeven.`);
    for (const id of promotion.items ?? []) {
      if (!accessoryIds.has(id)) problems.push(`Promotie "${promotion.id}": onbekend accessoire "${id}".`);
    }
    try {
      toCents(promotion.discount);
    } catch (cause) {
      problems.push(`Promotie "${promotion.id}": korting: ${cause.message}`);
    }
  }
  return problems;
}

// Kiest het productbeeld dat bij de samenstelling past: het eerste beeld waarvan `when` klopt.
export function pickImage(catalog, selection) {
  const product = getProduct(catalog, selection.product);
  const specific = product.images.find((image) => Object.keys(image.when ?? {}).length && matchesWhen(image.when, selection));
  return specific ?? product.images.find((image) => !Object.keys(image.when ?? {}).length) ?? product.images[0];
}
