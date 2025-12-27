let ws;
let currentUser = {};
let currentAccounts = [];
let currentTransactions = [];
let currentCards = [];
let currentBeneficiaries = [];
let currentProfile = {};

function getWebSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeHtmlAttr(value) {
    return escapeHtml(value);
}

function safeAccountStatus(value) {
    return value === 'actif' ? 'actif' : 'bloque';
}

function safeTransactionType(value) {
    const allowed = new Set(['virement', 'depot', 'retrait', 'paiement_carte']);
    return allowed.has(value) ? value : 'transaction';
}

document.addEventListener('DOMContentLoaded', () => {
    const sessionToken = localStorage.getItem('sessionToken');
    const userName = localStorage.getItem('userName');
    
    if (!sessionToken) {
        window.location.href = '/login.html';
        return;
    }
    
    document.getElementById('userName').textContent = userName || 'Utilisateur';
    connectWebSocket(sessionToken);
    initNavigation();
    initForms();
    initPreferences();
    initPasswordStrength();
    initFilters();
    initSafeActionHandlers();
    initCspUiHandlers();
});

function initCspUiHandlers() {
    document.getElementById('notifications-btn')?.addEventListener('click', () => {
        showNotifications();
    });

    document.querySelectorAll('.quick-action-btn[data-quick-section]').forEach(btn => {
        btn.addEventListener('click', () => {
            const section = btn.getAttribute('data-quick-section');
            if (section) {
                window.showSection(section);
            }
        });
    });

    document.getElementById('export-btn')?.addEventListener('click', () => {
        exportTransactions();
    });
}

function connectWebSocket(sessionToken) {
    ws = new WebSocket(getWebSocketUrl());
    
    ws.onopen = () => {
        console.log('Connecté au serveur');
        ws.send(JSON.stringify({ type: 'auth', data: { sessionToken } }));
    };
    
    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
    };
    
    ws.onerror = (error) => {
        console.error('Erreur WebSocket:', error);
        showToast('Erreur de connexion au serveur', 'error');
    };
    
    ws.onclose = () => {
        console.log('Déconnecté du serveur');
        setTimeout(() => connectWebSocket(sessionToken), 3000);
    };
}

function initSafeActionHandlers() {
    document.addEventListener('click', (e) => {
        const copyBtn = e.target.closest('.copy-btn');
        if (copyBtn && copyBtn.dataset.iban) {
            copyIban(copyBtn.dataset.iban);
            return;
        }

        const ribBtn = e.target.closest('.rib-btn');
        if (ribBtn) {
            const iban = ribBtn.dataset.iban || '';
            const numero = ribBtn.dataset.numero || '';
            downloadRIB(iban, numero);
            return;
        }

        const useIbanBtn = e.target.closest('.use-iban-btn');
        if (useIbanBtn && useIbanBtn.dataset.iban) {
            useIban(useIbanBtn.dataset.iban);
        }
    });
}

