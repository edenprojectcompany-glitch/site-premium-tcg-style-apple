// api/vault.js — Eden Vault : jeu d'ouverture de box en monnaie virtuelle (EC)
// Env requis : KV_REST_API_URL, KV_REST_API_TOKEN, JWT_SECRET, ADMIN_CODE
//
// Tous les tirages sont "provably fair" :
//   roll = HMAC_SHA256(serverSeed, `${clientSeed}:${nonce}`) → 52 premiers bits / 2^52 ∈ [0,1)
//   Le hash SHA-256 du serverSeed est affiché AVANT de jouer ; le seed est révélé à la rotation.
//
// Les montants sont stockés en centimes d'EC (entiers) pour des opérations atomiques (INCRBY).

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { ITEMS, BOXES, TABLES, IMG_BASE, pick, tierOf, SELLBACK } = require('../lib/vault-data');

const CORS_ORIGIN = process.env.SITE_URL || 'https://edenprojecttcg.com';
const DAY = 24 * 60 * 60;
const MAX_OPEN = 5;
const UPGRADE_EDGE = 0.9;   // chance = (valeur mise / valeur visée) × 0.9
const UPGRADE_MAX = 0.75;   // plafond de chance

const K = {
  bal: u => `vault:bal:${u}`,
  inv: u => `vault:inv:${u}`,
  seed: u => `vault:seed:${u}`,
  nonce: u => `vault:nonce:${u}`,
  xp: u => `vault:xp:${u}`,
  stats: u => `vault:stats:${u}`,
  daily: u => `vault:daily:${u}`,
  history: u => `vault:hist:${u}`,
  code: c => `vault:code:${c}`,
  codes: 'vault:codes',
  redeemed: 'vault:redeemed',
  ships: 'vault:ships',
  feed: 'vault:feed',
  top: 'vault:top',
};

const toCents = n => Math.round(n * 100);
const fromCents = c => (Number(c) || 0) / 100;
const parse = v => (typeof v === 'string' ? JSON.parse(v) : v);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Code');
}

class HttpError extends Error {
  constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; }
}

function authUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) throw new HttpError(401, 'Connecte-toi pour jouer');
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new HttpError(401, 'Session expirée — reconnecte-toi');
  }
}

function isAdmin(req) {
  const code = req.headers['x-admin-code'];
  return !!code && !!process.env.ADMIN_CODE && code === process.env.ADMIN_CODE;
}

// ── Provably fair ─────────────────────────────────────────────
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const newServerSeed = () => crypto.randomBytes(32).toString('hex');
const newClientSeed = () => crypto.randomBytes(8).toString('hex');

function rollFrom(serverSeed, clientSeed, nonce) {
  const h = crypto.createHmac('sha256', serverSeed).update(`${clientSeed}:${nonce}`).digest('hex');
  return parseInt(h.slice(0, 13), 16) / 2 ** 52;
}

async function getSeeds(kv, uid) {
  let s = parse(await kv.get(K.seed(uid)));
  if (!s) {
    s = { server: newServerSeed(), client: newClientSeed() };
    await kv.set(K.seed(uid), JSON.stringify(s));
  }
  return s;
}

// Consomme un nonce et renvoie le tirage correspondant
async function nextRoll(kv, uid) {
  const seeds = await getSeeds(kv, uid);
  const nonce = await kv.incr(K.nonce(uid));
  return { roll: rollFrom(seeds.server, seeds.client, nonce), nonce, clientSeed: seeds.client, serverHash: sha256(seeds.server) };
}

// ── Helpers état joueur ───────────────────────────────────────
const newUid = () => 'i' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

function publicName(user) {
  const parts = String(user.name || 'Joueur').trim().split(/\s+/);
  return parts[0] + (parts[1] ? ' ' + parts[1][0].toUpperCase() + '.' : '');
}

function levelFromXp(xp) {
  // Niveau n atteint à 100 × n² XP (1 XP = 0,10 EC joué)
  const level = Math.floor(Math.sqrt(xp / 100)) + 1;
  const cur = 100 * (level - 1) ** 2, next = 100 * level ** 2;
  return { level, xp, cur, next };
}

async function debit(kv, uid, cents) {
  const after = await kv.incrby(K.bal(uid), -cents);
  if (after < 0) {
    await kv.incrby(K.bal(uid), cents);
    throw new HttpError(402, 'Solde insuffisant', { balance: fromCents(after + cents) });
  }
  return after;
}

async function addStats(kv, uid, patch) {
  const s = parse(await kv.get(K.stats(uid))) || { opened: 0, wagered: 0, won: 0, best: null, upgrades: 0, upgradesWon: 0 };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'best') { if (!s.best || v.value > s.best.value) s.best = v; }
    else s[k] = +((s[k] || 0) + v).toFixed(2);
  }
  await kv.set(K.stats(uid), JSON.stringify(s));
  return s;
}

