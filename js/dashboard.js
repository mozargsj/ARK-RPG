/* ─── DASHBOARD ─── */
  async function loadDashboard() {
    const u = currentUser;
   
    document.getElementById('dash-avatar').src = u.photoURL || '';
    document.getElementById('btn-admin-panel').style.display = currentRole === 'admin' ? '' : 'none';
    document.getElementById('dash-viewing-own').style.display = (currentRole === 'admin' || currentRole === 'master') ? '' : 'none';    
    document.getElementById('dash-name').textContent = u.displayName || u.email;
    const badge = document.getElementById('dash-role-badge');
    badge.textContent = currentRole === 'admin' ? 'Admin' : 'Mestre';
    badge.className = 'role-badge ' + (currentRole === 'admin' ? 'role-admin' : 'role-master');
    document.getElementById('btn-admin-panel').style.display = currentRole === 'admin' ? '' : 'none';

    const grid = document.getElementById('player-grid');
    grid.innerHTML = '<div class="dash-empty">Carregando fichas...</div>';

    // Load all non-admin users for master/admin view
    let usersSnap;
    try {
      usersSnap = await db.collection('users').get();
    } catch(e) {
      grid.innerHTML = '<div class="dash-empty">Erro ao carregar jogadores. Verifique as regras do Firestore.</div>';
      return;
    }

    const players = usersSnap.docs
      .map(d => d.data())
      .filter(u => u.role === 'player' || u.uid === currentUser.uid);

    if (!players.length) {
      grid.innerHTML = '<div class="dash-empty">Nenhum jogador ainda. Aguarde os players fazerem login.</div>';
      return;
    }

    // Load sheet summaries
    grid.innerHTML = '';
    for (const player of players) {
      const card = await buildPlayerCard(player);
      grid.appendChild(card);
    }
  }

  async function buildPlayerCard(player) {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.onclick = () => openPlayerSheet(player.uid, player.displayName);

    let charName = '—', charLevel = '?', charHp = '?';
    try {
      const sheetSnap = await db.collection('sheets').doc(player.uid).get();
      if (sheetSnap.exists) {
        const ss = sheetSnap.data().sheetStore;
        if (ss && ss.tabs && ss.tabs.length) {
          const activeTab = ss.tabs.find(t => t.id === ss.activeId) || ss.tabs[0];
          if (activeTab && activeTab.data) {
            charName  = activeTab.data.nome  || activeTab.name || '—';
            charLevel = activeTab.data.nivel || '1';
            charHp    = activeTab.data.vidaAtual !== undefined ? activeTab.data.vidaAtual : '?';
          }
        }
      }
    } catch(e) {}

    card.innerHTML = `
      <div class="player-card-header">
        <img class="player-card-avatar" src="${player.photoURL || ''}" alt="" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22><rect width=%2240%22 height=%2240%22 fill=%22%230a1a2a%22/><text x=%2250%%22 y=%2255%%22 text-anchor=%22middle%22 fill=%22%237de7ff%22 font-size=%2218%22>?</text></svg>'" />
        <div class="player-card-info">
          <div class="player-card-name">${player.displayName || player.email}</div>
          <div class="player-card-email">${player.email}</div>
          <div class="player-card-char">⚔ ${charName}</div>
        </div>
      </div>
      <div class="player-card-stats">
        <div class="player-card-stat"><div class="label">Nível</div><div class="val">${charLevel}</div></div>
        <div class="player-card-stat"><div class="label">HP</div><div class="val">${charHp}</div></div>
        <div class="player-card-stat"><div class="label">Abas</div><div class="val">${(await getTabCount(player.uid))}</div></div>
      </div>
      <div class="player-card-action">→ Ver ficha completa</div>
    `;
    return card;
  }

  async function getTabCount(uid) {
    try {
      const snap = await db.collection('sheets').doc(uid).get();
      if (snap.exists && snap.data().sheetStore && snap.data().sheetStore.tabs) return snap.data().sheetStore.tabs.length;
    } catch(e) {}
    return 0;
  }

  async function openPlayerSheet(uid, name) {
    viewingUid = uid;
    isReadOnly = true;
    document.getElementById('viewing-player-name').textContent = name || uid;
    document.getElementById('btn-back-to-dash').style.display = '';
    document.getElementById('readonly-banner').classList.add('visible');
    document.getElementById('sheet-topbar-actions').style.display = 'none';
    document.getElementById('sheet-subtitle').textContent = `Visualizando ficha de ${name || uid} — somente leitura`;

    await initSheetForUser(uid, true);
    showScreen('sheet');
  }

  async function goToOwnSheet() {
    viewingUid = null;
    isReadOnly = false;
    document.getElementById('readonly-banner').classList.remove('visible');
    document.getElementById('btn-back-to-dash').style.display = (currentRole === 'admin' || currentRole === 'master') ? '' : 'none';    
    document.getElementById('sheet-topbar-actions').style.display = '';
    document.getElementById('sheet-subtitle').textContent = 'Salva automaticamente na nuvem.';
   
    await initSheetForUser(currentUser.uid, false);
    showScreen('sheet');
  }  
  
  function backToDashboard() {
    viewingUid = null;
    isReadOnly = false;
    loadDashboard().then(() => showScreen('dashboard'));
  }

  function showDashboard() {
    loadDashboard().then(() => showScreen('dashboard'));
  }

  /* ─── ADMIN PANEL ─── */
  function showAdminPanel() {
    document.getElementById('admin-avatar').src = currentUser.photoURL || '';
    document.getElementById('admin-name').textContent = currentUser.displayName || currentUser.email;
    loadUsersList().then(() => showScreen('admin'));
  }

  async function loadUsersList() {
    const list = document.getElementById('users-list');
    list.innerHTML = 'Carregando...';
    const snap = await db.collection('users').get();
    list.innerHTML = '';
    snap.docs.forEach(doc => {
      const u = doc.data();
      if (u.uid === currentUser.uid) return; // skip self
      const row = document.createElement('div');
      row.className = 'user-row';
      row.innerHTML = `
        <img src="${u.photoURL || ''}" alt="" onerror="this.src=''" />
        <div class="user-info">
          <div class="uname">${u.displayName || u.email}</div>
          <div class="uemail">${u.email}</div>
        </div>
        <select class="user-role-select" data-uid="${u.uid}">
          <option value="player" ${u.role==='player'?'selected':''}>Jogador</option>
          <option value="master" ${u.role==='master'?'selected':''}>Mestre</option>
          <option value="admin"  ${u.role==='admin'?'selected':''}>Admin</option>
        </select>
        <button class="btn-save-role" onclick="saveUserRole('${u.uid}')">Salvar</button>
      `;
      list.appendChild(row);
    });
  }

  async function saveUserRole(uid) {
    const sel = document.querySelector(`[data-uid="${uid}"]`);
    if (!sel) return;
    try {
      await db.collection('users').doc(uid).update({ role: sel.value });
      alert('Role atualizado com sucesso!');
    } catch(e) {
      alert('Erro ao salvar. Verifique as regras do Firestore.');
    }
  }
