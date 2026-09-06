// ============ CONFIGURATION ============
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbwpQjBvagza2ITagHh66NDTxe4vMhtiAOR2pywBkKAdaQ7pZbihBg29IihgdzfyR2g_qA/exec';
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
let reviewQueue = [];
let uploadQueue = [];
let reviewBusy = false;
let uploadBusy = false;
let editingTimestamp = null;
let editingPhotoLink = '';
let transportMode = 'shipped';
let selectedHandCarry = '';
let selectedStatus = '待整理';
let filterTransport = '';
let filterStatus = '';
let filterLocation = '';
let activityEntries = [];
let openSwipeRow = null;

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  }
  if (sessionStorage.getItem('idToken')) {
    showMainApp();
    loadAllItems();
    logAppOpen('session_resume');
    switchTab(isPhoneLike() ? 'upload' : 'review');
  } else showLoginScreen();
  initGoogleSignIn();
  bindEvents();
});

function isPhoneLike() {
  return /iPhone|iPod|Android.+Mobile/i.test(navigator.userAgent) ||
    (window.matchMedia('(max-width: 700px)').matches && navigator.maxTouchPoints > 1);
}

function bindEvents() {
  $('signOutBtn').addEventListener('click', signOut);
  $('selectPhotosBtn').addEventListener('click', () => $('bulkPhotoInput').click());
  $('bulkPhotoInput').addEventListener('change', onPhotosSelected);
  $('clearQueueBtn').addEventListener('click', clearReviewQueue);
  $('runAiBtn').addEventListener('click', runAiOnQueue);
  $('submitAllBtn').addEventListener('click', submitReadyItems);
  $('loadInboxBtn')?.addEventListener('click', loadInboxIntoReview);

  $('uploadSelectBtn')?.addEventListener('click', () => $('uploadPhotoInput').click());
  $('uploadPhotoInput')?.addEventListener('change', onUploadPhotosSelected);
  $('uploadClearBtn')?.addEventListener('click', clearUploadQueue);
  $('uploadSendBtn')?.addEventListener('click', sendUploadQueue);

  $('saveBtn').addEventListener('click', saveEditItem);
  $('cancelEditBtn').addEventListener('click', cancelEdit);
  $('searchInput').addEventListener('input', onSearchInput);
  $('searchClear').addEventListener('click', clearSearch);
  $('handCarryPickerBtn').addEventListener('click', openHandCarryPicker);
  $('statusPickerBtn').addEventListener('click', openStatusPicker);
  $('actionSheetCancel').addEventListener('click', closeActionSheet);
  $('actionSheetOverlay').addEventListener('click', (e) => {
    if (e.target === $('actionSheetOverlay')) closeActionSheet();
  });
  $('dismissInstallBanner')?.addEventListener('click', dismissInstallBanner);
  $('modeShipped').addEventListener('click', () => setTransportMode('shipped'));
  $('modeHandCarry').addEventListener('click', () => setTransportMode('handcarry'));

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
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
  sessionStorage.removeItem('openLogged');
  $('loginError').classList.add('hidden');
  showMainApp();
  loadAllItems();
  logAppOpen('sign_in');
  switchTab(isPhoneLike() ? 'upload' : 'review');
}

function getIdToken() {
  const token = sessionStorage.getItem('idToken');
  if (!token) { showLoginScreen(); return null; }
  return token;
}

function signOut() {
  sessionStorage.removeItem('idToken');
  sessionStorage.removeItem('openLogged');
  allItems = [];
  clearReviewQueue();
  cancelEdit();
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
  showLoginScreen();
}

function showLoginScreen() {
  $('loginScreen').classList.remove('hidden');
  $('mainApp').classList.add('hidden');
}

function showMainApp() {
  $('loginScreen').classList.add('hidden');
  $('mainApp').classList.remove('hidden');
  showInstallBannerIfNeeded();
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function showInstallBannerIfNeeded() {
  const banner = $('installBanner');
  if (!banner) return;
  if (isStandalone() || localStorage.getItem('installBannerDismissed') === '1') {
    banner.classList.add('hidden');
    return;
  }
  if (isIOS() || /Android/i.test(navigator.userAgent)) banner.classList.remove('hidden');
}

function dismissInstallBanner() {
  localStorage.setItem('installBannerDismissed', '1');
  $('installBanner')?.classList.add('hidden');
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function getDeviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return navigator.platform || 'Unknown';
}

function getBrowserLabel() {
  const ua = navigator.userAgent;
  if (/CriOS/.test(ua)) return 'Chrome iOS';
  if (/FxiOS/.test(ua)) return 'Firefox iOS';
  if (/EdgiOS/.test(ua)) return 'Edge iOS';
  if (/Safari/.test(ua) && !/Chrome/.test(ua)) return 'Safari';
  if (/Chrome/.test(ua)) return 'Chrome';
  if (/Firefox/.test(ua)) return 'Firefox';
  if (/Edg/.test(ua)) return 'Edge';
  return 'Other';
}

async function collectClientInfo(event) {
  const info = {
    event,
    device: getDeviceLabel(),
    browser: getBrowserLabel(),
    lang: navigator.language || '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    screen: `${screen.width}×${screen.height}`,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    mode: isStandalone() ? 'PWA' : 'Browser',
    network: navigator.connection?.effectiveType || '',
    online: navigator.onLine
  };
  try {
    const res = await fetchWithTimeout('https://api.ipify.org?format=json', 4000);
    if (res.ok) {
      const data = await res.json();
      if (data.ip) info.ip = data.ip;
    }
  } catch { /* optional */ }
  return info;
}

async function logAppOpen(event = 'session_resume') {
  if (sessionStorage.getItem('openLogged') === '1') return;
  if (!sessionStorage.getItem('idToken')) return;
  try {
    const client = await collectClientInfo(event);
    await apiCall({ action: 'open', client });
    sessionStorage.setItem('openLogged', '1');
  } catch { /* ignore */ }
}

async function apiCall(payload, retries = 2) {
  const idToken = getIdToken();
  if (!idToken) throw new Error('Not signed in');

  const hasImage = !!payload.image;
  const timeoutMs = (payload.action === 'analyze' || payload.action === 'inboxAnalyze') ? 45000
    : (payload.action === 'inboxUpload' || hasImage) ? 90000 : 35000;
  if (payload.action === 'analyze' || payload.action === 'inboxAnalyze') retries = 1;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(GAS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...payload, idToken }),
        redirect: 'follow',
        signal: ctrl.signal
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
      const msg = String(err.message || err.name || err);
      const aborted = err.name === 'AbortError' || /aborted/i.test(msg);
      if (aborted) {
        throw new Error(hasImage
          ? 'Timed out. Try Wi‑Fi or a smaller photo. 逾時，請用 Wi‑Fi 或較細相片。'
          : 'Request timed out. Check Wi‑Fi. 請求逾時。');
      }
      const network = /load failed|failed to fetch|networkerror|network request failed/i.test(msg);
      if (!network || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }

  const msg = String(lastErr?.message || lastErr || 'Request failed');
  if (/load failed|failed to fetch|networkerror|network request failed/i.test(msg)) {
    throw new Error('Network error. Check Wi-Fi. 網路不穩。');
  }
  throw lastErr;
}