async function pushFeed(kv, user, item, source) {
  const entry = { who: publicName(user), itemId: item.id, source, at: Date.now() };
  await kv.lpush(K.feed, JSON.stringify(entry));
  await kv.ltrim(K.feed, 0, 39);
  // Top 15 des plus gros tirages
  if (item.value >= 20) {
    const top = parse(await kv.get(K.top)) || [];
    top.push({ ...entry, value: item.value });
    top.sort((a, b) => b.value - a.value);
    await kv.set(K.top, JSON.stringify(top.slice(0, 15)));
  }
}

async function pushHistory(kv, uid, entry) {
  await kv.lpush(K.history(uid), JSON.stringify(entry));
  await kv.ltrim(K.history(uid), 0, 49);
}

async function inventory(kv, uid) {
  const raw = (await kv.hgetall(K.inv(uid))) || {};
  return Object.values(raw).map(parse).sort((a, b) => b.at - a.at);
}

async function state(kv, user) {
  const uid = user.id;
  const [bal, inv, seeds, nonce, xp, stats, daily, hist] = await Promise.all([
    kv.get(K.bal(uid)),
    inventory(kv, uid),
    getSeeds(kv, uid),
    kv.get(K.nonce(uid)),
    kv.get(K.xp(uid)),
    kv.get(K.stats(uid)),
    kv.get(K.daily(uid)),
    kv.lrange(K.history(uid), 0, 19),
  ]);
  const dailyAt = Number(daily) || 0;
  return {
    user: { id: uid, name: user.name, publicName: publicName(user) },
    balance: fromCents(bal),
    inventory: inv,
    fair: { serverHash: sha256(seeds.server), clientSeed: seeds.client, nonce: Number(nonce) || 0 },
    level: levelFromXp(Number(xp) || 0),
    stats: parse(stats) || { opened: 0, wagered: 0, won: 0, best: null, upgrades: 0, upgradesWon: 0 },
    dailyNext: dailyAt ? dailyAt + DAY * 1000 : 0,
    history: (hist || []).map(parse),
  };
}

// ── Actions joueur ────────────────────────────────────────────
async function openBox(kv, user, { boxId, count = 1 }) {
  const box = BOXES.find(b => b.id === boxId);
  if (!box) throw new HttpError(400, 'Box inconnue');
  const uid = user.id;
  const n = box.free ? 1 : Math.max(1, Math.min(MAX_OPEN, parseInt(count, 10) || 1));

  if (box.free) {
    // SET NX EX : un seul coffre gratuit par 24 h, atomique
    const ok = await kv.set(K.daily(uid), String(Date.now()), { nx: true, ex: DAY });
    if (!ok) {
      const at = Number(await kv.get(K.daily(uid))) || Date.now();
      throw new HttpError(429, 'Coffre du jour déjà ouvert', { dailyNext: at + DAY * 1000 });
    }
  } else {
    await debit(kv, uid, toCents(box.price) * n);
  }

  const results = [];
  let won = 0, coins = 0;
  for (let i = 0; i < n; i++) {
    const r = await nextRoll(kv, uid);
    const row = pick(box.id, r.roll);
    const item = ITEMS[row.itemId];
    const res = { item: item.id, tier: row.tier, roll: r.roll, nonce: r.nonce, clientSeed: r.clientSeed, serverHash: r.serverHash };
    if (item.kind === 'coin') {
      coins += toCents(item.value);
    } else {
      const uidItem = newUid();
      const owned = { uid: uidItem, itemId: item.id, tier: row.tier, from: box.id, at: Date.now() };
      await kv.hset(K.inv(uid), { [uidItem]: JSON.stringify(owned) });
      res.uid = uidItem;
    }
    won += item.value;
    if (row.tier === 'epic' || row.tier === 'legendary' || item.value >= 20) await pushFeed(kv, user, item, box.name);
    results.push(res);
  }
  if (coins) await kv.incrby(K.bal(uid), coins);

  const wagered = box.price * n;
  await kv.incrby(K.xp(uid), Math.max(5, Math.round(wagered * 10)));
  const best = results.map(r => ITEMS[r.item]).sort((a, b) => b.value - a.value)[0];
  await addStats(kv, uid, { opened: n, wagered, won, best: { itemId: best.id, value: best.value } });
  await pushHistory(kv, uid, { type: 'open', box: box.id, n, cost: wagered, items: results.map(r => r.item), at: Date.now() });

  return { results, state: await state(kv, user) };
}

