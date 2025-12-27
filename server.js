const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pool, initDatabase } = require('./database');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const PORT = 5000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
// Map<sessionToken, { userId: number, expiresAt: number }>
const sessions = new Map();

const RATE_LIMITS = {
  login: { windowMs: 15 * 60 * 1000, max: 10 },
  register: { windowMs: 60 * 60 * 1000, max: 10 }
};

const rateLimitBuckets = new Map();

function getClientIpFromReq(req) {
  const xfwd = req.headers['x-forwarded-for'];
  if (typeof xfwd === 'string' && xfwd.length > 0) {
    return xfwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function getClientIpFromWs(ws) {
  return ws?._socket?.remoteAddress || ws?.ip || 'unknown';
}

function takeRateLimitToken(key, { windowMs, max }) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (bucket.count >= max) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

function normalizeString(value, maxLen = 255) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const normalized = email.trim();
  if (normalized.length < 3 || normalized.length > 254) return false;
  // Basic check (avoid heavy/complex regex)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

function setSecurityHeaders(req, res) {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "form-action 'self'"
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  // Simple hardening for HTML responses
  if ((req.headers.accept || '').includes('text/html')) {
    res.setHeader('Cache-Control', 'no-store');
  }
}

function safeResolvePublicPath(urlPath) {
  const publicDir = path.join(__dirname, 'public');

  let decodedPath = '/';
  try {
    decodedPath = decodeURIComponent(urlPath || '/');
  } catch {
    decodedPath = '/';
  }

  const requestPath = decodedPath.split('?')[0].split('#')[0];
  const relative = requestPath === '/' ? '/login.html' : requestPath;
  const resolved = path.normalize(path.join(publicDir, relative));

  if (!resolved.startsWith(publicDir + path.sep)) {
    return null;
  }

  return resolved;
}

function getSessionUserId(ws) {
  if (!ws || !ws.sessionToken) return null;
  const session = sessions.get(ws.sessionToken);
  if (!session) return null;
  if (typeof session.expiresAt === 'number' && session.expiresAt <= Date.now()) {
    sessions.delete(ws.sessionToken);
    return null;
  }
  return session.userId || null;
}

function ensureAuthenticated(ws) {
  const userId = getSessionUserId(ws);
  if (!userId) return false;
  ws.userId = userId;
  ws.isAuthenticated = true;
  return true;
}

const server = http.createServer((req, res) => {
  setSecurityHeaders(req, res);

  const resolved = safeResolvePublicPath(req.url);
  if (!resolved) {
    res.writeHead(403);
    return res.end('Accès interdit');
  }

  const ext = path.extname(resolved);
  
  const contentTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json'
  };

  fs.readFile(resolved, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Fichier non trouvé');
    } else {
      res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
      res.end(content);
    }
  });
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  ws.userId = null;
  ws.isAuthenticated = false;
  ws.sessionToken = null;
  ws.ip = getClientIpFromReq(req);

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      await handleMessage(ws, message);
    } catch (error) {
      ws.send(JSON.stringify({ type: 'error', message: 'Erreur serveur' }));
    }
  });

  ws.on('close', () => {
    // Do not delete sessions on socket close; browser navigation would otherwise log out users.
  });
});

async function handleMessage(ws, message) {
  const { type, data } = message;

  // Enforce authentication centrally for all protected message types.
  if (!['register', 'login', 'auth'].includes(type)) {
    if (!ensureAuthenticated(ws)) {
      return ws.send(JSON.stringify({ type: 'error', message: 'Non authentifié' }));
    }
  }

  switch (type) {
    case 'register':
      await handleRegister(ws, data);
      break;
    
    case 'login':
      await handleLogin(ws, data);
      break;
    
    case 'auth':
      await handleAuth(ws, data);
      break;
    
    case 'get_accounts':
      await handleGetAccounts(ws);
      break;
    
    case 'get_transactions':
      await handleGetTransactions(ws, data);
      break;
    
    case 'get_cards':
      await handleGetCards(ws);
      break;
    
    case 'get_beneficiaries':
      await handleGetBeneficiaries(ws);
      break;
    
    case 'add_beneficiary':
      await handleAddBeneficiary(ws, data);
      break;
    
    case 'transfer':
      await handleTransfer(ws, data);
      break;
    
    case 'get_stats':
      await handleGetStats(ws);
      break;
    
    case 'get_notifications':
      await handleGetNotifications(ws);
      break;
    
    case 'mark_notification_read':
      await handleMarkNotificationRead(ws, data);
      break;
    
    case 'delete_beneficiary':
      await handleDeleteBeneficiary(ws, data);
      break;
    
    case 'update_profile':
      await handleUpdateProfile(ws, data);
      break;
    
    case 'change_password':
      await handleChangePassword(ws, data);
      break;
    
    case 'get_profile':
      await handleGetProfile(ws);
      break;
    
    case 'block_card':
      await handleBlockCard(ws, data);
      break;
    
    case 'unblock_card':
      await handleUnblockCard(ws, data);
      break;
    
    case 'export_transactions':
      await handleExportTransactions(ws, data);
      break;
    
    case 'search_user':
      await handleSearchUser(ws, data);
      break;
    
    case 'broadcast_message':
      await handleBroadcastMessage(ws, data);
      break;
    
    case 'admin_command':
      await handleAdminCommand(ws, data);
      break;
    
    default:
      ws.send(JSON.stringify({ type: 'error', message: 'Type de message inconnu' }));
  }
}

