// netlify/functions/checkout.mjs
//
// On-site checkout for negrislebrum.com, paid through Square.
// The page calls:
//   GET  /api/checkout/config → { ready, applicationId, locationId, environment, catalog }
//   POST /api/checkout        → charges the card / wallet token and returns the order
//
// KEYS: Netlify → Site configuration → Environment variables
//   SQUARE_APPLICATION_ID   (from the Square Developer dashboard)
//   SQUARE_ACCESS_TOKEN     (never put this in the page or this file)
//   SQUARE_ENVIRONMENT      "production" or "sandbox"
//   SQUARE_LOCATION_ID      optional — if it's empty, the first active Square location is used
//
// PRICES live here, not in the page. The page's prices are for display only; whatever the
// browser sends, the customer is charged the amount below. When a price changes, change it
// here AND in the product list in index.html. Amounts are in cents (USD).
// To offer colors on a piece, add colors:['Emerald','Black'] — the product panel shows them.

const ONE = ['One Size'];
const SMLXL = ['S', 'M', 'L', 'XL'];

const CATALOG = {
  // Ready-to-Wear
  'pinstripe-petal-suit':  { name: 'The Pinstripe Petal Suit',               amount: 129500, sizes: SMLXL },
  'emerald-rose-suit':     { name: 'The Emerald Rose Suit',                  amount: 109500, sizes: SMLXL },
  'noir-suede-suit':       { name: 'The Noir Suit (Vegan Suede)',            amount: 119500, sizes: SMLXL },
  'cognac-suede-jumpsuit': { name: 'The Cognac Jumpsuit (Vegan Suede)',      amount:  79500, sizes: SMLXL },
  'emerald-rose-mini':     { name: 'The Emerald Rose Mini',                  amount:  69500, sizes: SMLXL },
  'patchwork-suede-skirt': { name: 'The Patchwork Skirt (Vegan Suede)',      amount:  45000, sizes: SMLXL },
  'emerald-rose-skirt':    { name: 'The Emerald Rose Skirt',                 amount:  42500, sizes: SMLXL },
  'negris-knit-set':       { name: 'The Houndstooth Mini Skirt',             amount:  22500, sizes: SMLXL },
  // Knitwear
  'n-varsity-knit':        { name: 'The N Varsity Knit — Unisex',            amount:  22500, sizes: ['M', 'L'], colors: ['Black', 'Red'] },
  'no-war-knit':           { name: 'The No War Knit',                        amount:  25000, sizes: ['M', 'L', 'XL'] },
  // The Vault
  'elephant-ear-suit':     { name: 'Velvet & Brocade Elephant Collar Suit',  amount:  79500, sizes: SMLXL },
  'biker-set':             { name: 'Emerald Moto Set',                       amount:  59500, sizes: SMLXL },
  'sarahs-dress':          { name: "Sarah's Dress",                          amount:  59500, sizes: SMLXL },
  'pearl-satin-set':       { name: 'The Emerald Velvet Trouser',             amount:  19500, sizes: SMLXL },
  'cowl-neck-dress':       { name: 'The Cowl-Neck Dress',                    amount:  52500, sizes: SMLXL },
  'curtain-dress':         { name: 'Noir Satin Drape Dress',                 amount:  49500, sizes: SMLXL },
  'audrey':                { name: 'The Audrey',                             amount:  47500, sizes: SMLXL },
  'funkadelic':            { name: 'The Funkadelic Dress',                   amount:  24500, sizes: ['M'] },
  'n-sweater-vest':        { name: 'The N Sweater Vest',                     amount:  16500, sizes: ['M', 'L'] },
  // Accessories
  'williams-bag':          { name: 'The Williams Bag',                       amount:  59500, sizes: ONE },
  'oval-emerald':          { name: 'The Oval Signature Sunglasses — Emerald', amount: 26500, sizes: ONE },
  'oval-black':            { name: 'The Oval Signature Sunglasses — Black',  amount:  26500, sizes: ONE },
  'petite-black':          { name: 'The Petite Signature Sunglasses',        amount:  24500, sizes: ONE },
  'pickleball-set':        { name: 'The Court Set — Paddle & Vegan Ostrich Case', amount: 29500, sizes: ONE },
  'unity-watch':           { name: 'The Unity Watch',                        amount:  16500, sizes: ONE },
  'sock-compression':      { name: 'The Negris Compression Sock',            amount:   9500, sizes: ONE },
  'sock-crew':             { name: 'The NL Crew Sock',                       amount:   5000, sizes: ONE },
};

