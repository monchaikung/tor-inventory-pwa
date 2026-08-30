// ============ CONFIGURATION ============
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbyi7t8TsH6fFblM01lMv0PB1-C_cnFv4pgmaG44NTydk15KNgAYSc9BbqB13GeNMUIiKw/exec';
const GOOGLE_CLIENT_ID = '869989444444-o666m973d6ofrfnaip7g0lthsmi6l5g3.apps.googleusercontent.com';

const HAND_CARRY_OPTIONS = [
  { id: 'personal-bag', label: '隨身背囊', sub: 'Personal Item', icon: '🎒' },
  { id: 'cabin-20', label: '上機行李箱 (20吋)', sub: '20" Cabin Bag', icon: '🧳' },
  { id: 'cabin-large', label: '上機大行李箱', sub: 'Large Cabin Suitcase', icon: '🧳' }
];

const STATUS_OPTIONS = [
  { value: '待整理', label: '待整理 To Sort' },
  { value: '待打包', label: '待打包 To Pack' },
  { value: '已打包', label: '已打包 Packed' },
  { value: '已入箱', label: '已入箱 In Box' },
  { value: '已寄出', label: '已寄出 Shipped' }
];

const STATUS_CLASS = {
  '待整理': 'status-to-sort',
  '待打包': 'status-to-pack',
  '已打包': 'status-packed',
  '已入箱': 'status-in-box',
  '已寄出': 'status-shipped'
};

let allItems = [];
let currentImageBase64 = null;
let transportMode = 'shipped';
let selectedHandCarry = '';
let selectedStatus = '待整理';
let filterTransport = '';
let filterStatus = '';
let filterLocation = '';

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  }

  if (sessionStorage.getItem('idToken')) { showMainApp(); loadAllItems(); } else showLoginScreen();
  initGoogleSignIn();
  bindEvents();
});

function bindEvents() {
  $('signOutBtn').addEventListener('click', signOut);
  $('takePhotoBtn').addEventListener('click', () => $('cameraInput').click());
  $('importPhotoBtn').addEventListener('click', () => $('importInput').click());
  $('cameraInput').addEventListener('change', handlePhotoCapture);
  $('importInput').addEventListener('change', handlePhotoImport);
  $('changePhotoBtn').addEventListener('click', clearPhoto);
  $('saveBtn').addEventListener('click', saveItem);
  $('searchInput').addEventListener('input', onSearchInput);
  $('searchClear').addEventListener('click', clearSearch);
  $('handCarryPickerBtn').addEventListener('click', openHandCarryPicker);
  $('statusPickerBtn').addEventListener('click', openStatusPicker);
  $('actionSheetCancel').addEventListener('click', closeActionSheet);
  $('actionSheetOverlay').addEventListener('click', (e) => { if (e.target === $('actionSheetOverlay')) closeActionSheet(); });
  $('dismissInstallBanner')?.addEventListener('click', dismissInstallBanner);
  $('modeShipped').addEventListener('click', () => setTransportMode('shipped'));
  $('modeHandCarry').addEventListener('click', () => setTransportMode('handcarry'));
  document.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  document.querySelectorAll('#transportChips .ios-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#transportChips .ios-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      filterTransport = chip.dataset.transport;
      filterLocation = '';
      renderFilteredList();
    });
  });
  document.querySelectorAll('#statusChips .ios-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#statusChips .ios-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      filterStatus = chip.dataset.status;
      renderFilteredList();
    });
  });
}

function initGoogleSignIn() {
  const tryInit = () => {
    if (!window.google?.accounts?.id) { setTimeout(tryInit, 200); return; }
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredentialResponse });
    google.accounts.id.renderButton($('googleSignInBtn'), { theme: 'outline', size: 'large', text: 'signin_with', width: 280 });
  };
  tryInit();
}

function handleCredentialResponse(response) {
  sessionStorage.setItem('idToken', response.credential);
  $('loginError').classList.add('hidden');
  showMainApp();
  loadAllItems();
}

function getIdToken() {
  const token = sessionStorage.getItem('idToken');
  if (!token) { showLoginScreen(); return null; }
  return token;
}

function signOut() {
  sessionStorage.removeItem('idToken');
  allItems = [];
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
  showLoginScreen();
}

