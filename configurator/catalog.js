// Catalogus van de Airtrailer-configurator: de enige plek voor producten, prijzen,
// accessoires, combinatieregels en promoties.
//
// Dit bestand wordt gebruikt door:
//   - de browser (configurator/app.js)
//   - de server bij het verwerken van een aanvraag (api/aanvraag.js), die alles opnieuw berekent
//   - het build-script (scripts/build-configurator.mjs), dat de kaarten, de vanafprijs en de
//     structured data op de productpagina zet
//
// Prijs wijzigen? Pas hier het bedrag aan, draai `npm run build` en commit. Meer is niet nodig.
//
// Afspraken:
//   - Alle bedragen zijn in euro's, inclusief btw, met maximaal twee decimalen (37.5 = € 37,50).
//   - status 'available'   bestelbaar tegen de genoemde prijs
//            'on-request'  wel te kiezen, maar zonder prijs: telt niet mee in het totaal en
//                          staat in de aanvraag als "prijs op aanvraag"
//            'unavailable' zichtbaar, niet te kiezen
//   - Uitleg per veld staat in de README onder "Configurator".

export const catalog = {
  currency: 'EUR',
  priceListDate: '2024-02-22',

  // Getoond als de aanvraag niet verzonden kan worden, en in de bevestigingsmail.
  contact: {
    email: 'info@airtrailer.nl',
    phone: '038 333 8477',
    phoneHref: 'tel:+31383338477',
  },

  // Montageplaatsen die accessoires met elkaar delen.
  slotTypes: {
    side: {
      singular: 'zijplaats',
      plural: 'zijplaatsen',
      explanation:
        'Op de Mono is aan beide zijden van de trailer ruimte voor één accessoire. Sommige opties delen dus dezelfde plek.',
    },
  },

  products: {
    mono: {
      id: 'mono',
      name: 'Airtrailer Mono',
      page: '/mono',
      basePrice: 3350,
      description:
        'De motortrailer met zakkende laadvloer voor één motor tot 450 kg. Geproduceerd in Kampen.',
      included: [
        'SteadyStand-voorwielklem',
        'Luchtvering met zakkende laadvloer',
        'Oprijklep, versterkt met twee ribben',
        'Zwenkwieltjes om de trailer rechtop te stallen',
        'Veiligheidspen',
        'Europese typegoedkeuring (RDW) met COC-document',
      ],
      slots: { side: 2 },

      // Productbeelden. Het eerste beeld waarvan de voorwaarde past, wordt getoond.
      // Nieuwe foto (bijvoorbeeld van de Black Edition)? Voeg een regel toe met `when`.
      //   { when: { variant: 'black-edition' }, src: '...', alt: '...' }
      //   { when: { variant: 'black-edition', items: ['lichtmetalen-velgen'] }, ... }
      images: [
        {
          when: {},
          src: '/images/configurator/airtrailer-mono.webp',
          srcset:
            '/images/configurator/airtrailer-mono-800.webp 800w, /images/configurator/airtrailer-mono.webp 1400w',
          width: 1400,
          height: 884,
          alt: 'Airtrailer Mono in aluminium uitvoering, schuin van voren gezien',
          shows: 'aluminium',
        },
      ],

      variants: [
        {
          id: 'aluminium',
          name: 'Aluminium',
          label: 'Standaard',
          status: 'available',
          surcharge: 0,
          benefit: 'Blank aluminium traanplaat. De uitvoering zoals u de Airtrailer kent.',
        },
        {
          id: 'black-edition',
          name: 'Black Edition',
          status: 'on-request',
          surcharge: null,
          benefit: 'De Airtrailer in een zwarte uitvoering.',
          moreInfo:
            'Een zwart gepoedercoate uitvoering kan invloed hebben op de levertijd. Wij nemen de actuele meerprijs op in uw offerte.',
        },
      ],

      groups: [
        {
          id: 'laden',
          title: 'Laden en vastzetten',
          intro: 'Wat u nodig heeft om uw motor op de trailer te zetten en vast te zetten.',
          items: ['compressor', 'spanbanden'],
        },
        {
          id: 'meenemen',
          title: 'Extra meenemen',
          intro: 'Fietsen, bagage of een reservewiel mee op reis.',
          slot: 'side',
          items: ['fietsendrager', 'opbergkist', 'reservewiel'],
        },
        {
          id: 'beveiliging',
          title: 'Beveiliging',
          intro: 'Voor als u de trailer onbeheerd achterlaat, of als uw verzekeraar een slot verlangt.',
          items: ['disselslot', 'scm-slot'],
        },
        {
          id: 'rangeren',
          title: 'Rangeren en koppelen',
          intro: 'Voor meer gemak bij het manoeuvreren en meer ruimte achter uw voertuig.',
          items: ['steunwiel', 'disselverlenging'],
        },
        {
          id: 'uitstraling',
          title: 'Wielen en verlichting',
          intro: 'Geef uw Airtrailer een eigen uitstraling.',
          items: ['lichtmetalen-velgen', 'led-verlichting'],
        },
        {
          id: 'overig',
          title: 'Kenteken en overig',
          intro: '',
          items: ['vierkant-kenteken', 'nl-sticker', 'beugel-scootmobiel'],
        },
      ],

      // Afwijkende prijs voor dit product: { 'accessoire-id': bedrag }
      priceOverrides: {},
    },
  },

  // Velden per accessoire:
  //   name, spec           naam en (optioneel) type of maat
  //   article, plural      lidwoord en meervoud, voor nette zinnen in meldingen
  //   phrase               (optioneel) hoe het accessoire in een zin heet, als naam + lidwoord niet loopt
  //   shortName            (optioneel) korte naam als keuze onder een ander accessoire
  //   benefit, moreInfo    korte uitleg op de kaart en de tekst achter "Meer informatie"
  //   price, status        zie bovenaan
  //   max                  hoogste aantal (standaard 1)
  //   slots                montageplaatsen per stuk, bijvoorbeeld { side: 1 }
  //   requires             ids die ook gekozen moeten zijn
  //   excludes             ids die niet samen met dit accessoire kunnen
  //   onlyVariants         alleen leverbaar bij deze uitvoeringen
  //   parent               wordt als keuze onder dit accessoire getoond (impliceert requires)
  //   priceWhen            afwijkende prijs onder een voorwaarde:
  //                        [{ when: { variant: '…', items: ['…'] }, price: 0 }]
  //   image                echte productfoto, of null. Geen foto = kaart zonder beeld.
  accessories: {
    compressor: {
      name: 'Compressor',
      spec: 'Black+Decker ASI300',
      article: 'de',
      plural: 'compressoren',
      price: 130,
      status: 'available',
      benefit: 'Pompt de luchtbalg na het laden weer op tot de juiste druk.',
      moreInfo:
        'Zodra uw motor op de trailer staat, brengt u de Airtrailer met de compressor weer omhoog. Bij het ophalen leggen wij uit hoe dit werkt.',
      image: null,
    },
    spanbanden: {
      name: 'Spanbanden',
      spec: 'Set van 4 stuks',
      article: 'de',
      plural: 'sets spanbanden',
      price: 40,
      status: 'available',
      benefit: 'Zet uw motor na het laden veilig vast.',
      moreInfo:
        'De SteadyStand-voorwielklem ondersteunt uw motor tijdens het plaatsen, maar vervangt de spanbanden niet.',
      image: null,
    },
    fietsendrager: {
      name: 'Fietsendrager',
      spec: 'Ook voor e-bikes tot 25 kg',
      article: 'de',
      plural: 'fietsendragers',
      price: 295,
      unit: 'per stuk',
      status: 'available',
      max: 2,
      slots: { side: 1 },
      benefit: 'Neem naast uw motor één of twee fietsen mee.',
      moreInfo:
        'Per zijde kan één fietsendrager worden gemonteerd. Het gewicht van uw motor, fietsen en dragers samen moet binnen het laadvermogen van de trailer blijven.',
      image: {
        src: '/images/configurator/fietsendrager.webp',
        width: 900,
        height: 426,
        alt: 'Airtrailer Mono met een fiets op de fietsendrager',
      },
    },
    opbergkist: {
      name: 'Aluminium opbergkist',
      article: 'de',
      plural: 'opbergkisten',
      price: 195,
      status: 'available',
      max: 1,
      slots: { side: 1 },
      benefit: 'Bergruimte op de trailer voor spanbanden, gereedschap en andere kleine spullen.',
      image: null,
    },
    reservewiel: {
      name: 'Reservewiel',
      spec: '10 inch',
      article: 'het',
      plural: 'reservewielen',
      price: 140,
      status: 'available',
      benefit: 'Voor langere ritten: een compleet reservewiel.',
      image: null,
    },
    'reservewiel-beugel': {
      name: 'Bevestigingsbeugel reservewiel',
      shortName: 'Bevestigingsbeugel',
      phrase: 'de bevestigingsbeugel voor het reservewiel',
      article: 'de',
      plural: 'bevestigingsbeugels',
      price: 65,
      status: 'available',
      parent: 'reservewiel',
      slots: { side: 1 },
      benefit: 'Om het reservewiel op de trailer mee te nemen.',
      image: null,
    },
    'reservewiel-lichtmetaal': {
      name: 'Reservewiel in lichtmetaal',
      shortName: 'Uitvoering in lichtmetaal',
      phrase: 'het reservewiel in lichtmetaal',
      article: 'het',
      plural: 'reservewielen in lichtmetaal',
      price: null,
      status: 'on-request',
      parent: 'reservewiel',
      benefit: 'Passend bij lichtmetalen velgen.',
      image: null,
    },
    disselslot: {
      name: 'Disselslot',
      spec: 'ABUS-hangslot',
      article: 'het',
      plural: 'disselsloten',
      price: 37.5,
      status: 'available',
      benefit: 'Eenvoudige diefstalbeveiliging voor de koppeling.',
      image: null,
    },
    'scm-slot': {
      name: 'SCM-gekeurd onderbouwslot',
      spec: 'Inclusief montage',
      article: 'het',
      plural: 'onderbouwsloten',
      price: 215,
      status: 'available',
      benefit: 'Wordt vast onder de koppeling gemonteerd en biedt uitgebreidere beveiliging.',
      moreInfo:
        'Sommige verzekeraars stellen een SCM-gekeurd slot als voorwaarde. Controleer uw polis.',
      image: null,
    },
    steunwiel: {
      name: 'Steunwiel',
      article: 'het',
      plural: 'steunwielen',
      price: 90,
      status: 'available',
      benefit: 'Helpt bij het manoeuvreren van de stilstaande trailer.',
      image: null,
    },
    disselverlenging: {
      name: 'Disselverlenging',
      spec: '300 mm',
      article: 'de',
      plural: 'disselverlengingen',
      price: 105,
      status: 'available',
      benefit: 'Meer ruimte tussen uw voertuig en de trailer.',
      moreInfo:
        'Handig wanneer achter op uw camper of auto al een fietsendrager zit. De verlenging is geen extra montageplaats voor een opbergkist.',
      image: null,
    },
    'lichtmetalen-velgen': {
      name: 'Lichtmetalen velgen',
      spec: 'Upgrade van de standaardvelgen',
      article: 'de',
      plural: 'sets lichtmetalen velgen',
      price: 245,
      status: 'available',
      benefit: 'Lichtmetalen velgen in plaats van de standaardvelgen.',
      image: null,
    },
    'led-verlichting': {
      name: 'LED-verlichting',
      article: 'de',
      plural: 'sets LED-verlichting',
      price: null,
      status: 'on-request',
      benefit: 'LED-verlichting voor uw Airtrailer.',
      image: null,
    },
    'vierkant-kenteken': {
      name: 'Vierkant kenteken',
      spec: '340 × 210 mm',
      article: 'het',
      plural: 'vierkante kentekens',
      price: 32.5,
      status: 'available',
      benefit: 'Kentekenplaat in vierkante uitvoering.',
      image: null,
    },
    'nl-sticker': {
      name: 'NL-sticker met bordje',
      article: 'de',
      plural: 'NL-stickers met bordje',
      price: 25,
      status: 'available',
      benefit: 'Landaanduiding voor op de trailer.',
      image: null,
    },
    'beugel-scootmobiel': {
      name: 'Beugel voor scootmobiel of Piaggio MP3',
      article: 'de',
      plural: 'beugels',
      price: 75,
      status: 'available',
      benefit: 'Voor het vervoer van een scootmobiel of een Piaggio MP3.',
      image: null,
    },
  },

  // Bundelvoordelen en acties. Leeg zolang er geen actie loopt.
  //   { id: 'reisklaar', name: 'Reisklaar-voordeel', type: 'bundle',
  //     products: ['mono'], items: ['compressor', 'spanbanden', 'disselslot'],
  //     discount: 25, validFrom: '2027-01-01', validUntil: '2027-03-31' }
  promotions: [],
};

export default catalog;
