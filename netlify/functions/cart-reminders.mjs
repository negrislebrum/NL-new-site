// netlify/functions/cart-reminders.mjs
//
// Abandoned-cart reminder. Runs every 30 minutes. Each cart saved at checkout (netlify/functions/checkout.mjs,
// Netlify Blobs store "abandoned-carts") that is over an hour old and still unpaid gets ONE reminder email,
// sent through the EmailJS REST API, and is then marked sent. Paid orders delete their cart, so they're never reminded.
//
// KEYS: Netlify → Site configuration → Environment variables
//   EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY (server-side only)
// In EmailJS → Account → Security, turn on "Allow EmailJS API for non-browser applications".
//
// Template variables sent to EmailJS:
//   to_email    the shopper's email (set the template's "To Email" to {{to_email}})
//   subject     "You left something beautiful behind." (set the template's Subject to {{subject}})
//   items_html  the items as HTML, with images and prices (use {{{items_html}}} — three braces)
//   items_text  the same items as plain text
//   cart_total  e.g. $835
//   restore_url link that restores the cart on the site (the "Complete your order" button)

import { getStore } from '@netlify/blobs';

const HOUR = 60 * 60 * 1000;
const KEEP_DAYS = 30; // carts are cleared this long after their last update
const SITE = (process.env.URL || 'https://negrislebrum.com').replace(/\/$/, '');

const money = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0 });
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

// The product photo if it exists on the site, otherwise the house logo.
async function imageUrl(name) {
  if (name) {
    const u = SITE + '/img/p/' + name + '.jpg';
    try { if ((await fetch(u, { method: 'HEAD' })).ok) return u; } catch {}
  }
  return SITE + '/img/logo.png';
}

async function itemsHtml(items) {
  const rows = await Promise.all(items.map(async (i) => {
    const detail = [i.size && i.size !== 'One Size' ? 'Size ' + i.size : i.size, i.color].filter(Boolean).join(' · ');
    return `<tr>
  <td style="padding:12px 16px 12px 0;width:96px;vertical-align:top"><img src="${esc(await imageUrl(i.image))}" alt="${esc(i.name)}" width="96" style="display:block;width:96px;height:auto;border:0"></td>
  <td style="padding:12px 0;vertical-align:top;font-family:Georgia,serif;color:#161412">
    <div style="font-size:17px;line-height:1.3">${esc(i.name)}</div>
    ${detail ? `<div style="font-size:13px;color:#6f6a62;padding-top:4px">${esc(detail)}</div>` : ''}
    <div style="font-size:15px;padding-top:6px">${esc(money(i.price))}</div>
  </td>
</tr>`;
  }));
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">${rows.join('')}</table>`;
}

async function sendReminder(cartId, cart) {
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: process.env.EMAILJS_SERVICE_ID,
      template_id: process.env.EMAILJS_TEMPLATE_ID,
      user_id: process.env.EMAILJS_PUBLIC_KEY,
      accessToken: process.env.EMAILJS_PRIVATE_KEY,
      template_params: {
        to_email: cart.email,
        subject: 'You left something beautiful behind.',
        items_html: await itemsHtml(cart.items),
        items_text: cart.items.map((i) => [i.name, i.size, i.color, money(i.price)].filter(Boolean).join(' — ')).join('\n'),
        cart_total: money(cart.total),
        restore_url: SITE + '/?cart=' + encodeURIComponent(cartId),
      },
    }),
  });
  if (!res.ok) throw new Error('EmailJS ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 200));
}

export default async () => {
  const env = ['EMAILJS_SERVICE_ID', 'EMAILJS_TEMPLATE_ID', 'EMAILJS_PUBLIC_KEY', 'EMAILJS_PRIVATE_KEY'];
  if (env.some((k) => !process.env[k])) { console.error('Cart reminders: EmailJS keys are not set'); return; }

  const store = getStore({ name: 'abandoned-carts', consistency: 'strong' });
  const { blobs } = await store.list();
  const now = Date.now();
  let sent = 0;
  for (const { key } of blobs) {
    let cart;
    try { cart = await store.get(key, { type: 'json' }); } catch { continue; }
    if (!cart) continue;
    const updated = Date.parse(cart.updatedAt) || 0;
    if (now - updated > KEEP_DAYS * 24 * HOUR) { await store.delete(key).catch(() => {}); continue; }
    // One reminder per cart, ever. A cart that's paid has already been deleted.
    if (cart.reminderSentAt || cart.reminderSending || now - updated < HOUR || !cart.email || !cart.items?.length) continue;
    // Mark the cart before sending so an overlapping run can't send a second reminder.
    await store.setJSON(key, { ...cart, reminderSending: new Date().toISOString() });
    try {
      await sendReminder(key, cart);
      const { reminderSending, ...rest } = cart;
      await store.setJSON(key, { ...rest, reminderSentAt: new Date().toISOString() });
      sent++;
    } catch (e) {
      // Nothing was sent, so the cart is put back and tried again on the next run.
      console.error('Cart reminder failed', key, e && e.message);
      await store.setJSON(key, cart).catch(() => {});
    }
  }
  console.log('Cart reminders sent:', sent);
};

export const config = {
  schedule: '*/30 * * * *',
};
