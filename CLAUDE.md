# Eden Project TCG — Site Premium · Contexte Claude

## Repos & URLs
| | |
|---|---|
| **Repo nouveau site** | https://github.com/edenprojectcompany-glitch/site-premium-tcg-style-apple |
| **Repo ancien site (images)** | https://github.com/edenprojectcompany-glitch/catalogue-pokemon |
| **Ancien site prod** | https://catalogue-pokemon.vercel.app |
| **Nouveau site** | à déployer sur Vercel (voir ci-dessous) |
| **Domaine cible** | edenprojecttcg.com |

## Vercel
- **Team slug :** `eden-tcg`
- **Team ID :** `team_U7KyovUFmafdL1RRf0qC7JDO`
- **Projet ancien :** `catalogue-pokemon` / `prj_9UJyxMNiNwPeBUu2dPTCQ25AJvik`
- **Nouveau projet :** à importer depuis vercel.com/new → repo `site-premium-tcg-style-apple`

### Variables d'env à configurer dans Vercel (nouveau projet)
```
STRIPE_SECRET_KEY       sk_live_...
PAYPAL_CLIENT_ID        ...
PAYPAL_CLIENT_SECRET    ...
PAYPAL_ENV              live   (ou sandbox pour tests)
EBAY_APP_ID             ...
EBAY_CERT_ID            ...
```

## Stack
HTML/CSS/JS statique + APIs Vercel Serverless (Node.js) → GitHub → Vercel auto-deploy

## Règle absolue
> Ne jamais pusher sur GitHub sans confirmation explicite de Vincent.

---

## Structure du projet
```
site-premium-tcg-style-apple/
├── index.html          ← SPA complète (tout le front)
├── vercel.json         ← Config déploiement
├── package.json        ← Deps Node (stripe)
├── CLAUDE.md           ← Ce fichier
└── api/
    ├── create-payment.js       ← Stripe Checkout Session
    ├── create-paypal-order.js  ← PayPal Order
    └── ebay-prices.js          ← Prix live eBay (avec cache 1h)
```

## APIs disponibles
| Endpoint | Méthode | Description |
|---|---|---|
| `/api/create-payment` | POST | Crée session Stripe → retourne `{url, sessionId}` |
| `/api/create-paypal-order` | POST | Crée ordre PayPal → retourne `{orderId, approveUrl}` |
| `/api/ebay-prices` | POST | Prix eBay live → retourne `{prices: {id: prix}}` |

### Body create-payment
```json
{
  "items": [{"name":"...","sub":"...","img":"...","unitPrice":85,"qty":2}],
  "shippingCost": 4.90,
  "promoCode": "EDEN10",
  "successUrl": "https://...",
  "cancelUrl": "https://..."
}
```

### Body create-paypal-order
```json
{
  "items": [{"name":"...","unitPrice":85,"qty":2}],
  "shippingCost": 4.90,
  "promoCode": "EDEN10"
}
```

### Body ebay-prices
```json
{
  "queries": [
    {"id": 10, "term": "Pokemon Mega Dream EX M2a display JP"},
    {"id": 18, "term": "Pokemon Glory Team Rocket SV10 display JP"}
  ]
}
```

---

## Design system

### Typographie
- Titres : **Fraunces** (serif, Google Fonts)
- Corps : **Manrope** (sans-serif, Google Fonts)

### Palette CSS
```css
--obsidian: #0a0a0c      /* fond principal */
--obsidian-2: #111114    /* cartes */
--obsidian-3: #16161b
--glass: rgba(255,255,255,.04)
--glass-border: rgba(255,255,255,.09)
--foil-1: #7fd9ff   /* cyan */
--foil-2: #c9a8ff   /* violet */
--foil-3: #ffb3e6   /* rose */
--foil-4: #a8ffd4   /* vert menthe */
--success: #7fffaa
--danger: #ff7a7a
```

### Effets signature
- **Fond** : canvas WebGL-like — mesh de points connectés, réactif à la souris, couleurs foil
- **Cartes** : tilt 3D hover + effet foil color-dodge
- **Nav** : glassmorphism `backdrop-filter: blur(28px)`
- **Animations** : `cubic-bezier(.16,1,.3,1)` (spring) partout