function handleWebSocketMessage(message) {
    switch (message.type) {
        case 'auth_success':
            currentUser = message.data.user;
            loadAllData();
            break;
            
        case 'accounts':
            currentAccounts = message.data;
            updateAccountsDisplay();
            updateAccountSelect();
            updateProfileStats();
            break;
            
        case 'transactions':
            currentTransactions = message.data;
            updateTransactionsDisplay();
            break;
            
        case 'cards':
            currentCards = message.data;
            updateCardsDisplay();
            updateProfileStats();
            break;
            
        case 'beneficiaries':
            currentBeneficiaries = message.data;
            updateBeneficiariesDisplay();
            updateProfileStats();
            break;
            
        case 'stats':
            updateStatsDisplay(message.data);
            break;
            
        case 'notifications':
            updateNotificationBadge(message.data);
            break;
            
        case 'notification':
            showNotificationPopup(message.data);
            loadAllData();
            break;
            
        case 'transfer_success':
            showToast('Virement effectué avec succès !', 'success');
            document.getElementById('transfer-form').reset();
            loadAllData();
            break;
            
        case 'beneficiary_added':
            showToast('Bénéficiaire ajouté avec succès !', 'success');
            document.getElementById('beneficiary-form').reset();
            ws.send(JSON.stringify({ type: 'get_beneficiaries' }));
            break;

        case 'beneficiary_deleted':
            showToast('Bénéficiaire supprimé !', 'success');
            ws.send(JSON.stringify({ type: 'get_beneficiaries' }));
            break;
            
        case 'profile':
            currentProfile = message.data;
            updateProfileForm();
            break;

        case 'profile_updated':
            showToast('Profil mis à jour avec succès !', 'success');
            localStorage.setItem('userName', `${message.data.prenom} ${message.data.nom}`);
            document.getElementById('userName').textContent = `${message.data.prenom} ${message.data.nom}`;
            break;

        case 'password_changed':
            showToast('Mot de passe modifié avec succès !', 'success');
            document.getElementById('password-form').reset();
            document.getElementById('strength-bar').className = 'strength-bar';
            document.getElementById('strength-text').textContent = 'Force du mot de passe';
            break;

        case 'card_blocked':
            showToast('Carte bloquée avec succès', 'success');
            ws.send(JSON.stringify({ type: 'get_cards' }));
            break;

        case 'card_unblocked':
            showToast('Carte débloquée avec succès', 'success');
            ws.send(JSON.stringify({ type: 'get_cards' }));
            break;

        case 'export_transactions':
            downloadTransactions(message.data);
            break;
            
        case 'broadcast':
            showBroadcastMessage(message.data.message);
            break;
            
        case 'search_results':
            console.table(message.data);
            break;
            
        case 'admin_response':
            console.log('Réponse admin:', message.data);
            console.table(message.data);
            break;
            
        case 'error':
            showToast(message.message, 'error');
            break;
    }
}

function loadAllData() {
    ws.send(JSON.stringify({ type: 'get_accounts' }));
    ws.send(JSON.stringify({ type: 'get_cards' }));
    ws.send(JSON.stringify({ type: 'get_beneficiaries' }));
    ws.send(JSON.stringify({ type: 'get_stats' }));
    ws.send(JSON.stringify({ type: 'get_notifications' }));
    ws.send(JSON.stringify({ type: 'get_profile' }));
}

function initNavigation() {
    document.querySelectorAll('.nav-item[data-section]').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            const section = item.getAttribute('data-section');
            showSection(section);
        });
    });
    
    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.clear();
        if (ws) ws.close();
        window.location.href = '/login.html';
    });
}