// ============ REVIEW QUEUE ============

function compressImageFile(file, maxDim = 1024, quality = 0.65) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read photo.'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w >= h) { h = Math.round((h * maxDim) / w); w = maxDim; }
          else { w = Math.round((w * maxDim) / h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Could not process photo.'));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function shrinkBase64ForUpload(base64, maxChars = 350000) {
  if (!base64 || base64.length <= maxChars) return base64;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      const maxDim = 960;
      if (w > maxDim || h > maxDim) {
        if (w >= h) { h = Math.round((h * maxDim) / w); w = maxDim; }
        else { w = Math.round((w * maxDim) / h); h = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      let quality = 0.6;
      let out = canvas.toDataURL('image/jpeg', quality).split(',')[1];
      while (out.length > maxChars && quality > 0.35) {
        quality -= 0.1;
        out = canvas.toDataURL('image/jpeg', quality).split(',')[1];
      }
      resolve(out);
    };
    img.onerror = () => resolve(base64);
    img.src = 'data:image/jpeg;base64,' + base64;
  });
}

async function getCaptureTimeIso(file) {
  try {
    if (window.exifr?.parse) {
      const exif = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate', 'ModifyDate']);
      const dt = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate;
      if (dt) {
        const d = dt instanceof Date ? dt : new Date(dt);
        if (!isNaN(d.getTime())) return d.toISOString();
      }
    }
  } catch { /* fall through */ }
  if (file.lastModified) return new Date(file.lastModified).toISOString();
  return new Date().toISOString();
}

function formatCaptureTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function sortByCaptureTime(list) {
  list.sort((a, b) => new Date(a.captureTime || 0) - new Date(b.captureTime || 0));
  return list;
}

function emptyReviewItem(partial) {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    fileName: '',
    previewUrl: '',
    imageBase64: '',
    inboxId: null,
    photoLink: '',
    captureTime: new Date().toISOString(),
    note: '',
    state: 'pending',
    error: '',
    included: true,
    transportMode: '寄箱',
    location: '',
    roomCategory: '',
    itemDescription: '',
    quantity: '1',
    size: '',
    weight: '',
    estimatedValue: '',
    itemStatus: '待整理',
    ...partial
  };
}

async function onUploadPhotosSelected(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  showToast(`Preparing ${files.length} photo(s)…`, 'success');
  for (const file of files) {
    if (!file.type.startsWith('image/') && !/\.heic$/i.test(file.name)) continue;
    if (file.size > 20 * 1024 * 1024) {
      showToast(`Skipped ${file.name} (too large)`, 'error');
      continue;
    }
    try {
      const captureTime = await getCaptureTimeIso(file);
      const dataUrl = await compressImageFile(file);
      const base64 = await shrinkBase64ForUpload(dataUrl.split(',')[1]);
      uploadQueue.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        fileName: file.name,
        previewUrl: 'data:image/jpeg;base64,' + base64,
        imageBase64: base64,
        captureTime,
        state: 'queued'
      });
    } catch (err) {
      showToast(`${file.name}: ${err.message}`, 'error');
    }
  }
  sortByCaptureTime(uploadQueue);
  renderUploadQueue();
  updateUploadToolbar();
}

function clearUploadQueue() {
  if (uploadBusy) { showToast('Upload in progress…', 'error'); return; }
  uploadQueue = [];
  renderUploadQueue();
  updateUploadToolbar();
}

function updateUploadToolbar() {
  const el = $('uploadProgress');
  const btn = $('uploadSendBtn');
  if (!el || !btn) return;
  el.textContent = uploadQueue.length
    ? `${uploadQueue.length} photo(s) · sorted by capture time · status 待處理`
    : 'No photos selected';
  btn.disabled = uploadBusy || uploadQueue.length === 0;
}

function renderUploadQueue() {
  const container = $('uploadList');
  if (!container) return;
  if (!uploadQueue.length) {
    container.innerHTML = '<div class="empty-state">Select photos on your phone.</div>';
    return;
  }
  container.innerHTML = uploadQueue.map((item, idx) => `
    <article class="review-card">
      <div class="review-card-top">
        <span class="review-state review-state-pending">#${idx + 1} · 待處理</span>
        <span class="review-capture">${esc(formatCaptureTime(item.captureTime))}</span>
      </div>
      <div class="review-card-body">
        <img class="review-thumb" src="${item.previewUrl}" alt="">
        <div class="review-fields">
          <p class="review-filename">${esc(item.fileName)}</p>
          <p class="review-filename">Taken: ${esc(formatCaptureTime(item.captureTime))}</p>
        </div>
      </div>
    </article>
  `).join('');
}