---

## Catalogue — 22 produits

### Images
Hébergées sur le **repo ancien** (ne pas modifier ce repo) :
```
https://raw.githubusercontent.com/edenprojectcompany-glitch/catalogue-pokemon/main/img/{filename}
```
Constante JS : `const IMG_BASE = 'https://raw.githubusercontent.com/...'`

### Produits JP (13)
| ID | Nom | img |
|---|---|---|
| 10 | M2a — Méga Dream EX | mega-dream-ex-m2a.png |
| 11 | M2 — Méga Inferno X | inferno-x-m2.png |
| 12 | M1L — Méga Brave | mega-brave-m1l.png |
| 13 | M1s — Méga Symphonia | mega-symphonia-m1s.png |
| 14 | M3 — Nihil Zero | munikis-zero-m3.png |
| 15 | SV8a — Terastal Festival | terastal-fest-sv8a.png |
| 16 | SV9 — Battle Partners | battle-partners-sv9.png |
| 17 | SV9a — Heat Wave Arena | heat-wave-sv9a.png |
| 18 | SV10 — Glory Team Rocket | glory-rocket-sv10.png |
| 19 | SV11b — Black Bolt | black-bolt-sv11b.png |
| 20 | SV11w — White Flare | white-flare-sv11w.png |
| 21 | SV2a — Pokémon 151 | pokemon-151-sv2a.png |
| 22 | M5 — Mega Abyss Eye | abyss-eye-m5.png |

### Produits CN (9)
| ID | Nom | img |
|---|---|---|
| 1 | CN151 Vol.3 | 151c-vol3.png |
| 2 | CN151 Vol.4 | 151c-vol4.png |
| 3 | CN151 Vol.1 | 151c-vol1.png |
| 4 | CN151 Vol.2 | 151c-vol2.png |
| 5 | Gempack Vol.3 | gem-pack-vol3.png |
| 6 | Gempack Vol.2 | gem-pack-vol2.png |
| 7 | Gempack Vol.1 | gem-pack-vol1.png |
| 8 | Gempack Vol.4 | gem-pack-vol4.png |
| 9 | Gempack Vol.5 | gem-pack-vol5.png |

---

## SPA — Pages
Navigation via `go(pageName)`. Pages : `home`, `catalog`, `auth`, `dashboard`, `checkout`, `confirm`, `graded`, `news`

## Fonctionnalités actives (front mock)
- ✅ Catalogue 22 produits avec images GitHub
- ✅ Filtres JP / CN
- ✅ Recherche live
- ✅ Modal produit
- ✅ Panier sidebar + prix dégressifs
- ✅ Checkout avec Mondial Relay / Colissimo / Express
- ✅ Codes promo (EDEN10=10%, WELCOME5=5%, TCG15=15%)
- ✅ Bouton Stripe → `/api/create-payment`
- ✅ Bouton PayPal → `/api/create-paypal-order`
- ✅ Dashboard générique (pas de nom hardcodé)
- ✅ Fond canvas holo interactif
- ✅ Mobile nav hamburger
- ✅ Scroll-to-top

## Fonctionnalités à brancher (backlog)
- [ ] Auth réelle → `/api/register` + `/api/login` (Vercel KV/Redis)
- [ ] eBay live → `/api/ebay-prices` (remplacer les prix statiques dans `products[]`)
- [ ] Dashboard connecté (portfolio réel post-login)
- [ ] Roue de la fortune → `/api/record-spin` + fingerprint
- [ ] Mondial Relay widget (sélecteur point relais)
- [ ] Admin panel protégé
- [ ] Domaine edenprojecttcg.com (configurer dans Vercel)
- [ ] i18n FR/EN

## Pour déployer le nouveau site
1. Pusher ce repo sur GitHub : `git push origin main`
2. Aller sur vercel.com → "Add New Project"
3. Importer `edenprojectcompany-glitch/site-premium-tcg-style-apple`
4. Framework : **Other**
5. Ajouter les variables d'env (voir ci-dessus)
6. Deploy → URL automatique, puis ajouter edenprojecttcg.com

## Contact
Email : Edenprojectcompany@gmail.com
