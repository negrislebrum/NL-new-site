// netlify/functions/checkout.mjs
//
// On-site checkout for negrislebrum.com, paid through Square.
// The page calls:
//   GET  /api/checkout/config → { ready, applicationId, locationId, environment, catalog }
//   POST /api/checkout/code   → checks a promo code for a piece and returns the new total
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
//
// PROMO CODES live in CODES below. Each use is recorded in Netlify Database (coupon_redemptions)
// so per-customer and total limits hold across every order.

import { getDatabase } from '@netlify/database';

const ONE = ['One Size'];
const SMLXL = ['S', 'M', 'L', 'XL'];
const XSXL = ['XS', 'S', 'M', 'L', 'XL'];
// NL Live preorders close Dec 15, 2026, 11:59 PM Central.
const PREORDER_CLOSE = Date.parse('2026-12-15T23:59:59-06:00');

const CATALOG = {
  // Black Friday prices — Ready-to-Wear 35% off (Emerald Rose Suit and Mini 50% off), The Vault 50% off,
  // rounded down to end in 5. Regular prices are the "was" values in index.html, shown struck through there.
  // Ready-to-Wear
  'pinstripe-petal-suit':  { name: 'The Pinstripe Petal Suit',               amount: 83500, sizes: SMLXL },
  'emerald-rose-suit':     { name: 'The Emerald Rose Suit',                  amount: 49500, sizes: SMLXL },
  'noir-suede-suit':       { name: 'The Noir Suit (Vegan Suede)',            amount: 77500, sizes: SMLXL },
  'cognac-suede-jumpsuit': { name: 'The Cognac Jumpsuit (Vegan Suede)',      amount:  51500, sizes: SMLXL },
  'emerald-rose-mini':     { name: 'The Emerald Rose Mini',                  amount:  34500, sizes: SMLXL },
  'patchwork-suede-skirt': { name: 'The Patchwork Skirt (Vegan Suede)',      amount:  28500, sizes: SMLXL },
  'emerald-rose-skirt':    { name: 'The Emerald Rose Skirt',                 amount:  27500, sizes: SMLXL },
  'negris-knit-set':       { name: 'The Houndstooth Mini Skirt',             amount:   8500, sizes: SMLXL },
  // Knitwear
  'n-varsity-knit':        { name: 'The N Varsity Knit — Unisex',            amount:  22500, sizes: ['M', 'L'], colors: ['Black', 'Red'] },
  'no-war-knit':           { name: 'The No War Knit',                        amount:  25000, sizes: ['M', 'L', 'XL'] },
  'negris-originals':      { name: 'NEGRIS Originals',                       amount:  18500, sizes: SMLXL },
  'classic-vest':          { name: 'The Classic Vest',                       amount:   7800, sizes: ['M', 'L'] },
  'logo-sweater':          { name: 'The Logo Sweater',                       amount:  18500, sizes: ['M', 'L', 'XL'] },
  // The Vault
  'elephant-ear-suit':     { name: 'Velvet & Brocade Elephant Collar Suit',  amount:  39500, sizes: SMLXL },
  'biker-set':             { name: 'Emerald Moto Set',                       amount:  29500, sizes: SMLXL },
  'sarahs-dress':          { name: "Sarah's Dress",                          amount:  29500, sizes: SMLXL },
  'pearl-satin-set':       { name: 'The Emerald Velvet Trouser',             amount:   9500, sizes: SMLXL },
  'cowl-neck-dress':       { name: 'The Cowl-Neck Dress',                    amount:  25500, sizes: SMLXL },
  'curtain-dress':         { name: 'Noir Satin Drape Dress',                 amount:  24500, sizes: SMLXL },
  'audrey':                { name: 'The Audrey',                             amount:  23500, sizes: SMLXL },
  'funkadelic':            { name: 'The Funkadelic Dress',                   amount:  11500, sizes: ['M'] },
  'n-sweater-vest':        { name: 'The N Sweater Vest',                     amount:   7500, sizes: ['M', 'L'] },
  'apron-dress':           { name: 'Apron Dress',                            amount:  18500, sizes: XSXL },
  'fingerprint-dress':     { name: 'Fingerprint Dress',                      amount:  19500, sizes: XSXL },
  'polka-dot-romper-set':  { name: 'Polka Dot Romper Set (with cotton logo socks)', amount: 15500, sizes: XSXL },
  // stock: per-size counts live in Netlify Database (inventory). usOnly: ships to US addresses only.
  '80s-jumpsuit':          { name: "The '80s Jumpsuit",                      amount:  18750, sizes: ['S', 'M', 'L'], stock: true, usOnly: true },
  // Accessories
  'sport-package':         { name: 'The Holiday Sport Package',              amount:  65000, sizes: ONE },
  'williams-bag':          { name: 'The Williams Bag',                       amount:  59500, sizes: ONE },
  'oval-emerald':          { name: 'The Oval Signature Sunglasses — Emerald', amount: 26500, sizes: ONE },
  'oval-black':            { name: 'The Oval Signature Sunglasses — Black',  amount:  26500, sizes: ONE },
  'petite-black':          { name: 'The Petite Signature Sunglasses',        amount:  24500, sizes: ONE },
  'pickleball-set':        { name: 'The Court Set — Paddle & Vegan Ostrich Case', amount: 29500, sizes: ONE },
  'unity-watch':           { name: 'The Unity Watch',                        amount:  16500, sizes: ONE },
  'sock-compression':      { name: 'The Negris Compression Sock',            amount:   9500, sizes: ONE },
  'sock-crew':             { name: 'The NL Crew Sock',                       amount:   5000, sizes: ONE },
  // NL Live — The Exclusive Preorder (/live). Made to order, no cap. Delivery January–February 2027.
  // Same preorder prices as trunkshowusa.com; checkout for these stops when preorders close.
  'live-01':               { name: 'NL Live Preorder — Look 01',                        amount:  57500, sizes: SMLXL, closes: PREORDER_CLOSE },
  'live-02':               { name: 'NL Live Preorder — Look 02',                        amount:  57500, sizes: SMLXL, closes: PREORDER_CLOSE },
  'live-03':               { name: 'NL Live Preorder — Look 03',                        amount:  34500, sizes: SMLXL, closes: PREORDER_CLOSE },
  'live-04':               { name: 'NL Live Preorder — Look 04',                        amount:  39500, sizes: SMLXL, closes: PREORDER_CLOSE },
  'live-05':               { name: 'NL Live Preorder — Look 05',                        amount:  35500, sizes: SMLXL, closes: PREORDER_CLOSE },
  'live-06':               { name: 'NL Live Preorder — Look 06',                        amount:  37500, sizes: SMLXL, closes: PREORDER_CLOSE },
  'live-07':               { name: 'NL Live Preorder — Look 07',                        amount:  72500, sizes: SMLXL, closes: PREORDER_CLOSE },
  'live-08':               { name: 'NL Live Preorder — Look 08',                        amount:  82500, sizes: SMLXL, closes: PREORDER_CLOSE },
  'live-09':               { name: 'NL Live Preorder — Look 09',                        amount:  29500, sizes: SMLXL, closes: PREORDER_CLOSE },
  'live-10':               { name: 'NL Live Preorder — Look 10',                        amount:  34500, sizes: SMLXL, closes: PREORDER_CLOSE },
  'live-11':               { name: 'NL Live Preorder — Look 11',                        amount:  44500, sizes: SMLXL, closes: PREORDER_CLOSE },
  'live-12':               { name: 'NL Live Preorder — The Holiday Set (Look 12)',      amount:  59500, sizes: SMLXL, closes: PREORDER_CLOSE },
  'live-13':               { name: 'NL Live Preorder — Look 13',                        amount:  27500, sizes: SMLXL, closes: PREORDER_CLOSE },
  'live-14':               { name: 'NL Live Preorder — Look 14',                        amount:  54500, sizes: SMLXL, closes: PREORDER_CLOSE },
  'live-15':               { name: 'NL Live Preorder — Look 15',                        amount:  29500, sizes: SMLXL, closes: PREORDER_CLOSE },
  'live-16':               { name: 'NL Live Preorder — Look 16',                        amount:  81500, sizes: SMLXL, closes: PREORDER_CLOSE },
  'live-17':               { name: 'NL Live Preorder — Look 17',                        amount:  44500, sizes: SMLXL, closes: PREORDER_CLOSE },
  'live-18':               { name: 'NL Live Preorder — Look 18',                        amount:  52500, sizes: SMLXL, closes: PREORDER_CLOSE },
  'live-19':               { name: 'NL Live Preorder — Look 19',                        amount:  91000, sizes: SMLXL, closes: PREORDER_CLOSE },
  'live-20':               { name: 'NL Live Preorder — Look 20',                        amount:  37500, sizes: SMLXL, closes: PREORDER_CLOSE },
  'live-21':               { name: 'NL Live Preorder — Look 21',                        amount:  35500, sizes: SMLXL, closes: PREORDER_CLOSE },
};