async function handleRegister(ws, data) {
  try {
    const ip = getClientIpFromWs(ws);
    const limiter = takeRateLimitToken(`register:ip:${ip}`, RATE_LIMITS.register);
    if (!limiter.allowed) {
      return ws.send(JSON.stringify({ type: 'error', message: 'Trop de tentatives, veuillez réessayer plus tard' }));
    }

    const email = normalizeString(data?.email, 254).toLowerCase();
    const password = typeof data?.password === 'string' ? data.password : '';
    const nom = normalizeString(data?.nom, 100);
    const prenom = normalizeString(data?.prenom, 100);

    if (!isValidEmail(email) || password.length < 6 || nom.length < 1 || prenom.length < 1) {
      return ws.send(JSON.stringify({ type: 'error', message: 'Données invalides' }));
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const [result] = await pool.query(
      'INSERT INTO users (email, password, nom, prenom) VALUES (?, ?, ?, ?)',
      [email, hashedPassword, nom, prenom]
    );
    
    ws.send(JSON.stringify({ type: 'register_success', message: 'Inscription réussie' }));
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', message: 'Email déjà utilisé' }));
  }
}

async function handleLogin(ws, data) {
  try {
    const ip = getClientIpFromWs(ws);
    const email = normalizeString(data?.email, 254).toLowerCase();
    const password = typeof data?.password === 'string' ? data.password : '';

    const ipLimiter = takeRateLimitToken(`login:ip:${ip}`, RATE_LIMITS.login);
    const emailLimiter = takeRateLimitToken(`login:email:${email || 'unknown'}`, RATE_LIMITS.login);
    if (!ipLimiter.allowed || !emailLimiter.allowed) {
      return ws.send(JSON.stringify({ type: 'error', message: 'Trop de tentatives, veuillez réessayer plus tard' }));
    }

    if (!isValidEmail(email) || password.length < 1) {
      return ws.send(JSON.stringify({ type: 'error', message: 'Identifiants invalides' }));
    }

    const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    
    if (users.length === 0) {
      return ws.send(JSON.stringify({ type: 'error', message: 'Identifiants invalides' }));
    }
    
    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) {
      return ws.send(JSON.stringify({ type: 'error', message: 'Identifiants invalides' }));
    }
    
    const sessionToken = uuidv4();
    sessions.set(sessionToken, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
    
    ws.userId = user.id;
    ws.sessionToken = sessionToken;
    ws.isAuthenticated = true;
    
    await pool.query('UPDATE users SET derniere_connexion = NOW() WHERE id = ?', [user.id]);
    
    ws.send(JSON.stringify({ 
      type: 'login_success', 
      data: { 
        sessionToken, 
        user: { id: user.id, email: user.email, nom: user.nom, prenom: user.prenom }
      }
    }));
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', message: 'Erreur de connexion' }));
  }
}

async function handleAuth(ws, data) {
  try {
    const sessionToken = normalizeString(data?.sessionToken, 128);
    if (!sessionToken) {
      return ws.send(JSON.stringify({ type: 'error', message: 'Authentification échouée' }));
    }

    ws.sessionToken = sessionToken;
    if (!ensureAuthenticated(ws)) {
      ws.sessionToken = null;
      ws.userId = null;
      ws.isAuthenticated = false;
      return ws.send(JSON.stringify({ type: 'error', message: 'Authentification échouée' }));
    }
    
    const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [ws.userId]);
    const user = users[0];
    
    ws.send(JSON.stringify({ 
      type: 'auth_success',
      data: { user: { id: user.id, email: user.email, nom: user.nom, prenom: user.prenom } }
    }));
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', message: 'Authentification échouée' }));
  }
}

