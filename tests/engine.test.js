import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { catalog } from '../configurator/catalog.js';
import {
  calculate,
  checkCatalog,
  decodeSelection,
  emptySelection,
  encodeSelection,
  formatEuro,
  pickImage,
  productItemIds,
  sanitize,
  slotUsage,
  toCents,
  tryChange,
  validate,
} from '../configurator/engine.js';
import { fixture } from './fixture-catalog.js';

// Hulpjes -------------------------------------------------------------------

function build(cat, product, steps = [], variant) {
  let selection = emptySelection(cat, product);
  if (variant) {
    const result = tryChange(cat, selection, { type: 'variant', id: variant });
    assert.ok(result.ok, `uitvoering ${variant} kon niet worden gekozen`);
    selection = result.selection;
  }
  for (const [id, quantity = 1] of steps) {
    const result = tryChange(cat, selection, { type: 'set', id, quantity });
    assert.ok(result.ok, `${id} x${quantity} kon niet worden toegevoegd: ${result.conflict?.message}`);
    selection = result.selection;
  }
  return selection;
}

const add = (cat, selection, id, quantity = 1) => tryChange(cat, selection, { type: 'set', id, quantity });
const TODAY = { today: '2026-11-24' };

// Bedragen ------------------------------------------------------------------

describe('bedragen', () => {
  test('euro naar centen zonder afrondingsfouten', () => {
    assert.equal(toCents(3350), 335000);
    assert.equal(toCents(37.5), 3750);
    assert.equal(toCents(32.5), 3250);
    assert.equal(toCents(0.1) + toCents(0.2), 30);
    assert.equal(toCents(0), 0);
  });

  test('ongeldige bedragen worden geweigerd', () => {
    assert.throws(() => toCents(null));
    assert.throws(() => toCents('130'));
    assert.throws(() => toCents(-1));
    assert.throws(() => toCents(1.999));
    assert.throws(() => toCents(Number.NaN));
  });

  test('weergave als eurobedrag', () => {
    assert.equal(formatEuro(335000), '€ 3.350');
    assert.equal(formatEuro(335000, { decimals: 'always' }), '€ 3.350,00');
    assert.equal(formatEuro(3750), '€ 37,50');
    assert.equal(formatEuro(3705), '€ 37,05');
    assert.equal(formatEuro(0), '€ 0');
    assert.equal(formatEuro(123456789), '€ 1.234.567,89');
    assert.equal(formatEuro(-2500), '− € 25');
    assert.throws(() => formatEuro(10.5));
  });
});

// De echte catalogus --------------------------------------------------------

