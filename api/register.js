// api/register.js — Inscription utilisateur (Vercel KV + bcrypt + JWT)
// Env requis : KV_REST_API_URL, KV_REST_API_TOKEN, JWT_SECRET

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const CORS_ORIGIN = process.env.SITE_URL || 'https://edenprojecttcg.com';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function getKV() {
  const { kv } = require('@vercel/kv');
  return kv;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, password } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password || password.length < 6) {
    return res.status(400).json({ error: 'Données invalides — mot de passe min. 6 caractères' });
  }

  const key = `user:${email.toLowerCase().trim()}`;
  try {
    const kv = await getKV();
    const existing = await kv.get(key);
    if (existing) return res.status(409).json({ error: 'Cet e-mail est déjà utilisé' });

    const hash = await bcrypt.hash(password, 10);
    const user = {
      id: `usr_${Date.now()}`,
      name: name.trim(),
      email: email.toLowerCase().trim(),
      hash,
      createdAt: new Date().toISOString(),
      lastSpin: null,
      orders: [],
      loyalty: 0,
    };
    await kv.set(key, user);

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    return res.status(200).json({ token, user: { id: user.id, name: user.name, email: user.email, lastSpin: null, loyalty: 0 } });
  } catch (err) {
    console.error('Register error:', err.message);
    return res.status(500).json({ error: 'Erreur serveur — réessayez' });
  }
};
