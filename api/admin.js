// api/admin.js — Panneau admin sécurisé (prix, stocks, roue)
// Env requis : KV_REST_API_URL, KV_REST_API_TOKEN, ADMIN_CODE

const CORS_ORIGIN = process.env.SITE_URL || 'https://edenprojecttcg.com';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Code');
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const code = req.headers['x-admin-code'];
  if (!code || code !== process.env.ADMIN_CODE) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  try {
    const { kv } = require('@vercel/kv');

    if (req.method === 'GET') {
      const [prices, stocks, wheel] = await Promise.all([
        kv.get('admin:prices'),
        kv.get('admin:stocks'),
        kv.get('admin:wheel'),
      ]);
      return res.status(200).json({
        prices: prices || {},
        stocks: stocks || {},
        wheel: wheel || null,
      });
    }

    if (req.method === 'POST') {
      const { action, data } = req.body || {};

      if (action === 'set_prices') {
        // data = { [id]: price, ... }
        await kv.set('admin:prices', data);
        return res.status(200).json({ ok: true });
      }

      if (action === 'set_stocks') {
        // data = { [id]: stock, ... }
        await kv.set('admin:stocks', data);
        return res.status(200).json({ ok: true });
      }

      if (action === 'set_wheel') {
        // data = array of { label, prob, code, color }
        const total = data.reduce((s, p) => s + p.prob, 0);
        if (Math.abs(total - 100) > 0.1) {
          return res.status(400).json({ error: `Probabilités totales = ${total.toFixed(1)}% (doit être 100%)` });
        }
        await kv.set('admin:wheel', data);
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'Action inconnue' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Admin error:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
