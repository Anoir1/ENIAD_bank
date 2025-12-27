# 🏦 SecureBank - Application Bancaire en Ligne

## 📋 Description

Application bancaire complète avec authentification sécurisée, gestion de comptes, virements entre utilisateurs et notifications temps réel via WebSocket.

## 🚀 Fonctionnalités

### ✅ Authentification
- Inscription avec cryptage BCrypt des mots de passe
- Connexion sécurisée avec sessions
- Déconnexion propre

### 💰 Gestion Bancaire
- Consultation du solde en temps réel
- IBAN unique généré automatiquement
- Historique complet des transactions
- Virements inter-utilisateurs instantanés

### 🔔 Notifications Temps Réel
- WebSocket pour communications bidirectionnelles
- Alertes instantanées lors de virements reçus
- Confirmations de virements envoyés
- Activité bancaire simulée

### 🗄️ Base de Données
- SQLite pour la persistance des données
- Tables : users, transactions, notifications
- Relations entre entités
- Intégrité référentielle

## 📦 Installation

```bash
cd "projet reseau"
npm install
npm start
```

## 🌐 Accès

**URL :** http://localhost:5000

**Comptes de démonstration :**
- Alice : `alice@bank.com` / `alice123` (Solde: 5000€)
- Bob : `bob@bank.com` / `bob123` (Solde: 3200€)
- Charlie : `charlie@bank.com` / `charlie123` (Solde: 8750€)

## 🛠️ Technologies

- **Backend :** Node.js, Express.js
- **WebSocket :** ws library
- **Base de données :** SQLite3
- **Authentification :** express-session, bcrypt
- **Frontend :** HTML5, CSS3, JavaScript vanilla

## 📁 Structure du Projet

```
projet reseau/
├── server.js              # Serveur Express + WebSocket
├── database.js            # Gestion de la base de données
├── banque.db             # Base SQLite (générée auto)
├── package.json
└── public/
    ├── login.html        # Page de connexion
    ├── login.js          # Logique authentification
    ├── dashboard.html    # Tableau de bord
    ├── dashboard.js      # Logique dashboard
    └── styles.css        # Styles CSS
```

## 🔐 Sécurité

- Mots de passe cryptés avec BCrypt (10 rounds)
- Sessions sécurisées avec cookies
- Validation des entrées utilisateur
- Protection CSRF (Cross-Site Request Forgery)
- Transactions SQL avec paramètres liés
- WebSocket avec authentification

## 🔄 API Endpoints

### Authentification
- `POST /api/register` - Créer un compte
- `POST /api/login` - Se connecter
- `POST /api/logout` - Se déconnecter

### Compte
- `GET /api/account` - Informations du compte
- `GET /api/transactions` - Historique des transactions
- `POST /api/virement` - Effectuer un virement

### Recherche
- `GET /api/users` - Liste des utilisateurs
- `GET /api/search-user?q=` - Rechercher un utilisateur

## 📊 WebSocket Events

### Client → Serveur
- `auth` - Authentification WebSocket
- `broadcast_message` - Envoyer un message global

### Serveur → Client
- `auth_success` - Confirmation d'authentification
- `virement_envoye` - Notification virement envoyé
- `virement_recu` - Notification virement reçu
- `activite_bancaire` - Activité bancaire simulée
- `broadcast` - Message global reçu

## 👨‍💻 Développement

```bash
# Démarrer en mode développement
npm start

# Arrêter le serveur
Ctrl + C
```

## 📝 Utilisation

1. **Inscription :**
   - Allez sur la page d'accueil
   - Cliquez sur "Inscription"
   - Remplissez le formulaire
   - Votre compte est créé avec 1000€

2. **Virements :**
   - Connectez-vous
   - Allez dans "Virement"
   - Entrez l'IBAN du destinataire
   - Entrez le montant
   - Confirmez

3. **Historique :**
   - Consultez toutes vos transactions
   - Voir les virements envoyés/reçus
   - Détails complets avec dates

## 🎯 Cas d'Usage

### Virement entre Alice et Bob

1. Alice se connecte
2. Alice va dans "Virement"
3. Alice entre l'IBAN de Bob (visible dans la liste des utilisateurs)
4. Alice envoie 100€
5. Les deux utilisateurs reçoivent une notification instantanée
6. Les soldes sont mis à jour en temps réel

## 🔍 Tests

Pour tester l'application :

1. Ouvrez plusieurs onglets avec différents comptes
2. Effectuez des virements
3. Observez les notifications temps réel
4. Vérifiez l'historique des transactions

## ⚡ Performance

- Connexions WebSocket persistantes
- Mise à jour en temps réel
- Pas de rechargement de page nécessaire
- Réponses instantanées

## 🆘 Support

Pour toute question ou problème :
- Vérifiez que le serveur est démarré
- Consultez les logs du serveur
- Vérifiez la console du navigateur (F12)

## 📄 Licence

Application de démonstration - Tous droits réservés © 2025

---

**Développé avec ❤️ pour l'apprentissage du développement web full-stack**