function showLoginScreen() { $('loginScreen').classList.remove('hidden'); $('mainApp').classList.add('hidden'); }
function showMainApp() {
  $('loginScreen').classList.add('hidden');
  $('mainApp').classList.remove('hidden');
  showInstallBannerIfNeeded();
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function showInstallBannerIfNeeded() {
  const banner = $('installBanner');
  if (!banner) return;
  if (isStandalone() || localStorage.getItem('installBannerDismissed') === '1') {
    banner.classList.add('hidden');
    return;
  }
  if (isIOS() || /Android/i.test(navigator.userAgent)) {
    banner.classList.remove('hidden');
  }
}

function dismissInstallBanner() {
  localStorage.setItem('installBannerDismissed', '1');
  $('installBanner')?.classList.add('hidden');
}

async function apiCall(payload) {
  const idToken = getIdToken();
  if (!idToken) throw new Error('Not signed in');
  const res = await fetch(GAS_API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ ...payload, idToken }) });
  let data;
  try { data = JSON.parse(await res.text()); } catch { throw new Error('Invalid server response. Check GAS deployment URL.'); }
  if (!data.success) {
    if (data.error?.includes('denied')) { $('loginError').textContent = 'Access denied.'; $('loginError').classList.remove('hidden'); signOut(); }
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function handlePhotoCapture(e) { processImageFile(e.target.files[0]); e.target.value = ''; }
function handlePhotoImport(e) { processImageFile(e.target.files[0]); e.target.value = ''; }

function processImageFile(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { showToast('Image too large. Max 10 MB.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = async (ev) => {
    currentImageBase64 = ev.target.result.split(',')[1];
    $('photoPreview').src = ev.target.result;
    $('photoPreviewWrap').classList.remove('hidden');
    $('photoLoading').classList.remove('hidden');
    try { await analyzeWithAI(currentImageBase64); } catch (err) { showToast(err.message, 'error'); }
    finally { $('photoLoading').classList.add('hidden'); }
  };
  reader.readAsDataURL(file);
}

function clearPhoto() {
  currentImageBase64 = null;
  $('photoPreview').src = '';
  $('photoPreviewWrap').classList.add('hidden');
  $('cameraInput').value = '';
  $('importInput').value = '';
}

async function analyzeWithAI(base64Image) {
  const data = await apiCall({ action: 'analyze', image: base64Image });
  fillFormFromAI(data.suggestions || data);
}

function fillFormFromAI(data) {
  if (data.transportMode === 'handcarry' || data.transportMode === '手提') {
    setTransportMode('handcarry');
    if (data.location) setHandCarry(data.location);
  } else {
    setTransportMode('shipped');
    if (data.location || data.boxNumber) $('boxNumber').value = data.location || data.boxNumber || '';
  }
  if (data.roomCategory) $('roomCategory').value = data.roomCategory;
  if (data.itemDescription) $('itemDescription').value = data.itemDescription;
  if (data.quantity) $('quantity').value = data.quantity;
  if (data.size) $('size').value = data.size;
  if (data.weight) $('weight').value = data.weight;
  if (data.estimatedValue) $('estimatedValue').value = data.estimatedValue;
}

function setTransportMode(mode) {
  transportMode = mode;
  $('modeShipped').classList.toggle('active', mode === 'shipped');
  $('modeHandCarry').classList.toggle('active', mode === 'handcarry');
  $('locationRowShipped').classList.toggle('hidden', mode !== 'shipped');
  $('locationRowHandCarry').classList.toggle('hidden', mode !== 'handcarry');
}

function setHandCarry(label) {
  selectedHandCarry = label;
  const opt = HAND_CARRY_OPTIONS.find((o) => o.label === label);
  if (opt) $('handCarryPickerBtn').textContent = `${opt.icon} ${opt.label} ›`;
}

function openHandCarryPicker() {
  openActionSheet(HAND_CARRY_OPTIONS.map((o) => ({ label: `${o.icon} ${o.label}`, value: o.label, selected: selectedHandCarry === o.label })), setHandCarry);
}

function openStatusPicker() {
  openActionSheet(STATUS_OPTIONS.map((o) => ({ label: o.label, value: o.value, selected: selectedStatus === o.value })), (v) => {
    selectedStatus = v;
    $('statusPickerBtn').textContent = `${v} ›`;
  });
}

function openActionSheet(options, callback) {
  const container = $('actionSheetOptions');
  container.innerHTML = '';
  options.forEach((opt) => {
    const btn = document.createElement('button');
    btn.className = 'action-sheet-btn' + (opt.selected ? ' selected' : '');
    btn.textContent = opt.label;
    btn.addEventListener('click', () => { callback(opt.value); closeActionSheet(); });
    container.appendChild(btn);
  });
  $('actionSheetOverlay').classList.add('show');
}

function closeActionSheet() { $('actionSheetOverlay').classList.remove('show'); }

async function saveItem() {
  const transportLabel = transportMode === 'shipped' ? '寄箱' : '手提';
  const location = transportMode === 'shipped' ? $('boxNumber').value.trim() : selectedHandCarry;
  if (!location) { showToast(transportMode === 'shipped' ? 'Enter box number.' : 'Select hand-carry bag.', 'error'); return; }
  if (!$('itemDescription').value.trim()) { showToast('Enter item description.', 'error'); return; }
  if (!currentImageBase64) { showToast('Take or import a photo first.', 'error'); return; }
  $('saveBtn').disabled = true;
  $('saveBtn').textContent = 'Saving…';
  try {
    await apiCall({
      action: 'save', transportMode: transportLabel, location,
      roomCategory: $('roomCategory').value.trim(),
      itemDescription: $('itemDescription').value.trim(),
      quantity: $('quantity').value || '1',
      size: $('size').value.trim(), weight: $('weight').value.trim(),
      estimatedValue: $('estimatedValue').value.trim(),
      status: selectedStatus, image: currentImageBase64
    });
    showToast('Item saved!', 'success');
    clearForm();
    await loadAllItems();
  } catch (err) { showToast(err.message, 'error'); }
  finally { $('saveBtn').disabled = false; $('saveBtn').textContent = 'Save to Google Drive'; }
}

function clearForm() {
  $('boxNumber').value = '';
  selectedHandCarry = '';
  $('handCarryPickerBtn').textContent = 'Select bag ›';
  ['roomCategory','itemDescription','size','weight','estimatedValue'].forEach((id) => $(id).value = '');
  $('quantity').value = '1';
  selectedStatus = '待整理';
  $('statusPickerBtn').textContent = '待整理 ›';
  setTransportMode('shipped');
  clearPhoto();
}

async function loadAllItems() {
  try {
    const data = await apiCall({ action: 'search', query: '' });
    allItems = data.items || [];
    localStorage.setItem('torItems', JSON.stringify(allItems));
  } catch (err) {
    const cached = localStorage.getItem('torItems');
    if (cached) allItems = JSON.parse(cached);
    showToast(err.message, 'error');
  }
  renderFilteredList();
  renderBoxSummary();
  renderProgressBars();
}

function getFilteredItems() {
  const query = ($('searchInput')?.value || '').toLowerCase().trim();
  return allItems.filter((item) => {
    if (filterTransport && item.transportMode !== filterTransport) return false;
    if (filterStatus && item.status !== filterStatus) return false;
    if (filterLocation && item.location !== filterLocation) return false;
    if (!query) return true;
    return [item.location, item.itemDescription, item.roomCategory, item.transportMode, item.status].join(' ').toLowerCase().includes(query);
  });
}

function onSearchInput() {
  $('searchClear').style.display = $('searchInput').value ? 'block' : 'none';
  renderFilteredList();
}

function clearSearch() {
  $('searchInput').value = '';
  $('searchClear').style.display = 'none';
  filterLocation = '';
  renderFilteredList();
}

function renderFilteredList() {
  const items = getFilteredItems();
  const total = allItems.length;
  if ($('resultCount')) $('resultCount').textContent = items.length === total ? `Showing ${total} items` : `Showing ${items.length} of ${total}`;
  const list = $('itemList');
  if (!items.length) { list.innerHTML = '<div class="empty-state">No items found.</div>'; return; }
  list.innerHTML = items.map(renderItemCard).join('');
  list.querySelectorAll('.status-badge').forEach((badge) => {
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = allItems.find((i) => i.timestamp === badge.dataset.timestamp);
      if (item) cycleStatus(item);
    });
  });
  list.querySelectorAll('.item-card').forEach((card) => {
    card.addEventListener('click', () => card.querySelector('.item-detail')?.classList.toggle('hidden'));
  });
}