async function sell(kv, user, { uids }) {
  if (!Array.isArray(uids) || !uids.length) throw new HttpError(400, 'Aucun objet sélectionné');
  const uid = user.id;
  let total = 0, sold = 0;
  for (const u of uids.slice(0, 200)) {
    const raw = await kv.hget(K.inv(uid), u);
    if (!raw) continue;
    // HDEL renvoie 1 seulement si l'objet était encore là → pas de double revente
    const removed = await kv.hdel(K.inv(uid), u);
    if (!removed) continue;
    const it = ITEMS[parse(raw).itemId];
    total += toCents(it.value * SELLBACK);
    sold++;
  }
  if (total) await kv.incrby(K.bal(uid), total);
  if (sold) await pushHistory(kv, uid, { type: 'sell', n: sold, gain: fromCents(total), at: Date.now() });
  return { sold, credited: fromCents(total), state: await state(kv, user) };
}

async function upgrade(kv, user, { uid: itemUid, targetId }) {
  const uid = user.id;
  const target = ITEMS[targetId];
  if (!target || target.kind === 'coin') throw new HttpError(400, 'Cible invalide');
  const raw = await kv.hget(K.inv(uid), itemUid);
  if (!raw) throw new HttpError(404, 'Objet introuvable');
  const owned = parse(raw);
  const from = ITEMS[owned.itemId];
  if (target.value <= from.value * 1.2) throw new HttpError(400, 'Choisis une cible au moins 20 % plus chère');

  const chance = Math.min(UPGRADE_MAX, (from.value / target.value) * UPGRADE_EDGE);
  const removed = await kv.hdel(K.inv(uid), itemUid);
  if (!removed) throw new HttpError(409, 'Objet déjà utilisé');

  const r = await nextRoll(kv, uid);
  const win = r.roll < chance;
  let newUidItem = null;
  if (win) {
    newUidItem = newUid();
    const tier = tierOf(target.value, from.value * 2);
    await kv.hset(K.inv(uid), { [newUidItem]: JSON.stringify({ uid: newUidItem, itemId: target.id, tier, from: 'upgrade', at: Date.now() }) });
    await pushFeed(kv, user, target, 'Upgrade');
  }
  await kv.incrby(K.xp(uid), Math.round(from.value * 10));
  await addStats(kv, uid, { upgrades: 1, upgradesWon: win ? 1 : 0, ...(win ? { best: { itemId: target.id, value: target.value } } : {}) });
  await pushHistory(kv, uid, { type: 'upgrade', from: from.id, to: target.id, win, chance, at: Date.now() });
  return { win, chance, roll: r.roll, nonce: r.nonce, uid: newUidItem, state: await state(kv, user) };
}

async function redeem(kv, user, { code }) {
  const c = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (c.length < 6) throw new HttpError(400, 'Code invalide');
  // GETDEL : lecture + suppression atomique → usage unique garanti
  const data = parse(await kv.getdel(K.code(c)));
  if (!data) throw new HttpError(404, 'Code invalide ou déjà utilisé');
  await kv.srem(K.codes, c);
  await kv.incrby(K.bal(user.id), data.cents);
  await kv.lpush(K.redeemed, JSON.stringify({ code: c, cents: data.cents, note: data.note || '', by: user.email, name: user.name, at: Date.now() }));
  await kv.ltrim(K.redeemed, 0, 199);
  await pushHistory(kv, user.id, { type: 'redeem', gain: fromCents(data.cents), at: Date.now() });
  return { credited: fromCents(data.cents), state: await state(kv, user) };
}

async function ship(kv, user, { uids, address }) {
  if (!Array.isArray(uids) || !uids.length) throw new HttpError(400, 'Aucun objet sélectionné');
  if (!address || String(address).trim().length < 10) throw new HttpError(400, 'Adresse de livraison incomplète');
  const uid = user.id;
  const items = [];
  for (const u of uids.slice(0, 100)) {
    const raw = await kv.hget(K.inv(uid), u);
    if (!raw) continue;
    if (!(await kv.hdel(K.inv(uid), u))) continue;
    items.push(parse(raw).itemId);
  }
  if (!items.length) throw new HttpError(409, 'Objets introuvables');
  const req = { id: 'shp_' + Date.now().toString(36), uid, email: user.email, name: user.name, address: String(address).slice(0, 400), items, at: Date.now(), status: 'demande' };
  await kv.lpush(K.ships, JSON.stringify(req));
  await pushHistory(kv, uid, { type: 'ship', n: items.length, at: Date.now() });
  return { request: req, state: await state(kv, user) };
}

async function rotateSeed(kv, user, { clientSeed }) {
  const uid = user.id;
  const old = await getSeeds(kv, uid);
  const oldNonce = Number(await kv.get(K.nonce(uid))) || 0;
  const cs = String(clientSeed || '').trim().slice(0, 64) || newClientSeed();
  await kv.set(K.seed(uid), JSON.stringify({ server: newServerSeed(), client: cs }));
  await kv.set(K.nonce(uid), 0);
  return { revealed: { serverSeed: old.server, serverHash: sha256(old.server), clientSeed: old.client, lastNonce: oldNonce }, state: await state(kv, user) };
}