async function handleGetAccounts(ws) {
  if (!ws.isAuthenticated) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Non authentifié' }));
  }
  
  try {
    const [accounts] = await pool.query(
      'SELECT * FROM comptes WHERE user_id = ? ORDER BY date_ouverture DESC',
      [ws.userId]
    );
    
    ws.send(JSON.stringify({ type: 'accounts', data: accounts }));
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', message: 'Erreur récupération comptes' }));
  }
}

async function handleGetTransactions(ws, data) {
  try {
    const { compteId } = data;

    const [owned] = await pool.query('SELECT id FROM comptes WHERE id = ? AND user_id = ?', [compteId, ws.userId]);
    if (owned.length === 0) {
      return ws.send(JSON.stringify({ type: 'error', message: 'Accès interdit' }));
    }

    const [transactions] = await pool.query(
      `SELECT t.*, 
        c1.numero_compte as compte_source,
        c2.numero_compte as compte_dest
       FROM transactions t
       LEFT JOIN comptes c1 ON t.compte_source_id = c1.id
       LEFT JOIN comptes c2 ON t.compte_dest_id = c2.id
       WHERE t.compte_source_id = ? OR t.compte_dest_id = ?
       ORDER BY t.date_transaction DESC
       LIMIT 50`,
      [compteId, compteId]
    );
    
    ws.send(JSON.stringify({ type: 'transactions', data: transactions }));
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', message: 'Erreur récupération transactions' }));
  }
}

async function handleGetCards(ws) {
  if (!ws.isAuthenticated) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Non authentifié' }));
  }
  
  try {
    const [cards] = await pool.query(
      `SELECT c.*, co.numero_compte, co.solde 
       FROM cartes c
       JOIN comptes co ON c.compte_id = co.id
       WHERE co.user_id = ?`,
      [ws.userId]
    );
    
    ws.send(JSON.stringify({ type: 'cards', data: cards }));
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', message: 'Erreur récupération cartes' }));
  }
}

async function handleGetBeneficiaries(ws) {
  if (!ws.isAuthenticated) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Non authentifié' }));
  }
  
  try {
    const [beneficiaries] = await pool.query(
      'SELECT * FROM beneficiaires WHERE user_id = ? ORDER BY favori DESC, nom',
      [ws.userId]
    );
    
    ws.send(JSON.stringify({ type: 'beneficiaries', data: beneficiaries }));
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', message: 'Erreur récupération bénéficiaires' }));
  }
}

async function handleAddBeneficiary(ws, data) {
  if (!ws.isAuthenticated) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Non authentifié' }));
  }
  
  try {
    const { nom, prenom, iban } = data;
    await pool.query(
      'INSERT INTO beneficiaires (user_id, nom, prenom, iban) VALUES (?, ?, ?, ?)',
      [ws.userId, nom, prenom, iban]
    );
    
    ws.send(JSON.stringify({ type: 'beneficiary_added', message: 'Bénéficiaire ajouté' }));
    await handleGetBeneficiaries(ws);
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', message: 'Erreur ajout bénéficiaire' }));
  }
}

