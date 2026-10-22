# airtrailer.nl

Statische website van Airtrailer / The Trailer Company (Kampen). Oorspronkelijk gebouwd in Webflow, in oktober 2026 overgezet naar GitHub + Vercel. Geen build-stap, geen CMS, geen database: wat in deze repo staat is wat de bezoeker ziet.

## Structuur

```
*.html          een bestand per pagina (index.html = homepage, 404.html = niet-gevonden)
css/            normalize.css, components.css (Webflow basis), airtrailer.css (eigen styling)
js/             airtrailer.js (Webflow runtime: menu-animatie, sliders), jquery-3.5.1.min.js
images/         alle afbeeldingen, inclusief de responsive varianten (-p-500, -p-800, ...)
vercel.json     clean URLs (/mono in plaats van /mono.html) en cache-headers
sitemap.xml     handmatig bijhouden bij nieuwe of verwijderde pagina's
robots.txt
```

## Wijzigen en publiceren

1. Pas een bestand aan (tekst in een `.html`, styling in `css/airtrailer.css`, foto in `images/`).
2. Commit en push naar `main`.
3. Vercel bouwt en publiceert automatisch, meestal binnen een minuut. Elke pull request of andere branch krijgt een eigen preview-URL.

Lokaal bekijken: `npx serve .` in de map van de repo, daarna http://localhost:3000. Let op: lokaal werken links als `/mono` alleen met een server die clean URLs ondersteunt (`serve` doet dat standaard).

### Nieuwe pagina toevoegen

Kopieer een bestaande pagina (bijvoorbeeld `over-ons.html`), pas `<title>`, de meta-tags en de `<link rel="canonical">` aan, en voeg de URL toe aan `sitemap.xml`. Het menu staat in elke pagina los; een nieuw menu-item moet dus in alle `.html`-bestanden worden toegevoegd.

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

De pagina's `binnenkort-online`, `dealer-prijzen` en `veel-gestelde-vragen` hebben `noindex` en staan daarom niet in de sitemap.

## Domein

In Vercel onder Project > Settings > Domains: `www.airtrailer.nl` als primair domein, `airtrailer.nl` met redirect naar www (de canonical-tags op de pagina's wijzen naar www). Vercel toont daarna welke DNS-records bij de registrar moeten worden gezet (A-record voor de apex, CNAME voor www). Daarna pas de Webflow-site opzeggen.
