let ws;

document.addEventListener('DOMContentLoaded', () => {
    connectWebSocket();
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));
            document.getElementById(tab + 'Form').classList.add('active');
            document.getElementById('messageBox').innerHTML = '';
        });
    });
});

function connectWebSocket() {
    ws = new WebSocket('ws://localhost:3000');
    
    ws.onopen = () => {
        console.log('Connecté au serveur');
    };
    
    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
    };
    
    ws.onerror = (error) => {
        console.error('Erreur WebSocket:', error);
    };
    
    ws.onclose = () => {
        console.log('Déconnecté');
        setTimeout(connectWebSocket, 3000);
    };
}

function handleWebSocketMessage(message) {
    switch (message.type) {
        case 'login_success':
            localStorage.setItem('userId', message.data.user.id);
            localStorage.setItem('userName', `${message.data.user.prenom} ${message.data.user.nom}`);
            localStorage.setItem('sessionToken', message.data.sessionToken);
            showMessage('Connexion réussie ! Redirection...', 'success');
            setTimeout(() => {
                window.location.href = '/dashboard.html';
            }, 1000);
            break;
            
        case 'register_success':
            showMessage('Inscription réussie ! Vous pouvez vous connecter.', 'success');
            document.querySelector('[data-tab="login"]').click();
            break;
            
        case 'error':
            showMessage(message.message, 'error');
            break;
    }
}

function showMessage(message, type = 'info') {
    const messageBox = document.getElementById('messageBox');
    messageBox.innerHTML = `
        <div class="alert alert-${type}">
            ${type === 'error' ? '❌' : '✓'} ${message}
        </div>
    `;
    
    setTimeout(() => {
        messageBox.innerHTML = '';
    }, 5000);
}

async function handleLogin(event) {
    event.preventDefault();
    
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showMessage('Connexion au serveur en cours...', 'error');
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'login',
        data: { email, password }
    }));
}

async function handleRegister(event) {
    event.preventDefault();
    
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    const nom = document.getElementById('registerNom').value;
    const prenom = document.getElementById('registerPrenom').value;
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showMessage('Connexion au serveur en cours...', 'error');
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'register',
        data: { email, password, nom, prenom }
    }));
}
