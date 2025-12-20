const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

// Configuration MySQL (XAMPP par défaut)
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'securebank',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Initialiser la base de données
async function initDatabase() {
  try {
    // Connexion sans spécifier la base de données pour la créer
    const tempPool = mysql.createPool({
      host: 'localhost',
      user: 'root',
      password: '',
      waitForConnections: true,
      connectionLimit: 10
    });
    
    const tempConn = await tempPool.getConnection();
    await tempConn.query('CREATE DATABASE IF NOT EXISTS securebank');
    tempConn.release();
    await tempPool.end();
    
    const connection = await pool.getConnection();
    
    // Tables (voir contenu complet ci-dessus)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        nom VARCHAR(100) NOT NULL,
        prenom VARCHAR(100) NOT NULL,
        telephone VARCHAR(20),
        date_naissance DATE,
        adresse TEXT,
        date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        derniere_connexion TIMESTAMP NULL,
        statut ENUM('actif', 'suspendu') DEFAULT 'actif',
        INDEX idx_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS comptes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        numero_compte VARCHAR(30) UNIQUE NOT NULL,
        iban VARCHAR(34) UNIQUE NOT NULL,
        type_compte ENUM('courant', 'epargne') DEFAULT 'courant',
        solde DECIMAL(15,2) DEFAULT 1000.00,
        devise VARCHAR(3) DEFAULT 'EUR',
        taux_interet DECIMAL(5,2) DEFAULT 0.00,
        date_ouverture TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        statut ENUM('actif', 'bloque') DEFAULT 'actif',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS cartes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        compte_id INT NOT NULL,
        numero_carte VARCHAR(19) UNIQUE NOT NULL,
        type_carte ENUM('visa', 'mastercard') DEFAULT 'visa',
        titulaire VARCHAR(100) NOT NULL,
        date_expiration DATE NOT NULL,
        cvv VARCHAR(3) NOT NULL,
        plafond_jour DECIMAL(10,2) DEFAULT 500.00,
        statut ENUM('active', 'bloquee') DEFAULT 'active',
        date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (compte_id) REFERENCES comptes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        compte_source_id INT NOT NULL,
        compte_dest_id INT,
        type_transaction ENUM('virement', 'depot', 'retrait', 'paiement_carte') NOT NULL,
        montant DECIMAL(15,2) NOT NULL,
        description TEXT,
        date_transaction TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        statut ENUM('effectuee', 'rejetee') DEFAULT 'effectuee',
        solde_avant DECIMAL(15,2),
        solde_apres DECIMAL(15,2),
        FOREIGN KEY (compte_source_id) REFERENCES comptes(id) ON DELETE CASCADE,
        FOREIGN KEY (compte_dest_id) REFERENCES comptes(id) ON DELETE SET NULL,
        INDEX idx_date (date_transaction)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS beneficiaires (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        nom VARCHAR(100) NOT NULL,
        prenom VARCHAR(100),
        iban VARCHAR(34) NOT NULL,
        favori BOOLEAN DEFAULT FALSE,
        date_ajout TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        titre VARCHAR(200) NOT NULL,
        message TEXT NOT NULL,
        type ENUM('info', 'alerte', 'virement', 'securite') DEFAULT 'info',
        lu BOOLEAN DEFAULT FALSE,
        date_notification TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log('✓ Structure de la base de données créée');
    
    await createDemoData(connection);
    connection.release();
    console.log('✓ Données de démonstration créées');
    
  } catch (error) {
    console.error('Erreur DB:', error.message);
    throw error;
  }
}

async function createDemoData(connection) {
  try {
    const [users] = await connection.query('SELECT COUNT(*) as count FROM users');
    if (users[0].count > 0) return;

    const hashedPassword = await bcrypt.hash('demo123', 10);
    const hashedPasswordAnouar = await bcrypt.hash('anouar123', 10);
    
    // Créer Anouar Belabbes en premier avec beaucoup de données
    const [anouarResult] = await connection.query(
      `INSERT INTO users (email, password, nom, prenom, telephone, adresse) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['anoir.belabbes14@gmail.com', hashedPasswordAnouar, 'Belabbes', 'Anouar', '0698765432', '123 Rue de Paris, 75001 Paris']
    );
    
    const anouarId = anouarResult.insertId;
    
    // Compte courant principal pour Anouar - solde élevé
    const [compteCourant] = await connection.query(
      'INSERT INTO comptes (user_id, numero_compte, iban, type_compte, solde) VALUES (?, ?, ?, ?, ?)',
      [anouarId, generateAccountNumber(), 'FR76 3000 4000 0500 0012 3456 789', 'courant', 45750.85]
    );
    
    // Compte épargne pour Anouar
    const [compteEpargne] = await connection.query(
      'INSERT INTO comptes (user_id, numero_compte, iban, type_compte, solde, taux_interet) VALUES (?, ?, ?, ?, ?, ?)',
      [anouarId, generateAccountNumber(), 'FR76 3000 4000 0500 0098 7654 321', 'epargne', 125000.00, 2.5]
    );
    
    // Carte Visa Gold pour compte courant
    await connection.query(
      'INSERT INTO cartes (compte_id, numero_carte, type_carte, titulaire, date_expiration, cvv, plafond_jour) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [compteCourant.insertId, '4532 8521 6325 4789', 'visa', 'ANOUAR BELABBES', '2028-12-31', '852', 2000.00]
    );
    
    // Carte Mastercard Black pour compte épargne
    await connection.query(
      'INSERT INTO cartes (compte_id, numero_carte, type_carte, titulaire, date_expiration, cvv, plafond_jour) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [compteEpargne.insertId, '5412 7534 8521 9632', 'mastercard', 'ANOUAR BELABBES', '2029-06-30', '741', 5000.00]
    );
    
    // Bénéficiaires pour Anouar
    const beneficiaires = [
      { nom: 'Martin', prenom: 'Alice', iban: 'FR76 1234 5678 9012 3456 7890 123', favori: true },
      { nom: 'Durand', prenom: 'Bob', iban: 'FR76 9876 5432 1098 7654 3210 987', favori: true },
      { nom: 'EDF', prenom: 'Energie', iban: 'FR76 3000 1234 5678 9012 3456 789', favori: false },
      { nom: 'Orange', prenom: 'Telecom', iban: 'FR76 2000 9876 5432 1098 7654 321', favori: false },
      { nom: 'Propriétaire', prenom: 'Loyer', iban: 'FR76 1500 4567 8901 2345 6789 012', favori: true },
      { nom: 'Assurance', prenom: 'AXA', iban: 'FR76 1800 7890 1234 5678 9012 345', favori: false },
      { nom: 'Salle Sport', prenom: 'FitnessPark', iban: 'FR76 1700 3456 7890 1234 5678 901', favori: false },
      { nom: 'Netflix', prenom: 'Abonnement', iban: 'FR76 1600 6789 0123 4567 8901 234', favori: false }
    ];
    
    for (const b of beneficiaires) {
      await connection.query(
        'INSERT INTO beneficiaires (user_id, nom, prenom, iban, favori) VALUES (?, ?, ?, ?, ?)',
        [anouarId, b.nom, b.prenom, b.iban, b.favori]
      );
    }
    
    // Beaucoup de transactions pour Anouar (historique riche)
    const transactions = [
      { type: 'depot', montant: 3500.00, desc: 'Salaire Décembre 2025' },
      { type: 'virement', montant: -1200.00, desc: 'Loyer Décembre' },
      { type: 'paiement_carte', montant: -89.99, desc: 'Courses Carrefour' },
      { type: 'paiement_carte', montant: -45.50, desc: 'Restaurant Le Petit Bistro' },
      { type: 'virement', montant: -150.00, desc: 'Remboursement Alice' },
      { type: 'depot', montant: 500.00, desc: 'Virement reçu de Bob' },
      { type: 'paiement_carte', montant: -29.99, desc: 'Abonnement Netflix' },
      { type: 'paiement_carte', montant: -65.00, desc: 'Essence Total' },
      { type: 'virement', montant: -85.00, desc: 'Facture EDF' },
      { type: 'paiement_carte', montant: -120.00, desc: 'Shopping Zara' },
      { type: 'depot', montant: 3500.00, desc: 'Salaire Novembre 2025' },
      { type: 'virement', montant: -1200.00, desc: 'Loyer Novembre' },
      { type: 'paiement_carte', montant: -250.00, desc: 'Billet avion Paris-Lyon' },
      { type: 'paiement_carte', montant: -35.00, desc: 'Abonnement Spotify' },
      { type: 'virement', montant: -500.00, desc: 'Épargne mensuelle' },
      { type: 'paiement_carte', montant: -78.50, desc: 'Pharmacie' },
      { type: 'depot', montant: 200.00, desc: 'Remboursement Sécurité Sociale' },
      { type: 'paiement_carte', montant: -42.00, desc: 'Abonnement FitnessPark' },
      { type: 'paiement_carte', montant: -95.00, desc: 'Facture téléphone Orange' },
      { type: 'virement', montant: -300.00, desc: 'Cadeau anniversaire maman' },
      { type: 'depot', montant: 1500.00, desc: 'Prime fin année' },
      { type: 'paiement_carte', montant: -180.00, desc: 'Courses Auchan' },
      { type: 'paiement_carte', montant: -55.00, desc: 'Coiffeur' },
      { type: 'virement', montant: -400.00, desc: 'Assurance auto AXA' },
      { type: 'paiement_carte', montant: -22.50, desc: 'Uber' }
    ];
    
    const baseDate = new Date();
    for (let i = 0; i < transactions.length; i++) {
      const t = transactions[i];
      const transDate = new Date(baseDate);
      transDate.setDate(transDate.getDate() - i * 2);
      
      await connection.query(
        `INSERT INTO transactions (compte_source_id, type_transaction, montant, description, date_transaction, statut) 
         VALUES (?, ?, ?, ?, ?, 'effectuee')`,
        [compteCourant.insertId, t.type, Math.abs(t.montant), t.desc, transDate]
      );
    }
    
    // Notifications pour Anouar
    const notifications = [
      { titre: 'Bienvenue !', message: 'Bienvenue sur SecureBank Pro, Anouar !', type: 'info' },
      { titre: 'Virement reçu', message: 'Vous avez reçu 500€ de Bob Durand', type: 'virement' },
      { titre: 'Salaire crédité', message: 'Votre salaire de 3500€ a été crédité', type: 'virement' },
      { titre: 'Alerte sécurité', message: 'Nouvelle connexion détectée depuis Paris', type: 'securite' },
      { titre: 'Plafond carte', message: 'Vous avez atteint 80% de votre plafond journalier', type: 'alerte' }
    ];
    
    for (const n of notifications) {
      await connection.query(
        'INSERT INTO notifications (user_id, titre, message, type) VALUES (?, ?, ?, ?)',
        [anouarId, n.titre, n.message, n.type]
      );
    }
    
    // Autres utilisateurs de démo
    const demoUsers = [
      { email: 'alice.martin@email.com', nom: 'Martin', prenom: 'Alice', tel: '0612345678' },
      { email: 'bob.durand@email.com', nom: 'Durand', prenom: 'Bob', tel: '0687654321' },
      { email: 'charlie.bernard@email.com', nom: 'Bernard', prenom: 'Charlie', tel: '0698765432' }
    ];

    for (const user of demoUsers) {
      const [result] = await connection.query(
        'INSERT INTO users (email, password, nom, prenom, telephone) VALUES (?, ?, ?, ?, ?)',
        [user.email, hashedPassword, user.nom, user.prenom, user.tel]
      );
      
      const userId = result.insertId;
      
      const numCompte = generateAccountNumber();
      const iban = generateIBAN();
      const [compteResult] = await connection.query(
        'INSERT INTO comptes (user_id, numero_compte, iban, type_compte, solde) VALUES (?, ?, ?, ?, ?)',
        [userId, numCompte, iban, 'courant', 5000 + Math.random() * 10000]
      );
      
      const compteId = compteResult.insertId;
      
      const numCarte = generateCardNumber();
      const cvv = Math.floor(Math.random() * 900 + 100).toString();
      const expiration = new Date();
      expiration.setFullYear(expiration.getFullYear() + 3);
      
      await connection.query(
        'INSERT INTO cartes (compte_id, numero_carte, titulaire, date_expiration, cvv) VALUES (?, ?, ?, ?, ?)',
        [compteId, numCarte, `${user.prenom} ${user.nom}`.toUpperCase(), expiration, cvv]
      );
    }
    
  } catch (error) {
    console.error('Erreur création données:', error.message);
  }
}

function generateAccountNumber() {
  return '3000' + Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
}

function generateIBAN() {
  const countryCode = 'FR';
  const checkDigits = Math.floor(Math.random() * 90 + 10);
  const bankCode = Math.floor(Math.random() * 90000 + 10000);
  const branchCode = Math.floor(Math.random() * 90000 + 10000);
  const accountNumber = Math.floor(Math.random() * 90000000000 + 10000000000);
  const key = Math.floor(Math.random() * 90 + 10);
  return `${countryCode}${checkDigits} ${bankCode} ${branchCode} ${accountNumber} ${key}`;
}

function generateCardNumber() {
  const prefix = '4532'; // Visa
  const middle = Math.floor(Math.random() * 1000000000000).toString().padStart(12, '0');
  return prefix + middle;
}

module.exports = { pool, initDatabase, generateAccountNumber, generateIBAN };
