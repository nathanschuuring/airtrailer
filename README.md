# airtrailer.nl

Statische website van Airtrailer / The Trailer Company (Kampen). Oorspronkelijk gebouwd in Webflow, in oktober 2026 overgezet naar GitHub + Vercel. Geen CMS, geen database: wat in deze repo staat is wat de bezoeker ziet. Er zijn twee build-stappen: de kennisbank (veelgestelde vragen) wordt uit één inhoudsbestand gegenereerd, en de configurator op de productpagina uit één catalogus met prijzen en regels. De aanvraag uit de configurator wordt verwerkt door één serverfunctie op Vercel.

## Structuur

```
*.html          een bestand per pagina (index.html = homepage, 404.html = niet-gevonden)
css/            normalize.css, components.css (Webflow basis), airtrailer.css (eigen styling)
js/             airtrailer.js (Webflow runtime: menu-animatie, sliders), jquery-3.5.1.min.js
images/         alle afbeeldingen, inclusief de responsive varianten (-p-500, -p-800, ...)
vercel.json     clean URLs (/mono in plaats van /mono.html), redirects, cache-headers en het build-commando
sitemap.xml     gewone pagina's handmatig bijhouden; de kennisbank-regels worden gegenereerd
robots.txt

content/kennisbank.json     de inhoud van alle kennisbankartikelen (de enige bron)
templates/kennisbank/       artikel.html, overzicht.html en de gedeelde delen (head, header, footer)
scripts/build-kennisbank.mjs  genereert de kennisbank; geen afhankelijkheden, alleen Node.js
veelgestelde-vragen/        gegenereerde pagina's, niet met de hand aanpassen
css/kennisbank.css, js/kennisbank.js  styling en zoekfunctie van de kennisbank

configurator/catalog.js     producten, prijzen, accessoires, regels en acties (de enige bron)
configurator/engine.js      combinatieregels en prijsberekening, zonder HTML
configurator/app.js         de configurator in de browser; track.js stuurt de meetpunten
configurator/request.js     controleert en herberekent een aanvraag op de server; mailer.js verstuurt
api/aanvraag.js             Vercel Function: POST /api/aanvraag
scripts/build-configurator.mjs  zet kaarten, vanafprijs en structured data op de productpagina
scripts/dev-server.mjs      lokale server met schone URL's en de aanvraagfunctie
css/configurator.css        styling van de configurator
tests/                      tests voor prijzen, regels, de aanvraag en de pagina
package.json                scripts en de enige afhankelijkheid (nodemailer, voor e-mail)
```

## Wijzigen en publiceren

1. Pas een bestand aan (tekst in een `.html`, styling in `css/airtrailer.css`, foto in `images/`).
2. Commit en push naar `main`.
3. Vercel bouwt en publiceert automatisch, meestal binnen een minuut. Elke pull request of andere branch krijgt een eigen preview-URL.

Lokaal bekijken: `npm install` (eenmalig) en daarna `npm run dev`, dan http://localhost:3000. Die server kent de schone URL's (`/mono`) en de aanvraagfunctie; e-mails worden lokaal niet verstuurd maar in de terminal getoond. `npx serve .` werkt ook, maar dan zonder aanvraagfunctie.

Voor het committen: `npm run build` (kennisbank en configurator) en `npm test`.

### Nieuwe pagina toevoegen

Kopieer een bestaande pagina (bijvoorbeeld `over-ons.html`), pas `<title>`, de meta-tags en de `<link rel="canonical">` aan, en voeg de URL toe aan `sitemap.xml`. Het menu staat in elke pagina los; een nieuw menu-item moet dus in alle `.html`-bestanden worden toegevoegd, en in `templates/kennisbank/partials/header.html`.

## Kennisbank (veelgestelde vragen)

Overzicht op `/veelgestelde-vragen`, elk artikel op `/veelgestelde-vragen/<slug>`. Alles komt uit `content/kennisbank.json`; de HTML in `veelgestelde-vragen/` wordt daaruit gegenereerd.

### Artikel toevoegen of wijzigen

1. Voeg in `content/kennisbank.json` een blok toe aan `articles` (kopieer een bestaand artikel) of pas de tekst aan.
2. Draai `node scripts/build-kennisbank.mjs` en commit het resultaat. Vergeet je dat, dan doet Vercel het bij de deploy alsnog; de site klopt dus altijd met de bron.