// off: cents taken off the item. expires: the code stops working at this moment (end of Nov 23, US Central).
// limit: total uses; once reached, the listed pieces are sold out. perCustomer: uses per email address.
const CODES = {
  SPORT: {
    items: ['sport-package'], off: 37500, freeShipping: true, limit: 6, perCustomer: 1,
    expires: Date.parse('2026-11-24T06:00:00Z'), // 11:59 PM CST Nov 23 is the last valid minute
    soldOut: 'The Holiday Sport Package is sold out.',
  },
  // The customer enters VAULT25 at checkout (never applied automatically): 25% off the Vault price.
  // One use per email address, as with every code (coupon_redemptions).
  VAULT25: {
    items: ['80s-jumpsuit'], off: 4688, // 25% of $187.50
  },
};
// An unpaid hold on a code use is released after this long (a checkout that never finished).
const HOLD_MINUTES = 15;

let database = null;
function db() { return database || (database = getDatabase()); }

// Uses that count against a code's limit: paid orders, plus holds for checkouts in progress.
async function codeUses(code) {
  const rows = await db().sql`
    SELECT count(*)::int AS n FROM coupon_redemptions
    WHERE code = ${code} AND (status = 'paid' OR created_at > now() - make_interval(mins => ${HOLD_MINUTES}))`;
  return rows[0].n;
}

