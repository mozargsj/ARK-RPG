/* ─── SCREEN MANAGER ─── */
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id + '-screen').classList.add('active');
  }
  
  function closeApplyPointsModal() {
    document.getElementById("applyPointsModal").style.display = "none";
  }
  
  async function applyPoints() {

    const checkbox = document.getElementById("dontShowAgainPoints");
  
    if (checkbox.checked) {
      localStorage.setItem("skipApplyPointsConfirm", "true");
    }
  
    document.getElementById("applyPointsModal").style.display = "none";
  
    await lockPointInputs();
  
    persistSheetStore();
  }

  async function lockPointInputs() {
    document
      .querySelectorAll("#bonusPontos, #perkBonus")
      .forEach(el => el.disabled = true);
  
    document.getElementById("applyPointsBtn").disabled = true;
  
    if (!currentUser) return;
  
    await db.collection("sheets")
      .doc(currentUser.uid)
      .set({ pointsLocked: true }, { merge: true });
}

function confirmApplyPoints() {

  const skip = localStorage.getItem("skipApplyPointsConfirm");

  if (skip === "true") {
    applyPoints();
    return;
  }

  document.getElementById("applyPointsModal").style.display = "flex";
}

  function openCloseTabModal(tabId) {
    const tab = sheetStore.tabs.find(t => t.id === tabId);
    if (!tab) return;
    pendingCloseTabId = tabId;
    byId('closeTabMessage').innerHTML = `Fechar <strong>${normalizeTabName(tab.name)}</strong>? Os dados serão perdidos.`;
    closeTabModal.classList.remove('hidden');
    closeTabModal.setAttribute('aria-hidden','false');
  }

  function closeCloseTabModal() { pendingCloseTabId = null; closeTabModal.classList.add('hidden'); closeTabModal.setAttribute('aria-hidden','true'); }

function closeTab(tabId) {
    const idx = sheetStore.tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;
    sheetStore.tabs.splice(idx, 1);
    if (!sheetStore.tabs.length) { const t={id:uniqueId(),name:defaultTabName(1),data:makeBlankState()}; sheetStore.tabs=[t]; }
    if (!sheetStore.tabs.some(t => t.id === sheetStore.activeId)) sheetStore.activeId = sheetStore.tabs[Math.max(0,idx-1)].id;
    persistSheetStore();
    renderTabs();
    const active = getActiveTab();
    applyStateToForm(active ? active.data : {});
    createInventoryRows(true);
    updateAll();
  }