describe('catalogus Airtrailer', () => {
  test('bevat geen fouten', () => {
    assert.deepEqual(checkCatalog(catalog), []);
  });

  test('de testcatalogus bevat ook geen fouten', () => {
    assert.deepEqual(checkCatalog(fixture), []);
  });

  test('een kale Mono kost de basisprijs', () => {
    const result = calculate(catalog, emptySelection(catalog, 'mono'), TODAY);
    assert.equal(result.totalCents, 335000);
    assert.equal(result.accessoriesCents, 0);
    assert.deepEqual(result.lines, []);
    assert.deepEqual(result.onRequest, []);
    assert.deepEqual(result.discounts, []);
  });

  test('het totaal is altijd basis + som van de regels − korting', () => {
    // Elk accessoire los, elk op het hoogste aantal dat de regels toelaten.
    for (const id of productItemIds(catalog, 'mono')) {
      const accessory = catalog.accessories[id];
      const steps = accessory.parent ? [[accessory.parent, 1]] : [];
      const selection = build(catalog, 'mono', [...steps, [id, accessory.max ?? 1]]);
      const result = calculate(catalog, selection, TODAY);
      const sum = result.lines.reduce((total, line) => total + (line.cents ?? 0), 0);
      assert.equal(result.accessoriesCents, sum, id);
      assert.equal(result.totalCents, result.base.cents + (result.variant.cents ?? 0) + sum - result.discountCents, id);
      for (const line of result.lines) {
        if (line.cents != null) assert.equal(line.cents, line.unitCents * line.quantity, id);
      }
    }
  });

  test('voorbeeld: Mono met compressor, spanbanden, disselslot en twee fietsendragers', () => {
    const selection = build(catalog, 'mono', [['compressor'], ['spanbanden'], ['disselslot'], ['fietsendrager', 2]]);
    const result = calculate(catalog, selection, TODAY);
    // 3350 + 130 + 40 + 37,50 + 2 × 295
    assert.equal(result.accessoriesCents, 79750);
    assert.equal(result.totalCents, 414750);
    assert.equal(result.itemCount, 5);
    assert.equal(formatEuro(result.totalCents, { decimals: 'always' }), '€ 4.147,50');
  });

  test('een accessoire wordt nooit dubbel gerekend', () => {
    let selection = build(catalog, 'mono', [['compressor']]);
    const again = add(catalog, selection, 'compressor', 1);
    assert.ok(again.ok);
    selection = again.selection;
    const result = calculate(catalog, selection, TODAY);
    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0].quantity, 1);
    assert.equal(result.totalCents, 335000 + 13000);

    const twice = add(catalog, selection, 'compressor', 2);
    assert.equal(twice.ok, false);
    assert.equal(twice.conflict.code, 'max');
  });

  test('opties op aanvraag tellen niet mee in het totaal en staan apart vermeld', () => {
    const selection = build(catalog, 'mono', [['led-verlichting'], ['compressor']], 'black-edition');
    const result = calculate(catalog, selection, TODAY);
    assert.equal(result.totalCents, 335000 + 13000);
    assert.deepEqual(result.onRequest, ['Black Edition', 'LED-verlichting']);
    assert.equal(result.variant.onRequest, true);
    assert.equal(result.variant.cents, null);
    const led = result.lines.find((line) => line.id === 'led-verlichting');
    assert.equal(led.cents, null);
    assert.equal(led.onRequest, true);
  });

  test('twee fietsendragers bezetten beide zijplaatsen; de opbergkist past er dan niet bij', () => {
    const selection = build(catalog, 'mono', [['fietsendrager', 2]]);
    assert.equal(slotUsage(catalog, selection).side.free, 0);

    const result = add(catalog, selection, 'opbergkist');
    assert.equal(result.ok, false);
    assert.equal(result.conflict.code, 'slots');
    assert.match(result.conflict.message, /twee zijplaatsen/);
    assert.match(result.conflict.message, /twee fietsendragers/);
    assert.match(result.conflict.message, /moet één van de fietsendragers vervallen/);

    assert.equal(result.conflict.resolutions.length, 1);
    const [resolution] = result.conflict.resolutions;
    assert.equal(resolution.label, 'Vervang één fietsendrager door de aluminium opbergkist');
    assert.match(result.conflict.message, /zijn allebei bezet/);
    assert.deepEqual(resolution.selection.items, { fietsendrager: 1, opbergkist: 1 });
    assert.deepEqual(validate(catalog, resolution.selection), []);
  });

  test('een derde fietsendrager kan niet', () => {
    const selection = build(catalog, 'mono', [['fietsendrager', 2]]);
    const result = add(catalog, selection, 'fietsendrager', 3);
    assert.equal(result.ok, false);
    assert.equal(result.conflict.code, 'max');
    assert.match(result.conflict.message, /maximaal twee fietsendragers/);
  });

  test('fietsendrager + opbergkist: een tweede fietsendrager vraagt om een keuze', () => {
    const selection = build(catalog, 'mono', [['fietsendrager', 1], ['opbergkist']]);
    const result = add(catalog, selection, 'fietsendrager', 2);
    assert.equal(result.ok, false);
    assert.equal(result.conflict.code, 'slots');
    assert.equal(result.conflict.resolutions.length, 1);
    assert.equal(result.conflict.resolutions[0].label, 'Vervang de aluminium opbergkist door een extra fietsendrager');
    assert.match(result.conflict.message, /u heeft één fietsendrager en de aluminium opbergkist gekozen\. Om een extra fietsendrager te plaatsen, moet de aluminium opbergkist vervallen\./);
    assert.deepEqual(result.conflict.resolutions[0].selection.items, { fietsendrager: 2 });
  });

  test('de bevestigingsbeugel hoort bij het reservewiel en vervalt mee', () => {
    const without = add(catalog, emptySelection(catalog, 'mono'), 'reservewiel-beugel');
    assert.equal(without.ok, false);
    assert.equal(without.conflict.code, 'requires');
    assert.deepEqual(without.conflict.resolutions[0].selection.items, { reservewiel: 1, 'reservewiel-beugel': 1 });

    const selection = build(catalog, 'mono', [['reservewiel'], ['reservewiel-beugel'], ['reservewiel-lichtmetaal']]);
    assert.equal(calculate(catalog, selection, TODAY).accessoriesCents, 14000 + 6500);

    const removed = add(catalog, selection, 'reservewiel', 0);
    assert.ok(removed.ok);
    assert.deepEqual(removed.selection.items, {});
    assert.deepEqual(removed.removed.sort(), ['reservewiel-beugel', 'reservewiel-lichtmetaal']);
  });

  test('de beugel van het reservewiel gebruikt een zijplaats, het wiel zelf niet', () => {
    const full = build(catalog, 'mono', [['fietsendrager', 2]]);
    const wheel = add(catalog, full, 'reservewiel');
    assert.ok(wheel.ok);
    const bracket = add(catalog, wheel.selection, 'reservewiel-beugel');
    assert.equal(bracket.ok, false);
    assert.equal(bracket.conflict.code, 'slots');
    assert.deepEqual(bracket.conflict.resolutions[0].selection.items, {
      fietsendrager: 1,
      reservewiel: 1,
      'reservewiel-beugel': 1,
    });
  });

  test('drie verschillende zijaccessoires: twee oplossingen om uit te kiezen', () => {
    const selection = build(catalog, 'mono', [['fietsendrager', 1], ['reservewiel'], ['reservewiel-beugel']]);
    const result = add(catalog, selection, 'opbergkist');
    assert.equal(result.ok, false);
    assert.equal(result.conflict.resolutions.length, 2);
    assert.match(result.conflict.message, /moet één van deze accessoires vervallen/);
    for (const resolution of result.conflict.resolutions) {
      assert.deepEqual(validate(catalog, resolution.selection), []);
      assert.equal(slotUsage(catalog, resolution.selection).side.used, 2);
    }
  });

  test('de server weigert een samenstelling die de browser niet had mogen maken', () => {
    const errors = validate(catalog, {
      product: 'mono',
      variant: 'aluminium',
      items: { fietsendrager: 2, opbergkist: 1 },
    });
    assert.deepEqual(errors.map((entry) => entry.code), ['slots']);

    const codes = (selection) => validate(catalog, selection).map((entry) => entry.code);
    assert.deepEqual(codes({ product: 'mono', variant: 'aluminium', items: { fietsendrager: 3 } }), ['max', 'slots']);
    assert.deepEqual(codes({ product: 'mono', variant: 'aluminium', items: { 'reservewiel-beugel': 1 } }), ['requires']);
    assert.deepEqual(codes({ product: 'mono', variant: 'aluminium', items: { bestaatniet: 1 } }), ['unknown']);
    assert.deepEqual(codes({ product: 'mono', variant: 'aluminium', items: { compressor: 0 } }), ['quantity']);
    assert.deepEqual(codes({ product: 'mono', variant: 'aluminium', items: { compressor: 1.5 } }), ['quantity']);
    assert.deepEqual(codes({ product: 'mono', variant: 'paars', items: {} }), ['variant']);
    assert.deepEqual(codes({ product: 'duo', variant: 'aluminium', items: {} }), ['product']);
    assert.deepEqual(codes({ product: 'mono', variant: 'aluminium', items: [] }), ['invalid']);
    assert.deepEqual(codes({ product: 'mono', variant: 'aluminium', items: { __proto__: 1, constructor: 1 } }), ['unknown']);
    assert.deepEqual(codes(null), ['invalid']);
  });

  test('alles wat de configurator toelaat, keurt de server ook goed', () => {
    // Loop alle accessoires in willekeurige volgorde af en neem telkens de eerste oplossing.
    const ids = productItemIds(catalog, 'mono');
    for (let round = 0; round < 40; round++) {
      let selection = emptySelection(catalog, 'mono');
      const order = [...ids].sort(() => Math.sin(round * 7 + ids.length) - 0.5 + ((round * 13) % 7) / 7 - 0.5);
      for (const [index, id] of order.entries()) {
        const quantity = ((round + index) % (catalog.accessories[id].max ?? 1)) + 1;
        const result = add(catalog, selection, id, quantity);
        if (result.ok) selection = result.selection;
        else if (result.conflict.resolutions.length) selection = result.conflict.resolutions[0].selection;
        assert.deepEqual(validate(catalog, selection), [], `ronde ${round}, na ${id}`);
      }
    }
  });
});

