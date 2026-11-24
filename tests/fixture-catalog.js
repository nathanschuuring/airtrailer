// Verzonnen catalogus voor de tests. Hiermee testen we regels die de echte catalogus (nog) niet
// gebruikt: een tweede product, uitsluitingen, uitvoering-afhankelijke opties, prijsregels en acties.

export const fixture = {
  currency: 'EUR',
  slotTypes: {
    side: { singular: 'zijplaats', plural: 'zijplaatsen', explanation: '' },
    floor: { singular: 'vloerplaats', plural: 'vloerplaatsen', explanation: '' },
  },
  products: {
    solo: {
      id: 'solo',
      name: 'Testtrailer Solo',
      page: '/solo',
      basePrice: 1000,
      included: ['Wielen'],
      slots: { side: 2 },
      images: [
        { when: {}, src: '/solo.webp', alt: 'Solo', width: 10, height: 10 },
        { when: { variant: 'zwart' }, src: '/solo-zwart.webp', alt: 'Solo zwart', width: 10, height: 10 },
        { when: { variant: 'zwart', items: ['velgen'] }, src: '/solo-zwart-velgen.webp', alt: 'Solo zwart met velgen', width: 10, height: 10 },
      ],
      variants: [
        { id: 'blank', name: 'Blank', status: 'available', surcharge: 0, benefit: '' },
        { id: 'zwart', name: 'Zwart', status: 'available', surcharge: 500, benefit: '' },
        { id: 'goud', name: 'Goud', status: 'unavailable', surcharge: null, benefit: '' },
      ],
      groups: [
        { id: 'a', title: 'A', intro: '', items: ['drager', 'kist', 'wiel', 'slot-a', 'slot-b', 'velgen', 'sierlijst', 'lamp', 'oud'] },
      ],
      priceOverrides: {},
    },
    tandem: {
      id: 'tandem',
      name: 'Testtrailer Tandem',
      page: '/tandem',
      basePrice: 2000,
      included: ['Wielen'],
      slots: { side: 4, floor: 1 },
      images: [{ when: {}, src: '/tandem.webp', alt: 'Tandem', width: 10, height: 10 }],
      variants: [{ id: 'blank', name: 'Blank', status: 'available', surcharge: 0, benefit: '' }],
      groups: [{ id: 'a', title: 'A', intro: '', items: ['drager', 'kist', 'vloerklem'] }],
      priceOverrides: { kist: 250 },
    },
  },
  accessories: {
    drager: { name: 'Drager', article: 'de', plural: 'dragers', price: 295, status: 'available', max: 2, slots: { side: 1 }, benefit: 'x' },
    kist: { name: 'Kist', article: 'de', plural: 'kisten', price: 195, status: 'available', slots: { side: 1 }, benefit: 'x' },
    wiel: { name: 'Wiel', article: 'het', plural: 'wielen', price: 140, status: 'available', benefit: 'x' },
    'wiel-beugel': { name: 'Beugel', article: 'de', plural: 'beugels', price: 65, status: 'available', parent: 'wiel', slots: { side: 1 }, benefit: 'x' },
    'slot-a': { name: 'Slot A', article: 'het', plural: 'sloten A', price: 37.5, status: 'available', excludes: ['slot-b'], benefit: 'x' },
    'slot-b': { name: 'Slot B', article: 'het', plural: 'sloten B', price: 215, status: 'available', benefit: 'x' },
    velgen: {
      name: 'Velgen', article: 'de', plural: 'velgen', price: 245, status: 'available', benefit: 'x',
      priceWhen: [{ when: { variant: 'zwart' }, price: 200 }],
    },
    sierlijst: { name: 'Sierlijst', article: 'de', plural: 'sierlijsten', price: 50, status: 'available', onlyVariants: ['zwart'], benefit: 'x' },
    lamp: { name: 'Lamp', article: 'de', plural: 'lampen', price: null, status: 'on-request', benefit: 'x' },
    oud: { name: 'Oud model', article: 'het', plural: 'oude modellen', price: 10, status: 'unavailable', benefit: 'x' },
    vloerklem: { name: 'Vloerklem', article: 'de', plural: 'vloerklemmen', price: 80, status: 'available', max: 3, slots: { floor: 1 }, benefit: 'x' },
  },
  promotions: [
    { id: 'duo-drager', name: 'Fietsvoordeel', type: 'bundle', products: ['solo'], items: ['drager', 'wiel'], discount: 25, validFrom: '2026-01-01', validUntil: '2026-12-31' },
    { id: 'verlopen', name: 'Verlopen actie', type: 'bundle', items: ['kist'], discount: 50, validUntil: '2020-01-01' },
    { id: 'groot', name: 'Te grote korting', type: 'bundle', products: ['solo'], items: ['slot-a'], discount: 100 },
  ],
};