async function handleTransfer(ws, data) {
  if (!ws.isAuthenticated) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Non authentifié' }));
  }
  
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { compteSourceId, ibanDest, montant, description } = data;
    const amount = parseFloat(montant);
    
    const [sourceAccounts] = await connection.query(
      'SELECT * FROM comptes WHERE id = ? AND user_id = ? FOR UPDATE',
      [compteSourceId, ws.userId]
    );
    
    if (sourceAccounts.length === 0) {
      throw new Error('Compte source invalide');
    }
    
    const sourceAccount = sourceAccounts[0];
    
    if (sourceAccount.solde < amount) {
      throw new Error('Solde insuffisant');
    }
    
    const [destAccounts] = await connection.query(
      'SELECT * FROM comptes WHERE iban = ? FOR UPDATE',
      [ibanDest]
    );
    
    if (destAccounts.length === 0) {
      throw new Error('Compte destinataire introuvable');
    }
    
    const destAccount = destAccounts[0];
    
    await connection.query(
      'UPDATE comptes SET solde = solde - ? WHERE id = ?',
      [amount, sourceAccount.id]
    );
    
    await connection.query(
      'UPDATE comptes SET solde = solde + ? WHERE id = ?',
      [amount, destAccount.id]
    );
    
    await connection.query(
      `INSERT INTO transactions 
       (compte_source_id, compte_dest_id, type_transaction, montant, description, solde_avant, solde_apres)
       VALUES (?, ?, 'virement', ?, ?, ?, ?)`,
      [sourceAccount.id, destAccount.id, amount, description, sourceAccount.solde, sourceAccount.solde - amount]
    );
    
    await connection.query(
      `INSERT INTO notifications (user_id, titre, message, type)
       VALUES (?, 'Virement effectué', ?, 'virement')`,
      [ws.userId, `Virement de ${amount}€ vers ${ibanDest}`]
    );
    
    if (destAccount.user_id !== ws.userId) {
      await connection.query(
        `INSERT INTO notifications (user_id, titre, message, type)
         VALUES (?, 'Virement reçu', ?, 'virement')`,
        [destAccount.user_id, `Vous avez reçu ${amount}€`]
      );
      
      notifyUser(destAccount.user_id, {
        type: 'notification',
        data: {
          titre: 'Virement reçu',
          message: `Vous avez reçu ${amount}€`,
          montant: amount
        }
      });
    }
    
    await connection.commit();
    
    ws.send(JSON.stringify({ 
      type: 'transfer_success', 
      message: 'Virement effectué avec succès',
      data: { montant: amount, nouveau_solde: sourceAccount.solde - amount }
    }));
    
    await handleGetAccounts(ws);
    
  } catch (error) {
    await connection.rollback();
    ws.send(JSON.stringify({ type: 'error', message: error.message }));
  } finally {
    connection.release();
  }
}

