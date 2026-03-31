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

  function openCloseTabModal(tabId) {
    const tab = sheetStore.tabs.find(t => t.id === tabId);
    if (!tab) return;
    pendingCloseTabId = tabId;
    byId('closeTabMessage').innerHTML = `Fechar <strong>${normalizeTabName(tab.name)}</strong>? Os dados serão perdidos.`;
    closeTabModal.classList.remove('hidden');
    closeTabModal.setAttribute('aria-hidden','false');
  }

  function closeCloseTabModal() { pendingCloseTabId = null; closeTabModal.classList.add('hidden'); closeTabModal.setAttribute('aria-hidden','true'); }