// Regels die de echte catalogus nog niet gebruikt ---------------------------

describe('regels (testcatalogus)', () => {
  test('uitsluiting werkt in beide richtingen en biedt vervangen aan', () => {
    const withA = build(fixture, 'solo', [['slot-a']]);
    const addB = add(fixture, withA, 'slot-b');
    assert.equal(addB.ok, false);
    assert.equal(addB.conflict.code, 'excludes');
    assert.deepEqual(addB.conflict.resolutions[0].selection.items, { 'slot-b': 1 });

    const withB = build(fixture, 'solo', [['slot-b']]);
    const addA = add(fixture, withB, 'slot-a');
    assert.equal(addA.ok, false);
    assert.equal(addA.conflict.code, 'excludes');

    assert.deepEqual(
      validate(fixture, { product: 'solo', variant: 'blank', items: { 'slot-a': 1, 'slot-b': 1 } }).map((entry) => entry.code),
      ['excludes'],
    );
  });

  test('optie die alleen bij een bepaalde uitvoering hoort', () => {
    const blank = emptySelection(fixture, 'solo');
    const result = add(fixture, blank, 'sierlijst');
    assert.equal(result.ok, false);
    assert.equal(result.conflict.code, 'variant-only');
    assert.equal(result.conflict.resolutions[0].label, 'Kies de uitvoering Zwart');
    assert.deepEqual(result.conflict.resolutions[0].selection, { product: 'solo', variant: 'zwart', items: { sierlijst: 1 } });

    // Terug naar blank: de sierlijst moet dan vervallen.
    const zwart = build(fixture, 'solo', [['sierlijst']], 'zwart');
    const back = tryChange(fixture, zwart, { type: 'variant', id: 'blank' });
    assert.equal(back.ok, false);
    assert.deepEqual(back.conflict.resolutions[0].selection, { product: 'solo', variant: 'blank', items: {} });
  });

  test('niet-leverbare opties en uitvoeringen zijn niet te kiezen', () => {
    const selection = emptySelection(fixture, 'solo');
    assert.equal(add(fixture, selection, 'oud').conflict.code, 'unavailable');
    assert.equal(tryChange(fixture, selection, { type: 'variant', id: 'goud' }).conflict.code, 'unavailable');
    assert.deepEqual(
      validate(fixture, { product: 'solo', variant: 'goud', items: { oud: 1 } }).map((entry) => entry.code),
      ['variant', 'unavailable'],
    );
  });

  test('meerprijs van de uitvoering en uitvoering-afhankelijke prijs', () => {
    const blank = calculate(fixture, build(fixture, 'solo', [['velgen']]), TODAY);
    assert.equal(blank.totalCents, 100000 + 24500);
    const zwart = calculate(fixture, build(fixture, 'solo', [['velgen']], 'zwart'), TODAY);
    assert.equal(zwart.variant.cents, 50000);
    assert.equal(zwart.totalCents, 100000 + 50000 + 20000);
  });

  test('bundelvoordeel alleen als alle onderdelen gekozen zijn en de actie loopt', () => {
    const half = calculate(fixture, build(fixture, 'solo', [['drager']]), TODAY);
    assert.deepEqual(half.discounts, []);

    const full = build(fixture, 'solo', [['drager'], ['wiel']]);
    const during = calculate(fixture, full, TODAY);
    assert.deepEqual(during.discounts, [{ id: 'duo-drager', name: 'Fietsvoordeel', cents: 2500 }]);
    assert.equal(during.totalCents, 100000 + 29500 + 14000 - 2500);

    assert.deepEqual(calculate(fixture, full, { today: '2027-01-01' }).discounts, []);
    assert.deepEqual(calculate(fixture, full, { today: '2025-12-31' }).discounts, []);

    // Verlopen actie telt nooit; actie voor een ander product ook niet.
    assert.deepEqual(calculate(fixture, build(fixture, 'solo', [['kist']]), TODAY).discounts, []);
    assert.deepEqual(calculate(fixture, build(fixture, 'tandem', [['drager']]), TODAY).discounts, []);
  });

  test('korting is nooit hoger dan de prijs van de onderdelen waar het om gaat', () => {
    const result = calculate(fixture, build(fixture, 'solo', [['slot-a']]), TODAY);
    assert.deepEqual(result.discounts, [{ id: 'groot', name: 'Te grote korting', cents: 3750 }]);
    assert.equal(result.totalCents, 100000);
  });

  test('een tweede product gebruikt dezelfde engine met eigen regels en prijzen', () => {
    const selection = build(fixture, 'tandem', [['drager', 2], ['kist'], ['vloerklem']]);
    const result = calculate(fixture, selection, TODAY);
    assert.equal(result.totalCents, 200000 + 59000 + 25000 + 8000); // kist heeft bij dit product een eigen prijs
    assert.equal(slotUsage(fixture, selection).side.free, 1);
    assert.equal(slotUsage(fixture, selection).floor.free, 0);

    // Eén vloerplaats: een tweede vloerklem past niet, en er is niets om te vervangen.
    const second = add(fixture, selection, 'vloerklem', 2);
    assert.equal(second.ok, false);
    assert.equal(second.conflict.code, 'slots');
    assert.deepEqual(second.conflict.resolutions, []);

    // Accessoires van het andere product zijn hier niet te kiezen.
    assert.equal(add(fixture, selection, 'wiel').conflict.code, 'unknown');
    assert.deepEqual(
      validate(fixture, { product: 'tandem', variant: 'blank', items: { wiel: 1 } }).map((entry) => entry.code),
      ['unknown'],
    );
  });

  test('het productbeeld volgt de samenstelling, met het standaardbeeld als vangnet', () => {
    assert.equal(pickImage(fixture, build(fixture, 'solo')).src, '/solo.webp');
    assert.equal(pickImage(fixture, build(fixture, 'solo', [], 'zwart')).src, '/solo-zwart.webp');
    assert.equal(pickImage(fixture, build(fixture, 'solo', [['kist']])).src, '/solo.webp');
    // Black Edition heeft nog geen foto: het aluminium beeld blijft staan.
    const black = build(catalog, 'mono', [], 'black-edition');
    assert.equal(pickImage(catalog, black).shows, 'aluminium');
  });
});

