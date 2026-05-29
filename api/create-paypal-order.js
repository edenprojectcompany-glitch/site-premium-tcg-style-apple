// api/create-paypal-order.js — PayPal Order avec validation prix serveur
// Env requis : PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV, SITE_URL

const CORS_ORIGIN = process.env.SITE_URL || 'https://edenprojecttcg.com';
const PAYPAL_ENV = process.env.PAYPAL_ENV || 'live';
const PAYPAL_BASE = PAYPAL_ENV === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';

const PROMO_CODES = { EDEN5: 5, EDEN10: 10, WELCOME5: 5, TCG15: 15, EDEN20: 20 };

const BASE_PRICES = {
  1:65,2:65,3:65,4:65,5:65,6:65,7:null,8:50,9:50,
  10:85,11:110,12:89,13:80,14:80,15:100,16:80,17:99,18:130,19:115,20:110,21:299,22:120,
};

async function getPayPalToken() {
  const creds = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('PayPal auth failed');
  return data.access_token;
}

async function getServerPrice(id) {
  try {
    const { kv } = require('@vercel/kv');
    const prices = await kv.get('admin:prices');
    if (prices && prices[id] != null) return prices[id];
  } catch {}
  return BASE_PRICES[id] ?? null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { items, shippingCost, promoCode } = req.body;
    if (!items?.length) return res.status(400).json({ error: 'Panier vide' });

    const discountPct = promoCode ? (PROMO_CODES[promoCode.toUpperCase()] || 0) : 0;

    // Validate with server-side prices
    const validatedItems = [];
    for (const item of items) {
      const serverPrice = await getServerPrice(item.id);
      if (serverPrice === null) continue;
      const unitPrice = serverPrice * (1 - discountPct / 100);
      validatedItems.push({ ...item, unitPrice });
    }
    if (!validatedItems.length) return res.status(400).json({ error: 'Aucun article valide' });

    const itemTotal = validatedItems.reduce((s, i) => s + i.unitPrice * i.qty, 0);
    const shipping = Math.max(0, parseFloat(shippingCost) || 4.90);
    const total = itemTotal + shipping;

    const token = await getPayPalToken();

    const order = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `eden-${Date.now()}`,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: `EDN-${Date.now()}`,
          description: 'Eden Project TCG — Commande displays Pokémon',
          amount: {
            currency_code: 'EUR',
            value: total.toFixed(2),
            breakdown: {
              item_total: { currency_code: 'EUR', value: itemTotal.toFixed(2) },
              shipping: { currency_code: 'EUR', value: shipping.toFixed(2) },
            },
          },
          items: validatedItems.map(item => ({
            name: item.name.slice(0, 127),
            unit_amount: { currency_code: 'EUR', value: item.unitPrice.toFixed(2) },
            quantity: String(item.qty),
            category: 'PHYSICAL_GOODS',
          })),
        }],
        application_context: {
          brand_name: 'Eden Project TCG',
          locale: 'fr-FR',
          landing_page: 'NO_PREFERENCE',
          shipping_preference: 'GET_FROM_FILE',
          user_action: 'PAY_NOW',
          return_url: `${CORS_ORIGIN}?payment=success`,
          cancel_url: `${CORS_ORIGIN}?payment=cancel`,
        },
      }),
    });

    const orderData = await order.json();
    if (orderData.error) throw new Error(orderData.error_description || 'PayPal order failed');

    const approveUrl = orderData.links?.find(l => l.rel === 'approve')?.href;
    return res.status(200).json({ orderId: orderData.id, approveUrl });
  } catch (err) {
    console.error('PayPal error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
