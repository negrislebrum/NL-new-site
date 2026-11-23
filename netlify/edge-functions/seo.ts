// Gives every page and product of the single-page site its own <title>, description, share image (Open Graph)
// and structured data, so search engines and link previews see the right page — not just the homepage.
// The page itself is unchanged: only the block between <!-- seo:start --> and <!-- seo:end --> is swapped.
// Data comes from lib/seo-data.js, generated from index.html by scripts/seo.mjs on every deploy.
import SEO from './lib/seo-data.js';

const START = new TextEncoder().encode('<!-- seo:start -->');
const END = new TextEncoder().encode('<!-- seo:end -->');

function indexOf(buf: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= buf.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (buf[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

// Live sold-out state from the checkout server, so Product schema availability matches the page.
async function soldOut(origin: string): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const r = await fetch(origin + '/api/checkout/config', { signal: AbortSignal.timeout(1500) });
    const c = await r.json();
    Object.keys(c.soldOut || {}).forEach((id) => out.add(id));
    const sz = c.soldOutSizes || {};
    Object.keys(sz).forEach((id) => {
      const it = c.catalog && c.catalog[id];
      if (it && it.sizes && it.sizes.every((z: string) => sz[id].includes(z))) out.add(id);
    });
  } catch (_) { /* availability falls back to InStock */ }
  return out;
}

export default async (req: Request, context: any) => {
  const url = new URL(req.url);
  const p = url.pathname.replace(/(.)\/+$/, '$1');
  const pm = /^\/products\/([\w-]+)$/.exec(p);
  const data = SEO as any;
  let entry = pm ? data.products[pm[1]] : data.pages[p === '/index.html' ? '/' : p];
  if (!entry) {
    if (!pm) return; // not a page we know: leave it alone
    // Unknown product: the site still loads, but search engines are told not to index the address.
    entry = { missing: true, head: data.pages['/'].head.replace(/<link rel="canonical"[^>]*>/, '<meta name="robots" content="noindex" />') };
  }

  const res: Response = await context.next();
  if (!res.ok || !res.body || !(res.headers.get('content-type') || '').includes('text/html')) return res;

  let head: string = entry.head;
  if (pm && !entry.missing) {
    const out = await soldOut(url.origin);
    if (out.has(pm[1])) head = head.replace('https://schema.org/InStock', 'https://schema.org/OutOfStock');
  }
  const block = new TextEncoder().encode('<!-- seo:start -->\n' + head + '\n');

  // Stream the page through, replacing only the head block near the top (the page is several MB).
  let pending: Uint8Array | null = new Uint8Array(0);
  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      if (!pending) return ctl.enqueue(chunk);
      const buf = new Uint8Array(pending.length + chunk.length);
      buf.set(pending); buf.set(chunk, pending.length);
      const s = indexOf(buf, START);
      const e = s < 0 ? -1 : indexOf(buf, END, s);
      if (e >= 0) {
        ctl.enqueue(buf.subarray(0, s)); ctl.enqueue(block); ctl.enqueue(buf.subarray(e));
        pending = null;
      } else if (buf.length > 262144) { // markers not found near the top: pass the page through untouched
        ctl.enqueue(buf); pending = null;
      } else pending = buf;
    },
    flush(ctl) { if (pending && pending.length) ctl.enqueue(pending); },
  });

  const headers = new Headers(res.headers);
  headers.delete('content-length');
  headers.delete('etag');
  return new Response(res.body.pipeThrough(stream), { status: res.status, headers });
};

export const config = {
  path: ['/', '/index.html', '/ready-to-wear', '/tailoring', '/knitwear', '/accessories', '/vault', '/western', '/live',
    '/about', '/press', '/events', '/contact', '/returns', '/products/*'],
  method: 'GET',
  onError: 'bypass',
};