Het script maakt de artikelpagina, zet het artikel in het overzicht en de zoekfunctie, werkt de gerelateerde vragen, `sitemap.xml` en de vragenblokken op de gewone pagina's bij, en stopt met een duidelijke melding als er iets niet klopt (dubbele slug of title, een verwijzing naar een artikel dat niet bestaat, een interne link die nergens heen gaat).

| Veld | Betekenis |
|---|---|
| `id` | uniek nummer; `relatedIds` en de vragenblokken verwijzen ernaar |
| `category` | slug van een categorie uit `categories` |
| `slug` | laatste deel van de URL; na publicatie niet meer wijzigen zonder redirect in `vercel.json` |
| `question` | de vraag, tevens de H1 |
| `title`, `description` | SEO-title en meta description, beide uniek |
| `lead` | het directe antwoord, staat bovenaan het artikel en (ingekort) op de kaarten |
| `intro` | optioneel: alinea's vóór de eerste tussenkop |
| `sections` | tussenkoppen (`heading`) met alinea's (`paragraphs`) |
| `relatedIds` | de gerelateerde vragen onder het artikel |
| `cta` | `type` verwijst naar `ctaTypes` (doelpagina, kop en toelichting), `label` is de knoptekst |
| `links` | optioneel: sleutels uit `siteLinks` voor het blok "Meer op deze site" |
| `externalLinks` | optioneel: officiële bronnen (`label`, `href`) |
| `index`, `primaryPage` | `index: false` voor een vraag die een bestaande pagina al volledig beantwoordt; `primaryPage` is de sleutel uit `siteLinks` van die pagina. Het artikel blijft bereikbaar maar krijgt `noindex` en verwijst door |
| `reviewStatus` | `concept` of `goedgekeurd` |
| `lastReviewed` | datum van de inhoudelijke controle (JJJJ-MM-DD), verplicht bij `goedgekeurd` |

In alinea's zijn `**vet**` en links als `[tekst](/pad)` toegestaan.

### Concept en goedgekeurd

Een artikel met `reviewStatus: "concept"` wordt wel gebouwd, maar met `noindex` en zonder vermelding in `sitemap.xml`. Pas met `"goedgekeurd"` en een `lastReviewed`-datum krijgt het een canonical, komt het in de sitemap en toont het de controledatum. Het overzicht zelf wordt indexeerbaar zodra er minstens één indexeerbaar artikel is.

### Vragenblok op een gewone pagina

Op de product-, verhuur-, instructie- en contactpagina staat een blok met vragen tussen twee markeringen:

```html
<!-- kennisbank:start ids="1,4,8" titel="Veelgestelde vragen over de Airtrailer Mono" -->
<!-- kennisbank:end -->
```

Het script vult alles tussen de markeringen. Pas alleen `ids` en `titel` aan. Een pagina met zo'n blok laadt ook `css/kennisbank.css`.

### Menu en footer

De kennisbankpagina's gebruiken `templates/kennisbank/partials/header.html` en `footer.html`. Wijzigt het menu of de footer op de gewone pagina's, pas die twee bestanden dan ook aan.

## Externe diensten die de site gebruikt

| Dienst | Waarvoor | Waar geconfigureerd |
|---|---|---|
| Elfsight | de 5 formulieren (contact, prijsaanvraag Mono/Duo/Scootmobiel, verhuur, Motor Mover voorverkoop) | `data-elfsight-show-form="..."` en `<div class="elfsight-app-...">` in de pagina's |
| Google Analytics | statistieken, property's G-DVPG1RVGRW en G-X5TKCX4782 | `<head>` van elke pagina |
| Hotjar | gedragsopnames, site 3830674 | `<head>` van elke pagina |
| Google Fonts | Open Sans en Montserrat | WebFont-loader in `<head>` |
| Google Maps | kaart op contact en binnenkort-online, als iframe-embed (geen API-key nodig) | `contact.html`, `binnenkort-online.html` |
| YouTube | video op de homepage | `index.html` |

## Wat anders is dan in Webflow