// ── Actions admin ─────────────────────────────────────────────
function genCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I
  const b = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += A[b[i] % A.length];
  return `EDEN-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

async function admin(kv, action, body) {
  if (action === 'admin_create_codes') {
    const amount = Number(body.amount);
    const count = Math.max(1, Math.min(50, parseInt(body.count, 10) || 1));
    if (!(amount > 0 && amount <= 10000)) throw new HttpError(400, 'Montant invalide (0 à 10 000 EC)');
    const codes = [];
    for (let i = 0; i < count; i++) {
      const c = genCode();
      await kv.set(K.code(c), JSON.stringify({ cents: toCents(amount), note: String(body.note || '').slice(0, 80), at: Date.now() }));
      await kv.sadd(K.codes, c);
      codes.push(c);
    }
    return { codes, amount };
  }
  if (action === 'admin_overview') {
    const list = (await kv.smembers(K.codes)) || [];
    const codes = [];
    for (const c of list.slice(0, 300)) {
      const d = parse(await kv.get(K.code(c)));
      if (d) codes.push({ code: c, amount: fromCents(d.cents), note: d.note, at: d.at });
      else await kv.srem(K.codes, c);
    }
    codes.sort((a, b) => b.at - a.at);
    const [redeemed, ships] = await Promise.all([kv.lrange(K.redeemed, 0, 49), kv.lrange(K.ships, 0, 49)]);
    const house = Object.fromEntries(BOXES.map(b => [b.id, { ev: TABLES[b.id].ev, rtp: TABLES[b.id].rtp }]));
    return { codes, redeemed: (redeemed || []).map(parse), ships: (ships || []).map(parse), house };
  }
  if (action === 'admin_revoke_code') {
    const c = String(body.code || '').toUpperCase();
    await kv.del(K.code(c));
    await kv.srem(K.codes, c);
    return { ok: true };
  }
  if (action === 'admin_credit') {
    const email = String(body.email || '').toLowerCase().trim();
    const amount = Number(body.amount);
    const u = parse(await kv.get(`user:${email}`));
    if (!u) throw new HttpError(404, 'Utilisateur introuvable');
    if (!(Math.abs(amount) > 0 && Math.abs(amount) <= 10000)) throw new HttpError(400, 'Montant invalide');
    const bal = await kv.incrby(K.bal(u.id), toCents(amount));
    return { email, balance: fromCents(bal) };
  }
  throw new HttpError(400, 'Action admin inconnue');
}

// ── Config publique (catalogue, box, chances) ─────────────────
function config() {
  return {
    imgBase: IMG_BASE,
    sellback: SELLBACK,
    upgrade: { edge: UPGRADE_EDGE, max: UPGRADE_MAX },
    maxOpen: MAX_OPEN,
    items: ITEMS,
    boxes: BOXES.map(b => ({
      id: b.id, name: b.name, tagline: b.tagline, price: b.price, free: !!b.free, theme: b.theme,
      ev: +TABLES[b.id].ev.toFixed(2), rtp: TABLES[b.id].rtp,
      table: TABLES[b.id].rows.map(r => ({ itemId: r.itemId, p: r.p, tier: r.tier })),
    })),
  };
}

// ── Routeur ───────────────────────────────────────────────────
module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { kv } = require('@vercel/kv');

    if (req.method === 'GET') {
      const what = (req.query && req.query.q) || 'config';
      if (what === 'config') {
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
        return res.status(200).json(config());
      }
      if (what === 'feed') {
        const [feed, top] = await Promise.all([kv.lrange(K.feed, 0, 24), kv.get(K.top)]);
        return res.status(200).json({ feed: (feed || []).map(parse), top: parse(top) || [] });
      }
      return res.status(400).json({ error: 'Requête inconnue' });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {};
    const action = body.action;

    if (String(action || '').startsWith('admin_')) {
      if (!isAdmin(req)) return res.status(403).json({ error: 'Accès refusé' });
      return res.status(200).json(await admin(kv, action, body));
    }

    const user = authUser(req);
    switch (action) {
      case 'state': return res.status(200).json(await state(kv, user));
      case 'open': return res.status(200).json(await openBox(kv, user, body));
      case 'sell': return res.status(200).json(await sell(kv, user, body));
      case 'upgrade': return res.status(200).json(await upgrade(kv, user, body));
      case 'redeem': return res.status(200).json(await redeem(kv, user, body));
      case 'ship': return res.status(200).json(await ship(kv, user, body));
      case 'rotate_seed': return res.status(200).json(await rotateSeed(kv, user, body));
      default: return res.status(400).json({ error: 'Action inconnue' });
    }
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
    console.error('Vault error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
