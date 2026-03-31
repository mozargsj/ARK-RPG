/* ─── APP STATE ─── */

let currentUser = null;
let currentRole = null;

let viewingUid = null;   // uid sendo visualizado por admin/master
let isReadOnly = false;

let saveTimer = null;
let sheetInitialized = false;

let sheetStore = null;
let activeTabId = null;