async function sendUploadQueue() {
  if (uploadBusy || !uploadQueue.length) return;
  uploadBusy = true;
  updateUploadToolbar();
  const note = ($('uploadNote')?.value || '').trim();
  let ok = 0;
  let fail = 0;
  showToast(`Uploading ${uploadQueue.length} as 待處理…`, 'success');
  for (const item of uploadQueue) {
    try {
      await apiCall({
        action: 'inboxUpload',
        image: item.imageBase64,
        fileName: item.fileName,
        captureTime: item.captureTime,
        note
      });
      ok++;
      item.state = 'done';
    } catch (err) {
      fail++;
      item.state = 'error';
      showToast(`${item.fileName}: ${err.message}`, 'error');
    }
    updateUploadToolbar();
  }
  uploadBusy = false;
  if (fail === 0) {
    uploadQueue = [];
    if ($('uploadNote')) $('uploadNote').value = '';
    renderUploadQueue();
    updateUploadToolbar();
    showToast(`Uploaded ${ok} photo(s) · 待處理`, 'success');
  } else {
    uploadQueue = uploadQueue.filter((q) => q.state !== 'done');
    renderUploadQueue();
    updateUploadToolbar();
    showToast(`Uploaded ${ok}, failed ${fail}`, 'error');
  }
}

async function loadInboxIntoReview() {
  if (reviewBusy) { showToast('Busy — wait for AI/submit.', 'error'); return; }
  showToast('Loading inbox…', 'success');
  try {
    const data = await apiCall({ action: 'inboxList' });
    const items = data.items || [];
    if (!items.length) {
      showToast('Inbox empty — no 待處理 photos.', 'error');
      return;
    }
    reviewQueue = items.map((it) => emptyReviewItem({
      id: it.inboxId || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      inboxId: it.inboxId,
      fileName: it.fileName || 'inbox.jpg',
      previewUrl: it.thumbUrl || it.photoLink || '',
      imageBase64: '',
      photoLink: it.photoLink || '',
      captureTime: it.captureTime || it.uploadedAt || new Date().toISOString(),
      note: it.note || '',
      state: 'pending',
      location: it.note || ''
    }));
    sortByCaptureTime(reviewQueue);
    renderReviewQueue();
    updateReviewToolbar();
    showToast(`Loaded ${reviewQueue.length} 待處理 · oldest capture first`, 'success');
  } catch (err) {
    showToast(err.message || 'Could not load inbox', 'error');
  }
}

async function onPhotosSelected(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;

  showToast(`Loading ${files.length} photo(s)…`, 'success');
  for (const file of files) {
    if (!file.type.startsWith('image/') && !/\.heic$/i.test(file.name)) continue;
    if (file.size > 20 * 1024 * 1024) {
      showToast(`Skipped ${file.name} (too large)`, 'error');
      continue;
    }
    try {
      const captureTime = await getCaptureTimeIso(file);
      const dataUrl = await compressImageFile(file);
      const base64 = await shrinkBase64ForUpload(dataUrl.split(',')[1]);
      reviewQueue.push(emptyReviewItem({
        fileName: file.name,
        previewUrl: 'data:image/jpeg;base64,' + base64,
        imageBase64: base64,
        captureTime,
        state: 'pending'
      }));
    } catch (err) {
      showToast(`${file.name}: ${err.message}`, 'error');
    }
  }
  sortByCaptureTime(reviewQueue);
  renderReviewQueue();
  updateReviewToolbar();
}

function clearReviewQueue() {
  if (reviewBusy) { showToast('Busy — wait for AI/submit to finish.', 'error'); return; }
  reviewQueue = [];
  renderReviewQueue();
  updateReviewToolbar();
}

function updateReviewToolbar() {
  const pending = reviewQueue.filter((q) => q.state === 'pending' || q.state === 'error').length;
  const ready = reviewQueue.filter((q) => q.state === 'ready' && q.included).length;
  const done = reviewQueue.filter((q) => q.state === 'done').length;
  const analyzing = reviewQueue.filter((q) => q.state === 'analyzing' || q.state === 'submitting').length;
  $('reviewProgress').textContent = reviewQueue.length
    ? `${reviewQueue.length} photos · ${pending} need AI · ${ready} ready · ${done} submitted`
    : 'No photos yet';
  $('runAiBtn').disabled = reviewBusy || pending === 0;
  $('submitAllBtn').disabled = reviewBusy || ready === 0;
  if (analyzing) $('reviewProgress').textContent += ` · working…`;
}

function renderReviewQueue() {
  const container = $('reviewQueue');
  if (!reviewQueue.length) {
    container.innerHTML = '<div class="empty-state">Select photos to start.</div>';
    return;
  }
  container.innerHTML = reviewQueue.map((item) => reviewCardHtml(item)).join('');
  container.querySelectorAll('.review-card').forEach((card) => bindReviewCard(card));
}

