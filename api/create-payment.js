// api/create-payment.js — Stripe Checkout Session avec validation prix serveur
// Env requis : STRIPE_SECRET_KEY, SITE_URL

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const CORS_ORIGIN = process.env.SITE_URL || 'https://edenprojecttcg.com';

// Source de vérité prix — miroir du catalogue frontend
// Les overrides admin (KV) viennent s'y superposer
const BASE_PRICES = {
  1:{tiers:[{q:10,p:65},{q:20,p:60},{q:60,p:55}]},
  2:{tiers:[{q:10,p:65},{q:20,p:60},{q:60,p:58}]},
  3:{tiers:[{q:10,p:65},{q:20,p:55},{q:60,p:55}]},
  4:{tiers:[{q:10,p:65},{q:20,p:60},{q:60,p:55}]},
  5:{tiers:[{q:10,p:65},{q:20,p:60},{q:60,p:55}]},
  6:{tiers:[{q:10,p:65},{q:20,p:60},{q:60,p:60}]},
  7:{tiers:[{q:10,p:null},{q:20,p:null},{q:60,p:null}]},
  8:{tiers:[{q:10,p:50},{q:20,p:45},{q:60,p:43}]},
  9:{tiers:[{q:10,p:50},{q:20,p:45},{q:60,p:43}]},
  10:{tiers:[{q:10,p:85},{q:20,p:80},{q:60,p:75}]},
  11:{tiers:[{q:6,p:110},{q:12,p:105},{q:36,p:99}]},
  12:{tiers:[{q:6,p:89},{q:12,p:85},{q:36,p:79}]},
  13:{tiers:[{q:6,p:80},{q:12,p:75},{q:36,p:73}]},
  14:{tiers:[{q:6,p:80},{q:12,p:75},{q:36,p:73}]},
  15:{tiers:[{q:10,p:100},{q:20,p:95},{q:60,p:90}]},
  16:{tiers:[{q:6,p:80},{q:12,p:75},{q:36,p:73}]},
  17:{tiers:[{q:6,p:99},{q:12,p:95},{q:36,p:89}]},
  18:{tiers:[{q:6,p:130},{q:12,p:125},{q:36,p:120}]},
  19:{tiers:[{q:6,p:115},{q:12,p:110},{q:36,p:99}]},
  20:{tiers:[{q:6,p:110},{q:12,p:105},{q:36,p:99}]},
  21:{tiers:[{q:1,p:299},{q:12,p:295},{q:36,p:280}]},
  22:{tiers:[{q:1,p:120},{q:12,p:110},{q:36,p:105}]},
};

const PROMO_CODES = { EDEN5: 5, EDEN10: 10, WELCOME5: 5, TCG15: 15, EDEN20: 20 };

async function getServerPrice(id, qty) {
  let base = BASE_PRICES[id];
  if (!base) return null;

  // Check KV overrides
  try {
    const { kv } = require('@vercel/kv');
    const prices = await kv.get('admin:prices');
    if (prices && prices[id] != null) return prices[id];
  } catch {}

  if (base.tiers) {
    let price = base.tiers[0].p;
    for (const t of base.tiers) if (qty >= t.q && t.p !== null) price = t.p;
    return price;
  }
  return base.price ?? null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { items, shippingCost, promoCode, customerEmail, successUrl, cancelUrl } = req.body;
    if (!items?.length) return res.status(400).json({ error: 'Panier vide' });

    const discountPct = promoCode ? (PROMO_CODES[promoCode.toUpperCase()] || 0) : 0;

    // Validate & build line items with SERVER-SIDE prices
    const lineItems = [];
    for (const item of items) {
      if (!item.id || !item.qty || item.qty < 1) continue;
      const serverPrice = await getServerPrice(item.id, item.qty);
      if (serverPrice === null) continue; // prix sur demande → skip
      const finalPrice = Math.round(serverPrice * (1 - discountPct / 100) * 100);
      lineItems.push({
        price_data: {
          currency: 'eur',
          product_data: { name: item.name, description: item.sub || '' },
          unit_amount: finalPrice,
        },
        quantity: item.qty,
      });
    }
    if (!lineItems.length) return res.status(400).json({ error: 'Aucun article valide' });

    // Livraison
    const ship = Math.max(0, parseFloat(shippingCost) || 4.90);
    lineItems.push({
      price_data: {
        currency: 'eur',
        product_data: { name: 'Livraison' },
        unit_amount: Math.round(ship * 100),
      },
      quantity: 1,
    });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      customer_email: customerEmail || undefined,
      success_url: successUrl || `${CORS_ORIGIN}?payment=success`,
      cancel_url: cancelUrl || `${CORS_ORIGIN}?payment=cancel`,
      metadata: { promoCode: promoCode || '', source: 'eden-project-tcg' },
      shipping_address_collection: { allowed_countries: ['FR','BE','CH','LU','MC'] },
      locale: 'fr',
    });

    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
