// ============ CONFIGURATION ============
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbx2MqsAgSxPfXUK6BqWqlTTEISadDDM-wzYpMRIcICTbG089GSaFj7AUeOStVBPSm-XSA/exec';
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
let editingTimestamp = null;
let editingPhotoLink = '';
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
  $('cancelEditBtn')?.addEventListener('click', cancelEdit);
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
  cancelEdit();
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

async function apiCall(payload, retries = 2) {
  const idToken = getIdToken();
  if (!idToken) throw new Error('Not signed in');

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(GAS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...payload, idToken }),
        redirect: 'follow'
      });
      const raw = await res.text();
      let data;
      try { data = JSON.parse(raw); } catch {
        throw new Error('Invalid server response. Check GAS deployment URL.');
      }
      if (!data.success) {
        if (data.error?.includes('denied')) {
          $('loginError').textContent = 'Access denied. Please sign in again.';
          $('loginError').classList.remove('hidden');
          signOut();
        }
        throw new Error(data.error || 'Request failed');
      }
      return data;
    } catch (err) {
      lastErr = err;
      const msg = String(err.message || err);
      const network = /load failed|failed to fetch|networkerror|network request failed/i.test(msg);
      if (!network || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }

  const msg = String(lastErr?.message || lastErr || 'Request failed');
  if (/load failed|failed to fetch|networkerror|network request failed/i.test(msg)) {
    throw new Error('Network error. Check Wi-Fi and try again. 網路不穩，請再試。');
  }
  throw lastErr;
}

let photoStatusTimer = null;

const PHOTO_STATUS_STEPS = [
  'Compressing photo… 壓縮照片',
  'Uploading to server… 上載中',
  'Checking with Gemini… 正在分析',
  'Waiting for AI reply… 等候回覆',
  'Almost done… 快完成'
];

function setPhotoStatus(msg) {
  const el = $('photoStatusText');
  if (el) el.textContent = msg;
}

function startPhotoStatus() {
  stopPhotoStatus();
  let i = 0;
  setPhotoStatus(PHOTO_STATUS_STEPS[0]);
  photoStatusTimer = setInterval(() => {
    i = Math.min(i + 1, PHOTO_STATUS_STEPS.length - 1);
    setPhotoStatus(PHOTO_STATUS_STEPS[i]);
  }, 1500);
}

function stopPhotoStatus() {
  if (photoStatusTimer) {
    clearInterval(photoStatusTimer);
    photoStatusTimer = null;
  }
}

function showPhotoLoading(msg) {
  startPhotoStatus();
  if (msg) setPhotoStatus(msg);
  $('photoLoading')?.classList.remove('hidden');
}

function hidePhotoLoading() {
  stopPhotoStatus();
  $('photoLoading')?.classList.add('hidden');
}

function handlePhotoCapture(e) { processImageFile(e.target.files[0]); e.target.value = ''; }
function handlePhotoImport(e) { processImageFile(e.target.files[0]); e.target.value = ''; }

function compressImageFile(file, maxDim = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read photo.'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w >= h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Could not process photo.'));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function processImageFile(file) {
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) { showToast('Image too large. Max 15 MB.', 'error'); return; }
  showPhotoLoading('Reading photo… 讀取照片');
  $('photoPreviewWrap').classList.remove('hidden');
  try {
    setPhotoStatus('Compressing photo… 壓縮照片');
    const dataUrl = await compressImageFile(file);
    currentImageBase64 = dataUrl.split(',')[1];
    $('photoPreview').src = dataUrl;
    setPhotoStatus('Uploading to server… 上載中');
    const filled = await analyzeWithAI(currentImageBase64);
    setPhotoStatus('Done! Filling form… 完成');
    if (filled) showToast('AI filled the form 已自動填寫', 'success');
    else showToast('AI returned no details. Please fill manually. 請手動填寫', 'error');
  } catch (err) {
    showToast(err.message || 'Photo failed.', 'error');
  } finally {
    hidePhotoLoading();
  }
}

function clearPhoto() {
  currentImageBase64 = null;
  $('photoPreview').src = '';
  $('photoPreviewWrap').classList.add('hidden');
  $('cameraInput').value = '';
  $('importInput').value = '';
  if (editingTimestamp && editingPhotoLink) {
    $('photoPreview').src = editingPhotoLink;
    $('photoPreviewWrap').classList.remove('hidden');
  }
}