// Expose showSection globally for quick action buttons
window.showSection = function(section) {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[data-section="${section}"]`);
    if (navItem) navItem.classList.add('active');
    
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const sectionElement = document.getElementById(section);
    if (sectionElement) {
        sectionElement.classList.add('active');
    }
    
    const titles = {
        'overview': 'Vue d\'ensemble',
        'comptes': 'Mes comptes',
        'cartes': 'Mes cartes',
        'virement': 'Virement',
        'beneficiaires': 'Bénéficiaires',
        'historique': 'Historique',
        'profil': 'Paramètres'
    };
    
    document.getElementById('page-title').textContent = titles[section] || 'Dashboard';
    
    if (section === 'historique' && currentAccounts.length > 0) {
        ws.send(JSON.stringify({ 
            type: 'get_transactions',
            data: { compteId: currentAccounts[0].id }
        }));
    }

    if (section === 'profil') {
        ws.send(JSON.stringify({ type: 'get_profile' }));
    }
};

function initForms() {
    document.getElementById('transfer-form').addEventListener('submit', handleTransfer);
    document.getElementById('beneficiary-form').addEventListener('submit', handleAddBeneficiary);
    document.getElementById('profile-form')?.addEventListener('submit', handleUpdateProfile);
    document.getElementById('password-form')?.addEventListener('submit', handleChangePassword);
}

function initPreferences() {
    // Dark mode toggle
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    if (darkModeToggle) {
        const isDark = localStorage.getItem('darkMode') === 'true';
        darkModeToggle.checked = isDark;
        if (isDark) document.body.classList.add('dark-mode');
        
        darkModeToggle.addEventListener('change', (e) => {
            document.body.classList.toggle('dark-mode', e.target.checked);
            localStorage.setItem('darkMode', e.target.checked);
        });
    }

    // Show balance toggle
    const balanceToggle = document.getElementById('show-balance-toggle');
    if (balanceToggle) {
        const showBalance = localStorage.getItem('showBalance') !== 'false';
        balanceToggle.checked = showBalance;
        
        balanceToggle.addEventListener('change', (e) => {
            localStorage.setItem('showBalance', e.target.checked);
            updateAccountsDisplay();
            updateCardsDisplay();
        });
    }
}

function initPasswordStrength() {
    const passwordInput = document.getElementById('new-password');
    if (passwordInput) {
        passwordInput.addEventListener('input', (e) => {
            const strength = calculatePasswordStrength(e.target.value);
            const strengthBar = document.getElementById('strength-bar');
            const strengthText = document.getElementById('strength-text');
            
            strengthBar.className = 'strength-bar ' + strength.class;
            strengthText.textContent = strength.text;
        });
    }
}

function calculatePasswordStrength(password) {
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    
    if (score <= 1) return { class: 'weak', text: 'Faible' };
    if (score <= 2) return { class: 'medium', text: 'Moyen' };
    if (score <= 3) return { class: 'good', text: 'Bon' };
    return { class: 'strong', text: 'Excellent' };
}

function initFilters() {
    const searchInput = document.getElementById('filter-search');
    const typeSelect = document.getElementById('filter-type');
    
    if (searchInput) {
        searchInput.addEventListener('input', filterTransactions);
    }
    if (typeSelect) {
        typeSelect.addEventListener('change', filterTransactions);
    }
}

function filterTransactions() {
    const search = document.getElementById('filter-search')?.value.toLowerCase() || '';
    const type = document.getElementById('filter-type')?.value || '';
    
    let filtered = currentTransactions;
    
    if (search) {
        filtered = filtered.filter(t => 
            (t.description || '').toLowerCase().includes(search) ||
            t.montant.toString().includes(search)
        );
    }
    
    if (type === 'credit') {
        filtered = filtered.filter(t => t.compte_dest_id === currentAccounts[0]?.id);
    } else if (type === 'debit') {
        filtered = filtered.filter(t => t.compte_source_id === currentAccounts[0]?.id);
    }
    
    displayFilteredTransactions(filtered);
}

function displayFilteredTransactions(transactions) {
    const container = document.getElementById('transactions-list');
    if (!container) return;
    
    const transactionsHTML = transactions.map(t => {
        const isDebit = t.compte_source_id === currentAccounts[0]?.id;
        return `
            <div class="transaction-item ${safeTransactionType(t.type_transaction)}">
                <div class="transaction-icon">${getTransactionIcon(t.type_transaction)}</div>
                <div class="transaction-details">
                    <div class="transaction-title">${escapeHtml(t.description || getTransactionLabel(t.type_transaction))}</div>
                    <div class="transaction-date">${formatDateTime(t.date_transaction)}</div>
                </div>
                <div class="transaction-amount ${isDebit ? 'debit' : 'credit'}">
                    ${isDebit ? '-' : '+'} ${formatMoney(t.montant)}
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = transactionsHTML || '<p style="padding: 20px; text-align: center; color: #6b7280;">Aucune transaction trouvée</p>';
}