function reviewCardHtml(item) {
  const stateLabel = {
    pending: item.inboxId ? '待處理 · Waiting for AI' : 'Waiting for AI',
    analyzing: 'AI running…',
    ready: 'Ready to submit',
    error: 'AI failed — edit manually',
    submitting: 'Submitting…',
    done: 'Submitted ✓'
  }[item.state] || item.state;

  const disabled = item.state === 'done' || item.state === 'submitting' || item.state === 'analyzing';
  const handOpts = HAND_CARRY_OPTIONS.map((o) =>
    `<option value="${esc(o.label)}" ${item.location === o.label ? 'selected' : ''}>${esc(o.label)}</option>`
  ).join('');
  const statusOpts = STATUS_OPTIONS.map((s) =>
    `<option value="${esc(s.value)}" ${item.itemStatus === s.value ? 'selected' : ''}>${esc(s.value)}</option>`
  ).join('');

  return `
  <article class="review-card" data-id="${esc(item.id)}">
    <div class="review-card-top">
      <label class="review-include">
        <input type="checkbox" data-field="included" ${item.included ? 'checked' : ''} ${item.state === 'done' ? 'disabled' : ''}>
        Include
      </label>
      <span class="review-state review-state-${esc(item.state)}">${esc(stateLabel)}</span>
      <button type="button" class="ios-text-btn review-remove" data-action="remove" ${disabled ? 'disabled' : ''}>Remove</button>
    </div>
    <div class="review-card-body">
      <img class="review-thumb" src="${item.previewUrl}" alt="">
      <div class="review-fields">
        <p class="review-filename">${esc(item.fileName)}</p>
        <p class="review-capture">Taken: ${esc(formatCaptureTime(item.captureTime))}${item.inboxId ? ' · from Inbox' : ''}</p>
        ${item.note ? `<p class="review-capture">Note: ${esc(item.note)}</p>` : ''}
        ${item.error ? `<p class="review-error">${esc(item.error)}</p>` : ''}
        <div class="review-field-row">
          <label>Transport</label>
          <select data-field="transportMode" ${disabled ? 'disabled' : ''}>
            <option value="寄箱" ${item.transportMode === '寄箱' ? 'selected' : ''}>寄箱</option>
            <option value="手提" ${item.transportMode === '手提' ? 'selected' : ''}>手提</option>
          </select>
        </div>
        <div class="review-field-row review-loc-shipped" style="${item.transportMode === '手提' ? 'display:none' : ''}">
          <label>Box #</label>
          <input type="text" data-field="location" value="${esc(item.transportMode === '寄箱' ? item.location : '')}" placeholder="e.g. 1" ${disabled ? 'disabled' : ''}>
        </div>
        <div class="review-field-row review-loc-hand" style="${item.transportMode === '手提' ? '' : 'display:none'}">
          <label>Bag</label>
          <select data-field="handLocation" ${disabled ? 'disabled' : ''}>
            <option value="">Select…</option>
            ${handOpts}
          </select>
        </div>
        <div class="review-field-row">
          <label>Room</label>
          <input type="text" data-field="roomCategory" value="${esc(item.roomCategory)}" placeholder="客廳…" ${disabled ? 'disabled' : ''}>
        </div>
        <div class="review-field-row review-field-desc">
          <label>Description</label>
          <textarea data-field="itemDescription" rows="2" ${disabled ? 'disabled' : ''}>${esc(item.itemDescription)}</textarea>
        </div>
        <div class="review-field-grid">
          <div class="review-field-row">
            <label>Qty</label>
            <input type="number" min="1" data-field="quantity" value="${esc(item.quantity)}" ${disabled ? 'disabled' : ''}>
          </div>
          <div class="review-field-row">
            <label>Size</label>
            <input type="text" data-field="size" value="${esc(item.size)}" ${disabled ? 'disabled' : ''}>
          </div>
          <div class="review-field-row">
            <label>Weight</label>
            <input type="text" data-field="weight" value="${esc(item.weight)}" ${disabled ? 'disabled' : ''}>
          </div>
          <div class="review-field-row">
            <label>£</label>
            <input type="text" data-field="estimatedValue" value="${esc(item.estimatedValue)}" ${disabled ? 'disabled' : ''}>
          </div>
        </div>
        <div class="review-field-row">
          <label>Status</label>
          <select data-field="itemStatus" ${disabled ? 'disabled' : ''}>${statusOpts}</select>
        </div>
        <div class="review-card-actions">
          <button type="button" class="ios-btn-secondary" data-action="reai" ${disabled ? 'disabled' : ''}>Re-run AI</button>
        </div>
      </div>
    </div>
  </article>`;
}

function bindReviewCard(card) {
  const id = card.dataset.id;
  const item = reviewQueue.find((q) => q.id === id);
  if (!item) return;

  card.querySelectorAll('[data-field]').forEach((el) => {
    const sync = () => {
      const field = el.dataset.field;
      if (field === 'included') item.included = el.checked;
      else if (field === 'handLocation') {
        item.location = el.value;
      } else if (field === 'transportMode') {
        item.transportMode = el.value;
        if (item.transportMode === '寄箱') {
          const box = card.querySelector('[data-field="location"]');
          item.location = box?.value || '';
        } else {
          const bag = card.querySelector('[data-field="handLocation"]');
          item.location = bag?.value || '';
        }
        card.querySelector('.review-loc-shipped').style.display = item.transportMode === '寄箱' ? '' : 'none';
        card.querySelector('.review-loc-hand').style.display = item.transportMode === '手提' ? '' : 'none';
      } else {
        item[field] = el.value;
      }
      updateReviewToolbar();
    };
    el.addEventListener('change', sync);
    el.addEventListener('input', sync);
  });

  card.querySelector('[data-action="remove"]')?.addEventListener('click', () => {
    if (reviewBusy) return;
    reviewQueue = reviewQueue.filter((q) => q.id !== id);
    renderReviewQueue();
    updateReviewToolbar();
  });

  card.querySelector('[data-action="reai"]')?.addEventListener('click', async () => {
    if (reviewBusy) return;
    await analyzeOne(item);
    renderReviewQueue();
    updateReviewToolbar();
  });
}

