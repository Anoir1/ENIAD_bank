# Rapport de sécurisation (XSS / Brute force) — 20/12/2025

## Objectif
Réduire fortement le risque :
- **XSS (DOM + stocké)** : empêcher l’injection HTML/JS via données utilisateur/BD.
- **Actions forgées depuis la console** : empêcher qu’un utilisateur puisse envoyer des messages WebSocket arbitraires pour agir au nom d’un autre.
- **Brute force** : limiter les tentatives de connexion/inscription.

> Note importante : on ne peut pas empêcher un utilisateur d’exécuter du JavaScript dans **sa propre** console. La vraie protection consiste à faire en sorte que **le serveur refuse** toute action non autorisée (auth solide + contrôles d’accès) et que le navigateur soit durci (CSP + pas d’injection HTML).

## Changements effectués (résumé)

### 1) Auth WebSocket renforcée (anti “console attacks”)
- L’authentification du dashboard ne se fait plus par `userId` envoyé par le client.
- Le serveur exige maintenant un **`sessionToken`** et déduit l’`userId` côté serveur.
- Les messages WebSocket “sensibles” (tout sauf `login/register/auth`) sont refusés si la session est absente/invalide.
- Les sessions ont un **TTL** (12h) et ne sont plus supprimées à la fermeture d’une socket (sinon un simple changement de page déconnectait l’utilisateur).

Fichiers :
- `server.js`
- `public/dashboard.js`

### 2) Protection XSS (CSP + suppression des injections)
- Ajout de **Content Security Policy (CSP)** et de headers de sécurité.
- Suppression des handlers HTML inline (`onclick/onsubmit`) pour que CSP puisse bloquer l’inline.
- Remplacement des `innerHTML` dangereux pour les toasts/notifications/broadcast par des nœuds DOM avec `textContent`.
- Échappement des champs affichés venant de la BD (ex : description, IBAN, titulaire, bénéficiaires).
- Suppression du code client « démo vulnérable » qui exposait des données et encourageait le vol simulé.

Fichiers :
- `server.js`
- `public/login.js`
- `public/dashboard.js`
- `public/login.html`
- `public/dashboard.html`

### 3) Anti brute-force
- Ajout d’un **rate limit mémoire** sur :
  - `login`: 10 tentatives / 15 minutes (par IP et par email)
  - `register`: 10 tentatives / 60 minutes (par IP)

Fichier :
- `server.js`

### 4) Corrections de vulnérabilités critiques côté serveur
- Blocage des actions “admin” et “recherche” exposées à tous.
- Suppression/neutralisation d’un SQL injection (requêtes concaténées) via la désactivation de la fonctionnalité.
- Ajout d’un contrôle d’appartenance sur `get_transactions` et `export_transactions` (le compte doit appartenir à l’utilisateur).

Fichier :
- `server.js`

### 5) Durcissement du serveur HTTP
- Ajout de headers : `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, etc.
- Correction d’une faille **path traversal** possible via l’URL (normalisation et contrôle du chemin servi).

Fichier :
- `server.js`

---

## Extraits de code (avant / après)

### A) Auth WebSocket (ne plus faire confiance au `userId` client)

**Avant** (le client envoyait un `userId`, facilement falsifiable depuis la console) :

```js
// public/dashboard.js (avant)
ws.send(JSON.stringify({ type: 'auth', data: { userId: parseInt(userId) } }));
```

```js
// server.js (avant)
async function handleAuth(ws, data) {
  const { userId } = data;
  ws.userId = userId;
  ws.isAuthenticated = true;
  // ...
}
```

**Après** (le client envoie un `sessionToken`, le serveur récupère `userId` depuis la session) :

```js
// public/dashboard.js (après)
ws.send(JSON.stringify({ type: 'auth', data: { sessionToken } }));
```

```js
// server.js (après)
function getSessionUserId(ws) {
  const session = sessions.get(ws.sessionToken);
  if (!session || session.expiresAt <= Date.now()) return null;
  return session.userId;
}