async function handleGetStats(ws) {
  if (!ws.isAuthenticated) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Non authentifié' }));
  }
  
  try {
    const [accounts] = await pool.query(
      'SELECT SUM(solde) as total FROM comptes WHERE user_id = ?',
      [ws.userId]
    );
    
    const [transactions] = await pool.query(
      `SELECT 
        COUNT(*) as total_transactions,
        SUM(CASE WHEN compte_source_id IN (SELECT id FROM comptes WHERE user_id = ?) THEN montant ELSE 0 END) as total_depenses,
        SUM(CASE WHEN compte_dest_id IN (SELECT id FROM comptes WHERE user_id = ?) THEN montant ELSE 0 END) as total_revenus
       FROM transactions
       WHERE DATE(date_transaction) >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      [ws.userId, ws.userId]
    );
    
    ws.send(JSON.stringify({ 
      type: 'stats', 
      data: {
        total_solde: accounts[0].total || 0,
        total_transactions: transactions[0].total_transactions || 0,
        total_depenses: transactions[0].total_depenses || 0,
        total_revenus: transactions[0].total_revenus || 0
      }
    }));
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', message: 'Erreur récupération statistiques' }));
  }
}

async function handleGetNotifications(ws) {
  if (!ws.isAuthenticated) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Non authentifié' }));
  }
  
  try {
    const [notifications] = await pool.query(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY date_notification DESC LIMIT 20',
      [ws.userId]
    );
    
    ws.send(JSON.stringify({ type: 'notifications', data: notifications }));
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', message: 'Erreur récupération notifications' }));
  }
}

async function handleMarkNotificationRead(ws, data) {
  if (!ws.isAuthenticated) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Non authentifié' }));
  }
  
  try {
    const { notificationId } = data;
    await pool.query(
      'UPDATE notifications SET lu = TRUE WHERE id = ? AND user_id = ?',
      [notificationId, ws.userId]
    );
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', message: 'Erreur mise à jour notification' }));
  }
}

async function handleDeleteBeneficiary(ws, data) {
  if (!ws.isAuthenticated) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Non authentifié' }));
  }
  
  try {
    const { id } = data;
    await pool.query('DELETE FROM beneficiaires WHERE id = ? AND user_id = ?', [id, ws.userId]);
    ws.send(JSON.stringify({ type: 'beneficiary_deleted', message: 'Bénéficiaire supprimé' }));
    await handleGetBeneficiaries(ws);
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', message: 'Erreur suppression bénéficiaire' }));
  }
}

async function handleUpdateProfile(ws, data) {
  if (!ws.isAuthenticated) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Non authentifié' }));
  }
  
  try {
    const { nom, prenom, telephone, adresse } = data;
    await pool.query(
      'UPDATE users SET nom = ?, prenom = ?, telephone = ?, adresse = ? WHERE id = ?',
      [nom, prenom, telephone, adresse, ws.userId]
    );
    ws.send(JSON.stringify({ type: 'profile_updated', message: 'Profil mis à jour' }));
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', message: 'Erreur mise à jour profil' }));
  }
}

async function handleChangePassword(ws, data) {
  if (!ws.isAuthenticated) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Non authentifié' }));
  }
  
  try {
    const { oldPassword, newPassword } = data;
    const [users] = await pool.query('SELECT password FROM users WHERE id = ?', [ws.userId]);
    
    const validPassword = await bcrypt.compare(oldPassword, users[0].password);
    if (!validPassword) {
      return ws.send(JSON.stringify({ type: 'error', message: 'Mot de passe actuel incorrect' }));
    }
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, ws.userId]);
    ws.send(JSON.stringify({ type: 'password_changed', message: 'Mot de passe modifié avec succès' }));
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', message: 'Erreur changement mot de passe' }));
  }
}

async function handleGetProfile(ws) {
  if (!ws.isAuthenticated) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Non authentifié' }));
  }
  
  try {
    const [users] = await pool.query(
      'SELECT id, email, nom, prenom, telephone, adresse, date_creation, derniere_connexion FROM users WHERE id = ?',
      [ws.userId]
    );
    ws.send(JSON.stringify({ type: 'profile', data: users[0] }));
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', message: 'Erreur récupération profil' }));
  }
}

async function handleBlockCard(ws, data) {
  if (!ws.isAuthenticated) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Non authentifié' }));
  }
  
  try {
    const { cardId } = data;
    await pool.query(
      `UPDATE cartes SET statut = 'bloquee' 
       WHERE id = ? AND compte_id IN (SELECT id FROM comptes WHERE user_id = ?)`,
      [cardId, ws.userId]
    );
    ws.send(JSON.stringify({ type: 'card_blocked', message: 'Carte bloquée avec succès' }));
    await handleGetCards(ws);
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', message: 'Erreur blocage carte' }));
  }
}

async function handleUnblockCard(ws, data) {
  if (!ws.isAuthenticated) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Non authentifié' }));
  }
  
  try {
    const { cardId } = data;
    await pool.query(
      `UPDATE cartes SET statut = 'active' 
       WHERE id = ? AND compte_id IN (SELECT id FROM comptes WHERE user_id = ?)`,
      [cardId, ws.userId]
    );
    ws.send(JSON.stringify({ type: 'card_unblocked', message: 'Carte débloquée avec succès' }));
    await handleGetCards(ws);
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', message: 'Erreur déblocage carte' }));
  }
}

async function handleExportTransactions(ws, data) {
  try {
    const { compteId, format } = data;

    const [owned] = await pool.query('SELECT id FROM comptes WHERE id = ? AND user_id = ?', [compteId, ws.userId]);
    if (owned.length === 0) {
      return ws.send(JSON.stringify({ type: 'error', message: 'Accès interdit' }));
    }

    const [transactions] = await pool.query(
      `SELECT t.*, c1.numero_compte as source, c2.numero_compte as dest
       FROM transactions t
       LEFT JOIN comptes c1 ON t.compte_source_id = c1.id
       LEFT JOIN comptes c2 ON t.compte_dest_id = c2.id
       WHERE t.compte_source_id = ? OR t.compte_dest_id = ?
       ORDER BY t.date_transaction DESC`,
      [compteId, compteId]
    );
    
    ws.send(JSON.stringify({ type: 'export_data', data: transactions, format }));
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', message: 'Erreur export transactions' }));
  }
}

async function handleSearchUser(ws, data) {
  ws.send(JSON.stringify({ type: 'error', message: 'Action interdite' }));
}

async function handleBroadcastMessage(ws, data) {
  ws.send(JSON.stringify({ type: 'error', message: 'Action interdite' }));
}

// 🔓 VULNÉRABILITÉ CRITIQUE: Expose TOUTES les données de TOUS les utilisateurs
// Pas de vérification d'autorisation - N'importe quel utilisateur peut voir les données des autres
async function handleGetAllUsersData(ws) {
  ws.send(JSON.stringify({ type: 'error', message: 'Action interdite' }));
}

async function handleAdminCommand(ws, data) {
  ws.send(JSON.stringify({ type: 'error', message: 'Action interdite' }));
}

function notifyUser(userId, message) {
  wss.clients.forEach(client => {
    if (client.userId === userId && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

initDatabase().then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
  });
});
