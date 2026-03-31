/* ════════════════════════════════════════
   SHEET ENGINE (v18 CLEAN)
════════════════════════════════════════ */

const STORAGE_KEY = 'ark-rpg-ficha-tabs-v1';
const DEFAULT_TAB_NAME = 'Nova ficha';

let sheetStore = { activeId: null, tabs: [] };
let pendingCloseTabId = null;
let pendingImportMode = 'append';


/* ─────────────────────────────
   DOM REFERENCES
───────────────────────────── */

const closeTabModal = byId('closeTabModal');
const closeTabMessage = byId('closeTabMessage');

const exportModal = byId('exportModal');
const importModal = byId('importModal');
const replaceImportModal = byId('replaceImportModal');

const exportTabsChecklist = byId('exportTabsChecklist');

const cancelCloseTabBtn = byId('cancelCloseTabBtn');
const confirmCloseTabBtn = byId('confirmCloseTabBtn');

const cancelExportBtn = byId('cancelExportBtn');
const confirmExportBtn = byId('confirmExportBtn');

const cancelImportBtn = byId('cancelImportBtn');
const chooseImportFileBtn = byId('chooseImportFileBtn');

const cancelReplaceImportBtn = byId('cancelReplaceImportBtn');
const confirmReplaceImportBtn = byId('confirmReplaceImportBtn');


/* ─────────────────────────────
   HELPERS
───────────────────────────── */

function uniqueId() {
  return `ficha_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultTabName(i = 1) {
  return `${DEFAULT_TAB_NAME} ${i}`;
}

function makeBlankState() {
  return {};
}

function getActiveTab() {
  return sheetStore.tabs.find(t => t.id === sheetStore.activeId) || null;
}

function normalizeTabName(name, fallbackIndex = 1) {
  const clean = String(name || '').trim();
  return clean || defaultTabName(fallbackIndex);
}


/* ─────────────────────────────
   FIRESTORE SAVE
───────────────────────────── */

function persistSheetStore() {

  if (isReadOnly || !currentUser) return;

  clearTimeout(saveTimer);

  saveTimer = setTimeout(async () => {

    try {

      await db.collection('sheets')
        .doc(currentUser.uid)
        .set({

          ownerUid: currentUser.uid,
          ownerName: currentUser.displayName || currentUser.email,
          ownerEmail: currentUser.email,
          ownerPhoto: currentUser.photoURL || '',

          sheetStore: JSON.parse(JSON.stringify(sheetStore)),

          updatedAt: firebase.firestore.FieldValue.serverTimestamp()

        });

    } catch (e) {

      console.error('Save error:', e);

    }

  }, 1200);
}


/* ─────────────────────────────
   TAB RENDER
───────────────────────────── */

function renderTabs() {

  const bar = byId('tabsBar');
  if (!bar) return;

  bar.innerHTML = '';

  sheetStore.tabs.forEach((tab, index) => {

    const btn = document.createElement('div');

    btn.className =
      `tab-btn${tab.id === sheetStore.activeId ? ' active' : ''}`;

    btn.dataset.tabId = tab.id;

    btn.innerHTML = `
      <span class="tab-name">
        ${normalizeTabName(tab.name, index + 1)}
      </span>

      <button
        type="button"
        class="tab-close"
        data-close-tab="${tab.id}"
        title="Fechar ficha"
      >
        ×
      </button>
    `;

    bar.appendChild(btn);

  });
}


/* ─────────────────────────────
   STATE SAVE
───────────────────────────── */

function saveActiveTabState() {

  const active = getActiveTab();

  if (!active) return;

  active.data = captureCurrentState();

  active.name =
    normalizeTabName(
      active.data.nome,
      sheetStore.tabs.indexOf(active) + 1
    );

  persistSheetStore();

  renderTabs();

}

function saveState() {
  saveActiveTabState();
}


/* ─────────────────────────────
   TAB CRUD
───────────────────────────── */

function createTab(initialData = {}, preferredName = '') {

  const tab = {

    id: uniqueId(),

    name:
      normalizeTabName(
        preferredName || initialData.nome,
        sheetStore.tabs.length + 1
      ),

    data:
      {
        ...makeBlankState(),
        ...initialData
      }

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


/* ─────────────────────────────
   CLOSE TAB
───────────────────────────── */

function openCloseTabModal(tabId) {

  const tab =
    sheetStore.tabs.find(t => t.id === tabId);

  if (!tab) return;

  pendingCloseTabId = tabId;

  closeTabMessage.innerHTML =
    `Você tem certeza que quer fechar a aba
     <strong>${normalizeTabName(tab.name)}</strong>?`;

  closeTabModal.classList.remove('hidden');

}


function closeCloseTabModal() {

  pendingCloseTabId = null;

  closeTabModal.classList.add('hidden');

}


function closeTab(tabId) {

  const index =
    sheetStore.tabs.findIndex(t => t.id === tabId);

  if (index === -1) return;

  sheetStore.tabs.splice(index, 1);

  if (!sheetStore.tabs.length) {

    const tab = {

      id: uniqueId(),

      name: defaultTabName(1),

      data: makeBlankState()

    };

    sheetStore.tabs = [tab];

  }

  if (!sheetStore.tabs.some(t => t.id === sheetStore.activeId)) {

    sheetStore.activeId =
      sheetStore.tabs[Math.max(0, index - 1)].id;

  }

  persistSheetStore();

  renderTabs();

  const active = getActiveTab();

  applyStateToForm(active ? active.data : {});

  createInventoryRows(true);

  updateAll();

}


/* ─────────────────────────────
   INITIAL LOAD
───────────────────────────── */

function hydrateActiveTab() {

  const active = getActiveTab();

  renderTabs();

  applyStateToForm(active ? active.data : {});

}


/* ─────────────────────────────
   START ENGINE
───────────────────────────── */

createPerks();

hydrateActiveTab();

createInventoryRows(true);

updateAll();