function updateAccountsDisplay() {
    const overviewGrid = document.getElementById('overview-accounts');
    const accountsGrid = document.getElementById('accounts-grid');
    const showBalance = localStorage.getItem('showBalance') !== 'false';
    
    // Simple cards for overview
    const simpleAccountsHTML = currentAccounts.map((account, index) => `
        <div class="account-card animate-card" style="--delay: ${0.1 * (index + 1)}s">
            <div class="account-type">${account.type_compte === 'courant' ? '💳 Compte Courant' : '🏦 Compte Épargne'}</div>
            <div class="account-balance">${showBalance ? formatMoney(account.solde) : '••••••'}</div>
            <div class="account-number">${escapeHtml(account.iban)}</div>
            <div class="account-status ${safeAccountStatus(account.statut)}">${account.statut === 'actif' ? '✓ Actif' : '⚠ Bloqué'}</div>
        </div>
    `).join('');
    
    // Detailed cards for accounts section
    const detailedAccountsHTML = currentAccounts.map((account, index) => `
        <div class="account-card-detailed" style="--delay: ${0.1 * (index + 1)}s">
            <div class="account-header">
                <div class="account-type-badge">
                    ${account.type_compte === 'courant' ? '💳 Compte Courant' : '🏦 Compte Épargne'}
                </div>
                <div class="account-status-indicator ${safeAccountStatus(account.statut)}"></div>
            </div>
            
            <div class="account-balance-section">
                <div class="account-balance-label">Solde disponible</div>
                <div class="account-balance-value">${showBalance ? formatMoney(account.solde) : '••••••'}</div>
            </div>
            
            <div class="account-iban-section">
                <div class="iban-label">IBAN</div>
                <div class="iban-value">
                    <span id="iban-${account.id}">${escapeHtml(account.iban)}</span>
                    <button class="copy-btn" type="button" data-iban="${escapeHtmlAttr(account.iban)}">📋 Copier</button>
                </div>
            </div>
            
            <div class="account-details-grid">
                <div class="account-detail-item">
                    <div class="account-detail-label">Numéro de compte</div>
                    <div class="account-detail-value">${escapeHtml(account.numero_compte)}</div>
                </div>
                <div class="account-detail-item">
                    <div class="account-detail-label">Statut</div>
                    <div class="account-detail-value" style="color: ${account.statut === 'actif' ? '#10b981' : '#ef4444'}">
                        ${account.statut === 'actif' ? '✓ Actif' : '⚠ Bloqué'}
                    </div>
                </div>
                <div class="account-detail-item">
                    <div class="account-detail-label">Type</div>
                    <div class="account-detail-value">${account.type_compte === 'courant' ? 'Courant' : 'Épargne'}</div>
                </div>
                <div class="account-detail-item">
                    <div class="account-detail-label">Devise</div>
                    <div class="account-detail-value">EUR €</div>
                </div>
            </div>
            
            <div class="account-actions">
                <button class="account-action-btn primary" onclick="initiateTransferFrom(${account.id})">
                    💸 Virement
                </button>
                <button class="account-action-btn secondary" onclick="viewAccountHistory(${account.id})">
                    📋 Historique
                </button>
                <button class="account-action-btn secondary rib-btn" type="button" data-iban="${escapeHtmlAttr(account.iban)}" data-numero="${escapeHtmlAttr(account.numero_compte)}">
                    📄 Télécharger RIB
                </button>
            </div>
        </div>
    `).join('');
    
    if (overviewGrid) overviewGrid.innerHTML = simpleAccountsHTML;
    if (accountsGrid) accountsGrid.innerHTML = detailedAccountsHTML;
    
    // Update welcome banner
    updateWelcomeBanner();
}

function updateWelcomeBanner() {
    const welcomeName = document.getElementById('welcome-name');
    const userAvatar = document.getElementById('user-avatar');
    const currentDate = document.getElementById('current-date');
    
    const userName = localStorage.getItem('userName') || 'Utilisateur';
    const nameParts = userName.split(' ');
    const initials = nameParts.map(n => n[0]).join('').toUpperCase().slice(0, 2);
    
    if (welcomeName) welcomeName.textContent = userName.split(' ')[0];
    if (userAvatar) userAvatar.textContent = initials;
    if (currentDate) {
        const now = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        currentDate.textContent = now.toLocaleDateString('fr-FR', options);
    }
}

function copyIban(iban) {
    navigator.clipboard.writeText(iban.replace(/\s/g, '')).then(() => {
        showToast('IBAN copié dans le presse-papier !', 'success');
    }).catch(() => {
        showToast('Erreur lors de la copie', 'error');
    });
}

function initiateTransferFrom(accountId) {
    showSection('virement');
    setTimeout(() => {
        const select = document.getElementById('compte-source');
        if (select) select.value = accountId;
    }, 100);
}

function viewAccountHistory(accountId) {
    showSection('historique');
    ws.send(JSON.stringify({ 
        type: 'get_transactions',
        data: { compteId: accountId }
    }));
}