async function analyzeWithAI(base64Image) {
  const cacheKey = 'torAnalyze_' + hashBase64Sample(base64Image);
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed && parsed.itemDescription) {
        setPhotoStatus('Using cached result 使用快取');
        return fillFormFromAI(parsed);
      }
    } catch (_) {}
    sessionStorage.removeItem(cacheKey);
  }

  setPhotoStatus('Checking with Gemini… 正在分析');
  const data = await apiCall({ action: 'analyze', image: base64Image });
  setPhotoStatus('Waiting for return… 處理回覆');
  let suggestions = data.suggestions || data;
  if (typeof suggestions === 'string') {
    try { suggestions = JSON.parse(suggestions); } catch (_) { suggestions = {}; }
  }
  if (suggestions && suggestions.suggestions) suggestions = suggestions.suggestions;
  const filled = fillFormFromAI(suggestions);
  if (filled) sessionStorage.setItem(cacheKey, JSON.stringify(suggestions));
  return filled;
}

function hashBase64Sample(b64) {
  const sample = b64.slice(0, 1500) + b64.length + b64.slice(-1500);
  let h = 0;
  for (let i = 0; i < sample.length; i++) h = ((h << 5) - h + sample.charCodeAt(i)) | 0;
  return String(h);
}

function pickAiField(data, keys) {
  for (const k of keys) {
    const v = data?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
}

function fillFormFromAI(data) {
  if (!data || typeof data !== 'object') return false;

  const transportRaw = String(pickAiField(data, ['transportMode', 'transport_mode', '運送方式', 'mode'])).toLowerCase();
  const location = String(pickAiField(data, ['location', 'boxNumber', 'box_number', '存放位置', '箱號']));
  const roomCategory = String(pickAiField(data, ['roomCategory', 'room_category', '房間分類', 'room']));
  const itemDescription = String(pickAiField(data, ['itemDescription', 'item_description', 'description', '物品描述', 'desc']));
  const quantity = pickAiField(data, ['quantity', 'qty', '數量']) || '1';
  const size = String(pickAiField(data, ['size', '尺寸']));
  const weight = String(pickAiField(data, ['weight', '重量']));
  const estimatedValue = pickAiField(data, ['estimatedValue', 'estimated_value', 'value', '預估價值']);

  if (transportRaw.includes('hand') || transportRaw.includes('手提')) {
    setTransportMode('handcarry');
    if (location) setHandCarry(location);
  } else {
    setTransportMode('shipped');
    if (location) $('boxNumber').value = location;
  }

  if (roomCategory) $('roomCategory').value = roomCategory;
  if (itemDescription) $('itemDescription').value = itemDescription;
  if (quantity) $('quantity').value = quantity;
  if (size) $('size').value = size;
  if (weight) $('weight').value = weight;
  if (estimatedValue !== '') $('estimatedValue').value = estimatedValue;

  return Boolean(itemDescription);
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
  else $('handCarryPickerBtn').textContent = `${label} ›`;
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
    btn.className = 'action-sheet-btn' + (opt.selected ? ' selected' : '') + (opt.destructive ? ' destructive' : '');
    btn.textContent = opt.label;
    btn.addEventListener('click', () => { callback(opt.value); closeActionSheet(); });
    container.appendChild(btn);
  });
  $('actionSheetOverlay').classList.add('show');
}

function closeActionSheet() { $('actionSheetOverlay').classList.remove('show'); }

function updateSaveButtonLabel() {
  if (!$('saveBtn')) return;
  if ($('saveBtn').disabled) return;
  $('saveBtn').textContent = editingTimestamp ? 'Update item 更新' : 'Save to Google Drive';
  $('cancelEditBtn')?.classList.toggle('hidden', !editingTimestamp);
}

