// lib/vault-data.js — Catalogue Eden Vault (lots + box)
// Source unique de vérité : utilisé par /api/vault (tirages) et envoyé au front via action "config".
// Valeurs en EC (Eden Coins, monnaie virtuelle — 1 EC ≈ 1 €), basées sur la cote eBay des displays.

const IMG_BASE = 'https://raw.githubusercontent.com/edenprojectcompany-glitch/catalogue-pokemon/main/img/';

// Sets : [id, code, nom, image, valeur display, nb boosters, langue]
const SETS = [
  [1,  'CN151-3', 'CN151 Vol.3',          '151c-vol3.png',          78,  15, 'cn'],
  [2,  'CN151-4', 'CN151 Vol.4',          '151c-vol4.png',          76,  15, 'cn'],
  [3,  'CN151-1', 'CN151 Vol.1',          '151c-vol1.png',          70,  15, 'cn'],
  [4,  'CN151-2', 'CN151 Vol.2',          '151c-vol2.png',          72,  15, 'cn'],
  [5,  'GEM-3',   'Gempack Vol.3',        'gem-pack-vol3.png',      74,  18, 'cn'],
  [6,  'GEM-2',   'Gempack Vol.2',        'gem-pack-vol2.png',      75,  15, 'cn'],
  [8,  'GEM-4',   'Gempack Vol.4',        'gem-pack-vol4.png',      58,  15, 'cn'],
  [9,  'GEM-5',   'Gempack Vol.5',        'gem-pack-vol5.png',      58,  15, 'cn'],
  [10, 'M2a',     'Méga Dream EX',        'mega-dream-ex-m2a.png',  92,  10, 'jp'],
  [11, 'M2',      'Méga Inferno X',       'inferno-x-m2.png',       115, 30, 'jp'],
  [12, 'M1L',     'Méga Brave',           'mega-brave-m1l.png',     110, 30, 'jp'],
  [13, 'M1s',     'Méga Symphonia',       'mega-symphonia-m1s.png', 83,  30, 'jp'],
  [14, 'M3',      'Nihil Zero',           'munikis-zero-m3.png',    82,  30, 'jp'],
  [15, 'SV8a',    'Terastal Festival',    'terastal-fest-sv8a.png', 105, 10, 'jp'],
  [16, 'SV9',     'Battle Partners',      'battle-partners-sv9.png',82,  30, 'jp'],
  [17, 'SV9a',    'Heat Wave Arena',      'heat-wave-sv9a.png',     105, 30, 'jp'],
  [18, 'SV10',    'Glory Team Rocket',    'glory-rocket-sv10.png',  142, 30, 'jp'],
  [19, 'SV11b',   'Black Bolt',           'black-bolt-sv11b.png',   118, 20, 'jp'],
  [20, 'SV11w',   'White Flare',          'white-flare-sv11w.png',  112, 20, 'jp'],
  [21, 'SV2a',    'Pokémon 151',          'pokemon-151-sv2a.png',   310, 20, 'jp'],
  [22, 'M5',      'Mega Abyss Eye',       'abyss-eye-m5.png',       128, 30, 'jp'],
];

const round2 = n => Math.round(n * 100) / 100;

// Génère 2 lots par set : 1 booster (valeur = display / nb boosters) et 1 display complète
const ITEMS = {};
for (const [id, code, name, img, value, count, lang] of SETS) {
  const hue = (id * 47) % 360; // teinte unique pour le rendu foil du booster
  ITEMS['b' + id] = { id: 'b' + id, kind: 'booster', set: code, name: `Booster ${name}`, short: name, img, lang, hue, value: round2(Math.floor((value / count) * 20) / 20) };
  ITEMS['d' + id] = { id: 'd' + id, kind: 'display', set: code, name: `Display ${name}`, short: name, img, lang, hue, value, boosters: count };
}
// Lots en pièces (box quotidienne gratuite)
for (const v of [0.1, 0.25, 0.5, 1, 2, 5]) {
  const id = 'c' + Math.round(v * 100);
  ITEMS[id] = { id, kind: 'coin', name: `${v.toFixed(2).replace('.', ',')} EC`, short: `${v} EC`, value: v, hue: 45 };
}

