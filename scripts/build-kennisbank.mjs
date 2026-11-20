#!/usr/bin/env node
// Bouwt de kennisbank (veelgestelde vragen) van airtrailer.nl.
//
//   Bron:       content/kennisbank.json
//   Templates:  templates/kennisbank/
//   Uitvoer:    veelgestelde-vragen/index.html en veelgestelde-vragen/<slug>.html
//               sitemap.xml (alleen de kennisbank-regels)
//               de blokken tussen <!-- kennisbank:start ... --> en <!-- kennisbank:end -->
//               in de gewone pagina's
//
// Gebruik:  node scripts/build-kennisbank.mjs           bouwen
//           node scripts/build-kennisbank.mjs --check   alleen controleren, niets schrijven
//
// Geen afhankelijkheden: alleen Node.js (18 of nieuwer).

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');
const TEMPLATE_DIR = join(ROOT, 'templates', 'kennisbank');
const STATUSES = ['concept', 'goedgekeurd'];

const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const fail = (message) => {
  console.error(`\nFout in de kennisbank: ${message}\n`);
  process.exit(1);
};

// ---------------------------------------------------------------------------
// Mini-template (subset van Mustache): {{x}} {{{x}}} {{#x}}..{{/x}} {{^x}}..{{/x}} {{> partial}}
// ---------------------------------------------------------------------------

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function parseTemplate(source, partials) {
  // Regels met alleen een sectie- of partial-tag laten geen lege regel achter.
  source = source.replace(/^[ \t]*(\{\{[#^/>][^}]*\}\})[ \t]*\r?\n/gm, '$1');
  const tagPattern = /\{\{\{\s*([\w.-]+)\s*\}\}\}|\{\{([#^/>]?)\s*([\w.-]+)\s*\}\}/g;
  const root = { children: [] };
  const stack = [root];
  let last = 0;
  let match;
  while ((match = tagPattern.exec(source))) {
    const parent = stack[stack.length - 1];
    if (match.index > last) parent.children.push({ type: 'text', value: source.slice(last, match.index) });
    last = tagPattern.lastIndex;
    if (match[1]) {
      parent.children.push({ type: 'raw', name: match[1] });
    } else if (match[2] === '#' || match[2] === '^') {
      const node = { type: match[2] === '#' ? 'section' : 'inverted', name: match[3], children: [] };
      parent.children.push(node);
      stack.push(node);
    } else if (match[2] === '/') {
      const open = stack.pop();
      if (open.name !== match[3]) throw new Error(`Template: {{/${match[3]}}} sluit {{#${open.name}}} niet af`);
    } else if (match[2] === '>') {
      if (!(match[3] in partials)) throw new Error(`Template: onbekende partial "${match[3]}"`);
      parent.children.push(...partials[match[3]].children);
    } else {
      parent.children.push({ type: 'var', name: match[3] });
    }
  }
  if (stack.length !== 1) throw new Error(`Template: {{#${stack[stack.length - 1].name}}} is niet afgesloten`);
  if (last < source.length) root.children.push({ type: 'text', value: source.slice(last) });
  return root;
}

function lookup(name, contexts) {
  const [first, ...rest] = name.split('.');
  for (let i = contexts.length - 1; i >= 0; i--) {
    const context = contexts[i];
    if (context !== null && typeof context === 'object' && first in context) {
      return rest.reduce((value, key) => (value == null ? undefined : value[key]), context[first]);
    }
  }
  return undefined;
}

function renderNodes(nodes, contexts) {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      out += node.value;
      continue;
    }
    const value = lookup(node.name, contexts);
    const empty = value == null || value === false || value === '' || (Array.isArray(value) && value.length === 0);
    if (node.type === 'var') out += empty ? '' : escapeHtml(value);
    else if (node.type === 'raw') out += empty ? '' : String(value);
    else if (node.type === 'inverted') out += empty ? renderNodes(node.children, contexts) : '';
    else if (!empty) {
      for (const item of Array.isArray(value) ? value : [value]) {
        out += renderNodes(node.children, [...contexts, item]);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Inhoud
// ---------------------------------------------------------------------------

const data = JSON.parse(read('content', 'kennisbank.json'));
const { site, overview, categories, siteLinks, ctaTypes, articles } = data;
const basePath = site.basePath;
const outDir = join(ROOT, basePath.replace(/^\//, ''));
const absolute = (path) => site.baseUrl + (path === '/' ? '/' : path);
const articlePath = (article) => `${basePath}/${article.slug}`;

function validate() {
  const seen = { id: new Map(), slug: new Map(), title: new Map(), description: new Map() };
  const categorySlugs = new Set(categories.map((category) => category.slug));
  const ids = new Set(articles.map((article) => article.id));
  for (const article of articles) {
    const where = `artikel ${article.id ?? '?'} ("${article.slug ?? article.question ?? '?'}")`;
    for (const key of ['id', 'category', 'slug', 'question', 'title', 'description', 'lead', 'sections', 'cta', 'reviewStatus']) {
      if (article[key] == null || article[key] === '') fail(`${where} mist het veld "${key}".`);
    }
    for (const key of Object.keys(seen)) {
      if (seen[key].has(article[key])) fail(`${where} heeft dezelfde ${key} als artikel ${seen[key].get(article[key])}. Elke ${key} moet uniek zijn.`);
      seen[key].set(article[key], article.id);
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(article.slug)) fail(`${where}: de slug mag alleen kleine letters, cijfers en koppeltekens bevatten.`);
    if (article.slug === 'index') fail(`${where}: "index" is geen geldige slug.`);
    if (!categorySlugs.has(article.category)) fail(`${where}: onbekende categorie "${article.category}".`);
    if (!STATUSES.includes(article.reviewStatus)) fail(`${where}: reviewStatus moet "${STATUSES.join('" of "')}" zijn.`);
    if (article.reviewStatus === 'goedgekeurd' && !/^\d{4}-\d{2}-\d{2}$/.test(article.lastReviewed ?? '')) {
      fail(`${where} is goedgekeurd maar heeft geen lastReviewed in de vorm JJJJ-MM-DD.`);
    }
    if (!Array.isArray(article.sections) || article.sections.length === 0) fail(`${where} heeft geen secties.`);
    for (const section of article.sections) {
      if (!section.heading || !Array.isArray(section.paragraphs) || section.paragraphs.length === 0) fail(`${where}: elke sectie heeft een heading en minimaal één alinea nodig.`);
    }
    for (const relatedId of article.relatedIds ?? []) {
      if (!ids.has(relatedId)) fail(`${where}: gerelateerd artikel ${relatedId} bestaat niet.`);
      if (relatedId === article.id) fail(`${where} verwijst naar zichzelf als gerelateerd artikel.`);
    }
    if (!ctaTypes[article.cta.type]) fail(`${where}: onbekend CTA-type "${article.cta.type}".`);
    if (!article.cta.label) fail(`${where}: de CTA heeft geen label.`);
    for (const key of article.links ?? []) {
      if (!siteLinks[key]) fail(`${where}: onbekende sitelink "${key}".`);
    }
    if (article.primaryPage && !siteLinks[article.primaryPage]) fail(`${where}: onbekende primaryPage "${article.primaryPage}".`);
    if (article.index === false && !article.primaryPage) fail(`${where} staat op index: false maar noemt geen primaryPage waarnaar verwezen wordt.`);
  }
}

// Platte tekst uit de bron naar HTML: escapen, **vet** en [tekst](/pad) toestaan.
function inline(text) {
  return escapeHtml(text)
    .replace(/€ (?=\d)/g, '€&nbsp;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(((?:\/|https:\/\/)[^)\s]*)\)/g, (_, label, href) =>
      href.startsWith('/') ? `<a href="${href}">${label}</a>` : `<a href="${href}" target="_blank" rel="noopener">${label}</a>`
    );
}

const plain = (text) => text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

// Korte samenvatting voor kaarten: de eerste zin van het antwoord (twee als de eerste erg kort is).
function summarize(lead) {
  const sentences = plain(lead).split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý])/);
  let summary = sentences[0];
  if (summary.length < 60 && sentences[1]) summary += ' ' + sentences[1];
  return summary;
}

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function formatDate(iso) {
  const months = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} ${months[month - 1]} ${year}`;
}

const jsonLd = (graph) => JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
const isApproved = (article) => article.reviewStatus === 'goedgekeurd';
const isIndexable = (article) => isApproved(article) && article.index !== false;

function resolveCta(article) {
  const type = ctaTypes[article.cta.type];
  const actions = type.actions.map((action, position) => ({
    href: article.cta.href ?? action.href,
    label: action.label ?? article.cta.label,
    secondary: position > 0,
    type: article.cta.type,
  }));
  // Types met eigen knoplabels (bijvoorbeeld Mono en Duo) tonen het CTA-label van het artikel als kop.
  const heading = type.actions.some((action) => action.label) ? article.cta.label : type.heading;
  return { heading, text: article.cta.text ?? type.text, actions };
}

function buildArticle(article, template) {
  const category = categories.find((item) => item.slug === article.category);
  const path = articlePath(article);
  const indexable = isIndexable(article);
  const byId = new Map(articles.map((item) => [item.id, item]));
  const usedIds = new Set();
  const sections = article.sections.map((section) => {
    let id = slugify(section.heading) || 'sectie';
    while (usedIds.has(id)) id += '-2';
    usedIds.add(id);
    return { id, heading: section.heading, paragraphs: section.paragraphs.map((text) => ({ html: inline(text) })) };
  });
  const related = (article.relatedIds ?? []).map((id) => byId.get(id)).map((item) => ({
    href: articlePath(item),
    question: item.question,
    summary: summarize(item.lead),
  }));
  const relatedIds = new Set(article.relatedIds ?? []);
  const siblings = articles
    .filter((item) => item.category === article.category && item.id !== article.id && !relatedIds.has(item.id))
    .map((item) => ({ href: articlePath(item), question: item.question }));
  const links = (article.links ?? []).map((key) => siteLinks[key]);
  const page = {
    '@type': 'WebPage',
    '@id': absolute(path),
    url: absolute(path),
    name: article.question,
    description: article.description,
    inLanguage: site.language,
    isPartOf: { '@type': 'WebSite', name: site.name, url: absolute('/') },
    publisher: { '@type': 'Organization', name: site.name, url: absolute('/') },
  };
  if (article.lastReviewed) page.dateModified = article.lastReviewed;
  const breadcrumbs = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: absolute('/') },
      { '@type': 'ListItem', position: 2, name: 'Veelgestelde vragen', item: absolute(basePath) },
      { '@type': 'ListItem', position: 3, name: category.name, item: `${absolute(basePath)}#${category.slug}` },
      { '@type': 'ListItem', position: 4, name: article.question },
    ],
  };
  return renderNodes(template.children, [
    {
      title: article.title,
      description: article.description,
      url: absolute(path),
      ogType: 'article',
      canonical: indexable ? absolute(path) : null,
      robots: indexable ? null : 'noindex, follow',
      jsonLd: jsonLd([page, breadcrumbs]),
      basePath,
      category: { ...category, nameLower: category.name === 'Van Vossen' ? category.name : category.name.toLowerCase() },
      question: article.question,
      leadHtml: inline(article.lead),
      intro: (article.intro ?? []).map((text) => ({ html: inline(text) })),
      sections,
      primaryPage: article.primaryPage ? siteLinks[article.primaryPage] : null,
      externalLinks: article.externalLinks ?? [],
      hasExternalLinks: (article.externalLinks ?? []).length > 0,
      lastReviewed: isApproved(article) ? article.lastReviewed : null,
      lastReviewedLabel: isApproved(article) && article.lastReviewed ? formatDate(article.lastReviewed) : null,
      cta: resolveCta(article),
      links,
      hasLinks: links.length > 0,
      related,
      siblings,
      hasSiblings: siblings.length > 0,
    },
  ]);
}

function buildOverview(template) {
  const indexable = articles.some(isIndexable);
  const grouped = categories
    .map((category) => {
      const items = articles.filter((article) => article.category === category.slug);
      return {
        ...category,
        count: items.length,
        articles: items.map((article) => ({
          href: articlePath(article),
          question: article.question,
          summary: summarize(article.lead),
          // Extra zoektekst: het volledige korte antwoord en de tussenkoppen van het artikel.
          terms: [plain(article.lead), ...article.sections.map((section) => section.heading)].join(' ').toLowerCase(),
        })),
      };
    })
    .filter((category) => category.count > 0);
  const collection = {
    '@type': 'CollectionPage',
    '@id': absolute(basePath),
    url: absolute(basePath),
    name: overview.heading,
    description: overview.description,
    inLanguage: site.language,
    isPartOf: { '@type': 'WebSite', name: site.name, url: absolute('/') },
    publisher: { '@type': 'Organization', name: site.name, url: absolute('/') },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: articles.length,
      itemListElement: articles.map((article, position) => ({
        '@type': 'ListItem',
        position: position + 1,
        name: article.question,
        url: absolute(articlePath(article)),
      })),
    },
  };
  const breadcrumbs = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: absolute('/') },
      { '@type': 'ListItem', position: 2, name: 'Veelgestelde vragen' },
    ],
  };
  return renderNodes(template.children, [
    {
      title: overview.title,
      description: overview.description,
      url: absolute(basePath),
      ogType: 'website',
      canonical: indexable ? absolute(basePath) : null,
      robots: indexable ? null : 'noindex, follow',
      jsonLd: jsonLd([collection, breadcrumbs]),
      basePath,
      heading: overview.heading,
      intro: overview.intro,
      total: articles.length,
      categories: grouped,
    },
  ]);
}

// Blok met contextuele links voor gewone pagina's (product, verhuur, instructie, contact).
function buildContextBlock(attributes, file) {
  const ids = (attributes.ids ?? '').split(',').map((id) => Number(id.trim())).filter(Boolean);
  const title = attributes.titel ?? 'Veelgestelde vragen';
  const headingId = 'kennisbank-' + slugify(title);
  const items = ids.map((id) => {
    const article = articles.find((item) => item.id === id);
    if (!article) fail(`${file}: het kennisbankblok verwijst naar artikel ${id}, maar dat bestaat niet.`);
    return `          <li><a href="${articlePath(article)}">${escapeHtml(article.question)}</a><span>${escapeHtml(summarize(article.lead))}</span></li>`;
  });
  return [
    '',
    `      <section class="kb-context" aria-labelledby="${headingId}">`,
    `        <h2 id="${headingId}">${escapeHtml(title)}</h2>`,
    '        <ul>',
    ...items,
    '        </ul>',
    `        <p class="kb-context-more"><a href="${basePath}" class="btn w-button">Alle veelgestelde vragen</a></p>`,
    '      </section>',
    '      ',
  ].join('\n');
}

const MARKER = /(<!-- kennisbank:start([^>]*?)-->)([\s\S]*?)(<!-- kennisbank:end -->)/g;

function injectContextBlocks(output) {
  for (const file of readdirSync(ROOT).filter((name) => name.endsWith('.html'))) {
    const source = read(file);
    if (!source.includes('<!-- kennisbank:start')) continue;
    const result = source.replace(MARKER, (_, start, rawAttributes, __, end) => {
      const attributes = Object.fromEntries([...rawAttributes.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
      return start + buildContextBlock(attributes, file) + end;
    });
    output.set(file, result);
  }
}

function buildSitemap() {
  const existing = read('sitemap.xml');
  const kept = [...existing.matchAll(/^\s*<url>.*<\/url>\s*$/gm)]
    .map((match) => match[0].trim())
    .filter((line) => !line.includes(`<loc>${absolute(basePath)}`));
  const entries = [];
  if (articles.some(isIndexable)) entries.push(`<url><loc>${absolute(basePath)}</loc></url>`);
  for (const article of articles.filter(isIndexable)) {
    entries.push(`<url><loc>${absolute(articlePath(article))}</loc><lastmod>${article.lastReviewed}</lastmod></url>`);
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...[...kept, ...entries].map((line) => '  ' + line),
    '</urlset>',
    '',
  ].join('\n');
}

// Elke interne link in de uitvoer moet naar een bestaande pagina of bestand wijzen.
function checkInternalLinks(output) {
  const exists = (path) => {
    const clean = path.replace(/[?#].*$/, '').replace(/\/$/, '');
    if (clean === '') return true;
    const relative = clean.replace(/^\//, '');
    return [relative, `${relative}.html`, `${relative}/index.html`].some((candidate) => output.has(candidate) || existsSync(join(ROOT, candidate)));
  };
  const problems = [];
  for (const [file, html] of output) {
    if (!file.endsWith('.html')) continue;
    for (const match of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
      if (!exists(match[1])) problems.push(`${file} -> ${match[1]}`);
    }
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
    for (const match of html.matchAll(/aria-(?:labelledby|describedby)="([^"]+)"/g)) {
      if (!ids.has(match[1])) problems.push(`${file}: aria-verwijzing naar ontbrekend id "${match[1]}"`);
    }
  }
  if (problems.length) fail(`interne links die nergens naartoe wijzen:\n  ${problems.join('\n  ')}`);
}

// ---------------------------------------------------------------------------
// Bouwen
// ---------------------------------------------------------------------------

validate();

const partials = {};
for (const name of ['head', 'header', 'footer']) {
  partials[name] = parseTemplate(readFileSync(join(TEMPLATE_DIR, 'partials', `${name}.html`), 'utf8'), {});
}
const articleTemplate = parseTemplate(readFileSync(join(TEMPLATE_DIR, 'artikel.html'), 'utf8'), partials);
const overviewTemplate = parseTemplate(readFileSync(join(TEMPLATE_DIR, 'overzicht.html'), 'utf8'), partials);

const relativeDir = basePath.replace(/^\//, '');
const output = new Map();
output.set(`${relativeDir}/index.html`, buildOverview(overviewTemplate));
for (const article of articles) output.set(`${relativeDir}/${article.slug}.html`, buildArticle(article, articleTemplate));
output.set('sitemap.xml', buildSitemap());
injectContextBlocks(output);
checkInternalLinks(output);

const stale = existsSync(outDir)
  ? readdirSync(outDir).filter((name) => name.endsWith('.html') && !output.has(`${relativeDir}/${name}`))
  : [];
const changed = [...output].filter(([file, content]) => !existsSync(join(ROOT, file)) || read(file) !== content).map(([file]) => file);

if (CHECK_ONLY) {
  if (changed.length || stale.length) {
    fail(`de uitvoer loopt achter op de bron. Draai "node scripts/build-kennisbank.mjs".\n  ${[...changed, ...stale.map((name) => `${relativeDir}/${name} (verwijderen)`)].join('\n  ')}`);
  }
} else {
  mkdirSync(outDir, { recursive: true });
  for (const name of stale) rmSync(join(outDir, name));
  for (const file of changed) writeFileSync(join(ROOT, file), output.get(file));
}

const approved = articles.filter(isApproved).length;
const indexable = articles.filter(isIndexable).length;
console.log(
  [
    `Kennisbank: ${articles.length} artikelen in ${categories.length} categorieën.`,
    `  goedgekeurd: ${approved}, concept: ${articles.length - approved}`,
    `  indexeerbaar en in sitemap.xml: ${indexable}`,
    `  bewust niet indexeerbaar (index: false): ${articles.filter((article) => article.index === false).length}`,
    CHECK_ONLY ? '  controle geslaagd, uitvoer is actueel.' : `  ${changed.length} bestand(en) bijgewerkt, ${stale.length} verwijderd.`,
  ].join('\n')
);