async function saveItem() {
  const transportLabel = transportMode === 'shipped' ? '寄箱' : '手提';
  const location = transportMode === 'shipped' ? $('boxNumber').value.trim() : selectedHandCarry;
  if (!location) { showToast(transportMode === 'shipped' ? 'Enter box number.' : 'Select hand-carry bag.', 'error'); return; }
  if (!$('itemDescription').value.trim()) { showToast('Enter item description.', 'error'); return; }
  if (!editingTimestamp && !currentImageBase64) { showToast('Take or import a photo first.', 'error'); return; }
  if (editingTimestamp && !currentImageBase64 && !editingPhotoLink) { showToast('Take or import a photo first.', 'error'); return; }

  $('saveBtn').disabled = true;
  $('saveBtn').textContent = editingTimestamp ? 'Updating…' : 'Saving…';
  try {
    const payload = {
      action: editingTimestamp ? 'edit' : 'save',
      transportMode: transportLabel,
      location,
      roomCategory: $('roomCategory').value.trim(),
      itemDescription: $('itemDescription').value.trim(),
      quantity: $('quantity').value || '1',
      size: $('size').value.trim(),
      weight: $('weight').value.trim(),
      estimatedValue: $('estimatedValue').value.trim(),
      status: selectedStatus
    };
    if (editingTimestamp) payload.timestamp = editingTimestamp;
    if (currentImageBase64) payload.image = currentImageBase64;

    await apiCall(payload);
    showToast(editingTimestamp ? 'Item updated! 已更新' : 'Item saved!', 'success');
    clearForm();
    switchTab('items');
    loadAllItems();
  } catch (err) { showToast(err.message, 'error'); }
  finally {
    $('saveBtn').disabled = false;
    updateSaveButtonLabel();
  }
}

function startEditItem(item) {
  editingTimestamp = item.timestamp;
  editingPhotoLink = item.photoLink || '';
  currentImageBase64 = null;

  if (item.transportMode === '手提') {
    setTransportMode('handcarry');
    setHandCarry(item.location || '');
  } else {
    setTransportMode('shipped');
    $('boxNumber').value = item.location || '';
  }

  $('roomCategory').value = item.roomCategory || '';
  $('itemDescription').value = item.itemDescription || '';
  $('quantity').value = item.quantity || '1';
  $('size').value = item.size || '';
  $('weight').value = item.weight || '';
  $('estimatedValue').value = item.estimatedValue || '';
  selectedStatus = item.status || '待整理';
  $('statusPickerBtn').textContent = `${selectedStatus} ›`;

  if (editingPhotoLink) {
    $('photoPreview').src = editingPhotoLink;
    $('photoPreviewWrap').classList.remove('hidden');
  } else {
    clearPhoto();
  }

  updateSaveButtonLabel();
  switchTab('log');
  $('navTitle').textContent = 'Edit Item 編輯';
  window.scrollTo(0, 0);
}

function cancelEdit() {
  editingTimestamp = null;
  editingPhotoLink = '';
  clearForm();
  updateSaveButtonLabel();
}

function clearForm() {
  editingTimestamp = null;
  editingPhotoLink = '';
  $('boxNumber').value = '';
  selectedHandCarry = '';
  $('handCarryPickerBtn').textContent = 'Select bag ›';
  ['roomCategory','itemDescription','size','weight','estimatedValue'].forEach((id) => $(id).value = '');
  $('quantity').value = '1';
  selectedStatus = '待整理';
  $('statusPickerBtn').textContent = '待整理 ›';
  setTransportMode('shipped');
  currentImageBase64 = null;
  $('photoPreview').src = '';
  $('photoPreviewWrap').classList.add('hidden');
  $('cameraInput').value = '';
  $('importInput').value = '';
  updateSaveButtonLabel();
}

function confirmDeleteItem(item) {
  openActionSheet([
    { label: `Delete「${(item.itemDescription || 'item').slice(0, 24)}」`, value: 'delete', destructive: true }
  ], (v) => {
    if (v === 'delete') deleteItem(item);
  });
}