function downloadRIB(iban, numeroCompte) {
    const userName = localStorage.getItem('userName') || 'Utilisateur';
    
    // Create RIB content
    const ribContent = `
╔══════════════════════════════════════════════════════════════╗
║                    RELEVÉ D'IDENTITÉ BANCAIRE                 ║
║                         SecureBank Pro                        ║
╠══════════════════════════════════════════════════════════════╣
║                                                               ║
║  Titulaire: ${userName.padEnd(47)}║
║                                                               ║
║  IBAN: ${iban.padEnd(52)}║
║                                                               ║
║  Numéro de compte: ${numeroCompte.padEnd(40)}║
║                                                               ║
║  Code BIC: SECUBANKFRPP                                       ║
║                                                               ║
║  Banque: SecureBank Pro                                       ║
║  Adresse: 123 Avenue des Champs-Élysées, 75008 Paris          ║
║                                                               ║
╠══════════════════════════════════════════════════════════════╣
║  Document généré le ${new Date().toLocaleDateString('fr-FR').padEnd(39)}║
╚══════════════════════════════════════════════════════════════╝
    `;
    
    const blob = new Blob([ribContent], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `RIB_SecureBank_${numeroCompte}.txt`;
    link.click();
    
    showToast('RIB téléchargé avec succès !', 'success');
}

function updateAccountSelect() {
    const select = document.getElementById('compte-source');
    if (!select) return;

    select.textContent = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Sélectionnez un compte';
    select.appendChild(defaultOpt);

    currentAccounts.forEach(account => {
        const opt = document.createElement('option');
        opt.value = String(account.id);
        opt.textContent = `${account.type_compte === 'courant' ? 'Compte Courant' : 'Compte Épargne'} - ${formatMoney(account.solde)}`;
        select.appendChild(opt);
    });
}

function updateCardsDisplay() {
    const container = document.getElementById('cards-grid');
    if (!container) return;
    
    container.innerHTML = currentCards.map(card => {
        const cardClass = card.type_carte === 'mastercard' ? 'mastercard' : '';
        const isBlocked = card.statut === 'bloquee';
        return `
            <div class="bank-card ${cardClass}">
                <span class="card-status-badge ${isBlocked ? 'blocked' : 'active'}">
                    ${isBlocked ? '🔒 Bloquée' : '✓ Active'}
                </span>
                <div class="card-header-row">
                    <div class="card-chip"></div>
                    <div class="card-type-logo">${escapeHtml(String(card.type_carte || '').toUpperCase())}</div>
                </div>
                <div class="card-number">${formatCardNumber(card.numero_carte)}</div>
                <div class="card-details">
                    <div class="card-holder">${escapeHtml(card.titulaire)}</div>
                    <div class="card-expiry">
                        <div class="card-expiry-label">Expire</div>
                        <div class="card-expiry-value">${formatCardDate(card.date_expiration)}</div>
                    </div>
                </div>
                <div class="card-actions">
                    ${isBlocked ? `
                        <button class="card-action-btn unblock" onclick="unblockCard(${card.id})">
                            🔓 Débloquer
                        </button>
                    ` : `
                        <button class="card-action-btn block" onclick="blockCard(${card.id})">
                            🔒 Bloquer
                        </button>
                    `}
                </div>
            </div>
        `;
    }).join('');
}

function updateTransactionsDisplay() {
    const container = document.getElementById('transactions-list');
    const recentContainer = document.getElementById('recent-transactions');
    
    const transactionsHTML = currentTransactions.map(t => {
        const isDebit = t.compte_source_id === currentAccounts[0]?.id;
        return `
            <div class="transaction-item ${safeTransactionType(t.type_transaction)}">
                <div class="transaction-icon">${getTransactionIcon(t.type_transaction)}</div>
                <div class="transaction-details">
                    <div class="transaction-title">${escapeHtml(t.description || getTransactionLabel(t.type_transaction))}</div>
                    <div class="transaction-date">${formatDateTime(t.date_transaction)}</div>
                </div>
                <div class="transaction-amount ${isDebit ? 'debit' : 'credit'}">
                    ${isDebit ? '-' : '+'} ${formatMoney(t.montant)}
                </div>
            </div>
        `;
    }).join('');
    
    if (container) container.innerHTML = transactionsHTML || '<p style="padding: 20px; text-align: center; color: #6b7280;">Aucune transaction</p>';
    if (recentContainer) recentContainer.innerHTML = transactionsHTML || '<p style="padding: 20px; text-align: center; color: #6b7280;">Aucune transaction récente</p>';
    
    document.getElementById('transaction-count').textContent = currentTransactions.length;
}

function updateBeneficiariesDisplay() {
    const container = document.getElementById('beneficiaries-grid');
    if (!container) return;
    
    if (currentBeneficiaries.length === 0) {
        container.innerHTML = '<p style="padding: 20px; text-align: center; color: #6b7280;">Aucun bénéficiaire enregistré</p>';
        return;
    }
    
    container.innerHTML = currentBeneficiaries.map(b => `
        <div class="beneficiary-card" style="position: relative;">
            <button class="beneficiary-delete" onclick="deleteBeneficiary(${b.id})" title="Supprimer">✕</button>
            <div class="beneficiary-avatar">${(b.prenom || 'X')[0]}${(b.nom || 'X')[0]}</div>
            <div class="beneficiary-name">${escapeHtml(`${b.prenom || ''} ${b.nom || ''}`.trim())}</div>
            <div class="beneficiary-iban">${escapeHtml(b.iban)}</div>
            <div class="beneficiary-actions">
                <button class="btn btn-sm btn-primary use-iban-btn" type="button" data-iban="${escapeHtmlAttr(b.iban)}">💸 Virer</button>
            </div>
        </div>
    `).join('');
}

function updateStatsDisplay(stats) {
    document.getElementById('total-balance').textContent = formatMoney(stats.total_solde || 0);
    document.getElementById('total-revenus').textContent = formatMoney(stats.total_revenus || 0);
    document.getElementById('total-depenses').textContent = formatMoney(stats.total_depenses || 0);
    document.getElementById('total-transactions').textContent = stats.total_transactions || 0;
}

function updateProfileStats() {
    const statComptes = document.getElementById('stat-comptes');
    const statCartes = document.getElementById('stat-cartes');
    const statBeneficiaires = document.getElementById('stat-beneficiaires');
    const statTransactions = document.getElementById('stat-transactions');
    
    if (statComptes) statComptes.textContent = currentAccounts.length;
    if (statCartes) statCartes.textContent = currentCards.length;
    if (statBeneficiaires) statBeneficiaires.textContent = currentBeneficiaries.length;
    if (statTransactions) statTransactions.textContent = currentTransactions.length;
}

function updateProfileForm() {
    const profile = currentProfile;
    if (!profile) return;
    
    const nomInput = document.getElementById('profile-nom');
    const prenomInput = document.getElementById('profile-prenom');
    const emailInput = document.getElementById('profile-email');
    const telInput = document.getElementById('profile-telephone');
    const adresseInput = document.getElementById('profile-adresse');
    const statInscription = document.getElementById('stat-inscription');
    
    if (nomInput) nomInput.value = profile.nom || '';
    if (prenomInput) prenomInput.value = profile.prenom || '';
    if (emailInput) emailInput.value = profile.email || '';
    if (telInput) telInput.value = profile.telephone || '';
    if (adresseInput) adresseInput.value = profile.adresse || '';
    if (statInscription && profile.date_creation) {
        statInscription.textContent = new Date(profile.date_creation).toLocaleDateString('fr-FR');
    }
}

function updateNotificationBadge(notifications) {
    const unread = notifications.filter(n => !n.lu).length;
    const badge = document.getElementById('notification-badge');
    if (badge) {
        badge.style.display = unread > 0 ? 'block' : 'none';
    }
}

function handleTransfer(e) {
    e.preventDefault();
    
    const compteSourceId = document.getElementById('compte-source').value;
    const ibanDest = document.getElementById('iban-dest').value;
    const montant = document.getElementById('montant').value;
    const description = document.getElementById('description').value;
    
    if (!compteSourceId) {
        showToast('Veuillez sélectionner un compte source', 'error');
        return;
    }
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast('Connexion au serveur perdue', 'error');
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'transfer',
        data: { 
            compteSourceId: parseInt(compteSourceId), 
            ibanDest, 
            montant: parseFloat(montant), 
            description 
        }
    }));
}