// Pieces that are sold out because their code has reached its limit, or every size has run out.
async function soldOut() {
  const out = {};
  for (const [code, c] of Object.entries(CODES)) {
    if (!c.limit) continue;
    if ((await codeUses(code)) >= c.limit) c.items.forEach((id) => { out[id] = c.soldOut; });
  }
  const sizes = await soldSizes();
  for (const [id, gone] of Object.entries(sizes)) {
    if (CATALOG[id].sizes.every((z) => gone.includes(z))) out[id] = CATALOG[id].name + ' is sold out.';
  }
  return out;
}

// Sizes that have run out, for pieces with tracked stock: { id: ['S', ...] }. Counts never leave the server.
// A size with no inventory row counts as sold out.
async function soldSizes() {
  const ids = Object.keys(CATALOG).filter((id) => CATALOG[id].stock);
  if (!ids.length) return {};
  const { rows } = await db().pool.query('SELECT item_id, size FROM inventory WHERE item_id = ANY($1) AND qty > 0', [ids]);
  const out = {};
  for (const id of ids) {
    const gone = CATALOG[id].sizes.filter((z) => !rows.some((r) => r.item_id === id && r.size === z));
    if (gone.length) out[id] = gone;
  }
  return out;
}

// Takes one unit of a size before the card is charged. False when the size has run out.
async function takeStock(id, size) {
  const rows = await db().sql`
    UPDATE inventory SET qty = qty - 1 WHERE item_id = ${id} AND size = ${size} AND qty > 0 RETURNING item_id`;
  return rows.length > 0;
}
async function returnStock(id, size) {
  await db().sql`UPDATE inventory SET qty = qty + 1 WHERE item_id = ${id} AND size = ${size}`;
}

function checkCode(id, raw) {
  const code = str(raw, 30).toUpperCase();
  const c = Object.prototype.hasOwnProperty.call(CODES, code) ? CODES[code] : null;
  if (!c) return { error: 'That code isn’t valid.' };
  if (Date.now() >= c.expires) return { error: 'Code ' + code + ' has expired.' };
  if (!c.items.includes(id)) return { error: 'Code ' + code + ' doesn’t apply to this piece.' };
  return { code, c };
}