async function deleteItem(item) {
  try {
    await apiCall({ action: 'delete', timestamp: item.timestamp });
    allItems = allItems.filter((i) => i.timestamp !== item.timestamp);
    localStorage.setItem('torItems', JSON.stringify(allItems));
    if (editingTimestamp === item.timestamp) cancelEdit();
    renderFilteredList();
    renderBoxSummary();
    renderProgressBars();
    showToast('Item deleted 已刪除', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadAllItems() {
  try {
    const data = await apiCall({ action: 'search', query: '' });
    allItems = data.items || [];
    localStorage.setItem('torItems', JSON.stringify(allItems));
  } catch (err) {
    const cached = localStorage.getItem('torItems');
    if (cached) {
      try { allItems = JSON.parse(cached); } catch { allItems = []; }
    }
    showToast(err.message || 'Could not load inventory.', 'error');
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

function getItemTypeEmoji(item) {
  const text = [item.itemDescription, item.roomCategory, item.size].filter(Boolean).join(' ').toLowerCase();
  const rules = [
    [/kitchen|cook|pot|pan|plate|bowl|utensil|microwave|kettle|ware|廚|鍋|碗|碟|杯|刀|廚具/, '🍳'],
    [/cloth|shirt|dress|jacket|coat|sock|underwear|scarf|衣|服|褲|鞋|衫/, '👕'],
    [/book|novel|magazine|textbook|書|本/, '📚'],
    [/laptop|computer|phone|tablet|keyboard|mouse|charger|cable|monitor|電|腦|機|鍵盤/, '💻'],
    [/chair|table|desk|sofa|bed|furniture|cabinet|傢|椅|桌|床|櫃/, '🪑'],
    [/toy|game|puzzle|doll|玩具/, '🧸'],
    [/tool|drill|hammer|screwdriver|工具/, '🔧'],
    [/cosmetic|makeup|skincare|perfume|化妝|護膚/, '💄'],
    [/sport|gym|ball|racket|bike|運動/, '⚽'],
    [/jewel|watch|ring|necklace|手錶|飾/, '⌚'],
    [/pillow|blanket|duvet|bedding|枕|被|床單/, '🛏️'],
    [/towel|soap|shampoo|toothbrush|浴|毛巾|牙刷/, '🧴'],
    [/food|snack|tea|coffee|plate|食|茶|咖啡/, '🍽️'],
    [/bag|suitcase|luggage|backpack|箱|袋|背囊/, '🧳'],
    [/art|paint|frame|picture|畫|相框/, '🖼️'],
    [/music|guitar|piano|speaker|headphone|音|耳機/, '🎸'],
    [/clean|vacuum|detergent|mop|清|掃/, '🧹'],
    [/lamp|light|bulb|燈/, '💡'],
    [/plant|flower|vase|花|植物/, '🪴']
  ];
  for (const [re, emoji] of rules) {
    if (re.test(text)) return emoji;
  }
  const room = String(item.roomCategory || '');
  if (/廚/.test(room)) return '🍳';
  if (/睡/.test(room)) return '🛏️';
  if (/客/.test(room)) return '🛋️';
  if (/浴/.test(room)) return '🧴';
  if (/書/.test(room)) return '📚';
  return item.transportMode === '手提' ? '🎒' : '📦';
}

function renderItemThumb(item) {
  const emoji = getItemTypeEmoji(item);
  if (item.photoLink) {
    const link = esc(item.photoLink);
    return `<div class="item-thumb-wrap"><img class="item-thumb" src="${link}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="item-thumb item-thumb-emoji" style="display:none" aria-hidden="true">${emoji}</div></div>`;
  }
  return `<div class="item-thumb item-thumb-emoji" aria-hidden="true">${emoji}</div>`;
}

let openSwipeRow = null;

function closeOpenSwipe() {
  if (openSwipeRow) {
    openSwipeRow.querySelector('.item-swipe-content').style.transform = '';
    openSwipeRow.classList.remove('swipe-open-status', 'swipe-open-actions', 'swipe-open-left', 'swipe-open-right');
    openSwipeRow = null;
  }
}

function bindItemSwipe(wrap) {
  const content = wrap.querySelector('.item-swipe-content');
  const ts = wrap.dataset.timestamp;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let tracking = false;
  let axis = null;
  const maxLeft = 136;  // reveal Edit + Delete (swipe right)
  const maxRight = 110; // reveal Status (swipe left)

  wrap.querySelector('[data-swipe="edit"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = allItems.find((i) => i.timestamp === ts);
    if (item) { closeOpenSwipe(); startEditItem(item); }
  });
  wrap.querySelector('[data-swipe="delete"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = allItems.find((i) => i.timestamp === ts);
    if (item) { closeOpenSwipe(); confirmDeleteItem(item); }
  });
  wrap.querySelector('[data-swipe="status"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = allItems.find((i) => i.timestamp === ts);
    if (item) { closeOpenSwipe(); cycleStatus(item); }
  });

  content.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    currentX = 0;
    tracking = true;
    axis = null;
    content.style.transition = 'none';
    if (openSwipeRow && openSwipeRow !== wrap) closeOpenSwipe();
  }, { passive: true });

  content.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (axis === 'y') { tracking = false; return; }
    }
    if (axis !== 'x') return;
    e.preventDefault();
    currentX = Math.max(-maxRight, Math.min(maxLeft, dx));
    content.style.transform = `translateX(${currentX}px)`;
  }, { passive: false });

  content.addEventListener('touchend', () => {
    if (!tracking || axis !== 'x') { tracking = false; return; }
    tracking = false;
    content.style.transition = 'transform 0.2s ease';
    // Finger moves left → content left → show Status on the right
    if (currentX <= -48) {
      content.style.transform = `translateX(-${maxRight}px)`;
      wrap.classList.add('swipe-open-status');
      wrap.classList.remove('swipe-open-actions');
      openSwipeRow = wrap;
    // Finger moves right → content right → show Edit/Delete on the left
    } else if (currentX >= 48) {
      content.style.transform = `translateX(${maxLeft}px)`;
      wrap.classList.add('swipe-open-actions');
      wrap.classList.remove('swipe-open-status');
      openSwipeRow = wrap;
    } else {
      content.style.transform = '';
      wrap.classList.remove('swipe-open-status', 'swipe-open-actions');
      if (openSwipeRow === wrap) openSwipeRow = null;
    }
  });

  content.addEventListener('click', (e) => {
    if (Math.abs(currentX) > 10) return;
    if (e.target.closest('.status-badge')) return;
    if (wrap.classList.contains('swipe-open-status') || wrap.classList.contains('swipe-open-actions')) {
      closeOpenSwipe();
      return;
    }
    content.querySelector('.item-detail')?.classList.toggle('hidden');
  });
}