function handleAddBeneficiary(e) {
    e.preventDefault();
    
    const nom = document.getElementById('beneficiary-nom').value;
    const prenom = document.getElementById('beneficiary-prenom').value;
    const iban = document.getElementById('beneficiary-iban').value;
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast('Connexion au serveur perdue', 'error');
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'add_beneficiary',
        data: { nom, prenom, iban }
    }));
}

function useIban(iban) {
    document.getElementById('iban-dest').value = iban;
    document.querySelector('[data-section="virement"]').click();
    showToast('IBAN copié dans le formulaire de virement', 'success');
}

function deleteBeneficiary(id) {
    if (confirm('Supprimer ce bénéficiaire ?')) {
        ws.send(JSON.stringify({
            type: 'delete_beneficiary',
            data: { id }
        }));
    }
}

function handleUpdateProfile(e) {
    e.preventDefault();
    
    const nom = document.getElementById('profile-nom').value;
    const prenom = document.getElementById('profile-prenom').value;
    const telephone = document.getElementById('profile-telephone').value;
    const adresse = document.getElementById('profile-adresse').value;
    
    ws.send(JSON.stringify({
        type: 'update_profile',
        data: { nom, prenom, telephone, adresse }
    }));
}

function handleChangePassword(e) {
    e.preventDefault();
    
    const oldPassword = document.getElementById('old-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    
    if (newPassword !== confirmPassword) {
        showToast('Les mots de passe ne correspondent pas', 'error');
        return;
    }
    
    if (newPassword.length < 6) {
        showToast('Le mot de passe doit contenir au moins 6 caractères', 'error');
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'change_password',
        data: { oldPassword, newPassword }
    }));
}