// Holds one use of the code for this email before the card is charged. Returns the hold's id or an error.
async function holdCode(code, c, email, key, itemId) {
  const client = await db().pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['coupon:' + code]);
    const mine = await client.query(
      `SELECT id, idempotency_key, status, created_at > now() - make_interval(mins => $3) AS fresh
       FROM coupon_redemptions WHERE code = $1 AND email = $2`, [code, email, HOLD_MINUTES]);
    const row = mine.rows[0];
    if (row && row.idempotency_key === key) { await client.query('COMMIT'); return { id: row.id }; } // a retry of the same order
    if (row && (row.status === 'paid' || row.fresh)) {
      await client.query('ROLLBACK');
      return { error: 'Code ' + code + ' has already been used with this email.' };
    }
    if (row) await client.query('DELETE FROM coupon_redemptions WHERE id = $1', [row.id]);
    const used = await client.query(
      `SELECT count(*)::int AS n FROM coupon_redemptions
       WHERE code = $1 AND (status = 'paid' OR created_at > now() - make_interval(mins => $2))`, [code, HOLD_MINUTES]);
    if (used.rows[0].n >= c.limit) { await client.query('ROLLBACK'); return { error: c.soldOut, soldOut: true }; }
    const ins = await client.query(
      `INSERT INTO coupon_redemptions (code, email, item_id, idempotency_key) VALUES ($1, $2, $3, $4) RETURNING id`,
      [code, email, itemId, key]);
    await client.query('COMMIT');
    return { id: ins.rows[0].id };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

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
    out[id] = { name: item.name, amount: item.amount, sizes: item.sizes, colors: item.colors || [], usOnly: !!item.usOnly };
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
    let sold = {}, sizes = {};
    try { sold = await soldOut(); sizes = await soldSizes(); } catch (e) { console.error('Sold-out check failed', e && e.message); }
    return Response.json(
      { ready: true, applicationId: cfg.applicationId, locationId: loc, environment: cfg.environment, catalog: publicCatalog(), soldOut: sold, soldSizes: sizes },
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
  if (item.closes && Date.now() > item.closes) {
    return Response.json({ ok: false, error: 'Preorders for this look closed December 15, 2026.' }, { status: 410 });
  }

  // Pieces whose code has reached its limit can't be bought; a code must be valid for the piece.
  let sold = {};
  if (item.stock || Object.values(CODES).some((c) => c.limit && c.items.includes(id))) try { sold = await soldOut(); } catch (e) {
    console.error('Sold-out check failed', e && e.message);
    return Response.json({ ok: false, error: 'Checkout isn’t available right now. Please try again shortly.' }, { status: 503 });
  }
  if (sold[id]) return Response.json({ ok: false, soldOut: true, error: sold[id] }, { status: 409 });
  const promo = str(body.code, 30) ? checkCode(id, body.code) : null;
  if (promo && promo.error) return Response.json({ ok: false, error: promo.error }, { status: 400 });

  if (url.pathname.endsWith('/code')) {
    return Response.json({
      ok: true, code: promo ? promo.code : '', discount: promo ? promo.c.off : 0,
      amount: item.amount - (promo ? promo.c.off : 0), freeShipping: !!(promo && promo.c.freeShipping),
    });
  }
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
  if (item.usOnly && buyer.country !== 'US') {
    return Response.json({ ok: false, error: 'This piece ships within the United States only.' }, { status: 400 });
  }
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
  // Hold one use of the code for this customer before charging; it's released if the payment fails.
  let hold = null;
  if (promo) {
    try { hold = await holdCode(promo.code, promo.c, buyer.email.toLowerCase(), idempotencyKey, id); } catch (e) {
      console.error('Code hold failed', e && e.message);
      return Response.json({ ok: false, error: 'Checkout isn’t available right now. Please try again shortly.' }, { status: 503 });
    }
    if (hold.error) return Response.json({ ok: false, soldOut: !!hold.soldOut, error: hold.error }, { status: 409 });
  }
  const releaseHold = () => hold
    ? db().sql`DELETE FROM coupon_redemptions WHERE id = ${hold.id} AND status = 'pending'`.catch(() => {})
    : Promise.resolve();
  // Pieces with tracked stock: take one unit of the size now; it's put back if the payment fails.
  let took = false;
  if (item.stock) {
    try { took = await takeStock(id, size); } catch (e) {
      console.error('Stock check failed', e && e.message);
      await releaseHold();
      return Response.json({ ok: false, error: 'Checkout isn’t available right now. Please try again shortly.' }, { status: 503 });
    }
    if (!took) {
      await releaseHold();
      let all = false;
      try { all = !!(await soldOut())[id]; } catch {}
      return Response.json({ ok: false, soldOut: all, soldSize: size, error: 'Size ' + size + ' is sold out.' }, { status: 409 });
    }
  }
  const discount = promo ? promo.c.off : 0;
  const amount = item.amount - discount;

  const note = [item.name, 'Size: ' + size, color ? 'Color: ' + color : '',
    promo ? 'Code ' + promo.code + ' (−' + '$' + (discount / 100) + ')' : '', promo && promo.c.freeShipping ? 'Free shipping' : '',
    buyer.phone ? 'Phone: ' + buyer.phone : '']
    .filter(Boolean).join(' · ').slice(0, 500);

  const payment = {
    idempotency_key: idempotencyKey,
    source_id: sourceId,
    amount_money: { amount, currency: 'USD' },
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
    await releaseHold();
    if (took) await returnStock(id, size).catch((e) => console.error('Stock not returned', id, size, e && e.message));
    return Response.json({ ok: false, error: shopperMessage(r.data.errors) }, { status: 402 });
  }

  const p = r.data.payment;
  if (hold) {
    await db().sql`UPDATE coupon_redemptions SET status = 'paid', payment_id = ${p.id} WHERE id = ${hold.id}`
      .catch((e) => console.error('Code use not recorded', p.id, e && e.message));
  }
  return Response.json({
    ok: true,
    paymentId: p.id,
    status: p.status,
    receiptUrl: p.receipt_url || '',
    item: item.name,
    size,
    color,
    amount,
    code: promo ? promo.code : '',
    discount,
    freeShipping: !!(promo && promo.c.freeShipping),
  });
};

export const config = {
  path: ['/api/checkout', '/api/checkout/config', '/api/checkout/code'],
};
