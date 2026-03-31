
  /* ════════════════════════════════════════
     SHEET ENGINE (adapted from v17)
  ════════════════════════════════════════ */
  const STORAGE_KEY        = 'ark-rpg-ficha-tabs-v1'; // kept for legacy compat
  const DEFAULT_TAB_NAME   = 'Nova ficha';
  let sheetStore           = { activeId: null, tabs: [] };
  let pendingCloseTabId    = null;
  let pendingImportMode    = 'append';

  const closeTabModal      = document.getElementById('closeTabModal');
  const exportModal        = document.getElementById('exportModal');
  const importModal        = document.getElementById('importModal');
  const replaceImportModal = document.getElementById('replaceImportModal');
  const exportTabsChecklist = document.getElementById('exportTabsChecklist');

  function uniqueId() { return `ficha_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`; }
  function defaultTabName(i=1) { return `${DEFAULT_TAB_NAME} ${i}`; }
  function makeBlankState() { return {}; }
  function getActiveTab() { return sheetStore.tabs.find(t => t.id === sheetStore.activeId) || null; }
  function byId(id) { return document.getElementById(id); }
  function num(id) { const v = parseFloat(byId(id).value); return Number.isFinite(v) ? v : 0; }
  function clamp(v,mn,mx) { return Math.min(mx, Math.max(mn, v)); }

  /* ─── FIRESTORE SAVE (replaces localStorage) ─── */
  function persistSheetStore() {
    if (isReadOnly || !currentUser) return;
    const ind = document.getElementById('save-indicator');
    ind.textContent = '⏳ Salvando...';
    ind.className = 'saving';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await db.collection('sheets').doc(currentUser.uid).set({
          ownerUid:   currentUser.uid,
          ownerName:  currentUser.displayName || currentUser.email,
          ownerEmail: currentUser.email,
          ownerPhoto: currentUser.photoURL || '',
          sheetStore: JSON.parse(JSON.stringify(sheetStore)),
          updatedAt:  firebase.firestore.FieldValue.serverTimestamp()
        });
        ind.textContent = '✓ Salvo';
        ind.className = 'saved';
        setTimeout(() => { ind.className = ''; }, 2500);
      } catch(e) {
        console.error('Save error:', e);
        ind.textContent = '✗ Erro ao salvar';
        ind.className = 'saving';
      }
    }, 1800);
  }

  /* ─── SHEET INIT FROM FIRESTORE ─── */
  async function initSheetForUser(uid, readonly) {
    isReadOnly = readonly;
    viewingUid = readonly ? uid : null;

    try {
      const snap = await db.collection('sheets').doc(uid).get();
      if (snap.exists && snap.data().sheetStore) {
        const stored = snap.data().sheetStore;
        if (stored && Array.isArray(stored.tabs) && stored.tabs.length) {
          sheetStore = stored;
          if (!sheetStore.tabs.some(t => t.id === sheetStore.activeId)) sheetStore.activeId = sheetStore.tabs[0].id;
        } else { initBlankSheetStore(); }
      } else { initBlankSheetStore(); }

      if (snap.exists && snap.data().pointsLocked) {
        lockPointInputs();
      }
      
    } catch(e) { initBlankSheetStore(); }
    
    if (!sheetInitialized) {
      createPerks();
      sheetInitialized = true;
    }
    renderTabs();
    const active = getActiveTab();
    applyStateToForm(active ? active.data : {});
    createInventoryRows(true);
    updateAll();

    if (readonly) applyReadOnlyMode();
    else removeReadOnlyMode();
  }

  function initBlankSheetStore() {
    const firstId = uniqueId();
    sheetStore = { activeId: firstId, tabs: [{ id: firstId, name: defaultTabName(1), data: makeBlankState() }] };
  }

  function applyReadOnlyMode() {
    document.querySelectorAll('#sheet-screen input:not([readonly]), #sheet-screen select, #sheet-screen textarea').forEach(el => {
      el.setAttribute('data-was-enabled', '1');
      el.disabled = true;
    });
    document.querySelectorAll('.tab-close, #addTabBtn, #resetBtn, #importBtn, .resource-side-action button, .resource-main-action button, #applyReceivedDamageBtn, #applyDamageToTargetBtn, #useActionBtn, .postura-btn').forEach(el => {
      el.style.display = 'none';
    });
  }

  function removeReadOnlyMode() {
    document.querySelectorAll('[data-was-enabled]').forEach(el => {
      el.disabled = false;
      el.removeAttribute('data-was-enabled');
    });
    document.querySelectorAll('.tab-close, #addTabBtn, #resetBtn, #importBtn, .resource-side-action button, .resource-main-action button, #applyReceivedDamageBtn, #applyDamageToTargetBtn, .postura-btn').forEach(el => {
      el.style.display = '';
    });
  }

  /* ─── TAB MANAGEMENT ─── */
  function normalizeTabName(name, fi=1) { return (String(name||'').trim()) || defaultTabName(fi); }

  function renderTabs() {
    const bar = byId('tabsBar');
    if (!bar) return;
    bar.innerHTML = '';
    sheetStore.tabs.forEach((tab, i) => {
      const btn = document.createElement('div');
      btn.className = `tab-btn${tab.id === sheetStore.activeId ? ' active' : ''}`;
      btn.dataset.tabId = tab.id;
      btn.innerHTML = `<span class="tab-name">${normalizeTabName(tab.name, i+1)}</span><button type="button" class="tab-close" data-close-tab="${tab.id}" title="Fechar">×</button>`;
      bar.appendChild(btn);
    });
  }
 

  function captureCurrentState() {
    const data = {};
    document.querySelectorAll('[data-save]').forEach(el => {
      if (el.type === 'checkbox') data[el.id || el.dataset.perk] = el.checked;
      else data[el.id] = el.value;
    });
    return data;
  }

  function resetFormToBlank() {
    document.querySelectorAll('[data-save]').forEach(el => {
      if (el.type === 'checkbox') el.checked = false;
      else if (el.type === 'number') el.value = el.defaultValue || '0';
      else el.value = el.defaultValue || '';
    });
    createInventoryRows(true);
  }

  function applyStateToForm(data={}) {
    resetFormToBlank();
    document.querySelectorAll('[data-save]').forEach(el => {
      const key = el.id || el.dataset.perk;
      if (!(key in data)) return;
      if (el.type === 'checkbox') el.checked = !!data[key];
      else if (!el.hasAttribute('data-inventory')) el.value = data[key];
    });
    createInventoryRows(true);
    document.querySelectorAll('[data-save][data-inventory]').forEach(el => {
      const key = el.id || el.dataset.perk;
      if (key in data) el.value = data[key];
    });
  }

  function saveActiveTabState() {
    if (isReadOnly) return;
    const active = getActiveTab();
    if (!active) return;
    active.data = captureCurrentState();
    active.name = normalizeTabName(active.data.nome, sheetStore.tabs.indexOf(active)+1);
    persistSheetStore();
    renderTabs();
  }

  function saveState() { saveActiveTabState(); }

  function createTab(initialData={}, preferredName='') {
    const tab = { id: uniqueId(), name: normalizeTabName(preferredName || initialData.nome, sheetStore.tabs.length+1), data: { ...makeBlankState(), ...initialData } };
    sheetStore.tabs.push(tab);
    sheetStore.activeId = tab.id;
    persistSheetStore();
    renderTabs();
    applyStateToForm(tab.data);
    createInventoryRows(true);
    updateAll();
  }

  function switchTab(tabId) {
    if (tabId === sheetStore.activeId) return;
    saveActiveTabState();
    sheetStore.activeId = tabId;
    const active = getActiveTab();
    if (!active) return;
    persistSheetStore();
    renderTabs();
    applyStateToForm(active.data || {});
    createInventoryRows(true);
    updateAll();
  }

  function sanitizeFilename(name, fb='ficha_ark_rpg') {
    return (String(name||fb).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'_').replace(/^_+|_+$/g,'')||fb);
  }

  function buildWorkspaceExport(tabs) {
    return { exportType:'ark-rpg-workspace', version:1, activeId:tabs[0]?.id||null,
      tabs: tabs.map((t,i) => ({ id:t.id||uniqueId(), name:normalizeTabName(t.name,i+1), data:{...makeBlankState(),...(t.data||{})} })) };
  }

  function downloadJson(filenameBase, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${sanitizeFilename(filenameBase)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function getSelectedExportTabs() { return [...document.querySelectorAll('[data-export-tab]:checked')].map(b=>sheetStore.tabs.find(t=>t.id===b.value)).filter(Boolean); }

  function renderExportChecklist() {
    if (!exportTabsChecklist) return;
    exportTabsChecklist.innerHTML = '';
    sheetStore.tabs.forEach((tab,i) => {
      const label = document.createElement('label');
      label.className = 'checklist-item';
      label.innerHTML = `<input type="checkbox" data-export-tab value="${tab.id}" checked /><span>${normalizeTabName(tab.name,i+1)}</span>`;
      exportTabsChecklist.appendChild(label);
    });
    syncExportChecklistState();
  }

  function syncExportChecklistState() {
    const sep = document.querySelector('input[name="exportMode"]:checked')?.value === 'selected-separate';
    document.querySelectorAll('.checklist-item').forEach(i => i.classList.toggle('disabled',!sep));
    document.querySelectorAll('[data-export-tab]').forEach(b => b.disabled = !sep);
  }

  function openModal(m) { if(!m)return; m.classList.remove('hidden'); m.setAttribute('aria-hidden','false'); }
  function closeModal(m) { if(!m)return; m.classList.add('hidden'); m.setAttribute('aria-hidden','true'); }
  function closeAllSecondaryModals() { closeModal(exportModal); closeModal(importModal); closeModal(replaceImportModal); }

  function normalizeImportedTabs(parsed, fileName='') {
    if (parsed && Array.isArray(parsed.tabs) && parsed.tabs.length) {
      return parsed.tabs.map((t,i) => ({ id:uniqueId(), name:normalizeTabName(t?.name||t?.data?.nome,i+1), data:{...makeBlankState(),...(t?.data||{})} }));
    }
    const fb = fileName.replace(/\.json$/i,'')||parsed?.nome||defaultTabName(sheetStore.tabs.length+1);
    return [{ id:uniqueId(), name:normalizeTabName(parsed?.nome||fb,sheetStore.tabs.length+1), data:{...makeBlankState(),...(parsed||{})} }];
  }

  function appendImportedTabs(tabs) {
    if (!tabs.length) return; saveState();
    tabs.forEach((t,i) => sheetStore.tabs.push({ id:uniqueId(), name:normalizeTabName(t.name,sheetStore.tabs.length+1+i), data:{...makeBlankState(),...(t.data||{})} }));
    sheetStore.activeId = sheetStore.tabs[sheetStore.tabs.length-1].id;
    persistSheetStore(); renderTabs();
    const a=getActiveTab(); applyStateToForm(a?a.data:{}); createInventoryRows(true); updateAll();
  }

  function replaceWorkspaceWithImportedTabs(tabs) {
    if (!tabs.length) return;
    sheetStore = { activeId:tabs[0].id, tabs: tabs.map((t,i) => ({ id:t.id||uniqueId(), name:normalizeTabName(t.name,i+1), data:{...makeBlankState(),...(t.data||{})} })) };
    persistSheetStore(); renderTabs(); applyStateToForm(sheetStore.tabs[0].data||{}); createInventoryRows(true); updateAll();
  }

  /* ─── INVENTORY ─── */
  function inventorySlotCount() { return 5 + Math.max(0, Math.round(num('peso'))); }
  function backpackEnabled()    { const f=byId('mochilaAtiva'); return !!f && f.value==='sim'; }
  function backpackSlotCount()  { if(!backpackEnabled())return 0; return Math.max(0,Math.round(num('mochilaSlots'))); }
  function inventoryValueKey(s,f) { return `inventory_${s}_${f}`; }
  function backpackValueKey(s,f)  { return `backpack_${s}_${f}`; }

  let currentInventorySlots=0, currentBackpackSlots=0;

  function createStorageRows(bodyId, total, keyBuilder, dataAttr) {
    const body=byId(bodyId); if(!body)return;
    const prev={}; body.querySelectorAll(`[${dataAttr}]`).forEach(el=>prev[el.dataset.key]=el.value);
    body.innerHTML='';
    for(let i=1;i<=total;i++){
      const tr=document.createElement('tr');
      tr.innerHTML=`<td><span class="slot-badge">${i}</span></td><td><input data-save ${dataAttr} data-key="${keyBuilder(i,'desc')}" id="${keyBuilder(i,'desc')}" placeholder="Nome do item" /></td><td><input data-save ${dataAttr} data-key="${keyBuilder(i,'qty')}" id="${keyBuilder(i,'qty')}" type="number" min="0" step="1" value="0" /></td><td><input data-save ${dataAttr} data-key="${keyBuilder(i,'unit')}" id="${keyBuilder(i,'unit')}" type="number" min="0" step="0.01" value="0" /></td><td><input id="${keyBuilder(i,'total')}" readonly /></td>`;
      body.appendChild(tr);
    }
    for(const[k,v] of Object.entries(prev)){const el=byId(k);if(el)el.value=v;}
  }

  function createInventoryRows(force=false) {
    const ts=inventorySlotCount();
    if(force||ts!==currentInventorySlots){currentInventorySlots=ts;createStorageRows('inventoryBody',ts,inventoryValueKey,'data-inventory');}
    const tbs=backpackSlotCount();
    const ms=byId('mochilaSection'),mb=byId('mochilaSlotsBox');
    if(ms)ms.style.display=backpackEnabled()?'':'none';
    if(mb)mb.style.display=backpackEnabled()?'':'none';
    if(force||tbs!==currentBackpackSlots){currentBackpackSlots=tbs;createStorageRows('backpackBody',tbs,backpackValueKey,'data-backpack');}
  }

  function collectStorageTotals(total, keyBuilder) {
    let used=0,totalWeight=0;
    for(let i=1;i<=total;i++){
      const desc=byId(keyBuilder(i,'desc')),qty=byId(keyBuilder(i,'qty')),unit=byId(keyBuilder(i,'unit')),tot=byId(keyBuilder(i,'total'));
      if(!desc||!qty||!unit||!tot)continue;
      const q=Math.max(0,parseFloat(qty.value)||0),u=Math.max(0,parseFloat(unit.value)||0),rt=q*u;
      tot.value=rt.toFixed(2).replace(/\.00$/,'');
      if((desc.value||'').trim())used+=1; totalWeight+=rt;
    }
    return{used,totalWeight,totalSlots:total,free:Math.max(0,total-used)};
  }

  function inventoryTotals() {
    const c=collectStorageTotals(inventorySlotCount(),inventoryValueKey);
    const bp=backpackEnabled()?collectStorageTotals(backpackSlotCount(),backpackValueKey):{used:0,totalWeight:0,totalSlots:0,free:0};
    return{character:c,backpack:bp,used:c.used+bp.used,totalWeight:c.totalWeight+bp.totalWeight,totalSlots:c.totalSlots+bp.totalSlots,free:c.free+bp.free};
  }

  /* ─── PERKS ─── */
  const perkData = {
    forca:       [{id:'golpe_firme',nome:'Golpe Firme',efeito:'+10% de dano em ataques corpo a corpo'},{id:'impacto_pesado',nome:'Impacto Pesado',efeito:'+10% de dano com armas pesadas'},{id:'derrubar_gigantes',nome:'Derrubar Gigantes',efeito:'+10% de dano contra criaturas grandes'}],
    destreza:    [{id:'passo_leve',nome:'Passo Leve',efeito:'+1,5 m de movimento'},{id:'reflexo',nome:'Reflexo',efeito:'+5% redução de dano'},{id:'agilidade',nome:'Agilidade',efeito:'-10% custo de stamina em ataques leves'}],
    inteligencia:[{id:'oficio_inicial',nome:'Ofício Inicial',efeito:'+10% velocidade de criação'},{id:'mao_economica',nome:'Mão Econômica',efeito:'-10% custo de materiais'},{id:'ajuste_mestre',nome:'Ajuste de Mestre',efeito:'+5% na qualidade de itens'}],
    peso:        [{id:'mulinha',nome:'Mulinha',efeito:'+25 kg de capacidade'},{id:'organizacao_basica',nome:'Organização Básica',efeito:'-10% em peso dos itens'},{id:'costas_de_ferro',nome:'Costas de Ferro',efeito:'Penalidade de movimento só começa em 90%'}],
    resistencia: [{id:'tourinho',nome:'Tourinho',efeito:'+20 stamina'},{id:'senta_e_respira',nome:'Senta e Respira',efeito:'+2% regen stamina'},{id:'trabalho_consciente',nome:'Trabalho Consciente',efeito:'-10% custo de ações'}],
    constituicao:[{id:'corpo_forte',nome:'Corpo Forte',efeito:'+5% resistência a dano'},{id:'tolerancia_basica',nome:'Tolerância Básica',efeito:'-10% torpor recebido'}]
  };

  function createPerks() {
    const host=byId('perkGrid'); if(!host)return;
    const labels={forca:'Força',destreza:'Destreza',inteligencia:'Inteligência',peso:'Peso',resistencia:'Resistência',constituicao:'Constituição'};
    host.innerHTML='';
    for(const[attr,list] of Object.entries(perkData)){
      const g=document.createElement('div'); g.className='perk-group';
      g.innerHTML=`<div class="attr-head"><strong>${labels[attr]}</strong><span class="pill">requer pelo menos 1 ponto</span></div>`;
      list.forEach(p=>{
        const item=document.createElement('label'); item.className='perk-item';
        item.innerHTML=`<input type="checkbox" data-perk="${p.id}" data-attrreq="${attr}" data-save /><div><div class="perk-title">${p.nome}</div><div class="small">${p.efeito}</div></div>`;
        g.appendChild(item);
      });
      host.appendChild(g);
    }
  }

  function selectedPerks() { return [...document.querySelectorAll('[data-perk]:checked')].map(el=>el.dataset.perk); }
  function hasPerk(id) { return selectedPerks().includes(id); }

  function updatePerkLocks() {
    const total=Math.floor(Math.max(1,Math.round(num('nivel'))||1)/5)+num('perkBonus');
    const used=selectedPerks().length; const noSlots=used>=total;
    document.querySelectorAll('[data-perk]').forEach(b=>{
      const attr=b.dataset.attrreq, av=num(attr), attrBlocked=av<1, slotBlocked=!b.checked&&noSlots;
      b.disabled=attrBlocked||slotBlocked; if(attrBlocked)b.checked=false;
    });
  }

  function attrCost(v) { let t=0; for(let i=1;i<=v;i++)t+=i>80?3:i>50?2:1; return t; }
  function d20Multiplier(r) { if(r>=20)return 2; if(r>=18)return 1.5; if(r>=11)return 1; if(r>=4)return 0.5; return 0.3; }

  function updateBars(curId, max, barId) {
    const cur=clamp(num(curId),0,Math.max(0,max));
    byId(curId).value=cur;
    const pct=max<=0?0:(cur/max)*100;
    byId(barId).style.width=`${clamp(pct,0,100)}%`;
  }

  /* ─── POSTURA ─── */
  function setPostura(p) {
    byId('posturaAtual').value=p;
    document.querySelectorAll('.postura-btn').forEach(b=>b.classList.toggle('active-postura',b.dataset.postura===p));
    updateAll(); saveState();
  }

  /* ─── MAIN UPDATE FUNCTION ─── */
  function updateAll() {
    createInventoryRows();
    updatePerkLocks();

    const attrs=['forca','constituicao','destreza','inteligencia','sabedoria','carisma','peso','resistencia'];
    attrs.forEach(id=>{
      let v=clamp(Math.round(num(id)),0,100);
      byId(id).value=v;
      const cost=attrCost(v);
      const costEl=byId(id+'Cost'), infoEl=byId(id+'Info');
      if(costEl)costEl.value=cost;
      if(infoEl){
        if(id==='forca')      infoEl.value=`+${v*2}% dano`;
        else if(id==='constituicao') infoEl.value=`+${v*10} HP`;
        else if(id==='destreza')  infoEl.value=`+${v} furt, +${(v*0.5).toFixed(1)}m`;
        else if(id==='inteligencia') infoEl.value=`+${v}% craft vel`;
        else if(id==='sabedoria')  infoEl.value=`+${v} perc, +${v*5}s O2`;
        else if(id==='carisma')   infoEl.value=`+${v} interação`;
        else if(id==='peso')      infoEl.value=`+${v*10} kg cap`;
        else if(id==='resistencia') infoEl.value=`+${v*2} stamina`;
      }
    });

    const nivel=Math.max(1,Math.round(num('nivel'))||1);
    const ppp=5;
    const pontosTotais=nivel*ppp+num('bonusPontos');
    const pontosGastos=attrs.reduce((s,id)=>s+attrCost(clamp(Math.round(num(id)),0,100)),0);
    const pontosRestantes=pontosTotais-pontosGastos;
    byId('pontosTotais').textContent=pontosTotais;
    byId('pontosGastos').textContent=pontosGastos;
    byId('pontosRestantes').textContent=pontosRestantes;
    const pS=byId('pontosStatus');
    if(pontosRestantes<0){pS.textContent='acima do limite!';pS.className='status-danger';}
    else if(pontosRestantes===0){pS.textContent='exatos';pS.className='status-ok';}
    else{pS.textContent='disponível';pS.className='';}

    const perkTotal=Math.floor(nivel/5)+num('perkBonus');
    const perkUsed=selectedPerks().length;
    const perkLeft=perkTotal-perkUsed;
    byId('perkTotal').textContent=perkTotal;
    byId('perkUsed').textContent=perkUsed;
    byId('perkLeft').textContent=perkLeft;
    const pSt=byId('perkStatus');
    if(perkLeft<0){pSt.textContent='acima do limite!';pSt.className='status-danger';}
    else if(perkLeft===0){pSt.textContent='exatas';pSt.className='status-ok';}
    else{pSt.textContent='disponível';pSt.className='';}

    const con=clamp(Math.round(num('constituicao')),0,100);
    const res=clamp(Math.round(num('resistencia')),0,100);
    const des=clamp(Math.round(num('destreza')),0,100);
    const pes=clamp(Math.round(num('peso')),0,100);
    const sab=clamp(Math.round(num('sabedoria')),0,100);
    const for_=clamp(Math.round(num('forca')),0,100);
    const int_=clamp(Math.round(num('inteligencia')),0,100);

    const corpForte=hasPerk('corpo_forte');
    const tolBasica=hasPerk('tolerancia_basica');
    const mulinha  =hasPerk('mulinha');
    const orgBasica=hasPerk('organizacao_basica');
    const costasFerro=hasPerk('costas_de_ferro');
    const tourinho=hasPerk('tourinho');
    const sentaRespira=hasPerk('senta_e_respira');
    const passoLeve=hasPerk('passo_leve');
    const reflexo=hasPerk('reflexo');

    const vidaBase=100+con*10;
    const vidaMax=vidaBase;
    byId('vidaMax').textContent=vidaMax;
    byId('vidaRegen').textContent=`regen: ${2+Math.floor(con/10)}% por turno`;

    const torporMax=100+con*10;
    byId('torporMax').textContent=torporMax;
    byId('torporInfo').textContent=tolBasica?'-10% torpor recebido':'torpor = desmaio';

    const staminaBase=100+res*2+(tourinho?20:0);
    byId('staminaMax').textContent=staminaBase;
    const staminaRegenPct=5+Math.floor(res/10)+(sentaRespira?2:0);
    byId('staminaRegen').textContent=`regen: ${staminaRegenPct}% por ação`;

    const capacidadeBase=50+pes*10+(mulinha?25:0);
    byId('capacidadeVal').textContent=`${capacidadeBase} kg`;

    const inv=inventoryTotals();
    const pesoTotal=orgBasica?inv.totalWeight*0.9:inv.totalWeight;
    const pesoPct=capacidadeBase>0?(pesoTotal/capacidadeBase)*100:0;
    byId('pesoAtual').value=pesoTotal.toFixed(2).replace(/\.00$/,'');
    byId('pesoAtualMax').value=capacidadeBase;
    byId('pesoUso').value=`${pesoPct.toFixed(1)}%`;
    const limiar=costasFerro?90:75;
    const pesoPenalizado=pesoPct>=100;
    const pesoLento=pesoPct>=limiar&&!pesoPenalizado;
    if(byId('pesoPenalty')){
      if(pesoPenalizado)byId('pesoPenalty').textContent='imóvel (100%+)';
      else if(pesoLento)byId('pesoPenalty').textContent=`penalidade (${limiar}%+)`;
      else byId('pesoPenalty').textContent='livre';
    }
    updateBars('vidaAtual',vidaMax,'vidaBar');
    updateBars('torporAtual',torporMax,'torporBar');
    updateBars('staminaAtual',staminaBase,'staminaBar');
    byId('vidaAtualMax').value=vidaMax; byId('torporAtualMax').value=torporMax; byId('staminaAtualMax').value=staminaBase;
    if(byId('pesoBar'))byId('pesoBar').style.width=`${clamp(pesoPct,0,100)}%`;

    byId('inventarioSlotsTotal').textContent=inv.character.totalSlots;
    byId('inventarioSlotsUsados').textContent=inv.character.used;
    byId('inventarioSlotsLivres').textContent=inv.character.free;
    if(byId('mochilaSlotsTotal'))byId('mochilaSlotsTotal').textContent=inv.backpack.totalSlots;
    if(byId('mochilaSlotsUsados'))byId('mochilaSlotsUsados').textContent=inv.backpack.used;
    if(byId('mochilaSlotsLivres'))byId('mochilaSlotsLivres').textContent=inv.backpack.free;

    const movBase=5+(passoLeve?1.5:0);
    if(pesoPenalizado){byId('andarVal').textContent='0 m';byId('correrVal').textContent='0 m';}
    else if(pesoLento){byId('andarVal').textContent=`${(movBase*0.5).toFixed(1).replace('.0','')} m`;byId('correrVal').textContent=`${(movBase).toFixed(1).replace('.0','')} m`;}
    else{byId('andarVal').textContent=`${movBase.toFixed(1).replace('.0','')} m`;byId('correrVal').textContent=`${(movBase*2).toFixed(1).replace('.0','')} m`;}

    byId('esquivaVal').textContent=`d100/2+${(des/2).toFixed(1).replace('.0','')}`;
    byId('furtividadeVal').textContent=des;
    byId('percepcaoVal').textContent=10+sab;
    byId('zonaPercepcao').textContent=`zona: ${Math.round((10+sab)*1.5)} m`;
    byId('oxigenioVal').textContent=`${60+sab*5} s`;
    byId('danoFisicoVal').textContent=`+${for_*2}%`;
    byId('danoDistVal').textContent=`+${des}%`;
    byId('craftVelVal').textContent=`+${int_}% vel`;
    byId('craftQualVal').textContent=`qualidade +${hasPerk('ajuste_mestre')?int_+5:int_}%`;

    // Postura
    const postura=byId('posturaAtual').value||'neutra';
    document.querySelectorAll('.postura-btn').forEach(b=>b.classList.toggle('active-postura',b.dataset.postura===postura));
    const armadura=byId('armadura')?byId('armadura').value:'sem';
    const armaduraBonus=num('armaduraBonus');
    let damageReduction=0+armaduraBonus;
    if(armadura==='leve')damageReduction+=10; else if(armadura==='media')damageReduction+=20; else if(armadura==='pesada')damageReduction+=35;
    if(corpForte)damageReduction+=5; if(reflexo)damageReduction+=5;
    if(postura==='defensiva')damageReduction+=50;
    const posturaTexts={
      neutra:'Neutra: sem bônus ou penalidades.',
      ofensiva:`Ofensiva: +20% dano. Redução de dano: ${Math.max(0,damageReduction-20)}% (−20% armadura).`,
      defensiva:`Defensiva: −50% dano recebido. Redução total: ${damageReduction}%.`,
      esquiva:`Esquiva: d100/2 + destreza/2. Armadura leve: esquiva total. Média: parcial. Pesada: sem esquiva.`,
      furtiva:`Furtiva: −2 m de movimento, furtividade +${Math.round(des*0.5)} bônus.`
    };
    if(byId('posturaResumo'))byId('posturaResumo').textContent=posturaTexts[postura]||'';

    // Combate
    const armaEscala=byId('armaEscala')?byId('armaEscala').value:'forca';
    const attrValEscala=armaEscala==='forca'?for_:armaEscala==='destreza'?des:0;
    const attrPct=armaEscala==='forca'?for_*2:armaEscala==='destreza'?des:0;
    if(byId('armaScaleValue'))byId('armaScaleValue').textContent=`+${attrValEscala}`;
    if(byId('armaScaleText'))byId('armaScaleText').textContent=armaEscala==='nenhum'?'sem escalonamento':`${armaEscala} (${attrPct}%)`;

    const d20=clamp(Math.round(num('rolagemD20')),1,20);
    const multi=d20Multiplier(d20);
    if(byId('multiD20'))byId('multiD20').textContent=`${multi*100}%`;

    let percentualTotal=attrPct+(postura==='ofensiva'?20:0)+num('bonusPercentualExtra');
    if(byId('tamanhoAlvo')&&byId('tamanhoAlvo').value==='grande'&&hasPerk('derrubar_gigantes'))percentualTotal+=10;
    if(hasPerk('golpe_firme')&&armaEscala==='forca')percentualTotal+=10;
    if(hasPerk('impacto_pesado'))percentualTotal+=10;
    if(hasPerk('agilidade')&&armaEscala==='destreza')percentualTotal-=0;

    const danoBase=num('danoBaseRolado')+num('armaBonus')+num('efeitoExtra');
    const danoBruto=danoBase*multi*(1+percentualTotal/100);
    const redAlvo=clamp(num('reducaoArmaduraAlvo'),0,100);
    const danoFinal=danoBruto*(1-redAlvo/100);
    const alvoAntes=num('danoAplicadoAlvo');
    const vidaRestanteAlvo=Math.max(0,alvoAntes-danoFinal);

    if(byId('percentualTotalDano'))byId('percentualTotalDano').textContent=`${percentualTotal>=0?'+':''}${percentualTotal}%`;
    if(byId('danoBruto'))byId('danoBruto').textContent=danoBruto.toFixed(2).replace(/\.00$/,'');
    if(byId('danoFinal'))byId('danoFinal').textContent=danoFinal.toFixed(2).replace(/\.00$/,'');
    if(byId('vidaRestanteAlvo'))byId('vidaRestanteAlvo').value=alvoAntes>0?vidaRestanteAlvo.toFixed(2).replace(/\.00$/,''):'';

    const danoRecebidoBruto=num('danoRecebidoBruto');
    const esquivaAtiva=postura==='esquiva';
    const rolagemEsquiva=clamp(num('rolagemEsquiva'),1,100);
    const penalidadeEsquiva=num('penalidadeEsquiva');
    let formulaEsquivaValor=0;
    if(armadura==='leve')formulaEsquivaValor=rolagemEsquiva/2+des/2;
    else if(armadura==='media')formulaEsquivaValor=rolagemEsquiva/4+des/4;
    const danoEsquivado=clamp(formulaEsquivaValor-penalidadeEsquiva,0,danoRecebidoBruto);
    const danoAposEsquiva=Math.max(0,danoRecebidoBruto-danoEsquivado);
    const danoRecebidoFinal=danoAposEsquiva*(1-damageReduction/100);
    const vidaAposDanoRecebido=Math.max(0,num('vidaAtual')-danoRecebidoFinal);

    let esquivaCalcValor=0;
    if(armadura==='leve')esquivaCalcValor=50+des/2; else if(armadura==='media')esquivaCalcValor=25+des/4;
    if(byId('esquivaCalc'))byId('esquivaCalc').textContent=esquivaCalcValor.toFixed(1).replace('.0','');
    if(byId('reducaoArmaduraRecebida'))byId('reducaoArmaduraRecebida').value=`${damageReduction}%`;
    if(byId('danoRecebidoFinal'))byId('danoRecebidoFinal').value=danoRecebidoFinal.toFixed(2).replace(/\.00$/,'');
    if(byId('vidaAposDanoRecebido'))byId('vidaAposDanoRecebido').value=vidaAposDanoRecebido.toFixed(2).replace(/\.00$/,'');
    if(byId('formulaEsquiva'))byId('formulaEsquiva').value=formulaEsquivaValor.toFixed(2).replace(/\.00$/,'');
    if(byId('danoEsquivado'))byId('danoEsquivado').value=danoEsquivado.toFixed(2).replace(/\.00$/,'');
    if(byId('esquivaBox'))byId('esquivaBox').style.display=esquivaAtiva?'block':'none';
    if(byId('applyReceivedDamageBtn'))byId('applyReceivedDamageBtn').disabled=danoRecebidoBruto<=0;
    if(byId('ataqueResumo'))byId('ataqueResumo').textContent=`${byId('armaNome').value||'Arma'} (${byId('armaDado').value||'-'})`;

    saveActiveTabState();
  }

  window.applyDelta = function(type) {
    const cur=num(`${type}Atual`), delta=num(`${type}Delta`), max=num(`${type}AtualMax`);
    byId(`${type}Atual`).value=clamp(cur+delta,0,max); byId(`${type}Delta`).value=0; updateAll();
  };

  /* ─── EVENT LISTENERS ─── */
  byId('useActionBtn')?.addEventListener('click', ()=>{
    let cost=parseFloat(byId('acaoRapida')?.value)||0;
    if(hasPerk('trabalho_consciente'))cost*=0.9;
    byId('staminaAtual').value=Math.max(0,num('staminaAtual')-Math.round(cost*100)/100);
    updateAll();
  });

  byId('recoverStaminaBtn').addEventListener('click', ()=>{
    const max=num('staminaAtualMax'), res2=num('resistencia');
    let rp=5+Math.floor(res2/10); if(hasPerk('senta_e_respira'))rp+=2;
    byId('staminaAtual').value=clamp(num('staminaAtual')+Math.round(max*rp/100),0,max);
    updateAll();
  });

  byId('recoverHpBtn').addEventListener('click', ()=>{
    const max=num('vidaAtualMax'),con2=num('constituicao');
    const rp=2+Math.floor(con2/10);
    byId('vidaAtual').value=clamp(num('vidaAtual')+Math.round(max*rp/100),0,max);
    updateAll();
  });

  byId('dropTorporBtn').addEventListener('click', ()=>{
    byId('torporAtual').value=Math.max(0,num('torporAtual')-Math.round(num('torporAtualMax')*0.05));
    updateAll();
  });

  byId('applyReceivedDamageBtn').addEventListener('click', ()=>{
    byId('vidaAtual').value=Math.max(0,num('vidaAtual')-(Math.max(0,parseFloat(byId('danoRecebidoFinal').value)||0)));
    updateAll();
  });

  byId('applyDamageToTargetBtn').addEventListener('click', ()=>{
    const va=Math.max(0,num('danoAplicadoAlvo')),df=Math.max(0,parseFloat(byId('danoFinal').textContent.replace(',','.'))||0);
    byId('danoAplicadoAlvo').value=Math.max(0,va-df).toFixed(2).replace(/\.00$/,'');
    updateAll();
  });

  byId('exportBtn').addEventListener('click', ()=>{ saveState(); renderExportChecklist(); openModal(exportModal); });
  byId('importBtn').addEventListener('click', ()=>{ pendingImportMode='append'; document.querySelector('input[name="importMode"][value="append"]').checked=true; openModal(importModal); });
  byId('confirmExportBtn').addEventListener('click', ()=>{
    saveState();
    const mode=document.querySelector('input[name="exportMode"]:checked')?.value||'active';
    const active=getActiveTab();
    if(mode==='workspace')downloadJson('ficha_ark_rpg_completa',buildWorkspaceExport(sheetStore.tabs));
    else if(mode==='selected-separate'){const sel=getSelectedExportTabs();if(!sel.length){alert('Selecione ao menos uma aba.');return;}sel.forEach((t,i)=>setTimeout(()=>downloadJson(sanitizeFilename(t.name||`ficha_${i+1}`),t.data||{}),i*150));}
    else downloadJson(active?.name||'ficha_ark_rpg',active?.data||{});
    closeModal(exportModal);
  });
  byId('cancelExportBtn').addEventListener('click', ()=>closeModal(exportModal));
  document.querySelectorAll('input[name="exportMode"]').forEach(r=>r.addEventListener('change',syncExportChecklistState));

  byId('chooseImportFileBtn').addEventListener('click', ()=>{
    pendingImportMode=document.querySelector('input[name="importMode"]:checked')?.value||'append';
    closeModal(importModal);
    if(pendingImportMode==='replace'){openModal(replaceImportModal);return;}
    byId('fileInput').click();
  });
  byId('cancelImportBtn').addEventListener('click', ()=>closeModal(importModal));
  byId('cancelReplaceImportBtn').addEventListener('click', ()=>closeModal(replaceImportModal));
  byId('confirmReplaceImportBtn').addEventListener('click', ()=>{ closeModal(replaceImportModal); byId('fileInput').click(); });
  byId('fileInput').addEventListener('change', async(e)=>{
    const file=e.target.files[0]; if(!file)return;
    try{const t=await file.text();const p=JSON.parse(t);const tabs=normalizeImportedTabs(p,file.name);if(!tabs.length)throw new Error();
      if(pendingImportMode==='replace')replaceWorkspaceWithImportedTabs(tabs);else appendImportedTabs(tabs);}
    catch(err){alert('Não foi possível importar o arquivo JSON.');}
    finally{pendingImportMode='append';e.target.value='';}
  });

  byId('printBtn').addEventListener('click', ()=>window.print());
  byId('resetBtn').addEventListener('click', ()=>{
    const active=getActiveTab(); if(!active)return;
    if(!confirm('Isso vai limpar a ficha atual. Deseja continuar?'))return;
    active.data=makeBlankState(); active.name=defaultTabName(sheetStore.tabs.indexOf(active)+1);
    persistSheetStore(); renderTabs(); applyStateToForm(active.data); createInventoryRows(true); updateAll();
  });

  byId('addTabBtn').addEventListener('click', ()=>{ saveState(); createTab({},defaultTabName(sheetStore.tabs.length+1)); });

  byId('tabsBar').addEventListener('click', (e)=>{
    const closeBtn=e.target.closest('[data-close-tab]');
    if(closeBtn){e.stopPropagation();openCloseTabModal(closeBtn.dataset.closeTab);return;}
    const tabBtn=e.target.closest('[data-tab-id]');
    if(tabBtn)switchTab(tabBtn.dataset.tabId);
  });

  byId('cancelCloseTabBtn').addEventListener('click', ()=>closeCloseTabModal());
  byId('confirmCloseTabBtn').addEventListener('click', ()=>{ if(pendingCloseTabId)closeTab(pendingCloseTabId); closeCloseTabModal(); });

  closeTabModal.addEventListener('click', e=>{ if(e.target===closeTabModal)closeCloseTabModal(); });
  [exportModal,importModal,replaceImportModal].forEach(m=>{ if(!m)return; m.addEventListener('click',e=>{if(e.target===m)closeModal(m);}); });

  document.addEventListener('keydown', e=>{
    if(e.key==='Escape'&&!closeTabModal.classList.contains('hidden')){closeCloseTabModal();return;}
    if(e.key==='Escape')closeAllSecondaryModals();
  });

  document.addEventListener('input', e=>{ if(e.target.matches('#sheet-screen input, #sheet-screen select, #sheet-screen textarea'))updateAll(); });
  document.addEventListener('change', e=>{ if(e.target.matches('#sheet-screen input, #sheet-screen select, #sheet-screen textarea'))updateAll(); });

    /* ════════════════════════════════════════
     SHEET ENGINE (adapted from v18)
  ════════════════════════════════════════ */

 const STORAGE_KEY = 'ark-rpg-ficha-tabs-v1';
    const LEGACY_STORAGE_KEYS = ['ark-rpg-ficha-v5'];
    const DEFAULT_TAB_NAME = 'Nova ficha';
    let sheetStore = { activeId: null, tabs: [] };
    let pendingCloseTabId = null;

    const closeTabModal = document.getElementById('closeTabModal');
    const closeTabMessage = document.getElementById('closeTabMessage');
    const cancelCloseTabBtn = document.getElementById('cancelCloseTabBtn');
    const confirmCloseTabBtn = document.getElementById('confirmCloseTabBtn');

    const exportModal = document.getElementById('exportModal');
    const importModal = document.getElementById('importModal');
    const replaceImportModal = document.getElementById('replaceImportModal');
    const exportTabsChecklist = document.getElementById('exportTabsChecklist');
    const cancelExportBtn = document.getElementById('cancelExportBtn');
    const confirmExportBtn = document.getElementById('confirmExportBtn');
    const cancelImportBtn = document.getElementById('cancelImportBtn');
    const chooseImportFileBtn = document.getElementById('chooseImportFileBtn');
    const cancelReplaceImportBtn = document.getElementById('cancelReplaceImportBtn');
    const confirmReplaceImportBtn = document.getElementById('confirmReplaceImportBtn');

    let pendingImportMode = 'append';

    function uniqueId() {
      return `ficha_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function defaultTabName(index = 1) {
      return `${DEFAULT_TAB_NAME} ${index}`;
    }

    function makeBlankState() {
      return {};
    }

    function getActiveTab() {
      return sheetStore.tabs.find(tab => tab.id === sheetStore.activeId) || null;
    }

    function persistSheetStore() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sheetStore));
    }

    function normalizeTabName(name, fallbackIndex = 1) {
      const clean = String(name || '').trim();
      return clean || defaultTabName(fallbackIndex);
    }


    function sanitizeFilename(name, fallback = 'ficha_ark_rpg') {
      return (String(name || fallback)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '') || fallback);
    }

    function buildWorkspaceExport(tabs) {
      return {
        exportType: 'ark-rpg-workspace',
        version: 1,
        activeId: tabs[0]?.id || null,
        tabs: tabs.map((tab, index) => ({
          id: tab.id || uniqueId(),
          name: normalizeTabName(tab.name, index + 1),
          data: { ...makeBlankState(), ...(tab.data || {}) }
        }))
      };
    }

    function downloadJson(filenameBase, payload) {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      const href = URL.createObjectURL(blob);
      a.href = href;
      a.download = `${sanitizeFilename(filenameBase)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    }

    function getSelectedExportTabs() {
      return [...document.querySelectorAll('[data-export-tab]:checked')]
        .map(box => sheetStore.tabs.find(tab => tab.id === box.value))
        .filter(Boolean);
    }

    function renderExportChecklist() {
      if (!exportTabsChecklist) return;
      exportTabsChecklist.innerHTML = '';
      sheetStore.tabs.forEach((tab, index) => {
        const label = document.createElement('label');
        label.className = 'checklist-item';
        label.innerHTML = `
          <input type="checkbox" data-export-tab value="${tab.id}" checked />
          <span>${normalizeTabName(tab.name, index + 1)}</span>
        `;
        exportTabsChecklist.appendChild(label);
      });
      syncExportChecklistState();
    }

    function syncExportChecklistState() {
      const separateMode = document.querySelector('input[name="exportMode"]:checked')?.value === 'selected-separate';
      document.querySelectorAll('.checklist-item').forEach(item => {
        item.classList.toggle('disabled', !separateMode);
      });
      document.querySelectorAll('[data-export-tab]').forEach(box => {
        box.disabled = !separateMode;
      });
    }

    function openModal(modal) {
      if (!modal) return;
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
    }

    function closeModal(modal) {
      if (!modal) return;
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }

    function closeAllSecondaryModals() {
      closeModal(exportModal);
      closeModal(importModal);
      closeModal(replaceImportModal);
    }

    function normalizeImportedTabs(parsed, fileName = '') {
      if (parsed && Array.isArray(parsed.tabs) && parsed.tabs.length) {
        return parsed.tabs.map((tab, index) => ({
          id: uniqueId(),
          name: normalizeTabName(tab?.name || tab?.data?.nome, index + 1),
          data: { ...makeBlankState(), ...(tab?.data || {}) }
        }));
      }
      const fallbackName = fileName.replace(/\.json$/i, '') || parsed?.nome || defaultTabName(sheetStore.tabs.length + 1);
      return [{
        id: uniqueId(),
        name: normalizeTabName(parsed?.nome || fallbackName, sheetStore.tabs.length + 1),
        data: { ...makeBlankState(), ...(parsed || {}) }
      }];
    }

    function appendImportedTabs(tabs) {
      if (!tabs.length) return;
      saveState();
      tabs.forEach((tab, index) => {
        sheetStore.tabs.push({
          id: uniqueId(),
          name: normalizeTabName(tab.name, sheetStore.tabs.length + 1 + index),
          data: { ...makeBlankState(), ...(tab.data || {}) }
        });
      });
      sheetStore.activeId = sheetStore.tabs[sheetStore.tabs.length - 1].id;
      persistSheetStore();
      renderTabs();
      const active = getActiveTab();
      applyStateToForm(active ? active.data : {});
      createInventoryRows(true);
      updateAll();
    }

    function replaceWorkspaceWithImportedTabs(tabs) {
      if (!tabs.length) return;
      sheetStore = {
        activeId: tabs[0].id,
        tabs: tabs.map((tab, index) => ({
          id: tab.id || uniqueId(),
          name: normalizeTabName(tab.name, index + 1),
          data: { ...makeBlankState(), ...(tab.data || {}) }
        }))
      };
      persistSheetStore();
      renderTabs();
      applyStateToForm(sheetStore.tabs[0].data || {});
      createInventoryRows(true);
      updateAll();
    }

    function captureCurrentState() {
      const data = {};
      document.querySelectorAll('[data-save]').forEach(el => {
        if (el.type === 'checkbox') data[el.id || el.dataset.perk] = el.checked;
        else data[el.id] = el.value;
      });
      return data;
    }

    function resetFormToBlank() {
      document.querySelectorAll('[data-save]').forEach(el => {
        if (el.type === 'checkbox') el.checked = false;
        else if (el.type === 'number') el.value = el.defaultValue || '0';
        else el.value = el.defaultValue || '';
      });
      createInventoryRows(true);
    }

    function applyStateToForm(data = {}) {
      resetFormToBlank();
      document.querySelectorAll('[data-save]').forEach(el => {
        const key = el.id || el.dataset.perk;
        if (!(key in data)) return;
        if (el.type === 'checkbox') el.checked = !!data[key];
        else if (!el.hasAttribute('data-inventory')) el.value = data[key];
      });
      createInventoryRows(true);
      document.querySelectorAll('[data-save][data-inventory]').forEach(el => {
        const key = el.id || el.dataset.perk;
        if (!(key in data)) return;
        el.value = data[key];
      });
    }

    function saveActiveTabState() {
      const active = getActiveTab();
      if (!active) return;
      active.data = captureCurrentState();
      active.name = normalizeTabName(active.data.nome, sheetStore.tabs.indexOf(active) + 1);
      persistSheetStore();
      renderTabs();
    }

    function renderTabs() {
      const bar = byId('tabsBar');
      if (!bar) return;
      bar.innerHTML = '';
      sheetStore.tabs.forEach((tab, index) => {
        const btn = document.createElement('div');
        btn.className = `tab-btn${tab.id === sheetStore.activeId ? ' active' : ''}`;
        btn.dataset.tabId = tab.id;
        btn.innerHTML = `
          <span class="tab-name">${normalizeTabName(tab.name, index + 1)}</span>
          <button type="button" class="tab-close" data-close-tab="${tab.id}" title="Fechar ficha">×</button>
        `;
        bar.appendChild(btn);
      });
    }

    function createTab(initialData = {}, preferredName = '') {
      const tab = {
        id: uniqueId(),
        name: normalizeTabName(preferredName || initialData.nome, sheetStore.tabs.length + 1),
        data: { ...makeBlankState(), ...initialData }
      };
      sheetStore.tabs.push(tab);
      sheetStore.activeId = tab.id;
      persistSheetStore();
      renderTabs();
      applyStateToForm(tab.data);
      createInventoryRows(true);
      updateAll();
    }

    function switchTab(tabId) {
      if (tabId === sheetStore.activeId) return;
      saveActiveTabState();
      sheetStore.activeId = tabId;
      const active = getActiveTab();
      if (!active) return;
      persistSheetStore();
      renderTabs();
      applyStateToForm(active.data || {});
      createInventoryRows(true);
      updateAll();
    }

    function openCloseTabModal(tabId) {
      const tab = sheetStore.tabs.find(item => item.id === tabId);
      if (!tab) return;
      pendingCloseTabId = tabId;
      closeTabMessage.innerHTML = `Você tem certeza que quer fechar a aba <strong>${normalizeTabName(tab.name)}</strong>?<br><br>Os dados da aba serão perdidos e não poderão ser recuperados.`;
      closeTabModal.classList.remove('hidden');
      closeTabModal.setAttribute('aria-hidden', 'false');
    }

    function closeCloseTabModal() {
      pendingCloseTabId = null;
      closeTabModal.classList.add('hidden');
      closeTabModal.setAttribute('aria-hidden', 'true');
    }

    function closeTab(tabId) {
      const index = sheetStore.tabs.findIndex(tab => tab.id === tabId);
      if (index === -1) return;
      sheetStore.tabs.splice(index, 1);
      if (!sheetStore.tabs.length) {
        const tab = { id: uniqueId(), name: defaultTabName(1), data: makeBlankState() };
        sheetStore.tabs = [tab];
      }
      if (!sheetStore.tabs.some(tab => tab.id === sheetStore.activeId)) {
        sheetStore.activeId = sheetStore.tabs[Math.max(0, index - 1)].id;
      }
      persistSheetStore();
      renderTabs();
      const active = getActiveTab();
      applyStateToForm(active ? active.data : {});
      createInventoryRows(true);
      updateAll();
    }

    function loadWorkspace() {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.tabs) && parsed.tabs.length) {
            sheetStore = parsed;
            if (!sheetStore.tabs.some(tab => tab.id === sheetStore.activeId)) {
              sheetStore.activeId = sheetStore.tabs[0].id;
            }
            return;
          }
        } catch (e) {}
      }
      for (const legacyKey of LEGACY_STORAGE_KEYS) {
        const legacyRaw = localStorage.getItem(legacyKey);
        if (!legacyRaw) continue;
        try {
          const legacyData = JSON.parse(legacyRaw);
          sheetStore = {
            activeId: uniqueId(),
            tabs: []
          };
          sheetStore.tabs.push({ id: sheetStore.activeId, name: normalizeTabName(legacyData.nome, 1), data: legacyData });
          persistSheetStore();
          return;
        } catch (e) {}
      }
      const firstId = uniqueId();
      sheetStore = { activeId: firstId, tabs: [{ id: firstId, name: defaultTabName(1), data: makeBlankState() }] };
      persistSheetStore();
    }

    function hydrateActiveTab() {
      const active = getActiveTab();
      renderTabs();
      applyStateToForm(active ? active.data : {});
    }

    const perkData = {
      forca: [
        { id: 'golpe_firme', nome: 'Golpe Firme', efeito: '+10% de dano em ataques corpo a corpo' },
        { id: 'impacto_pesado', nome: 'Impacto Pesado', efeito: '+10% de dano com armas pesadas' },
        { id: 'derrubar_gigantes', nome: 'Derrubar Gigantes', efeito: '+10% de dano contra criaturas grandes' }
      ],
      destreza: [
        { id: 'passo_leve', nome: 'Passo Leve', efeito: '+1,5 m de movimento' },
        { id: 'reflexo', nome: 'Reflexo', efeito: '+5% redução de dano' },
        { id: 'agilidade', nome: 'Agilidade', efeito: '-10% custo de stamina em ataques leves' }
      ],
      inteligencia: [
        { id: 'oficio_inicial', nome: 'Ofício Inicial', efeito: '+10% velocidade de criação' },
        { id: 'mao_economica', nome: 'Mão Econômica', efeito: '-10% custo de materiais' },
        { id: 'ajuste_mestre', nome: 'Ajuste de Mestre', efeito: '+5% na qualidade de itens' }
      ],
      peso: [
        { id: 'mulinha', nome: 'Mulinha', efeito: '+25 kg de capacidade' },
        { id: 'organizacao_basica', nome: 'Organização Básica', efeito: '-10% em peso dos itens' },
        { id: 'costas_de_ferro', nome: 'Costas de Ferro', efeito: 'Penalidade de movimento só começa em 90%' }
      ],
      resistencia: [
        { id: 'tourinho', nome: 'Tourinho', efeito: '+20 stamina' },
        { id: 'senta_e_respira', nome: 'Senta e Respira', efeito: '+2% regen stamina' },
        { id: 'trabalho_consciente', nome: 'Trabalho Consciente', efeito: '-10% custo de ações' }
      ],
      constituicao: [
        { id: 'corpo_forte', nome: 'Corpo Forte', efeito: '+5% resistência a dano' },
        { id: 'tolerancia_basica', nome: 'Tolerância Básica', efeito: '-10% torpor recebido' }
      ]
    };

    function byId(id) { return document.getElementById(id); }
    function num(id) {
      const v = parseFloat(byId(id).value);
      return Number.isFinite(v) ? v : 0;
    }
    function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

    function inventorySlotCount() {
      return 5 + Math.max(0, Math.round(num('peso')));
    }

    function backpackEnabled() {
      const field = byId('mochilaAtiva');
      return !!field && field.value === 'sim';
    }

    function backpackSlotCount() {
      if (!backpackEnabled()) return 0;
      return Math.max(0, Math.round(num('mochilaSlots')));
    }

    function inventoryValueKey(slot, field) {
      return `inventory_${slot}_${field}`;
    }

    function backpackValueKey(slot, field) {
      return `backpack_${slot}_${field}`;
    }

    let currentInventorySlots = 0;
    let currentBackpackSlots = 0;

    function createStorageRows(bodyId, totalSlots, keyBuilder, dataAttr) {
      const body = byId(bodyId);
      if (!body) return;
      const previousValues = {};
      body.querySelectorAll(`[${dataAttr}]`).forEach(el => {
        previousValues[el.dataset.key] = el.value;
      });
      body.innerHTML = '';
      for (let i = 1; i <= totalSlots; i++) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><span class="slot-badge">${i}</span></td>
          <td><input data-save ${dataAttr} data-key="${keyBuilder(i,'desc')}" id="${keyBuilder(i,'desc')}" placeholder="Nome do item" /></td>
          <td><input data-save ${dataAttr} data-key="${keyBuilder(i,'qty')}" id="${keyBuilder(i,'qty')}" type="number" min="0" step="1" value="0" /></td>
          <td><input data-save ${dataAttr} data-key="${keyBuilder(i,'unit')}" id="${keyBuilder(i,'unit')}" type="number" min="0" step="0.01" value="0" /></td>
          <td><input id="${keyBuilder(i,'total')}" readonly /></td>
        `;
        body.appendChild(tr);
      }
      for (const [key, value] of Object.entries(previousValues)) {
        const el = byId(key);
        if (el) el.value = value;
      }
    }

    function createInventoryRows(force = false) {
      const totalSlots = inventorySlotCount();
      if (force || totalSlots !== currentInventorySlots) {
        currentInventorySlots = totalSlots;
        createStorageRows('inventoryBody', totalSlots, inventoryValueKey, 'data-inventory');
      }

      const totalBackpackSlots = backpackSlotCount();
      const mochilaSection = byId('mochilaSection');
      const mochilaSlotsBox = byId('mochilaSlotsBox');
      if (mochilaSection) mochilaSection.style.display = backpackEnabled() ? '' : 'none';
      if (mochilaSlotsBox) mochilaSlotsBox.style.display = backpackEnabled() ? '' : 'none';

      if (force || totalBackpackSlots !== currentBackpackSlots) {
        currentBackpackSlots = totalBackpackSlots;
        createStorageRows('backpackBody', totalBackpackSlots, backpackValueKey, 'data-backpack');
      }
    }

    function collectStorageTotals(totalSlots, keyBuilder) {
      let used = 0;
      let totalWeight = 0;
      for (let i = 1; i <= totalSlots; i++) {
        const descEl = byId(keyBuilder(i,'desc'));
        const qtyEl = byId(keyBuilder(i,'qty'));
        const unitEl = byId(keyBuilder(i,'unit'));
        const totalEl = byId(keyBuilder(i,'total'));
        if (!descEl || !qtyEl || !unitEl || !totalEl) continue;
        const desc = (descEl.value || '').trim();
        const qty = Math.max(0, parseFloat(qtyEl.value) || 0);
        const unit = Math.max(0, parseFloat(unitEl.value) || 0);
        const rowTotal = qty * unit;
        totalEl.value = rowTotal.toFixed(2).replace(/\.00$/, '');
        if (desc) used += 1;
        totalWeight += rowTotal;
      }
      return { used, totalWeight, totalSlots, free: Math.max(0, totalSlots - used) };
    }

    function inventoryTotals() {
      const character = collectStorageTotals(inventorySlotCount(), inventoryValueKey);
      const backpack = backpackEnabled() ? collectStorageTotals(backpackSlotCount(), backpackValueKey) : { used: 0, totalWeight: 0, totalSlots: 0, free: 0 };
      return {
        character,
        backpack,
        used: character.used + backpack.used,
        totalWeight: character.totalWeight + backpack.totalWeight,
        totalSlots: character.totalSlots + backpack.totalSlots,
        free: character.free + backpack.free
      };
    }

    function attrCost(value) {
      let total = 0;
      for (let i = 1; i <= value; i++) {
        total += i > 80 ? 3 : i > 50 ? 2 : 1;
      }
      return total;
    }

    function d20Multiplier(roll) {
      if (roll >= 20) return 2;
      if (roll >= 18) return 1.5;
      if (roll >= 11) return 1;
      if (roll >= 4) return 0.5;
      return 0.3;
    }

    function createPerks() {
      const host = byId('perkGrid');
      const labels = {
        forca: 'Força', destreza: 'Destreza', inteligencia: 'Inteligência', peso: 'Peso', resistencia: 'Resistência', constituicao: 'Constituição'
      };
      host.innerHTML = '';
      for (const [attr, list] of Object.entries(perkData)) {
        const group = document.createElement('div');
        group.className = 'perk-group';
        group.innerHTML = `<div class="attr-head"><strong>${labels[attr]}</strong><span class="pill">requer pelo menos 1 ponto</span></div>`;
        list.forEach(perk => {
          const item = document.createElement('label');
          item.className = 'perk-item';
          item.innerHTML = `
            <input type="checkbox" data-perk="${perk.id}" data-attrreq="${attr}" data-save />
            <div>
              <div class="perk-title">${perk.nome}</div>
              <div class="small">${perk.efeito}</div>
            </div>
          `;
          group.appendChild(item);
        });
        host.appendChild(group);
      }
    }

    function saveState() {
      saveActiveTabState();
    }

    function loadState() {
      loadWorkspace();
      hydrateActiveTab();
    }

    function selectedPerks() {
      return [...document.querySelectorAll('[data-perk]:checked')].map(el => el.dataset.perk);
    }

    function hasPerk(id) {
      return selectedPerks().includes(id);
    }


    function updatePerkLocks() {
      const perkTotal = Math.floor(Math.max(1, Math.round(num('nivel')) || 1) / 5) + num('perkBonus');
      const used = selectedPerks().length;
      const noSlotsLeft = used >= perkTotal;
      document.querySelectorAll('[data-perk]').forEach(box => {
        const attr = box.dataset.attrreq;
        const attrVal = num(attr);
        const attrBlocked = attrVal < 1;
        const slotBlocked = !box.checked && noSlotsLeft;
        box.disabled = attrBlocked || slotBlocked;
        if (attrBlocked) box.checked = false;
      });
    }

    function updateBars(currentId, max, barId, inverse = false) {
      const current = clamp(num(currentId), 0, Math.max(0, max));
      byId(currentId).value = current;
      const pct = max <= 0 ? 0 : (current / max) * 100;
      byId(barId).style.width = `${clamp(pct, 0, 100)}%`;
      if (inverse) byId(barId).style.width = `${clamp(pct, 0, 100)}%`;
    }

    function updateAll() {
      createInventoryRows();
      updatePerkLocks();

      const attrs = ['forca','constituicao','destreza','inteligencia','sabedoria','carisma','peso','resistencia'];
      attrs.forEach(id => {
        let v = clamp(Math.round(num(id)), 0, 100);
        byId(id).value = v;
        byId(id + 'Cost').value = attrCost(v);
      });

      const forca = num('forca');
      const constituicao = num('constituicao');
      const destreza = num('destreza');
      const inteligencia = num('inteligencia');
      const sabedoria = num('sabedoria');
      const peso = num('peso');
      const resistencia = num('resistencia');
      const nivel = Math.max(1, Math.round(num('nivel')) || 1);
      const pontosPorNivel = Math.max(0, num('pontosPorNivel'));
      const bonusPontos = num('bonusPontos');
      const perkBonus = num('perkBonus');

      const pontosTotais = nivel * pontosPorNivel + bonusPontos;
      const custos = attrs.reduce((sum, id) => sum + attrCost(num(id)), 0);
      const pontosRestantes = pontosTotais - custos;
      byId('pontosTotais').textContent = pontosTotais;
      byId('pontosGastos').textContent = custos;
      byId('pontosRestantes').textContent = pontosRestantes;
      byId('pontosStatus').textContent = pontosRestantes < 0 ? 'ultrapassou o limite' : 'disponível';
      byId('pontosStatus').className = pontosRestantes < 0 ? 'sub status-danger' : 'sub status-ok';

      const perkTotal = Math.floor(nivel / 5) + perkBonus;
      const perkUsed = selectedPerks().length;
      const perkLeft = perkTotal - perkUsed;
      byId('perkTotal').textContent = perkTotal;
      byId('perkUsed').textContent = perkUsed;
      byId('perkLeft').textContent = perkLeft;
      byId('perkStatus').textContent = perkLeft < 0 ? 'perks excedidas' : 'disponível';
      byId('perkStatus').className = perkLeft < 0 ? 'sub status-danger' : 'sub status-ok';

      const vidaMax = 100 + constituicao * 10;
      let vidaRegenPct = 2 + Math.floor(constituicao / 10);
      if (hasPerk('corpo_forte')) {}
      const vidaRegenTurno = Math.round(vidaMax * (vidaRegenPct / 100));
      const torporMax = 100 + constituicao * 5;
      let torporResist = Math.floor(constituicao / 10) * 5;
      if (hasPerk('tolerancia_basica')) torporResist += 10;

      let andar = 5 + Math.floor(destreza / 5) * 1.5;
      if (hasPerk('passo_leve')) andar += 1.5;
      let esquivaBase = destreza;
      let furtividade = destreza;

      const percepcao = 10 + sabedoria;
      const zonaPercepcao = percepcao / 2;
      const oxigenio = 60 + sabedoria * 5;

      let capacidade = 50 + peso * 10;
      if (hasPerk('mulinha')) capacidade += 25;

      let staminaMax = 100 + resistencia * 10;
      if (hasPerk('tourinho')) staminaMax += 20;
      let staminaRegenPct = 5 + Math.floor(resistencia / 10);
      if (hasPerk('senta_e_respira')) staminaRegenPct += 2;
      const staminaRegenTurno = Math.round(staminaMax * (staminaRegenPct / 100));

      const danoFisico = forca * 2 + (hasPerk('golpe_firme') ? 10 : 0);
      const danoDistancia = destreza * 2;
      const craftVel = inteligencia * 2 + (hasPerk('oficio_inicial') ? 10 : 0);
      const craftQual = inteligencia + (hasPerk('ajuste_mestre') ? 5 : 0);
      let reducaoDanoExtra = 0;
      if (hasPerk('reflexo')) reducaoDanoExtra += 5;
      if (hasPerk('corpo_forte')) reducaoDanoExtra += 5;

      const inventory = inventoryTotals();
      const pesoAtual = inventory.totalWeight;
      const threshold = hasPerk('costas_de_ferro') ? 90 : 80;
      const cargaPct = capacidade <= 0 ? 0 : (pesoAtual / capacidade) * 100;
      let correr = andar * 2;
      let pesoPenaltyText = 'sem penalidade';
      if (cargaPct > 100) {
        andar = 0;
        correr = 0;
        pesoPenaltyText = 'imóvel por excesso de carga';
      } else if (cargaPct > threshold) {
        andar *= 0.7;
        correr *= 0.7;
        pesoPenaltyText = `deslocamento reduzido em 30% acima de ${threshold}% de carga`;
      }

      byId('forcaInfo').value = `+${forca * 2}% dano físico`;
      byId('constituicaoInfo').value = `HP +${constituicao * 10}`;
      byId('destrezaInfo').value = `+${destreza * 2}% distância`;
      byId('inteligenciaInfo').value = `criação +${inteligencia * 2}%`;
      byId('sabedoriaInfo').value = `percepção +${sabedoria}`;
      byId('carismaInfo').value = 'bônus narrativo';
      byId('pesoInfo').value = `+${peso * 10} kg`;
      byId('resistenciaInfo').value = `stamina +${resistencia * 10}`;

      byId('vidaMax').textContent = vidaMax;
      byId('vidaRegen').textContent = `regen: ${vidaRegenPct}% por turno (${vidaRegenTurno})`;
      byId('torporMax').textContent = torporMax;
      byId('torporInfo').textContent = `resistência a torpor: -${torporResist}% | queda natural: 5% por turno`;
      byId('staminaMax').textContent = staminaMax;
      byId('staminaRegen').textContent = `regen: ${staminaRegenPct}% por turno (${staminaRegenTurno})`;
      byId('andarVal').textContent = `${andar.toFixed(1).replace('.0','')} m`;
      byId('correrVal').textContent = `${correr.toFixed(1).replace('.0','')} m`;
      byId('esquivaVal').textContent = esquivaBase;
      byId('furtividadeVal').textContent = furtividade;
      byId('percepcaoVal').textContent = percepcao;
      byId('zonaPercepcao').textContent = `zona passiva: ${zonaPercepcao.toFixed(1).replace('.0','')}`;
      byId('oxigenioVal').textContent = `${oxigenio} s`;
      byId('capacidadeVal').textContent = `${capacidade} kg`;
      byId('pesoPenalty').textContent = pesoPenaltyText;
      byId('danoFisicoVal').textContent = `+${danoFisico}%`;
      byId('danoDistVal').textContent = `+${danoDistancia}%`;
      byId('craftVelVal').textContent = `+${craftVel}%`;
      byId('craftQualVal').textContent = `qualidade +${craftQual}%`;

      byId('vidaAtualMax').value = vidaMax;
      byId('torporAtualMax').value = torporMax;
      byId('staminaAtualMax').value = staminaMax;
      byId('pesoAtual').value = pesoAtual.toFixed(2).replace(/\.00$/, '');
      byId('pesoAtualMax').value = capacidade;
      byId('pesoUso').value = `${cargaPct.toFixed(1)}%`;
      byId('inventarioSlotsTotal').textContent = inventory.character.totalSlots;
      byId('inventarioSlotsUsados').textContent = inventory.character.used;
      byId('inventarioSlotsLivres').textContent = inventory.character.free;
      if (byId('mochilaSlotsTotalLabel')) byId('mochilaSlotsTotalLabel').textContent = inventory.backpack.totalSlots;
      if (byId('mochilaSlotsUsados')) byId('mochilaSlotsUsados').textContent = inventory.backpack.used;
      if (byId('mochilaSlotsLivres')) byId('mochilaSlotsLivres').textContent = inventory.backpack.free;

      updateBars('vidaAtual', vidaMax, 'vidaBar');
      updateBars('torporAtual', torporMax, 'torporBar');
      updateBars('staminaAtual', staminaMax, 'staminaBar');
      const pesoBarPct = capacidade <= 0 ? 0 : clamp((pesoAtual / capacidade) * 100, 0, 100);
      byId('pesoBar').style.width = `${pesoBarPct}%`;

      const postura = byId('postura').value;
      const armadura = byId('armadura').value;
      let posturaResumo = 'Postura ofensiva: funcionamento normal, sem custo.';
      if (postura === 'defensiva') posturaResumo = 'Postura defensiva: reduz o dano do personagem em 50%, aumenta a defesa em 50% e custa 10 de stamina.';
      if (postura === 'esquiva') posturaResumo = 'Postura de esquiva: custa 10 de stamina e depende da armadura. Leve usa d100/2 + destreza/2. Média usa d100/4 + destreza/4. Pesada não desvia.';
      if (armadura === 'media') posturaResumo += ' Armadura média: usa a fórmula reduzida de esquiva.';
      if (armadura === 'pesada') posturaResumo += ' Armadura pesada: não permite desvio.';
      byId('posturaResumo').textContent = posturaResumo;

      const armaEscala = byId('armaEscala').value;
      const escalaBonus = armaEscala === 'forca' ? Math.round(forca * 0.02 * 100) / 100 : armaEscala === 'destreza' ? Math.round(destreza * 0.02 * 100) / 100 : 0;
      const escalaPercentual = armaEscala === 'forca' ? danoFisico : armaEscala === 'destreza' ? danoDistancia : 0;
      byId('armaScaleValue').textContent = `+${escalaPercentual}%`;
      byId('armaScaleText').textContent = armaEscala === 'forca' ? 'escala por Força' : armaEscala === 'destreza' ? 'escala por Destreza' : 'sem escalonamento';

      const roll = clamp(Math.round(num('rolagemD20')), 1, 20);
      byId('rolagemD20').value = roll;
      const mult = d20Multiplier(roll);
      byId('multiD20').textContent = `${Math.round(mult * 100)}%`;

      const dadoBase = Math.max(0, num('danoBaseRolado'));
      const bonusArma = num('armaBonus');
      const extra = num('efeitoExtra');
      const bonusPercentualExtra = num('bonusPercentualExtra');
      let perkDamageBonus = 0;
      if (hasPerk('impacto_pesado')) perkDamageBonus += 10;
      if (hasPerk('derrubar_gigantes') && byId('tamanhoAlvo').value === 'grande') perkDamageBonus += 10;
      const percentualTotal = escalaPercentual + bonusPercentualExtra + perkDamageBonus;
      const baseSemMult = dadoBase + bonusArma + extra;
      const multiplicadorPosturaAtaque = postura === 'defensiva' ? 0.5 : 1;
      const danoBruto = baseSemMult * (1 + percentualTotal / 100) * mult * multiplicadorPosturaAtaque;
      const reducaoAlvo = clamp(num('reducaoArmaduraAlvo'), 0, 95);
      const danoFinal = danoBruto * (1 - reducaoAlvo / 100);
      const alvoAntes = Math.max(0, num('danoAplicadoAlvo'));
      const vidaRestanteAlvo = Math.max(0, alvoAntes - danoFinal);

      let damageReduction = clamp(num('reducaoArmadura') + reducaoDanoExtra, 0, 95);
      if (postura === 'defensiva') damageReduction = clamp(damageReduction + 50, 0, 95);

      const danoRecebidoBruto = Math.max(0, num('danoRecebidoBruto'));
      const rolagemEsquiva = clamp(Math.round(num('rolagemEsquiva') || 1), 1, 100);
      byId('rolagemEsquiva').value = rolagemEsquiva;
      const penalidadeEsquiva = num('penalidadeEsquiva');
      const esquivaAtiva = postura === 'esquiva';
      let formulaEsquivaValor = 0;
      if (esquivaAtiva) {
        if (armadura === 'leve') {
          formulaEsquivaValor = (rolagemEsquiva / 2) + (destreza / 2);
        } else if (armadura === 'media') {
          formulaEsquivaValor = (rolagemEsquiva / 4) + (destreza / 4);
        } else {
          formulaEsquivaValor = 0;
        }
      }
      const danoEsquivado = clamp(formulaEsquivaValor - penalidadeEsquiva, 0, danoRecebidoBruto);
      const danoAposEsquiva = Math.max(0, danoRecebidoBruto - danoEsquivado);
      const danoRecebidoFinal = danoAposEsquiva * (1 - damageReduction / 100);
      const vidaAposDanoRecebido = Math.max(0, num('vidaAtual') - danoRecebidoFinal);

      let esquivaCalcValor = 0;
      if (armadura === 'leve') esquivaCalcValor = 50 + destreza / 2;
      else if (armadura === 'media') esquivaCalcValor = 25 + destreza / 4;
      else esquivaCalcValor = 0;
      const esquivaCalc = esquivaCalcValor.toFixed(1).replace('.0','');

      byId('percentualTotalDano').textContent = `${percentualTotal >= 0 ? '+' : ''}${percentualTotal}%`;
      byId('danoBruto').textContent = danoBruto.toFixed(2).replace(/\.00$/, '');
      byId('danoFinal').textContent = danoFinal.toFixed(2).replace(/\.00$/, '');
      byId('vidaRestanteAlvo').value = alvoAntes > 0 ? vidaRestanteAlvo.toFixed(2).replace(/\.00$/, '') : '';
      byId('reducaoArmaduraRecebida').value = `${damageReduction}%`;
      byId('danoRecebidoFinal').value = danoRecebidoFinal.toFixed(2).replace(/\.00$/, '');
      byId('vidaAposDanoRecebido').value = vidaAposDanoRecebido.toFixed(2).replace(/\.00$/, '');
      byId('esquivaCalc').textContent = esquivaCalc;
      byId('esquivaBox').style.display = esquivaAtiva ? 'block' : 'none';
      byId('formulaEsquiva').value = formulaEsquivaValor.toFixed(2).replace(/\.00$/, '');
      byId('danoEsquivado').value = danoEsquivado.toFixed(2).replace(/\.00$/, '');
      byId('applyReceivedDamageBtn').disabled = danoRecebidoBruto <= 0;
      byId('ataqueResumo').textContent = `${byId('armaNome').value || 'Arma'} (${byId('armaDado').value || '-'})`;

      saveState();
    }

    window.applyDelta = function(type) {
      const currentId = `${type}Atual`;
      const deltaId = `${type}Delta`;
      const maxId = `${type}AtualMax`;
      const current = num(currentId);
      const delta = num(deltaId);
      const max = num(maxId);
      byId(currentId).value = clamp(current + delta, 0, max);
      byId(deltaId).value = 0;
      updateAll();
    }

    function actionCost() {
      let cost = parseFloat(byId('acaoRapida').value) || 0;
      if (hasPerk('trabalho_consciente')) cost *= 0.9;
      if (hasPerk('agilidade') && byId('acaoRapida').selectedOptions[0].text.toLowerCase().includes('ataque leve')) cost *= 0.9;
      return Math.round(cost * 100) / 100;
    }

    byId('useActionBtn').addEventListener('click', () => {
      const current = num('staminaAtual');
      byId('staminaAtual').value = Math.max(0, current - actionCost());
      updateAll();
    });

    byId('recoverStaminaBtn').addEventListener('click', () => {
      const max = num('staminaAtualMax');
      const resistencia = num('resistencia');
      let regenPct = 5 + Math.floor(resistencia / 10);
      if (hasPerk('senta_e_respira')) regenPct += 2;
      const amount = Math.round(max * regenPct / 100);
      byId('staminaAtual').value = clamp(num('staminaAtual') + amount, 0, max);
      updateAll();
    });

    byId('recoverHpBtn').addEventListener('click', () => {
      const max = num('vidaAtualMax');
      const constituicao = num('constituicao');
      let regenPct = 2 + Math.floor(constituicao / 10);
      const amount = Math.round(max * regenPct / 100);
      byId('vidaAtual').value = clamp(num('vidaAtual') + amount, 0, max);
      updateAll();
    });

    byId('dropTorporBtn').addEventListener('click', () => {
      const current = num('torporAtual');
      const drop = Math.round(num('torporAtualMax') * 0.05);
      byId('torporAtual').value = Math.max(0, current - drop);
      updateAll();
    });

    byId('applyReceivedDamageBtn').addEventListener('click', () => {
      const vidaAtual = num('vidaAtual');
      const danoFinal = Math.max(0, parseFloat(byId('danoRecebidoFinal').value) || 0);
      byId('vidaAtual').value = Math.max(0, vidaAtual - danoFinal);
      updateAll();
    });

    byId('applyDamageToTargetBtn').addEventListener('click', () => {
      const vidaAlvoAtual = Math.max(0, num('danoAplicadoAlvo'));
      const danoFinal = Math.max(0, parseFloat(byId('danoFinal').textContent.replace(',', '.')) || 0);
      byId('danoAplicadoAlvo').value = Math.max(0, vidaAlvoAtual - danoFinal).toFixed(2).replace(/\.00$/, '');
      updateAll();
    });

    byId('exportBtn').addEventListener('click', () => {
      saveState();
      renderExportChecklist();
      openModal(exportModal);
    });

    byId('importBtn').addEventListener('click', () => {
      pendingImportMode = 'append';
      const defaultOption = document.querySelector('input[name="importMode"][value="append"]');
      if (defaultOption) defaultOption.checked = true;
      openModal(importModal);
    });

    confirmExportBtn.addEventListener('click', () => {
      saveState();
      const mode = document.querySelector('input[name="exportMode"]:checked')?.value || 'active';
      const active = getActiveTab();
      if (mode === 'workspace') {
        downloadJson('ficha_ark_rpg_completa', buildWorkspaceExport(sheetStore.tabs));
      } else if (mode === 'selected-separate') {
        const selectedTabs = getSelectedExportTabs();
        if (!selectedTabs.length) {
          alert('Selecione pelo menos uma aba para exportar separadamente.');
          return;
        }
        selectedTabs.forEach((tab, index) => {
          setTimeout(() => downloadJson(normalizeTabName(tab.name, index + 1), tab.data || {}), index * 150);
        });
      } else {
        downloadJson(active?.name || 'ficha_ark_rpg', active?.data || {});
      }
      closeModal(exportModal);
    });

    cancelExportBtn.addEventListener('click', () => closeModal(exportModal));

    document.querySelectorAll('input[name="exportMode"]').forEach(radio => {
      radio.addEventListener('change', syncExportChecklistState);
    });

    chooseImportFileBtn.addEventListener('click', () => {
      pendingImportMode = document.querySelector('input[name="importMode"]:checked')?.value || 'append';
      closeModal(importModal);
      if (pendingImportMode === 'replace') {
        openModal(replaceImportModal);
        return;
      }
      byId('fileInput').click();
    });

    cancelImportBtn.addEventListener('click', () => closeModal(importModal));
    cancelReplaceImportBtn.addEventListener('click', () => closeModal(replaceImportModal));
    confirmReplaceImportBtn.addEventListener('click', () => {
      closeModal(replaceImportModal);
      byId('fileInput').click();
    });

    byId('fileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const importedTabs = normalizeImportedTabs(parsed, file.name);
        if (!importedTabs.length) throw new Error('empty');
        if (pendingImportMode === 'replace') {
          replaceWorkspaceWithImportedTabs(importedTabs);
        } else {
          appendImportedTabs(importedTabs);
        }
      } catch (err) {
        alert('Não foi possível importar o arquivo JSON.');
      } finally {
        pendingImportMode = 'append';
        e.target.value = '';
      }
    });

    byId('printBtn').addEventListener('click', () => window.print());
    byId('resetBtn').addEventListener('click', () => {
      const active = getActiveTab();
      if (!active) return;
      if (!confirm('Isso vai limpar apenas a ficha atual. Deseja continuar?')) return;
      active.data = makeBlankState();
      active.name = defaultTabName(sheetStore.tabs.indexOf(active) + 1);
      persistSheetStore();
      renderTabs();
      applyStateToForm(active.data);
      createInventoryRows(true);
      updateAll();
    });

    byId('addTabBtn').addEventListener('click', () => {
      saveState();
      createTab({}, defaultTabName(sheetStore.tabs.length + 1));
    });

    byId('tabsBar').addEventListener('click', (e) => {
      const closeBtn = e.target.closest('[data-close-tab]');
      if (closeBtn) {
        e.stopPropagation();
        openCloseTabModal(closeBtn.dataset.closeTab);
        return;
      }
      const tabBtn = e.target.closest('[data-tab-id]');
      if (tabBtn) {
        switchTab(tabBtn.dataset.tabId);
      }
    });

    cancelCloseTabBtn.addEventListener('click', () => {
      closeCloseTabModal();
    });

    confirmCloseTabBtn.addEventListener('click', () => {
      if (pendingCloseTabId) {
        closeTab(pendingCloseTabId);
      }
      closeCloseTabModal();
    });

    closeTabModal.addEventListener('click', (e) => {
      if (e.target === closeTabModal) {
        closeCloseTabModal();
      }
    });

    [exportModal, importModal, replaceImportModal].forEach(modal => {
      if (!modal) return;
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal(modal);
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !closeTabModal.classList.contains('hidden')) {
        closeCloseTabModal();
        return;
      }
      if (e.key === 'Escape') {
        closeAllSecondaryModals();
      }
    });

    document.addEventListener('input', (e) => {
      if (e.target.matches('input, select, textarea')) updateAll();
    });
    document.addEventListener('change', (e) => {
      if (e.target.matches('input, select, textarea')) updateAll();
    });

    createPerks();
    loadState();
    createInventoryRows(true);
    updateAll();