function ensureAuthenticated(ws) {
  const userId = getSessionUserId(ws);
  if (!userId) return false;
  ws.userId = userId;
  ws.isAuthenticated = true;
  return true;
}

async function handleAuth(ws, data) {
  const sessionToken = normalizeString(data?.sessionToken, 128);
  ws.sessionToken = sessionToken;
  if (!ensureAuthenticated(ws)) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Authentification échouée' }));
  }
}
```

### B) CSP + suppression des handlers inline (bloquer `onclick/onsubmit`)

**Avant** (inline event handlers dans le HTML) :

```html
<!-- public/login.html (avant) -->
<form id="loginForm" class="auth-form active" onsubmit="handleLogin(event)">
```

**Après** (handlers supprimés + binding via JS) :

```html
<!-- public/login.html (après) -->
<form id="loginForm" class="auth-form active">
```

```js
// public/login.js (après)
document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
```

Et côté serveur, ajout d’une CSP (extrait) :

```js
// server.js (après)
res.setHeader('Content-Security-Policy',
  "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'"
);
```

### C) XSS DOM : ne plus injecter du HTML avec des données non fiables

**Avant** (`innerHTML` avec message serveur) :

```js
// public/dashboard.js (avant)
div.innerHTML = message;
```

**Après** (`textContent`) :

```js
// public/dashboard.js (après)
div.textContent = String(message);
```

Autre exemple : toasts

**Avant** :

```js
// public/dashboard.js (avant)
toast.innerHTML = `... <div class="toast-message">${message}</div> ...`;
```

**Après** :

```js
// public/dashboard.js (après)
const msg = document.createElement('div');
msg.className = 'toast-message';
msg.textContent = String(message);
```

### D) Anti brute-force (rate limit)

**Avant** : aucune limitation de tentatives.

**Après** (extrait) :

```js
// server.js (après)
const RATE_LIMITS = {
  login: { windowMs: 15 * 60 * 1000, max: 10 },
  register: { windowMs: 60 * 60 * 1000, max: 10 }
};

const ipLimiter = takeRateLimitToken(`login:ip:${ip}`, RATE_LIMITS.login);
const emailLimiter = takeRateLimitToken(`login:email:${email}`, RATE_LIMITS.login);
if (!ipLimiter.allowed || !emailLimiter.allowed) {
  return ws.send(JSON.stringify({ type: 'error', message: 'Trop de tentatives, veuillez réessayer plus tard' }));
}
```

### E) Path traversal (accès fichiers hors `public/`)

**Avant** (construction directe à partir de `req.url`) :

```js
// server.js (avant)
let filePath = path.join(__dirname, 'public', req.url === '/' ? 'login.html' : req.url);
fs.readFile(filePath, ...);
```

**Après** (normalisation + blocage si on sort de `public/`) :

```js
// server.js (après)
const resolved = safeResolvePublicPath(req.url);
if (!resolved) {
  res.writeHead(403);
  return res.end('Accès interdit');
}
fs.readFile(resolved, ...);
```

## Comment tester rapidement
1. Lancer : `npm start`
2. Ouvrir : `http://localhost:5000`
3. Se connecter, vérifier que le dashboard charge.
4. Tester le brute force : tenter plusieurs logins invalides → un message “Trop de tentatives…” doit apparaître.
5. Tester XSS :
   - Créer un bénéficiaire avec un nom du type `<img src=x onerror=alert(1)>` → rien ne doit s’exécuter, le texte doit s’afficher “échappé”.

## Points à connaître (limites)
- Le rate limit est **en mémoire** : si le serveur redémarre, les compteurs repartent à zéro.
- Pour une sécurité “banque”, il faudrait idéalement :
  - sessions persistantes (Redis/DB),
  - cookies `HttpOnly` + `SameSite` (réduire l’impact d’un XSS résiduel),
  - logs/audit et détection de fraude.