function blockCard(cardId) {
    if (confirm('Voulez-vous bloquer cette carte ?')) {
        ws.send(JSON.stringify({
            type: 'block_card',
            data: { cardId }
        }));
    }
}

function unblockCard(cardId) {
    if (confirm('Voulez-vous débloquer cette carte ?')) {
        ws.send(JSON.stringify({
            type: 'unblock_card',
            data: { cardId }
        }));
    }
}

function exportTransactions() {
    if (currentAccounts.length === 0) {
        showToast('Aucun compte disponible', 'error');
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'export_transactions',
        data: { compteId: currentAccounts[0].id }
    }));
}

function downloadTransactions(transactions) {
    // Create CSV content
    let csv = 'Date,Type,Description,Montant,Devise\n';
    
    transactions.forEach(t => {
        const isDebit = t.compte_source_id === currentAccounts[0]?.id;
        const montant = isDebit ? -t.montant : t.montant;
        csv += `"${formatDateTime(t.date_transaction)}","${t.type_transaction}","${t.description || ''}","${montant}","EUR"\n`;
    });
    
    // Create download link
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `transactions_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast('Export téléchargé avec succès !', 'success');
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = document.createElement('div');
    icon.className = 'toast-icon';
    icon.textContent = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';

    const content = document.createElement('div');
    content.className = 'toast-content';

    const title = document.createElement('div');
    title.className = 'toast-title';
    title.textContent = type === 'success' ? 'Succès' : type === 'error' ? 'Erreur' : 'Information';

    const msg = document.createElement('div');
    msg.className = 'toast-message';
    msg.textContent = String(message);

    content.appendChild(title);
    content.appendChild(msg);
    toast.appendChild(icon);
    toast.appendChild(content);
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

function showNotificationPopup(data) {
    const popup = document.createElement('div');
    popup.className = 'notification-popup';

    const strong = document.createElement('strong');
    strong.textContent = String(data?.titre ?? '');
    const p = document.createElement('p');
    p.textContent = String(data?.message ?? '');
    popup.appendChild(strong);
    popup.appendChild(p);
    document.body.appendChild(popup);
    
    setTimeout(() => {
        popup.classList.add('fade-out');
        setTimeout(() => popup.remove(), 400);
    }, 5000);
}

function showBroadcastMessage(message) {
    const div = document.createElement('div');
    div.className = 'broadcast-message';
    div.textContent = String(message);
    document.body.appendChild(div);
    
    setTimeout(() => div.remove(), 8000);
}

function showNotifications() {
    showToast('Fonctionnalité en cours de développement', 'info');
}

// Formatage
function formatMoney(amount) {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount || 0);
}

function formatCardNumber(number) {
    return number.replace(/(.{4})/g, '$1 ').trim();
}

function formatCardDate(date) {
    const d = new Date(date);
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
}

function formatDateTime(date) {
    return new Date(date).toLocaleString('fr-FR', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getTransactionIcon(type) {
    const icons = { 'virement': '💸', 'depot': '💰', 'retrait': '🏧', 'paiement_carte': '💳' };
    return icons[type] || '📝';
}

function getTransactionLabel(type) {
    const labels = { 'virement': 'Virement', 'depot': 'Dépôt', 'retrait': 'Retrait', 'paiement_carte': 'Paiement carte' };
    return labels[type] || 'Transaction';
}
