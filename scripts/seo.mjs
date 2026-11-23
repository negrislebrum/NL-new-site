// SEO generator — runs on every deploy (build command) and can be run by hand: `node scripts/seo.mjs`.
// Reads the product list (P), category lists (LISTS) and images (PIMG) straight from index.html, so titles,
// Product schema, the sitemap and share images always match what the site shows. It writes:
//   img/p/<key>.jpg                          product photos embedded in index.html, as real files for Google & share cards
//   img/og/*.jpg, img/logo.png               page share images and the logo
//   netlify/edge-functions/lib/seo-data.js   the <head> block for every page and product (used by the seo edge function)
//   sitemap.xml, robots.txt
//   index.html                               the homepage <head> block, between <!-- seo:start --> and <!-- seo:end -->
// Page titles and descriptions are written below in PAGES; product ones are built from each product's name and description.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://negrislebrum.com';
const BRAND = 'Negris LeBrum';
const HERO = 'https://res.cloudinary.com/vndeostj/image/upload/f_auto,q_auto,w_1200/Hero%20Right';
const SOCIAL = [
  'https://www.instagram.com/negris_lebrum/',
  'https://www.tiktok.com/@negrislebrum',
  'https://x.com/negrislebrum',
  'https://www.youtube.com/@negris_lebrum',
];

// view key → address. The same map lives in index.html (NL_PATHS) for in-site navigation.
const PAGES = {
  home:        { path: '/',              title: 'Negris LeBrum | Black-Owned American Luxury Fashion',
    description: 'Negris LeBrum is a Black-owned American luxury fashion house founded in Houston in 1999. Shop women’s luxury clothing, knitwear and our Black Friday sale.' },
  rtw:         { path: '/ready-to-wear', title: 'Women’s Luxury Clothing | Ready-to-Wear | Negris LeBrum',
    description: 'Shop Negris LeBrum ready-to-wear: tailored suits, vegan suede and emerald brocade by a Black-owned Houston designer, at Black Friday prices.' },
  tailoring:   { path: '/tailoring',     title: 'Women’s Luxury Suits & Tailoring | Negris LeBrum',
    description: 'Women’s luxury suits from Negris LeBrum: wool pinstripe, vegan suede and emerald brocade tailoring from a Black-owned American luxury house.' },
  knitwear:    { path: '/knitwear',      title: 'Luxury Knitwear & Sweaters | Negris LeBrum',
    description: 'Negris LeBrum knitwear: the Logo Sweater, varsity knits, vests and houndstooth. Signature pieces from a Black-owned American luxury fashion house.' },
  accessories: { path: '/accessories',   title: 'Luxury Accessories & Gifts | Negris LeBrum',
    description: 'Negris LeBrum accessories: signature sunglasses, the Williams Bag, the Unity Watch, logo socks and the Holiday Sport Package. Gift-ready American luxury.' },
  vault:       { path: '/vault',         title: 'The Vault: Black Friday Fashion Sale | Negris LeBrum',
    description: 'The Vault: archive classics from Negris LeBrum at Black Friday prices, plus an extra 25% off with code VAULT25. Once it’s gone, it’s gone.' },
  western:     { path: '/western',       title: 'NL Western Collection | Negris LeBrum',
    description: 'NL Western, a collection from Negris LeBrum, the Black-owned American luxury fashion house rooted in the American South. The first pieces arrive soon.' },
  live:        { path: '/live',          title: 'NL Live Holiday Trunk Show & Preorder | Negris LeBrum',
    description: 'NL Live: the Negris LeBrum holiday trunk show. Watch twenty-one looks and preorder women’s luxury clothing from a Black-owned Houston designer.' },
  about:       { path: '/about',         title: 'Our Story | Black-Owned Houston Designer | Negris LeBrum',
    description: 'Founded in 1999 at Texas Southern University in Houston, Negris LeBrum is a Black-owned American luxury fashion house rooted in a Louisiana love story.' },
  press:       { path: '/press',         title: 'Press | Negris LeBrum American Luxury Fashion',
    description: 'Negris LeBrum in the press: ELLE, Harper’s Bazaar, WWD, Vogue and Vanity Fair on the Black-owned American luxury fashion house from Houston.' },
  events:      { path: '/events',        title: 'Events & Trunk Shows | Negris LeBrum',
    description: 'Negris LeBrum events, trunk shows and appearances from the Black-owned Houston designer and American luxury fashion house.' },
  contact:     { path: '/contact',       title: 'Contact Client Services | Negris LeBrum',
    description: 'Contact Negris LeBrum client services for orders, sizing, styling, press, wholesale and stockist inquiries. Email staff@negrislebrum.com.' },
  returns:     { path: '/returns',       title: 'Returns & Exchanges | Negris LeBrum',
    description: 'Returns and exchanges at Negris LeBrum: how to return or exchange a piece bought from the American luxury fashion house online.' },
};
// Not for search (personal pages), titles only.
const PRIVATE = { wishlist: 'Wishlist | Negris LeBrum', bag: 'Your Bag | Negris LeBrum' };
const LABEL = { western: 'NL Western', live: 'NL Live', about: 'Our Story', press: 'Press', events: 'Events', contact: 'Contact', returns: 'Returns & Exchanges' };
const CAT = { rtw: ['Ready-to-Wear', 'rtw'], knit: ['Knitwear', 'knitwear'], vault: ['The Vault', 'vault'], acc: ['Accessories', 'accessories'] };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsonScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
const abs = (u) => (u.startsWith('http') ? u : SITE + u);
const usd = (n) => '$' + (n % 1 ? n.toFixed(2) : String(n));
function clip(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const end = s.slice(0, max).lastIndexOf('. ');
  if (end >= 90) return s.slice(0, end + 1); // end on a full sentence when one fits
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:—–-]+$/, '') + '…';
}
// Writes a file only when its content changed, so deploys don't churn.
function put(rel, data) {
  const f = path.join(ROOT, rel);
  if (fs.existsSync(f) && Buffer.compare(fs.readFileSync(f), Buffer.from(data)) === 0) return;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
}
function dataUriFile(uri, rel) {
  const m = /^data:image\/([a-z]+);base64,(.+)$/.exec(uri);
  if (!m) return null;
  put(rel, Buffer.from(m[2], 'base64'));
  return '/' + rel;
}