function renderItemCard(item) {
  const icon = item.transportMode === '手提' ? '🎒' : '📦';
  const thumb = item.photoLink ? `<img class="item-thumb" src="${item.photoLink}" alt="" loading="lazy">` : '<div class="item-thumb item-thumb-placeholder">📷</div>';
  const sc = STATUS_CLASS[item.status] || 'status-to-sort';
  return `<div class="item-card"><div class="item-card-main">${thumb}<div class="item-info"><div class="item-title">${esc(item.itemDescription)}</div><div class="item-subtitle">${icon} ${esc(item.location)} · ${esc(item.roomCategory||'')}</div></div><span class="status-badge ${sc}" data-timestamp="${esc(item.timestamp)}">${esc(item.status||'待整理')}</span><span class="item-chevron">›</span></div><div class="item-detail hidden"><p>運送: ${esc(item.transportMode)} · Qty: ${esc(item.quantity||'1')}</p><p>尺寸: ${esc(item.size||'—')} · 重量: ${esc(item.weight||'—')}</p><p>£${esc(item.estimatedValue||'—')} · ${esc(item.timestamp||'')}</p>${item.photoLink?`<a href="${item.photoLink}" target="_blank" style="color:#007AFF">View Photo</a>`:''}</div></div>`;
}

async function cycleStatus(item) {
  const idx = STATUS_OPTIONS.findIndex((s) => s.value === item.status);
  const next = STATUS_OPTIONS[(idx + 1) % STATUS_OPTIONS.length];
  try {
    await apiCall({ action: 'update', timestamp: item.timestamp, status: next.value });
    item.status = next.value;
    renderFilteredList(); renderBoxSummary(); renderProgressBars();
    showToast(`Status → ${next.value}`, 'success');
  } catch (err) { showToast(err.message, 'error'); }
}