function pickAiField(data, keys) {
  for (const k of keys) {
    const v = data?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
}

function applySuggestionsToItem(item, data) {
  if (!data || typeof data !== 'object') return false;
  const transportRaw = String(pickAiField(data, ['transportMode', 'transport_mode', '運送方式', 'mode'])).toLowerCase();
  const location = String(pickAiField(data, ['location', 'boxNumber', 'box_number', '存放位置', '箱號']));
  const roomCategory = String(pickAiField(data, ['roomCategory', 'room_category', '房間分類', 'room']));
  const itemDescription = String(pickAiField(data, ['itemDescription', 'item_description', 'description', '物品描述', 'desc', 'item', 'name', 'title']));
  const quantity = pickAiField(data, ['quantity', 'qty', '數量']) || '1';
  const size = String(pickAiField(data, ['size', '尺寸']));
  const weight = String(pickAiField(data, ['weight', '重量']));
  const estimatedValue = pickAiField(data, ['estimatedValue', 'estimated_value', 'value', '預估價值']);

  if (transportRaw.includes('hand') || transportRaw.includes('手提')) {
    item.transportMode = '手提';
    item.location = location || item.location;
  } else {
    item.transportMode = '寄箱';
    item.location = location || item.location;
  }
  if (roomCategory) item.roomCategory = roomCategory;
  if (itemDescription) item.itemDescription = itemDescription;
  if (quantity) item.quantity = String(quantity);
  if (size) item.size = size;
  if (weight) item.weight = weight;
  if (estimatedValue !== '') item.estimatedValue = String(estimatedValue);
  return Boolean(item.itemDescription);
}

async function analyzeOne(item) {
  item.state = 'analyzing';
  item.error = '';
  renderReviewQueue();
  updateReviewToolbar();
  try {
    let data;
    if (item.inboxId) {
      data = await apiCall({ action: 'inboxAnalyze', inboxId: item.inboxId });
    } else {
      if (!item.imageBase64) throw new Error('Missing photo data');
      data = await apiCall({ action: 'analyze', image: item.imageBase64 });
    }
    let suggestions = data.suggestions || data;
    if (typeof suggestions === 'string') {
      try { suggestions = JSON.parse(suggestions); } catch { suggestions = {}; }
    }
    if (suggestions?.suggestions) suggestions = suggestions.suggestions;
    const ok = applySuggestionsToItem(item, suggestions);
    item.state = 'ready';
    if (!ok) {
      item.error = 'AI returned incomplete data — please fill description.';
    }
  } catch (err) {
    item.state = 'error';
    item.error = err.message || 'AI failed';
  }
}

async function runAiOnQueue() {
  if (reviewBusy) return;
  const targets = reviewQueue.filter((q) => q.state === 'pending' || q.state === 'error');
  if (!targets.length) return;
  reviewBusy = true;
  updateReviewToolbar();
  showToast(`Running AI on ${targets.length} photo(s)…`, 'success');
  for (const item of targets) {
    await analyzeOne(item);
    renderReviewQueue();
    updateReviewToolbar();
  }
  reviewBusy = false;
  updateReviewToolbar();
  const ready = reviewQueue.filter((q) => q.state === 'ready').length;
  showToast(`AI done · ${ready} ready to submit`, 'success');
}

async function submitReadyItems() {
  if (reviewBusy) return;
  const targets = reviewQueue.filter((q) => q.state === 'ready' && q.included);
  if (!targets.length) {
    showToast('No included ready items to submit.', 'error');
    return;
  }

  for (const item of targets) {
    if (!item.itemDescription.trim()) {
      showToast(`Missing description: ${item.fileName}`, 'error');
      return;
    }
    if (!item.location.trim()) {
      showToast(`Missing box/bag: ${item.fileName}`, 'error');
      return;
    }
  }

  reviewBusy = true;
  updateReviewToolbar();
  let okCount = 0;
  let failCount = 0;

  for (const item of targets) {
    item.state = 'submitting';
    renderReviewQueue();
    updateReviewToolbar();
    try {
      const payload = {
        action: 'save',
        transportMode: item.transportMode,
        location: item.location.trim(),
        roomCategory: item.roomCategory.trim(),
        itemDescription: item.itemDescription.trim(),
        quantity: item.quantity || '1',
        size: item.size.trim(),
        weight: item.weight.trim(),
        estimatedValue: item.estimatedValue.trim(),
        status: item.itemStatus || '待整理'
      };
      if (item.inboxId) {
        payload.inboxId = item.inboxId;
        if (item.photoLink) payload.photoLink = item.photoLink;
      }
      if (item.imageBase64) {
        payload.image = await shrinkBase64ForUpload(item.imageBase64);
      }
      if (!payload.image && !payload.inboxId) throw new Error('Missing photo');
      await apiCall(payload);
      item.state = 'done';
      okCount++;
    } catch (err) {
      item.state = 'ready';
      item.error = err.message || 'Submit failed';
      failCount++;
    }
    renderReviewQueue();
    updateReviewToolbar();
  }

  reviewBusy = false;
  updateReviewToolbar();
  loadAllItems();
  if (failCount) showToast(`Submitted ${okCount}, failed ${failCount}`, 'error');
  else showToast(`Submitted ${okCount} item(s) to Sheet!`, 'success');
}

// ============ EDIT EXISTING ============

function setTransportMode(mode) {
  transportMode = mode;
  $('modeShipped')?.classList.toggle('active', mode === 'shipped');
  $('modeHandCarry')?.classList.toggle('active', mode === 'handcarry');
  $('locationRowShipped')?.classList.toggle('hidden', mode !== 'shipped');
  $('locationRowHandCarry')?.classList.toggle('hidden', mode !== 'handcarry');
}

function setHandCarry(label) {
  selectedHandCarry = label;
  const opt = HAND_CARRY_OPTIONS.find((o) => o.label === label);
  if (opt) $('handCarryPickerBtn').textContent = `${opt.icon} ${opt.label} ›`;
  else $('handCarryPickerBtn').textContent = `${label} ›`;
}

function openHandCarryPicker() {
  openActionSheet(
    HAND_CARRY_OPTIONS.map((o) => ({
      label: `${o.icon} ${o.label}`,
      value: o.label,
      selected: selectedHandCarry === o.label
    })),
    setHandCarry
  );
}

function openStatusPicker() {
  openActionSheet(
    STATUS_OPTIONS.map((s) => ({
      label: s.label,
      value: s.value,
      selected: selectedStatus === s.value
    })),
    (v) => {
      selectedStatus = v;
      $('statusPickerBtn').textContent = `${v} ›`;
    }
  );
}

function openActionSheet(options, callback) {
  const group = $('actionSheetOptions');
  group.innerHTML = options.map((o) =>
    `<button class="action-sheet-btn ${o.selected ? 'selected' : ''} ${o.destructive ? 'destructive' : ''}" data-value="${esc(o.value)}">${esc(o.label)}</button>`
  ).join('');
  group.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeActionSheet();
      callback(btn.dataset.value);
    });
  });
  $('actionSheetOverlay').classList.add('show');
}