- De Google Maps-widget van Webflow werkte alleen met de API-key van Webflow en is vervangen door een gewone Google Maps-embed.
- jQuery wordt niet meer van het Webflow-CDN geladen maar staat in `js/`.
- Google Analytics stond dubbel in de export en is teruggebracht tot één blok (beide property's blijven gemeten).
- Het menu-item "Airtrailer MOTOR MOVER" verwees naar de scootmobiel-pagina en wijst nu naar `/motormover`.
- 157 niet-gebruikte responsive afbeeldingsvarianten zijn verwijderd (van 42 MB naar 20 MB).
- `sitemap.xml`, `robots.txt` en `404.html` genereerde Webflow automatisch; die staan nu in de repo.

De pagina's `binnenkort-online` en `dealer-prijzen` hebben `noindex` en staan daarom niet in de sitemap. De oude, lege pagina `/veel-gestelde-vragen` is vervangen door de kennisbank en verwijst daar met een 301 naartoe.

## Domein

In Vercel onder Project > Settings > Domains: `www.airtrailer.nl` als primair domein, `airtrailer.nl` met redirect naar www (de canonical-tags op de pagina's wijzen naar www). Vercel toont daarna welke DNS-records bij de registrar moeten worden gezet (A-record voor de apex, CNAME voor www). Daarna pas de Webflow-site opzeggen.

## Configurator

Op `/mono` staat de configurator (`#samenstellen`). De bezoeker kiest een uitvoering en accessoires, ziet direct het totaal en vraagt de samenstelling aan. Alles wat de configurator weet, staat in `configurator/catalog.js`.

### Prijs wijzigen

1. Pas in `configurator/catalog.js` het bedrag aan (`basePrice` van het model of `price` van een accessoire). Bedragen zijn in euro's inclusief btw: `37.5` is € 37,50.
2. Draai `npm run build` en `npm test`, en commit.

De vanafprijs in de kop van de pagina, de kaarten, de structured data voor Google, de berekening in de browser en de controle op de server gebruiken allemaal dat ene bedrag. Vergeet je de build, dan doet Vercel die bij de deploy; de test `tests/page.test.js` waarschuwt als de pagina achterloopt. De kennisbank noemt de basisprijs in lopende tekst (`content/kennisbank.json`); een test meldt het als die afwijkt.

### Accessoire toevoegen of wijzigen

Voeg een blok toe aan `accessories` en zet het id in een groep onder `products.mono.groups`.

| Veld | Betekenis |
|---|---|
| `name`, `spec` | naam en (optioneel) type of maat |
| `article`, `plural` | lidwoord en meervoud, voor de zinnen in meldingen |
| `phrase`, `shortName` | optioneel: naam in een zin, en korte naam als keuze onder een ander accessoire |
| `price` | meerprijs inclusief btw |
| `status` | `available` (bestelbaar), `on-request` (wel te kiezen, zonder prijs, telt niet mee in het totaal) of `unavailable` (zichtbaar, niet te kiezen) |
| `max` | hoogste aantal, standaard 1 |
| `slots` | montageplaatsen per stuk, bijvoorbeeld `{ side: 1 }` |
| `requires` | accessoires die ook gekozen moeten zijn |
| `excludes` | accessoires die niet samen met dit accessoire kunnen |
| `onlyVariants` | alleen leverbaar bij deze uitvoeringen |
| `parent` | wordt als keuze onder dat accessoire getoond en vervalt mee als het wordt verwijderd |
| `priceWhen` | afwijkende prijs onder een voorwaarde, bijvoorbeeld bij een bepaalde uitvoering |
| `benefit`, `moreInfo` | de korte uitleg op de kaart en de tekst achter "Meer informatie" |
| `image` | echte productfoto (`src`, `width`, `height`, `alt`) of `null` |

Is een prijs of regel nog niet zeker? Zet de status op `on-request`. Het accessoire is dan te kiezen, maar er staat geen bedrag bij en het telt niet mee in het totaal.

### Combinatieregels

De Mono heeft twee zijplaatsen (`products.mono.slots.side`). Elk accessoire met `slots: { side: 1 }` bezet er één. Kiest een bezoeker iets waarvoor geen plaats meer is, dan legt de configurator uit waarom en biedt hij aan een ander accessoire te vervangen. De teksten daarvoor worden uit de namen in de catalogus opgebouwd. Dezelfde regels gelden op de server: een samenstelling die niet kan, wordt daar geweigerd.

### Productfoto's

Kaarten zonder `image` tonen geen beeld; er worden geen verzonnen afbeeldingen gebruikt. Een foto toevoegen: zet het bestand in `images/configurator/` (bij voorkeur WebP) en vul `image` in. Geef een vervangende foto een nieuwe bestandsnaam: afbeeldingen worden 30 dagen in de browser bewaard.

Het grote productbeeld komt uit `products.mono.images`. Het eerste beeld waarvan `when` past, wordt getoond; een regel zonder voorwaarde is het standaardbeeld. Voor de Black Edition volstaat dus één extra regel:

```js
{ when: { variant: 'black-edition' }, src: '/images/configurator/airtrailer-mono-black.webp', width: 1400, height: 884, alt: '…', shows: 'black-edition' },
```

Zolang die foto er niet is, staat onder het beeld dat de aluminium uitvoering is afgebeeld.

### Acties en bundelvoordeel

`promotions` is leeg. Een actie toevoegen (zie het voorbeeld in de catalogus): `items` zijn de accessoires die samen gekozen moeten zijn, `discount` het bedrag, `validFrom` en `validUntil` de looptijd. De korting verschijnt alleen als ze echt van toepassing is, en de server rekent haar opnieuw uit met de datum van dat moment.

### Een tweede model (Duo)

Voeg onder `products` een blok `duo` toe met eigen basisprijs, uitvoeringen, groepen, montageplaatsen en beelden (afwijkende accessoireprijzen via `priceOverrides`), en zet op `airtrailer-duo.html` dezelfde drie markeringen als op `mono.html`, met `product="duo"`:

```html
<!-- configurator:jsonld product="duo" --><!-- configurator:jsonld-end -->
<!-- configurator:price product="duo" --><!-- configurator:price-end -->
<!-- configurator:start product="duo" -->
<!-- configurator:end -->
```

Laad op die pagina ook `css/configurator.css` en `configurator/app.js`. Er is geen tweede systeem nodig; `tests/fixture-catalog.js` test de engine al met twee modellen.

### Aanvraag en e-mail

De browser stuurt alleen de keuzes en het totaal dat de bezoeker zag naar `POST /api/aanvraag`. De server controleert de samenstelling, rekent alles opnieuw uit met de catalogus en mailt de aanvraag naar Airtrailer; de bezoeker krijgt desgewenst een kopie. Wijkt het totaal af (bijvoorbeeld omdat de prijzen net zijn gewijzigd), dan wordt er niets verstuurd en vraagt de pagina de bezoeker om te verversen.

E-mail gaat via SMTP. Stel in Vercel (Project Settings, Environment Variables) in en deploy opnieuw:

| Variabele | Waarde |
|---|---|
| `SMTP_HOST` | mailserver, bijvoorbeeld die van TransIP |
| `SMTP_PORT` | `465` (standaard) of `587` |
| `SMTP_USER`, `SMTP_PASS` | de mailbox waarmee wordt verzonden |
| `MAIL_TO` | waar aanvragen binnenkomen |
| `MAIL_FROM` | optioneel: afzenderadres als dat afwijkt van `SMTP_USER` |

Zolang deze ontbreken, antwoordt de server met een fout en biedt de pagina aan de samenstelling per e-mail te sturen of te bellen. Er gaat dan niets ongemerkt verloren.

Spam wordt geweerd zonder puzzel: een verborgen veld, een minimale invultijd, een controle op de herkomst van het verzoek en een rem op veel aanvragen vanaf één adres.

### Meten

`configurator/track.js` stuurt events naar de bestaande Google Analytics, zonder persoonsgegevens: `configurator_start`, `configurator_stap_bekeken` (stap 1, 2, 3), `configurator_uitvoering_gekozen`, `configurator_accessoire_toegevoegd`, `configurator_accessoire_verwijderd`, `configurator_combinatie_melding`, `configurator_combinatie_opgelost`, `configurator_voltooid` (overzicht bereikt), `configurator_aanvraag_gestart`, `configurator_aanvraag_verzonden`, `configurator_aanvraag_fout`, `configurator_link_gekopieerd` en `configurator_opnieuw_begonnen`. Start, stappen, voltooid, aanvraag gestart en verzonden tellen per paginabezoek één keer. Afhakers lees je af uit het verschil tussen deze stappen.