function renderFilteredList() {
  const items = getFilteredItems();
  const total = allItems.length;
  if ($('resultCount')) $('resultCount').textContent = items.length === total ? `Showing ${total} items` : `Showing ${items.length} of ${total}`;
  const list = $('itemList');
  if (!items.length) { list.innerHTML = '<div class="empty-state">No items found.</div>'; return; }
  openSwipeRow = null;
  list.innerHTML = items.map(renderItemCard).join('');
  list.querySelectorAll('.item-swipe-wrap').forEach(bindItemSwipe);
  list.querySelectorAll('.status-badge').forEach((badge) => {
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = allItems.find((i) => i.timestamp === badge.dataset.timestamp);
      if (item) cycleStatus(item);
    });
  });
}

function renderItemCard(item) {
  const transportIcon = item.transportMode === '手提' ? '🎒' : '📦';
  const thumb = renderItemThumb(item);
  const sc = STATUS_CLASS[item.status] || 'status-to-sort';
  const ts = esc(item.timestamp);
  const nextStatus = STATUS_OPTIONS[(STATUS_OPTIONS.findIndex((s) => s.value === item.status) + 1) % STATUS_OPTIONS.length];
  return `<div class="item-swipe-wrap" data-timestamp="${ts}"><div class="item-swipe-behind"><div class="swipe-actions-left"><button type="button" class="swipe-btn" data-swipe="edit">Edit</button><button type="button" class="swipe-btn destructive" data-swipe="delete">Delete</button></div><div class="swipe-actions-right"><button type="button" class="swipe-btn" data-swipe="status">${esc(nextStatus.value)} ›</button></div></div><div class="item-swipe-content"><div class="item-card"><div class="item-card-main">${thumb}<div class="item-info"><div class="item-title">${esc(item.itemDescription)}</div><div class="item-subtitle">${transportIcon} ${esc(item.location)} · ${esc(item.roomCategory||'')}</div></div><span class="status-badge ${sc}" data-timestamp="${ts}">${esc(item.status||'待整理')}</span><span class="item-chevron">›</span></div><div class="item-detail hidden"><p>運送: ${esc(item.transportMode)} · Qty: ${esc(item.quantity||'1')}</p><p>尺寸: ${esc(item.size||'—')} · 重量: ${esc(item.weight||'—')}</p><p>£${esc(item.estimatedValue||'—')}</p>${item.photoLink?`<a href="${item.photoLink}" target="_blank" rel="noopener" style="color:#007AFF">View Photo</a>`:''}</div></div></div></div>`;
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
  closeOpenSwipe();
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const titles = {
    log: editingTimestamp ? 'Edit Item 編輯' : 'Log Item',
    items: 'Inventory',
    boxes: 'Boxes'
  };
  $('navTitle').textContent = titles[tab] || 'ToR Log';
  if (tab === 'log') $('screenLog').classList.add('active');
  if (tab === 'items') { $('screenItems').classList.add('active'); renderFilteredList(); }
  if (tab === 'boxes') { $('screenBoxes').classList.add('active'); renderBoxSummary(); renderProgressBars(); }
}

function showToast(msg, type='success') {
  const t = $('toast');
  if (!t) return;
  if (showToast._timer) clearTimeout(showToast._timer);
  t.textContent = msg;
  t.className = `toast ${type} show`;
  showToast._timer = setTimeout(() => {
    t.classList.remove('show');
    showToast._timer = null;
  }, 2500);
}

function esc(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = String(str); return d.innerHTML; }