function closeActionSheet() {
  $('actionSheetOverlay').classList.remove('show');
}

function startEditItem(item) {
  editingTimestamp = item.timestamp;
  editingPhotoLink = item.photoLink || '';

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
    $('editPhotoPreview').src = editingPhotoLink;
    $('editPhotoWrap').classList.remove('hidden');
  } else {
    $('editPhotoPreview').src = '';
    $('editPhotoWrap').classList.add('hidden');
  }

  switchTab('edit');
}

function cancelEdit() {
  editingTimestamp = null;
  editingPhotoLink = '';
  switchTab('items');
}

async function saveEditItem() {
  if (!editingTimestamp) return;
  const location = transportMode === 'shipped' ? $('boxNumber').value.trim() : selectedHandCarry;
  if (!location) { showToast(transportMode === 'shipped' ? 'Enter box number.' : 'Select hand-carry bag.', 'error'); return; }
  if (!$('itemDescription').value.trim()) { showToast('Enter item description.', 'error'); return; }

  $('saveBtn').disabled = true;
  $('saveBtn').textContent = 'Updating…';
  try {
    await apiCall({
      action: 'edit',
      timestamp: editingTimestamp,
      transportMode: transportMode === 'shipped' ? '寄箱' : '手提',
      location,
      roomCategory: $('roomCategory').value.trim(),
      itemDescription: $('itemDescription').value.trim(),
      quantity: $('quantity').value || '1',
      size: $('size').value.trim(),
      weight: $('weight').value.trim(),
      estimatedValue: $('estimatedValue').value.trim(),
      status: selectedStatus
    });
    showToast('Item updated! 已更新', 'success');
    editingTimestamp = null;
    switchTab('items');
    loadAllItems();
  } catch (err) {
    showToast(err.message || 'Update failed', 'error');
  } finally {
    $('saveBtn').disabled = false;
    $('saveBtn').textContent = 'Update item';
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
  renderDashboard();
}

async function loadActivityLog() {
  const container = $('activityLog');
  if (container) container.innerHTML = '<p class="activity-loading">Loading activity…</p>';
  try {
    const data = await apiCall({ action: 'activity' });
    activityEntries = data.entries || [];
    renderActivityLog();
  } catch (err) {
    if (container) container.innerHTML = `<p class="activity-empty">${esc(err.message || 'Could not load activity.')}</p>`;
  }
}

function renderDashboard() {
  const statsEl = $('dashStats');
  const barsEl = $('dashStatusBars');
  if (!statsEl || !barsEl) return;

  const total = allItems.length;
  const packed = allItems.filter((i) => ['已打包', '已入箱', '已寄出'].includes(i.status)).length;
  const notPacked = total - packed;
  const shipped = allItems.filter((i) => i.transportMode === '寄箱').length;
  const handCarry = allItems.filter((i) => i.transportMode === '手提').length;
  let totalValue = 0;
  let totalWeight = 0;
  allItems.forEach((i) => {
    const v = parseFloat(String(i.estimatedValue || '').replace(/[^0-9.]/g, ''));
    if (!isNaN(v)) totalValue += v;
    totalWeight += parseWeight(i.weight);
  });
  const pct = total ? Math.round((packed / total) * 100) : 0;

  statsEl.innerHTML = `
    <div class="dash-stat"><span class="dash-stat-value">${total}</span><span class="dash-stat-label">Items</span></div>
    <div class="dash-stat"><span class="dash-stat-value">${pct}%</span><span class="dash-stat-label">Packed</span></div>
    <div class="dash-stat"><span class="dash-stat-value">£${totalValue.toFixed(0)}</span><span class="dash-stat-label">Est. value</span></div>
    <div class="dash-stat"><span class="dash-stat-value">${fmtW(totalWeight)}</span><span class="dash-stat-label">Weight</span></div>
    <div class="dash-stat dash-stat-wide"><span class="dash-stat-value">${notPacked}</span><span class="dash-stat-label">Not yet packed · 📦 ${shipped} shipped · 🎒 ${handCarry} hand carry</span></div>`;

  const statusCounts = {};
  STATUS_OPTIONS.forEach((s) => { statusCounts[s.value] = 0; });
  allItems.forEach((i) => { if (statusCounts[i.status] !== undefined) statusCounts[i.status]++; });

  barsEl.innerHTML = STATUS_OPTIONS.map((s) => {
    const n = statusCounts[s.value] || 0;
    const w = total ? Math.round((n / total) * 100) : 0;
    return `<div class="dash-bar-row"><span class="dash-bar-label">${esc(s.value)}</span><div class="dash-bar-track"><div class="dash-bar-fill ${STATUS_CLASS[s.value] || ''}" style="width:${w}%"></div></div><span class="dash-bar-count">${n}</span></div>`;
  }).join('');
}

const ACTIVITY_META = {
  open: { icon: '🔐', label: 'Access' },
  added: { icon: '➕', label: 'Added' },
  edited: { icon: '✏️', label: 'Edited' },
  deleted: { icon: '🗑️', label: 'Deleted' },
  status: { icon: '🔄', label: 'Status' }
};

function renderActivityLog() {
  const container = $('activityLog');
  if (!container) return;
  if (!activityEntries.length) {
    container.innerHTML = '<p class="activity-empty">No activity yet.</p>';
    return;
  }
  container.innerHTML = activityEntries.map((e) => {
    const meta = ACTIVITY_META[e.action] || { icon: '•', label: e.action };
    return `<div class="activity-row"><div class="activity-icon">${meta.icon}</div><div class="activity-body"><div class="activity-top"><span class="activity-user">${esc(formatUserName(e.user))}</span><span class="activity-action">${esc(meta.label)}</span><span class="activity-time">${esc(formatRelativeTime(e.timestamp))}</span></div><div class="activity-item">${esc(e.item || '—')}</div>${e.detail ? `<div class="activity-detail">${esc(e.detail)}</div>` : ''}</div></div>`;
  }).join('');
}

function formatUserName(email) {
  if (!email) return 'Unknown';
  const local = email.split('@')[0] || email;
  const name = local.split(/[._]/)[0] || local;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function formatRelativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getFilteredItems() {
  const query = ($('searchInput')?.value || '').toLowerCase().trim();
  return allItems.filter((item) => {
    if (filterTransport && item.transportMode !== filterTransport) return false;
    if (filterStatus && item.status !== filterStatus) return false;
    if (filterLocation && item.location !== filterLocation) return false;
    if (!query) return true;
    return [item.location, item.itemDescription, item.roomCategory, item.transportMode, item.status]
      .join(' ').toLowerCase().includes(query);
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
    [/kitchen|cook|pot|pan|plate|bowl|廚|鍋|碗|碟/, '🍳'],
    [/cloth|shirt|dress|jacket|衣|服|褲|鞋|衫/, '👕'],
    [/book|書|本/, '📚'],
    [/laptop|computer|phone|電|腦|機/, '💻'],
    [/chair|table|desk|sofa|bed|傢|椅|桌|床/, '🪑'],
    [/bag|suitcase|luggage|箱|袋/, '🧳']
  ];
  for (const [re, emoji] of rules) {
    if (re.test(text)) return emoji;
  }
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
  const maxLeft = 136;
  const maxRight = 110;

  wrap.querySelector('[data-swipe="edit"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = allItems.find((i) => i.timestamp === ts);
    closeOpenSwipe();
    if (item) startEditItem(item);
  });
  wrap.querySelector('[data-swipe="delete"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = allItems.find((i) => i.timestamp === ts);
    closeOpenSwipe();
    if (item) confirmDeleteItem(item);
  });
  wrap.querySelector('[data-swipe="status"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = allItems.find((i) => i.timestamp === ts);
    closeOpenSwipe();
    if (item) cycleStatus(item);
  });

  const onStart = (x, y) => {
    if (openSwipeRow && openSwipeRow !== wrap) closeOpenSwipe();
    startX = x; startY = y; currentX = 0; tracking = true; axis = null;
  };
  const onMove = (x, y, e) => {
    if (!tracking) return;
    const dx = x - startX;
    const dy = y - startY;
    if (!axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (axis !== 'x') return;
    e.preventDefault();
    currentX = Math.max(-maxRight, Math.min(maxLeft, dx));
    content.style.transform = `translateX(${currentX}px)`;
  };
  const onEnd = () => {
    if (!tracking) return;
    tracking = false;
    if (axis === 'x') {
      if (currentX > 60) {
        content.style.transform = `translateX(${maxLeft}px)`;
        wrap.classList.add('swipe-open-actions');
        openSwipeRow = wrap;
      } else if (currentX < -50) {
        content.style.transform = `translateX(${-maxRight}px)`;
        wrap.classList.add('swipe-open-status');
        openSwipeRow = wrap;
      } else {
        content.style.transform = '';
        wrap.classList.remove('swipe-open-status', 'swipe-open-actions');
        if (openSwipeRow === wrap) openSwipeRow = null;
      }
    }
  };

  content.addEventListener('touchstart', (e) => onStart(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  content.addEventListener('touchmove', (e) => onMove(e.touches[0].clientX, e.touches[0].clientY, e), { passive: false });
  content.addEventListener('touchend', onEnd);
  content.addEventListener('click', () => {
    if (openSwipeRow === wrap) { closeOpenSwipe(); return; }
    const detail = wrap.querySelector('.item-detail');
    detail?.classList.toggle('hidden');
  });
}

function confirmDeleteItem(item) {
  openActionSheet(
    [{ label: `Delete「${(item.itemDescription || 'item').slice(0, 24)}」`, value: 'delete', destructive: true }],
    async (v) => { if (v === 'delete') await deleteItem(item); }
  );
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
    renderDashboard();
    showToast('Item deleted 已刪除', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderFilteredList() {
  const list = $('itemList');
  if (!list) return;
  const items = getFilteredItems();
  $('resultCount').textContent = `${items.length} result(s)`;
  if (!items.length) { list.innerHTML = '<div class="empty-state">No items found.</div>'; return; }
  list.innerHTML = items.map(renderItemCard).join('');
  list.querySelectorAll('.item-swipe-wrap').forEach(bindItemSwipe);
}

function renderItemCard(item) {
  const thumb = renderItemThumb(item);
  const transportIcon = item.transportMode === '手提' ? '🎒' : '📦';
  const sc = STATUS_CLASS[item.status] || 'status-to-sort';
  const ts = esc(item.timestamp);
  const nextStatus = STATUS_OPTIONS[(STATUS_OPTIONS.findIndex((s) => s.value === item.status) + 1) % STATUS_OPTIONS.length];
  return `<div class="item-swipe-wrap" data-timestamp="${ts}"><div class="item-swipe-behind"><div class="swipe-actions-left"><button type="button" class="swipe-btn" data-swipe="edit">Edit</button><button type="button" class="swipe-btn destructive" data-swipe="delete">Delete</button></div><div class="swipe-actions-right"><button type="button" class="swipe-btn" data-swipe="status">${esc(nextStatus.value)} ›</button></div></div><div class="item-swipe-content"><div class="item-card"><div class="item-card-main">${thumb}<div class="item-info"><div class="item-title">${esc(item.itemDescription)}</div><div class="item-subtitle">${transportIcon} ${esc(item.location)} · ${esc(item.roomCategory || '')}</div></div><span class="status-badge ${sc}">${esc(item.status || '待整理')}</span><span class="item-chevron">›</span></div><div class="item-detail hidden"><p>運送: ${esc(item.transportMode)} · Qty: ${esc(item.quantity || '1')}</p><p>尺寸: ${esc(item.size || '—')} · 重量: ${esc(item.weight || '—')}</p><p>£${esc(item.estimatedValue || '—')}</p>${item.photoLink ? `<a href="${esc(item.photoLink)}" target="_blank" rel="noopener" style="color:#007AFF">View Photo</a>` : ''}</div></div></div></div>`;
}

async function cycleStatus(item) {
  const idx = STATUS_OPTIONS.findIndex((s) => s.value === item.status);
  const next = STATUS_OPTIONS[(idx + 1) % STATUS_OPTIONS.length];
  try {
    await apiCall({ action: 'update', timestamp: item.timestamp, status: next.value });
    item.status = next.value;
    renderFilteredList();
    renderBoxSummary();
    renderProgressBars();
    renderDashboard();
    showToast(`Status → ${next.value}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderProgressBars() {
  const t = allItems.length;
  const p = allItems.filter((i) => ['已打包', '已入箱', '已寄出'].includes(i.status)).length;
  const ib = allItems.filter((i) => i.status === '已入箱').length;
  const sh = allItems.filter((i) => i.status === '已寄出').length;
  const text = `📦 ${t} items · ✅ ${p} packed · 📥 ${ib} in box · 🚚 ${sh} shipped`;
  if ($('progressBar')) $('progressBar').textContent = text;
  if ($('progressBarBoxes')) $('progressBarBoxes').textContent = text;
}

function renderBoxSummary() {
  const container = $('boxSummary');
  if (!container) return;
  const shipped = {};
  const handCarry = {};
  HAND_CARRY_OPTIONS.forEach((o) => { handCarry[o.label] = { items: [], packed: 0, weight: 0 }; });
  allItems.forEach((item) => {
    const bucket = item.transportMode === '手提' ? handCarry : shipped;
    const key = item.location || 'Unknown';
    if (!bucket[key]) bucket[key] = { items: [], packed: 0, weight: 0 };
    bucket[key].items.push(item);
    if (['已打包', '已入箱', '已寄出'].includes(item.status)) bucket[key].packed++;
    bucket[key].weight += parseWeight(item.weight);
  });
  let html = '<p class="location-section-title">寄箱 Shipped</p>';
  const boxKeys = Object.keys(shipped).sort();
  html += boxKeys.length
    ? boxKeys.map((k) => locRow(`📦 Box ${k}`, shipped[k], k, 'shipped')).join('')
    : '<div class="empty-state" style="padding:16px">No shipped items yet.</div>';
  html += '<p class="location-section-title">手提 Hand Carry</p>';
  html += HAND_CARRY_OPTIONS.map((o) =>
    locRow(`${o.icon} ${o.label}`, handCarry[o.label] || { items: [], packed: 0, weight: 0 }, o.label, 'handcarry')
  ).join('');
  container.innerHTML = html;
  container.querySelectorAll('.location-row').forEach((row) => {
    row.addEventListener('click', () => {
      filterLocation = row.dataset.location;
      filterTransport = row.dataset.transport === 'handcarry' ? '手提' : '寄箱';
      document.querySelectorAll('#transportChips .ios-chip').forEach((c) =>
        c.classList.toggle('active', c.dataset.transport === filterTransport)
      );
      switchTab('items');
    });
  });
}

function locRow(title, b, location, transport) {
  return `<div class="location-row" data-location="${esc(location)}" data-transport="${transport}"><div><div style="font-weight:500">${title}</div><div style="font-size:13px;color:#8E8E93;margin-top:2px">${b.items.length} items · ${b.packed} packed · ${fmtW(b.weight)}</div></div><span style="color:#8E8E93">›</span></div>`;
}

function parseWeight(w) {
  const n = parseFloat(String(w || '').replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}
function fmtW(w) { return w > 0 ? `${w.toFixed(1)}kg` : '—'; }

function switchTab(tab) {
  closeOpenSwipe();
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const titles = {
    upload: 'Upload',
    review: 'Review',
    edit: 'Edit Item',
    items: 'Inventory',
    boxes: 'Boxes',
    dashboard: 'Dashboard'
  };
  $('navTitle').textContent = titles[tab] || 'Review';
  if (tab === 'upload') {
    $('screenUpload').classList.add('active');
    renderUploadQueue();
    updateUploadToolbar();
  }
  if (tab === 'review') $('screenReview').classList.add('active');
  if (tab === 'edit') $('screenEdit').classList.add('active');
  if (tab === 'items') { $('screenItems').classList.add('active'); renderFilteredList(); }
  if (tab === 'boxes') { $('screenBoxes').classList.add('active'); renderBoxSummary(); renderProgressBars(); }
  if (tab === 'dashboard') { $('screenDashboard').classList.add('active'); renderDashboard(); loadActivityLog(); }
}

function showToast(msg, type = 'success') {
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

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}
