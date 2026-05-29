// api/ebay-prices.js — Prix eBay live avec cache Vercel KV (1h)
// Env requis : EBAY_APP_ID, EBAY_CERT_ID, KV_REST_API_URL, KV_REST_API_TOKEN, SITE_URL

const CORS_ORIGIN = process.env.SITE_URL || 'https://edenprojecttcg.com';
const CACHE_TTL = 60 * 60 * 1000; // 1h en ms

async function getEbayToken() {
  const creds = Buffer.from(`${process.env.EBAY_APP_ID}:${process.env.EBAY_CERT_ID}`).toString('base64');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('eBay auth failed');
  return data.access_token;
}

async function fetchEbayPrice(token, query, kv) {
  const cacheKey = `ebay:${query.toLowerCase().replace(/\s+/g, '_')}`;
  try {
    const cached = await kv.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL) return cached.price;
  } catch {}

  const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
  url.searchParams.set('q', query);
  url.searchParams.set('filter', 'categoryIds:{183454},conditions:{NEW},deliveryCountry:FR');
  url.searchParams.set('sort', 'price');
  url.searchParams.set('limit', '10');

  const res = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_FR',
      'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country=FR',
    },
  });
  const data = await res.json();

  if (!data.itemSummaries?.length) return null;

  const prices = data.itemSummaries
    .slice(0, 5)
    .map(i => parseFloat(i.price?.value))
    .filter(p => !isNaN(p) && p > 0);

  if (!prices.length) return null;
  const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);

  try {
    await kv.set(cacheKey, { price: avg, ts: Date.now() });
  } catch {}
  return avg;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { queries } = req.body;
  if (!queries?.length) return res.status(400).json({ error: 'queries required' });

  try {
    const { kv } = require('@vercel/kv');
    const token = await getEbayToken();
    const results = await Promise.all(
      queries.map(async ({ id, term }) => ({ id, price: await fetchEbayPrice(token, term, kv) }))
    );
    return res.status(200).json({ prices: Object.fromEntries(results.map(r => [r.id, r.price])) });
  } catch (err) {
    console.error('eBay error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