function renderProgressBars() {
  const t = allItems.length, p = allItems.filter((i) => ['已打包','已入箱','已寄出'].includes(i.status)).length;
  const ib = allItems.filter((i) => i.status === '已入箱').length, sh = allItems.filter((i) => i.status === '已寄出').length;
  const text = `📦 ${t} items · ✅ ${p} packed · 📥 ${ib} in box · 🚚 ${sh} shipped`;
  if ($('progressBar')) $('progressBar').textContent = text;
  if ($('progressBarBoxes')) $('progressBarBoxes').textContent = text;
}

function renderBoxSummary() {
  const container = $('boxSummary');
  const shipped = {}, handCarry = {};
  HAND_CARRY_OPTIONS.forEach((o) => { handCarry[o.label] = { items: [], packed: 0, weight: 0 }; });
  allItems.forEach((item) => {
    const bucket = item.transportMode === '手提' ? handCarry : shipped;
    const key = item.location || 'Unknown';
    if (!bucket[key]) bucket[key] = { items: [], packed: 0, weight: 0 };
    bucket[key].items.push(item);
    if (['已打包','已入箱','已寄出'].includes(item.status)) bucket[key].packed++;
    bucket[key].weight += parseWeight(item.weight);
  });
  let html = '<p class="location-section-title">寄箱 Shipped</p>';
  const boxKeys = Object.keys(shipped).sort();
  html += boxKeys.length ? boxKeys.map((k) => locRow(`📦 Box ${k}`, shipped[k], k, 'shipped')).join('') : '<div class="empty-state" style="padding:16px">No shipped items yet.</div>';
  html += '<p class="location-section-title">手提 Hand Carry</p>';
  html += HAND_CARRY_OPTIONS.map((o) => locRow(`${o.icon} ${o.label}`, handCarry[o.label]||{items:[],packed:0,weight:0}, o.label, 'handcarry')).join('');
  container.innerHTML = html;
  container.querySelectorAll('.location-row').forEach((row) => {
    row.addEventListener('click', () => {
      filterLocation = row.dataset.location;
      filterTransport = row.dataset.transport === 'handcarry' ? '手提' : '寄箱';
      document.querySelectorAll('#transportChips .ios-chip').forEach((c) => c.classList.toggle('active', c.dataset.transport === filterTransport));
      switchTab('items');
    });
  });
}

function locRow(title, b, location, transport) {
  return `<div class="location-row" data-location="${esc(location)}" data-transport="${transport}"><div><div style="font-weight:500">${title}</div><div style="font-size:13px;color:#8E8E93;margin-top:2px">${b.items.length} items · ${b.packed} packed · ${fmtW(b.weight)}</div></div><span style="color:#8E8E93">›</span></div>`;
}

function parseWeight(w) { const n = parseFloat(String(w||'').replace(/[^0-9.]/g,'')); return isNaN(n)?0:n; }
function fmtW(w) { return w>0?`${w.toFixed(1)}kg`:'—'; }

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const titles = { log: 'Log Item', items: 'Inventory', boxes: 'Boxes' };
  $('navTitle').textContent = titles[tab] || 'ToR Log';
  if (tab === 'log') $('screenLog').classList.add('active');
  if (tab === 'items') { $('screenItems').classList.add('active'); renderFilteredList(); }
  if (tab === 'boxes') { $('screenBoxes').classList.add('active'); renderBoxSummary(); renderProgressBars(); }
}

function showToast(msg, type='success') {
  const t = $('toast'); t.textContent = msg; t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

function esc(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = String(str); return d.innerHTML; }
