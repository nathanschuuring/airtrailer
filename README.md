# airtrailer.nl

Statische website van Airtrailer / The Trailer Company (Kampen). Oorspronkelijk gebouwd in Webflow, in oktober 2026 overgezet naar GitHub + Vercel. Geen CMS, geen database: wat in deze repo staat is wat de bezoeker ziet. De enige build-stap is het script dat de kennisbank (veelgestelde vragen) uit één inhoudsbestand genereert.

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
```

## Wijzigen en publiceren

1. Pas een bestand aan (tekst in een `.html`, styling in `css/airtrailer.css`, foto in `images/`).
2. Commit en push naar `main`.
3. Vercel bouwt en publiceert automatisch, meestal binnen een minuut. Elke pull request of andere branch krijgt een eigen preview-URL.

Lokaal bekijken: `npx serve .` in de map van de repo, daarna http://localhost:3000. Let op: lokaal werken links als `/mono` alleen met een server die clean URLs ondersteunt (`serve` doet dat standaard).

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