// Bewaren en delen ----------------------------------------------------------

describe('bewaren en delen', () => {
  test('samenstelling heen en terug via een link', () => {
    const selection = build(catalog, 'mono', [['compressor'], ['fietsendrager', 2], ['reservewiel']], 'black-edition');
    const text = encodeSelection(selection);
    assert.equal(text, 'mono:black-edition:compressor,fietsendrager*2,reservewiel');
    const restored = sanitize(catalog, decodeSelection(text), 'mono');
    assert.deepEqual(restored.selection, selection);
    assert.deepEqual(restored.dropped, []);
  });

  test('een verouderde of gemanipuleerde link levert altijd een geldige samenstelling op', () => {
    const cases = [
      'mono:aluminium:fietsendrager*9,opbergkist,reservewiel-beugel',
      'mono:bestaatniet:compressor,weg-uit-catalogus',
      'onbekend:x:compressor',
      'mono::',
      'mono:aluminium:compressor*-3,spanbanden*abc,<script>',
      '',
    ];
    for (const text of cases) {
      const { selection } = sanitize(catalog, decodeSelection(text), 'mono');
      assert.equal(selection.product, 'mono', text);
      assert.deepEqual(validate(catalog, selection), [], text);
    }

    const { selection, dropped } = sanitize(catalog, decodeSelection(cases[0]), 'mono');
    assert.deepEqual(selection.items, { fietsendrager: 2 });
    assert.deepEqual(dropped.sort(), ['opbergkist', 'reservewiel-beugel']);
    assert.equal(decodeSelection('x'.repeat(700)), null);
  });
});
