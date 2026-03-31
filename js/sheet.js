
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