// Box : poids relatifs (normalisés à l'exécution). Le RTP visé est ~88-92 %.
const BOXES = [
  {
    id: 'daily', name: 'Coffre du jour', tagline: 'Gratuit toutes les 24 h', price: 0, free: true,
    theme: ['#a8ffd4', '#7fd9ff'],
    drops: { c10: 4200, c25: 2800, c50: 1600, c100: 800, c200: 350, c500: 90, b13: 120, b21: 30, d13: 10 },
  },
  {
    id: 'china', name: 'Chine Express', tagline: 'Boosters CN 151 & Gempack', price: 5.49,
    theme: ['#ff9f7a', '#ffd97f'],
    drops: { b9: 1500, b8: 1500, b5: 1400, b3: 1300, b4: 1300, b6: 1100, b2: 1000, b1: 900, d9: 35, d4: 24, d1: 16 },
  },
  {
    id: 'japan', name: 'Japan Rush', tagline: 'Tous les boosters JP du moment', price: 4.59,
    theme: ['#7fd9ff', '#c9a8ff'],
    drops: {
      b16: 1500, b14: 1500, b13: 1400, b17: 1100, b12: 1000, b11: 900, b22: 700, b18: 566, b20: 425, b19: 378,
      b10: 170, b15: 132, b21: 57, d16: 21, d18: 8, d21: 3,
    },
  },
  {
    id: 'mega', name: 'Méga Évolution', tagline: 'Boosters & displays série M', price: 14.9,
    theme: ['#c9a8ff', '#ffb3e6'],
    drops: {
      b13: 1400, b14: 1400, b12: 1200, b11: 1100, b22: 1000, b10: 900,
      d14: 208, d13: 190, d10: 139, d12: 104, d11: 87, d22: 69,
    },
  },
  {
    id: 'rocket', name: 'Rocket Vault', tagline: 'Glory Team Rocket & Unova', price: 29.9,
    theme: ['#ff7a7a', '#c9a8ff'],
    drops: {
      b18: 1600, b20: 1400, b19: 1400, b15: 1000, b21: 700,
      d17: 312, d15: 277, d20: 242, d19: 208, d18: 190, d21: 42,
    },
  },
  {
    id: 'grail', name: 'Grail 151', tagline: 'La chasse au display 151 JP', price: 59.9,
    theme: ['#ffd97f', '#ffb3e6'],
    drops: {
      b21: 1600, b15: 1400, b10: 1300, b19: 900,
      d16: 1163, d13: 1127, d17: 881, d18: 669, d21: 211,
    },
  },
];

// Seuil de rareté selon valeur / prix de la box (ou prix de référence pour la box gratuite)
function tierOf(value, boxPrice) {
  const ref = boxPrice || 1;
  const r = value / ref;
  if (r >= 8 || value >= 250) return 'legendary';
  if (r >= 2.5) return 'epic';
  if (r >= 1.2) return 'rare';
  if (r >= 0.75) return 'uncommon';
  return 'common';
}

// Tableau des chances normalisé + RTP pour chaque box
function boxTable(box) {
  const total = Object.values(box.drops).reduce((s, w) => s + w, 0);
  let acc = 0, ev = 0;
  const rows = Object.entries(box.drops).map(([itemId, w]) => {
    const item = ITEMS[itemId];
    const p = w / total;
    ev += p * item.value;
    const row = { itemId, p, from: acc, to: acc + p, tier: tierOf(item.value, box.price) };
    acc += p;
    return row;
  });
  return { rows, ev, rtp: box.price ? ev / box.price : null };
}

const TABLES = Object.fromEntries(BOXES.map(b => [b.id, boxTable(b)]));

// Tirage à partir d'un nombre [0,1)
function pick(boxId, roll) {
  const rows = TABLES[boxId].rows;
  for (const r of rows) if (roll < r.to) return r;
  return rows[rows.length - 1];
}

module.exports = { IMG_BASE, ITEMS, BOXES, TABLES, pick, tierOf, SELLBACK: 0.9 };