const SQUARE_VERSION = '2025-01-23';

let cachedLocation = null;

function env() {
  const environment = (process.env.SQUARE_ENVIRONMENT || 'sandbox').trim().toLowerCase() === 'production' ? 'production' : 'sandbox';
  return {
    applicationId: (process.env.SQUARE_APPLICATION_ID || '').trim(),
    accessToken: (process.env.SQUARE_ACCESS_TOKEN || '').trim(),
    locationId: (process.env.SQUARE_LOCATION_ID || '').trim(),
    environment,
    base: environment === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com',
  };
}

async function square(cfg, path, init = {}) {
  const res = await fetch(cfg.base + path, {
    ...init,
    headers: {
      'Authorization': 'Bearer ' + cfg.accessToken,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json',
    },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// SQUARE_LOCATION_ID if set; otherwise the first active location that can take cards.
async function locationId(cfg) {
  if (cfg.locationId) return cfg.locationId;
  if (cachedLocation) return cachedLocation;
  const r = await square(cfg, '/v2/locations');
  if (!r.ok) {
    console.error('Square locations lookup failed', r.status, JSON.stringify(r.data.errors || []));
    return null;
  }
  const active = (r.data.locations || []).filter((l) => l.status === 'ACTIVE');
  const pick = active.find((l) => (l.capabilities || []).includes('CREDIT_CARD_PROCESSING')) || active[0];
  cachedLocation = pick ? pick.id : null;
  return cachedLocation;
}

function publicCatalog() {
  const out = {};
  for (const [id, item] of Object.entries(CATALOG)) {
    out[id] = { name: item.name, amount: item.amount, sizes: item.sizes, colors: item.colors || [] };
  }
  return out;
}

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

// Square error codes → words a shopper can act on.
function shopperMessage(errors) {
  const code = (errors && errors[0] && errors[0].code) || '';
  const map = {
    CARD_DECLINED: 'Your card was declined. Please try another card.',
    GENERIC_DECLINE: 'Your card was declined. Please try another card.',
    INSUFFICIENT_FUNDS: 'Your card was declined for insufficient funds.',
    CVV_FAILURE: 'The security code didn’t match. Please check it and try again.',
    INVALID_CVV: 'The security code didn’t match. Please check it and try again.',
    ADDRESS_VERIFICATION_FAILURE: 'The billing ZIP / postal code didn’t match your card.',
    INVALID_POSTAL_CODE: 'The billing ZIP / postal code didn’t match your card.',
    INVALID_EXPIRATION: 'Please check the card’s expiration date.',
    EXPIRATION_FAILURE: 'Please check the card’s expiration date.',
    CARD_EXPIRED: 'This card has expired. Please try another card.',
    VERIFY_CVV_FAILURE: 'The security code didn’t match. Please check it and try again.',
    VERIFY_AVS_FAILURE: 'The billing ZIP / postal code didn’t match your card.',
    CARD_DECLINED_VERIFICATION_REQUIRED: 'Your bank needs to verify this payment. Please try again.',
    TRANSACTION_LIMIT: 'This payment is over your card’s limit. Please try another card.',
  };
  return map[code] || 'We couldn’t complete the payment. Please try again or use another card.';
}

export default async (req) => {
  const cfg = env();
  const url = new URL(req.url);

  if (req.method === 'GET') {
    if (!url.pathname.endsWith('/config')) return Response.json({ error: 'Not found' }, { status: 404 });
    if (!cfg.applicationId || !cfg.accessToken) return Response.json({ ready: false });
    const loc = await locationId(cfg);
    if (!loc) return Response.json({ ready: false });
    return Response.json(
      { ready: true, applicationId: cfg.applicationId, locationId: loc, environment: cfg.environment, catalog: publicCatalog() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  if (!cfg.applicationId || !cfg.accessToken) {
    return Response.json({ ok: false, error: 'Checkout isn’t available right now. Please try again shortly.' }, { status: 503 });
  }

  let body;
  try { body = await req.json(); } catch { body = null; }
  if (!body || typeof body !== 'object') return Response.json({ ok: false, error: 'Something went wrong. Please try again.' }, { status: 400 });

  // The item, size and color must match the server list. Price comes only from CATALOG.
  const id = str(body.id, 60);
  const item = Object.prototype.hasOwnProperty.call(CATALOG, id) ? CATALOG[id] : null;
  if (!item) return Response.json({ ok: false, error: 'This piece isn’t available for checkout.' }, { status: 400 });
  const size = str(body.size, 20);
  if (!item.sizes.includes(size)) return Response.json({ ok: false, error: 'Please choose an available size.' }, { status: 400 });
  const colors = item.colors || [];
  const color = str(body.color, 40);
  if (colors.length && !colors.includes(color)) return Response.json({ ok: false, error: 'Please choose an available color.' }, { status: 400 });

  const sourceId = str(body.sourceId, 512);
  if (!sourceId) return Response.json({ ok: false, error: 'Please check your payment details.' }, { status: 400 });

  const b = body.buyer && typeof body.buyer === 'object' ? body.buyer : {};
  const buyer = {
    givenName: str(b.givenName, 60), familyName: str(b.familyName, 60), email: str(b.email, 120), phone: str(b.phone, 30),
    address1: str(b.address1, 120), address2: str(b.address2, 120), city: str(b.city, 60), state: str(b.state, 60),
    postal: str(b.postal, 20), country: /^[A-Z]{2}$/.test(str(b.country, 2).toUpperCase()) ? str(b.country, 2).toUpperCase() : 'US',
  };
  if (!buyer.givenName || !buyer.familyName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyer.email) || !buyer.address1 || !buyer.city || !buyer.postal) {
    return Response.json({ ok: false, error: 'Please complete your name, email and shipping address.' }, { status: 400 });
  }

  const loc = await locationId(cfg);
  if (!loc) return Response.json({ ok: false, error: 'Checkout isn’t available right now. Please try again shortly.' }, { status: 503 });

  // The browser keeps one key per order attempt, so a retried request can never charge twice.
  const key = str(body.idempotencyKey, 45);
  const idempotencyKey = /^[A-Za-z0-9-]{8,45}$/.test(key) ? key : crypto.randomUUID();

  const address = {
    address_line_1: buyer.address1,
    ...(buyer.address2 ? { address_line_2: buyer.address2 } : {}),
    locality: buyer.city,
    ...(buyer.state ? { administrative_district_level_1: buyer.state } : {}),
    postal_code: buyer.postal,
    country: buyer.country,
    first_name: buyer.givenName,
    last_name: buyer.familyName,
  };
  const note = [item.name, 'Size: ' + size, color ? 'Color: ' + color : '', buyer.phone ? 'Phone: ' + buyer.phone : '']
    .filter(Boolean).join(' · ').slice(0, 500);

  const payment = {
    idempotency_key: idempotencyKey,
    source_id: sourceId,
    amount_money: { amount: item.amount, currency: 'USD' },
    location_id: loc,
    autocomplete: true,
    reference_id: id.slice(0, 40),
    note,
    buyer_email_address: buyer.email,
    shipping_address: address,
  };
  const verificationToken = str(body.verificationToken, 1024);
  if (verificationToken) payment.verification_token = verificationToken;

  const r = await square(cfg, '/v2/payments', { method: 'POST', body: JSON.stringify(payment) });
  if (!r.ok || !r.data.payment) {
    console.error('Square payment failed', r.status, JSON.stringify((r.data.errors || []).map((e) => ({ code: e.code, category: e.category }))));
    return Response.json({ ok: false, error: shopperMessage(r.data.errors) }, { status: 402 });
  }

  const p = r.data.payment;
  return Response.json({
    ok: true,
    paymentId: p.id,
    status: p.status,
    receiptUrl: p.receipt_url || '',
    item: item.name,
    size,
    color,
    amount: item.amount,
  });
};

export const config = {
  path: ['/api/checkout', '/api/checkout/config'],
};