function run() {
  const htmlPath = path.join(ROOT, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  const lines = html.split('\n');

  // Product data: evaluate the lines from `const PIMG` to `const LISTS` (plain data plus the Cloudinary URL helpers).
  const a = lines.findIndex((l) => /^\s*const PIMG = /.test(l));
  const b = lines.findIndex((l) => /^\s*const LISTS = /.test(l));
  if (a < 0 || b < a) throw new Error('Could not find PIMG / LISTS in index.html');
  const { PIMG, P, LISTS } = vm.runInNewContext(lines.slice(a, b + 1).join('\n') + '\n;({PIMG, P, LISTS})', {});

  // Images: embedded photos become real files; Cloudinary ones are used as-is.
  const img = {};
  for (const [k, v] of Object.entries(PIMG)) img[k] = v.startsWith('data:') ? dataUriFile(v, `img/p/${k}.jpg`) : v;
  const logoM = /class="logo-link"[^>]*><img src="(data:image\/png;base64,[^"]+)"/.exec(html);
  const LOGO = logoM ? dataUriFile(logoM[1], 'img/logo.png') : null;
  const aboutM = /class="art about-art" style="background-image:url\('(data:image\/jpeg;base64,[^']+)'\)/.exec(html);
  const ABOUT_IMG = aboutM ? dataUriFile(aboutM[1], 'img/og/about.jpg') : null;
  const vaultM = /\.vault-banner\{[^}]*url\('(data:image\/jpeg;base64,[^']+)'\)/.exec(html);
  const VAULT_IMG = vaultM ? dataUriFile(vaultM[1], 'img/og/vault.jpg') : null;

  const listed = new Set(Object.values(LISTS).flatMap((l) => l.ids));
  const products = P.filter((p) => listed.has(p.id));
  const firstImg = (key) => { const p = products.find((x) => x.id === LISTS[key].ids[0]); return p && img[p.imgs[0]]; };
  const pageImg = { home: HERO, rtw: firstImg('rtw'), tailoring: firstImg('tailoring'), knitwear: firstImg('knitwear'),
    accessories: firstImg('accessories'), vault: VAULT_IMG || firstImg('vault'), about: ABOUT_IMG || HERO };

  const ORG = {
    '@type': 'Organization', '@id': SITE + '/#organization', name: BRAND, alternateName: 'Negris LeBrum America',
    url: SITE + '/', ...(LOGO ? { logo: abs(LOGO) } : {}), foundingDate: '1999', founder: { '@type': 'Person', name: 'Travis Hamilton' },
    email: 'staff@negrislebrum.com', sameAs: SOCIAL,
  };

  function head({ title, description, url, image, type, ld, robots }) {
    return [
      `<title>${esc(title)}</title>`,
      `<meta name="description" content="${esc(description)}" />`,
      robots ? `<meta name="robots" content="${robots}" />` : `<link rel="canonical" href="${url}" />`,
      `<meta property="og:site_name" content="${BRAND}" />`,
      `<meta property="og:type" content="${type || 'website'}" />`,
      `<meta property="og:title" content="${esc(title)}" />`,
      `<meta property="og:description" content="${esc(description)}" />`,
      `<meta property="og:url" content="${url}" />`,
      `<meta property="og:image" content="${esc(abs(image || HERO))}" />`,
      `<meta property="og:image:alt" content="${esc(title)}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:site" content="@negrislebrum" />`,
      `<meta name="twitter:title" content="${esc(title)}" />`,
      `<meta name="twitter:description" content="${esc(description)}" />`,
      `<meta name="twitter:image" content="${esc(abs(image || HERO))}" />`,
      ld ? `<script type="application/ld+json">${jsonScript({ '@context': 'https://schema.org', '@graph': ld })}</script>` : '',
    ].filter(Boolean).join('\n');
  }

  const out = { pages: {}, products: {} };
  const titles = new Map();
  const check = (key, t, d) => {
    if (t.length >= 60) throw new Error(`Title too long (${t.length}) for ${key}: ${t}`);
    if (d.length >= 155) throw new Error(`Description too long (${d.length}) for ${key}: ${d}`);
    if (titles.has(t)) throw new Error(`Duplicate title "${t}" (${key}, ${titles.get(t)})`);
    titles.set(t, key);
  };
  const crumbs = (items) => ({ '@type': 'BreadcrumbList', itemListElement: items.map(([name, u], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE + u })) });

  for (const [key, pg] of Object.entries(PAGES)) {
    check(key, pg.title, pg.description);
    const url = SITE + pg.path;
    const ld = key === 'home'
      ? [ORG, { '@type': 'WebSite', '@id': SITE + '/#website', name: BRAND, url: SITE + '/', publisher: { '@id': SITE + '/#organization' } }]
      : [crumbs([['Home', '/'], [LABEL[key] || (LISTS[key] && LISTS[key].title), pg.path]])];
    if (LISTS[key]) ld.push({ '@type': 'ItemList', name: LISTS[key].title, itemListElement: LISTS[key].ids.filter((id) => products.some((p) => p.id === id))
      .map((id, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/products/${id}` })) });
    out.pages[pg.path] = { view: key, title: pg.title, head: head({ ...pg, url, image: pageImg[key], ld }) };
  }

  for (const p of products) {
    const [section, view] = CAT[p.cat] || ['Shop', 'home'];
    const name = p.n;
    let title = `${name} | ${section} | ${BRAND} American Luxury`;
    if (title.length >= 60) title = `${name} | ${section} | ${BRAND}`;
    if (title.length >= 60) title = `${name} | ${BRAND}`;
    if (title.length >= 60) title = clip(name, 59 - (' | ' + BRAND).length) + ' | ' + BRAND;
    const sale = p.was && p.price ? (p.bf ? `Black Friday fashion sale: ${usd(p.price)}, was ${usd(p.was)}. ` : `Now ${usd(p.price)}, was ${usd(p.was)}. `) : '';
    const description = clip(`${sale}${p.d} ${name} by ${BRAND}, American luxury.`, 154);
    check(p.id, title, description);
    const u = `/products/${p.id}`, url = SITE + u;
    const images = [...new Set([...(p.imgs || []), ...Object.values(p.cimgs || {}).flat()])].map((k) => img[k]).filter(Boolean).map(abs);
    const offer = {
      '@type': 'Offer', url, priceCurrency: 'USD', price: p.price ? p.price.toFixed(2) : undefined,
      availability: 'https://schema.org/InStock', itemCondition: 'https://schema.org/NewCondition', seller: { '@id': SITE + '/#organization' },
      ...(p.was ? { priceSpecification: [
        { '@type': 'UnitPriceSpecification', price: p.price.toFixed(2), priceCurrency: 'USD' },
        { '@type': 'UnitPriceSpecification', priceType: 'https://schema.org/StrikethroughPrice', price: p.was.toFixed(2), priceCurrency: 'USD' },
      ] } : {}),
    };
    const product = {
      '@type': 'Product', '@id': url + '#product', name, url, image: images, description: p.d + (p.inc ? ' ' + p.inc : ''),
      sku: p.id, brand: { '@type': 'Brand', name: BRAND }, category: section, ...(p.colors ? { color: p.colors.join(', ') } : {}),
      ...(p.price ? { offers: offer } : {}),
    };
    const ld = [product, crumbs([['Home', '/'], [section, PAGES[view].path], [name, u]])];
    out.products[p.id] = { view, title, path: u, wasPrice: p.was || null, head: head({ title, description, url, image: images[0], type: 'product', ld }) };
  }
  out.private = PRIVATE;

  // Titles the browser shows while moving around the site (no reload), injected into every page.
  const client = { paths: Object.fromEntries(Object.entries(PAGES).map(([k, v]) => [k, v.path])),
    titles: { ...Object.fromEntries(Object.entries(PAGES).map(([k, v]) => [k, v.title])), ...PRIVATE },
    products: Object.fromEntries(Object.entries(out.products).map(([id, v]) => [id, v.title])) };
  const clientTag = `<script>window.NL_SEO=${jsonScript(client)};</script>`;
  for (const v of [...Object.values(out.pages), ...Object.values(out.products)]) v.head += '\n' + clientTag;

  put('netlify/edge-functions/lib/seo-data.js',
    '// Generated by scripts/seo.mjs from index.html on every deploy. Edit scripts/seo.mjs or index.html, not this file.\n' +
    'export default ' + JSON.stringify(out, null, 1) + ';\n');

  // Homepage head, written into index.html so the page is right even before the edge function runs.
  const block = `<!-- seo:start -->\n${out.pages['/'].head}\n<!-- seo:end -->`;
  const re = /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/;
  if (!re.test(html)) throw new Error('index.html is missing the <!-- seo:start --> / <!-- seo:end --> markers');
  html = html.replace(re, () => block);
  put('index.html', html);

  const today = new Date().toISOString().slice(0, 10);
  const urlTag = (loc, imgs, pri) => `  <url>\n    <loc>${esc(SITE + loc)}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${pri}</priority>\n` +
    imgs.map((i) => `    <image:image><image:loc>${esc(abs(i))}</image:loc></image:image>\n`).join('') + '  </url>';
  const sm = [
    ...Object.entries(PAGES).map(([k, pg]) => urlTag(pg.path, pageImg[k] ? [pageImg[k]] : [], k === 'home' ? '1.0' : '0.8')),
    ...products.map((p) => urlTag(`/products/${p.id}`, [...new Set(p.imgs.map((k) => img[k]).filter(Boolean))], '0.7')),
  ];
  // lastmod only changes when content does: keep the old file if only the date would differ.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${sm.join('\n')}\n</urlset>\n`;
  const smFile = path.join(ROOT, 'sitemap.xml');
  const strip = (s) => s.replace(/<lastmod>[^<]*<\/lastmod>/g, '');
  if (!fs.existsSync(smFile) || strip(fs.readFileSync(smFile, 'utf8')) !== strip(xml)) put('sitemap.xml', xml);
  put('robots.txt', `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /.netlify/\n\nSitemap: ${SITE}/sitemap.xml\n`);

  const hash = crypto.createHash('sha1').update(JSON.stringify(out)).digest('hex').slice(0, 8);
  console.log(`SEO: ${Object.keys(out.pages).length} pages, ${products.length} products (${hash})`);
  return out;
}

try { run(); }
catch (e) {
  // Never block a deploy: the files from the last successful run stay in place.
  console.warn('SEO generator skipped:', e.message);
  if (process.argv.includes('--strict')) process.exit(1);
}
