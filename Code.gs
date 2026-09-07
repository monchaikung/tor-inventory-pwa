// ============ CONFIGURATION ============
const SHEET_ID = '1Uqr9wK9SonaXbsBlTzw5CWYWPGozGlZAksdh6ekGvDk';
const DRIVE_FOLDER_ID = '1zDSkyqyLU-DjHbZ3gkSdY8tAi8qbrcFn';

// Script Properties (Project Settings -> Script Properties):
//   GEMINI_API_KEY = your Gemini API key
//   ALLOWED_EMAILS = monchai.kung@gmail.com,kristintsang@gmail.com

const ACTIVITY_SHEET_NAME = 'Activity Log';
const INBOX_SHEET_NAME = 'Pending Inbox';
const INBOX_FOLDER_NAME = 'Inbox';
const GOOGLE_CLIENT_ID = '869989444444-o666m973d6ofrfnaip7g0lthsmi6l5g3.apps.googleusercontent.com';
const VALID_STATUSES = ['待整理', '待打包', '已打包', '已入箱', '已寄出'];
const OPEN_RATE_LIMIT_SEC = 3600;
const ALLOWED_DEVICES = ['iPhone', 'iPad', 'Android', 'Mac', 'Windows', 'Unknown'];
const ALLOWED_BROWSERS = ['Safari', 'Chrome iOS', 'Firefox iOS', 'Edge iOS', 'Chrome', 'Firefox', 'Edge', 'Other'];
const ALLOWED_MODES = ['PWA', 'Browser'];
const ALLOWED_NETWORKS = ['slow-2g', '2g', '3g', '4g', ''];

function doGet() {
  return jsonResponse({ status: 'ok', message: 'ToR Inventory API is running', model: 'gemini-3.5-flash-lite', version: 'v26' });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const user = verifyAccess_(body.idToken);
    if (!user) return jsonResponse({ success: false, error: 'Access denied' });

    switch (body.action) {
      case 'analyze': return jsonResponse(analyzeImage_(body.image));
      case 'save': return jsonResponse(saveItem_(body, user.email));
      case 'search': return jsonResponse(searchItems_(body.query || ''));
      case 'update': return jsonResponse(updateStatus_(body.timestamp, body.status, user.email));
      case 'bulkUpdate': return jsonResponse(bulkUpdateStatus_(body.timestamps, body.status, user.email));
      case 'edit': return jsonResponse(editItem_(body, user.email));
      case 'delete': return jsonResponse(deleteItem_(body.timestamp, user.email));
      case 'activity': return jsonResponse(getActivityLog_());
      case 'open': return jsonResponse(logAppOpen_(body.client || {}, user.email));
      case 'inboxUpload': return jsonResponse(inboxUpload_(body, user.email));
      case 'inboxList': return jsonResponse(inboxList_());
      case 'inboxAnalyze': return jsonResponse(inboxAnalyze_(body.inboxId));
      case 'inboxDelete': return jsonResponse(inboxDelete_(body.inboxId, user.email));
      case 'rebuildTorList': return jsonResponse(rebuildTorItemList_(user.email));
      default: return jsonResponse({ success: false, error: 'Unknown action' });
    }
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function testSetup() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  Logger.log('Sheet: ' + sheet.getName());
  Logger.log('Folder: ' + folder.getName());
}

function verifyAccess_(idToken) {
  if (!idToken) return null;
  const resp = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (resp.getResponseCode() !== 200) return null;
  const payload = JSON.parse(resp.getContentText());

  const iss = String(payload.iss || '');
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') return null;

  const aud = String(payload.aud || '');
  if (aud !== GOOGLE_CLIENT_ID) return null;

  const exp = parseInt(payload.exp, 10);
  if (!exp || exp * 1000 <= Date.now()) return null;

  const email = payload.email;
  if (!email) return null;
  if (payload.email_verified === 'false' || payload.email_verified === false) return null;

  const allowed = (PropertiesService.getScriptProperties().getProperty('ALLOWED_EMAILS') || '')
    .split(',').map(function(e) { return e.trim().toLowerCase(); });
  if (allowed.indexOf(email.toLowerCase()) === -1) return null;
  return { email: email };
}

function sanitizeSheetValue_(value) {
  var s = String(value == null ? '' : value).substring(0, 500);
  if (/^[=+\-@|\t\r]/.test(s)) s = "'" + s;
  return s;
}

function isValidStatus_(status) {
  return VALID_STATUSES.indexOf(String(status)) !== -1;
}

function isValidIp_(ip) {
  if (!ip) return false;
  var s = String(ip);
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(s)) {
    var parts = s.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (parseInt(parts[i], 10) > 255) return false;
    }
    return true;
  }
  if (/^[0-9a-fA-F:]+$/.test(s) && s.indexOf(':') !== -1) return s.length <= 45;
  return false;
}

function sanitizeClientInfo_(client) {
  client = client || {};
  var out = {};
  if (isValidIp_(client.ip)) out.ip = String(client.ip);
  var dev = String(client.device || '');
  if (ALLOWED_DEVICES.indexOf(dev) !== -1) out.device = dev;
  var br = String(client.browser || '');
  if (ALLOWED_BROWSERS.indexOf(br) !== -1) out.browser = br;
  var lang = String(client.lang || '').substring(0, 20);
  if (/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/.test(lang)) out.lang = lang;
  var tz = String(client.timezone || '').substring(0, 64);
  if (/^[A-Za-z0-9_+\/-]+$/.test(tz)) out.timezone = tz;
  var screen = String(client.screen || '');
  if (/^\d{1,5}[x×]\d{1,5}$/i.test(screen)) out.screen = screen.replace(/x/i, '×');
  var vp = String(client.viewport || '');
  if (/^\d{1,5}[x×]\d{1,5}$/i.test(vp)) out.viewport = vp.replace(/x/i, '×');
  var mode = String(client.mode || '');
  if (ALLOWED_MODES.indexOf(mode) !== -1) out.mode = mode;
  var net = String(client.network || '');
  if (ALLOWED_NETWORKS.indexOf(net) !== -1) out.network = net;
  if (client.online === false) out.online = false;
  out.event = client.event === 'sign_in' ? 'sign_in' : 'session_resume';
  return out;
}

function checkOpenRateLimit_(email) {
  var cache = CacheService.getScriptCache();
  var key = 'open_' + String(email).toLowerCase().replace(/[^a-z0-9@._-]/g, '');
  if (cache.get(key)) return false;
  cache.put(key, '1', OPEN_RATE_LIMIT_SEC);
  return true;
}

function analyzeImage_(base64Image, opts) {
  opts = opts || {};
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in Script Properties');

  var raw = String(base64Image || '');
  var comma = raw.indexOf(',');
  if (raw.indexOf('data:') === 0 && comma !== -1) raw = raw.substring(comma + 1);
  // Cap payload size — huge Drive originals stall UrlFetch + Gemini
  if (raw.length > 450000) {
    throw new Error('Photo too large for AI. Re-upload a smaller JPEG. 相片太大，請用較細 JPEG 再上載。');
  }

  const prompt =
    'Identify the main personal item in this photo for UK Transfer of Residence customs inventory. ' +
    'Return JSON only with keys: roomCategory, itemDescription, quantity, size, weight, estimatedValue. ' +
    'Do NOT invent transport mode, box numbers, or bag locations. ' +
    'itemDescription: required short English phrase for UK ToR / mover packing list, e.g. "Used laptop computer", "Used clothing", "Used books". Prefer "Used …" wording. ' +
    'size: ONLY numeric cm dimensions e.g. "20x15x5 cm" or "30x20 cm". Never use A4, Small, Medium, Large, or paper sizes. If unsure, leave size empty. ' +
    'roomCategory: 客廳|睡房|廚房|浴室|書房|其他. quantity: 1. estimatedValue: number GBP.';

  const schema = {
    type: 'OBJECT',
    properties: {
      roomCategory: { type: 'STRING' },
      itemDescription: { type: 'STRING' },
      quantity: { type: 'NUMBER' },
      size: { type: 'STRING' },
      weight: { type: 'STRING' },
      estimatedValue: { type: 'NUMBER' }
    },
    required: ['itemDescription']
  };

  const payload = {
    contents: [{ parts: [
      { text: prompt },
      { inline_data: { mime_type: 'image/jpeg', data: raw } }
    ]}],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
      responseSchema: schema
    }
  };

  // No gemini-2.5-* (retired for new users → 404). Prefer 3.5-lite, then 3.6-flash.
  const models = opts.fast
    ? ['gemini-3.5-flash-lite', 'gemini-3.6-flash']
    : ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.6-flash'];
  let resp = null;
  let lastError = '';
  let lastCode = 0;

  for (var m = 0; m < models.length; m++) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + models[m] + ':generateContent?key=' + apiKey;
    resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    lastCode = resp.getResponseCode();
    if (lastCode === 200) break;
    lastError = resp.getContentText();
    // 404/400 = bad/retired model or request — try next. 429/503 = busy — try next once.
    const tryNext = lastCode === 404 || lastCode === 400 || lastCode === 503 || lastCode === 429 || lastCode === 500;
    if (!tryNext) break;
    if (m < models.length - 1) Utilities.sleep(250);
  }

  if (!resp || lastCode !== 200) {
    if (lastCode === 503) {
      throw new Error('AI is busy right now. Please wait a few seconds and try again.');
    }
    if (lastCode === 429) {
      throw new Error('AI rate limit reached. Wait 30 seconds and try again. AI 請求太密，請稍等再試。');
    }
    if (lastCode === 404) {
      throw new Error('AI model unavailable. Redeploy latest Code.gs. AI 模型唔可用，請更新 Code.gs。');
    }
    throw new Error(formatGeminiError_(lastError, lastCode));
  }

  const result = JSON.parse(resp.getContentText());
  const blockReason = result.candidates && result.candidates[0] && result.candidates[0].finishReason;
  if (blockReason === 'SAFETY') {
    throw new Error('Photo blocked by safety filter. Try a clearer photo.');
  }

  const text = extractGeminiText_(result);
  if (!text) throw new Error('AI returned an empty response. Please try again.');

  const suggestions = normalizeSuggestions_(parseAiJsonLoose_(text));
  if (!suggestions.itemDescription) {
    suggestions.itemDescription = guessDescription_(suggestions, text);
  }
  if (!suggestions.itemDescription) {
    throw new Error('AI could not identify the item. Try a clearer photo of one item.');
  }

  return { success: true, suggestions: suggestions };
}


function formatGeminiError_(raw, code) {
  try {
    var parsed = JSON.parse(raw);
    var msg = parsed && parsed.error && parsed.error.message;
    if (msg) {
      msg = String(msg);
      if (/no longer available|NOT_FOUND|not found/i.test(msg)) {
        return 'AI model unavailable. Update Code.gs model list. AI 模型已停用。';
      }
      if (msg.length > 160) msg = msg.substring(0, 157) + '…';
      return 'Gemini API error: ' + msg;
    }
  } catch (e) {}
  var s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (s.length > 160) s = s.substring(0, 157) + '…';
  return 'Gemini API error: ' + (s || ('HTTP ' + code));
}

function extractGeminiText_(result) {
  try {
    var parts = (result.candidates[0].content && result.candidates[0].content.parts) || [];
    var answer = '';
    var fallback = '';
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i].text) continue;
      fallback += parts[i].text;
      if (parts[i].thought) continue;
      answer = parts[i].text;
    }
    var text = String(answer || fallback || '').trim();
    if (text.indexOf('{') !== -1 && text.lastIndexOf('}') > text.indexOf('{')) {
      return text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    }
    return text;
  } catch (e) {
    return '';
  }
}

function parseAiJsonLoose_(text) {
  var cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e1) {
    var start = cleaned.indexOf('{');
    var end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.substring(start, end + 1));
      } catch (e2) {}
    }
    return regexExtractFields_(cleaned);
  }
}

function regexExtractFields_(text) {
  function grab(key) {
    var re = new RegExp('"' + key + '"\\s*:\\s*"([^"]*)"', 'i');
    var m = text.match(re);
    return m ? m[1] : '';
  }
  function grabNum(key) {
    var re = new RegExp('"' + key + '"\\s*:\\s*([0-9.]+)', 'i');
    var m = text.match(re);
    return m ? m[1] : '';
  }
  return {
    transportMode: grab('transportMode') || grab('transport_mode'),
    location: '',
    roomCategory: grab('roomCategory') || grab('room_category'),
    itemDescription: grab('itemDescription') || grab('item_description') || grab('description'),
    quantity: grabNum('quantity') || 1,
    size: sanitizeSizeCm_(grab('size')),
    weight: grab('weight'),
    estimatedValue: grabNum('estimatedValue') || 0
  };
}

function guessDescription_(suggestions, rawText) {
  var fromText = String(rawText || '');
  var m = fromText.match(/"itemDescription"\s*:\s*"([^"]+)"/i) ||
          fromText.match(/"description"\s*:\s*"([^"]+)"/i);
  if (m) return m[1];
  if (suggestions.roomCategory) return 'Used household item (' + suggestions.roomCategory + ')';
  return '';
}


function sanitizeSizeCm_(raw) {
  var s = String(raw || '').trim();
  if (!s) return '';
  var lower = s.toLowerCase();
  // Reject qualitative / paper sizes
  if (/\b(a[0-6]|b[0-6]|letter|legal|small|medium|large|xl|xxl|tiny|huge|big)\b/i.test(lower)) return '';
  if (/^(xs|s|m|l|xl|xxl)$/i.test(s)) return '';
  if (!/[0-9]/.test(s)) return '';
  // Bare number → treat as cm
  if (/^[0-9]+(\.[0-9]+)?$/.test(s)) return s + ' cm';
  if (/^[0-9]+(\.[0-9]+)?\s*cm$/i.test(s)) return s.replace(/\s+/g, ' ');
  // Dimensions with x/× but missing unit
  if (/(x|×|\*)/i.test(s) && !/(cm|mm)\b/i.test(s)) {
    s = s.replace(/\s+$/, '') + ' cm';
  } else if (!/(cm|mm|\bm\b|x|×|\*)/i.test(s)) {
    return '';
  }
  return s.substring(0, 40);
}

function normalizeSuggestions_(raw) {
  if (!raw || typeof raw !== 'object') return {};
  if (raw.suggestions && typeof raw.suggestions === 'object') raw = raw.suggestions;
  if (Array.isArray(raw) && raw.length) raw = raw[0];

  function pick() {
    for (var i = 0; i < arguments.length; i++) {
      var v = raw[arguments[i]];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return '';
  }

  // Transport + Box # never from AI — upload bulk fields or PC editor only
  var desc = String(pick('itemDescription', 'item_description', 'description', '物品描述', 'desc', 'item', 'name', 'title', 'product', 'object'));

  return {
    transportMode: '',
    location: '',
    roomCategory: String(pick('roomCategory', 'room_category', '房間分類', 'room')),
    itemDescription: desc,
    quantity: pick('quantity', 'qty', '數量') || 1,
    size: sanitizeSizeCm_(pick('size', '尺寸')),
    weight: String(pick('weight', '重量')),
    estimatedValue: pick('estimatedValue', 'estimated_value', 'value', '預估價值') || 0
  };
}

function getActivitySheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(ACTIVITY_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ACTIVITY_SHEET_NAME);
    sheet.appendRow(['Timestamp', 'User', 'Action', 'Item', 'Detail']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function logActivity_(email, action, itemDesc, detail) {
  getActivitySheet_().appendRow([
    new Date().toISOString(),
    sanitizeSheetValue_(email),
    sanitizeSheetValue_(action),
    sanitizeSheetValue_(itemDesc),
    sanitizeSheetValue_(detail)
  ]);
}

function getActivityLog_() {
  const sheet = getActivitySheet_();
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { success: true, entries: [] };

  const entries = [];
  for (var i = data.length - 1; i >= 1 && entries.length < 50; i--) {
    entries.push({
      timestamp: String(data[i][0]),
      user: String(data[i][1] || ''),
      action: String(data[i][2] || ''),
      item: String(data[i][3] || ''),
      detail: String(data[i][4] || '')
    });
  }
  return { success: true, entries: entries };
}

function logAppOpen_(client, email) {
  if (!checkOpenRateLimit_(email)) return { success: true, skipped: true };

  client = sanitizeClientInfo_(client);
  const parts = [];
  if (client.ip) parts.push('IP: ' + client.ip);
  if (client.device) parts.push('Device: ' + client.device);
  if (client.browser) parts.push('Browser: ' + client.browser);
  if (client.lang) parts.push('Lang: ' + client.lang);
  if (client.timezone) parts.push('TZ: ' + client.timezone);
  if (client.screen) parts.push('Screen: ' + client.screen);
  if (client.viewport) parts.push('Viewport: ' + client.viewport);
  if (client.mode) parts.push('Mode: ' + client.mode);
  if (client.network) parts.push('Network: ' + client.network);
  if (client.online === false) parts.push('Offline');
  const event = client.event === 'sign_in' ? 'Signed in' : 'Opened app';
  logActivity_(email, 'open', event, parts.join(' · '));
  return { success: true };
}

function saveItem_(body, email) {
  const status = isValidStatus_(body.status) ? body.status : '待整理';
  const timestamp = new Date().toISOString();
  var photoLink = '';
  if (body.image) {
    photoLink = savePhoto_(body.image, body.location, timestamp);
  } else if (body.inboxId) {
    photoLink = getInboxPhotoLink_(body.inboxId);
  } else if (body.photoLink) {
    photoLink = String(body.photoLink);
  } else {
    throw new Error('Missing photo');
  }
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  const desc = body.itemDescription || '';
  sheet.appendRow([
    timestamp,
    body.transportMode || '寄箱',
    body.location || '',
    body.roomCategory || '',
    desc,
    body.quantity || '1',
    body.size || '',
    body.weight || '',
    body.estimatedValue || '',
    status,
    photoLink
  ]);
  if (body.inboxId) markInboxDone_(body.inboxId);
  logActivity_(email, 'added', desc, (body.location || '') + ' · ' + status);
  try { rebuildTorItemList_(email); } catch (e) {}
  return { success: true, photoLink: photoLink, timestamp: timestamp };
}

function savePhoto_(base64Image, location, timestamp) {
  return savePhotoToFolder_(base64Image, location, timestamp, DriveApp.getFolderById(DRIVE_FOLDER_ID)).url;
}

function savePhotoToFolder_(base64Image, location, timestamp, folder) {
  if (!base64Image) throw new Error('Missing photo');
  var raw = String(base64Image);
  var comma = raw.indexOf(',');
  if (raw.indexOf('data:') === 0 && comma !== -1) raw = raw.substring(comma + 1);
  var bytes;
  try {
    bytes = Utilities.base64Decode(raw);
  } catch (e) {
    throw new Error('Invalid photo data');
  }
  if (!bytes || !bytes.length) throw new Error('Empty photo');
  const blob = Utilities.newBlob(
    bytes,
    'image/jpeg',
    sanitizeFilename_(location || 'photo') + '_' + Date.now() + '.jpg'
  );
  const file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {}
  return { url: file.getUrl(), fileId: file.getId() };
}

function getInboxFolder_() {
  const parent = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const it = parent.getFoldersByName(INBOX_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return parent.createFolder(INBOX_FOLDER_NAME);
}

function getInboxSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(INBOX_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(INBOX_SHEET_NAME);
    sheet.appendRow(['InboxId', 'UploadedAt', 'User', 'PhotoLink', 'FileId', 'FileName', 'CaptureTime', 'Note', 'Status', 'TransportMode', 'Location']);
    sheet.setFrozenRows(1);
  } else {
    ensureInboxHeaders_(sheet);
  }
  return sheet;
}

function ensureInboxHeaders_(sheet) {
  if (sheet.getLastColumn() < 10) sheet.getRange(1, 10).setValue('TransportMode');
  if (sheet.getLastColumn() < 11) sheet.getRange(1, 11).setValue('Location');
}

function inboxUpload_(body, email) {
  if (!body.image) throw new Error('Missing photo');
  const inboxId = Utilities.getUuid();
  const uploadedAt = new Date().toISOString();
  const captureTime = body.captureTime ? String(body.captureTime) : uploadedAt;
  const fileName = String(body.fileName || 'photo.jpg').substring(0, 120);
  const note = String(body.note || '').substring(0, 200);
  var transportMode = String(body.transportMode || '寄箱');
  if (transportMode.indexOf('手') !== -1 || /hand/i.test(transportMode)) transportMode = '手提';
  else transportMode = '寄箱';
  const location = String(body.location || '').substring(0, 80);
  const saved = savePhotoToFolder_(body.image, 'inbox', uploadedAt, getInboxFolder_());
  getInboxSheet_().appendRow([
    inboxId,
    uploadedAt,
    email || '',
    saved.url,
    saved.fileId,
    fileName,
    captureTime,
    note,
    'pending',
    transportMode,
    location
  ]);
  logActivity_(email, 'inbox', 'Uploaded for later', fileName + ' · ' + captureTime);
  return {
    success: true,
    inboxId: inboxId,
    photoLink: saved.url,
    fileId: saved.fileId,
    captureTime: captureTime,
    status: 'pending'
  };
}

function inboxList_() {
  const sheet = getInboxSheet_();
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { success: true, items: [], count: 0 };

  const items = [];
  for (var i = 1; i < data.length; i++) {
    const status = String(data[i][8] || 'pending');
    if (status === 'done') continue;
    const fileId = String(data[i][4] || '');
    items.push({
      inboxId: String(data[i][0] || ''),
      uploadedAt: String(data[i][1] || ''),
      user: String(data[i][2] || ''),
      photoLink: String(data[i][3] || ''),
      fileId: fileId,
      thumbUrl: fileId ? ('https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400') : String(data[i][3] || ''),
      fileName: String(data[i][5] || ''),
      captureTime: String(data[i][6] || data[i][1] || ''),
      note: String(data[i][7] || ''),
      status: status,
      transportMode: String(data[i][9] || '寄箱'),
      location: String(data[i][10] || '')
    });
  }
  items.sort(function(a, b) {
    return new Date(a.captureTime).getTime() - new Date(b.captureTime).getTime();
  });
  return { success: true, items: items, count: items.length };
}

function findInboxRow_(inboxId) {
  if (!inboxId) return null;
  const sheet = getInboxSheet_();
  const data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(inboxId)) {
      return { sheet: sheet, row: i + 1, data: data[i] };
    }
  }
  return null;
}

function getInboxPhotoLink_(inboxId) {
  const found = findInboxRow_(inboxId);
  if (!found) throw new Error('Inbox item not found');
  return String(found.data[3] || '');
}

function markInboxDone_(inboxId) {
  const found = findInboxRow_(inboxId);
  if (!found) return;
  found.sheet.getRange(found.row, 9).setValue('done');
}

function inboxAnalyze_(inboxId) {
  const found = findInboxRow_(inboxId);
  if (!found) throw new Error('Inbox item not found');
  const fileId = String(found.data[4] || '');
  if (!fileId) throw new Error('Inbox photo missing');
  found.sheet.getRange(found.row, 9).setValue('processing');
  try {
    const blob = DriveApp.getFileById(fileId).getBlob();
    var bytes = blob.getBytes();
    // Guard: oversized Drive files (e.g. original HEIC/JPEG) blow past client timeout
    if (bytes && bytes.length > 350000) {
      // Prefer JPEG conversion when Drive can; otherwise fail clearly
      try {
        const jpeg = blob.getAs('image/jpeg');
        bytes = jpeg.getBytes();
      } catch (e) {}
    }
    if (!bytes || !bytes.length) throw new Error('Inbox photo empty');
    if (bytes.length > 500000) {
      found.sheet.getRange(found.row, 9).setValue('pending');
      throw new Error('Inbox photo too large for AI. Re-upload compressed JPEG from phone.');
    }
    const base64 = Utilities.base64Encode(bytes);
    return analyzeImage_(base64, { fast: true });
  } catch (err) {
    try { found.sheet.getRange(found.row, 9).setValue('pending'); } catch (e2) {}
    throw err;
  }
}

function inboxDelete_(inboxId, email) {
  const found = findInboxRow_(inboxId);
  if (!found) throw new Error('Inbox item not found');
  try {
    const fileId = String(found.data[4] || '');
    if (fileId) DriveApp.getFileById(fileId).setTrashed(true);
  } catch (e) {}
  found.sheet.deleteRow(found.row);
  logActivity_(email, 'inbox', 'Removed pending photo', String(found.data[5] || ''));
  return { success: true };
}

function sanitizeFilename_(str) {
  return String(str).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').substring(0, 30);
}

function searchItems_(query) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { success: true, items: [], count: 0 };

  const q = query.toLowerCase().trim();
  const items = [];

  for (var i = 1; i < data.length; i++) {
    const row = data[i];
    const item = {
      timestamp: String(row[0]),
      transportMode: String(row[1] || ''),
      location: String(row[2] || ''),
      roomCategory: String(row[3] || ''),
      itemDescription: String(row[4] || ''),
      quantity: String(row[5] || ''),
      size: String(row[6] || ''),
      weight: String(row[7] || ''),
      estimatedValue: String(row[8] || ''),
      status: String(row[9] || ''),
      photoLink: String(row[10] || '')
    };
    if (q) {
      const haystack = [item.location, item.itemDescription, item.roomCategory, item.transportMode, item.status].join(' ').toLowerCase();
      if (haystack.indexOf(q) === -1) continue;
    }
    items.push(item);
  }

  items.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
  return { success: true, items: items.slice(0, 200), count: items.length };
}

function updateStatus_(timestamp, status, email) {
  if (!isValidStatus_(status)) throw new Error('Invalid status');
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  const data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(timestamp)) {
      const oldStatus = String(data[i][9] || '');
      const desc = String(data[i][4] || '');
      sheet.getRange(i + 1, 10).setValue(status);
      logActivity_(email, 'status', desc, oldStatus + ' → ' + status);
      return { success: true };
    }
  }
  throw new Error('Item not found');
}

function bulkUpdateStatus_(timestamps, status, email) {
  if (!isValidStatus_(status)) throw new Error('Invalid status');
  if (!timestamps || !timestamps.length) throw new Error('No items selected');
  var wanted = {};
  for (var t = 0; t < timestamps.length; t++) {
    wanted[String(timestamps[t])] = true;
  }
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var updated = [];
  var changed = 0;
  for (var i = 1; i < data.length; i++) {
    var ts = String(data[i][0]);
    if (!wanted[ts]) continue;
    var oldStatus = String(data[i][9] || '');
    if (oldStatus !== String(status)) {
      sheet.getRange(i + 1, 10).setValue(status);
      changed++;
    }
    updated.push(ts);
  }
  if (!updated.length) throw new Error('No matching items found');
  logActivity_(email, 'bulk-status', changed + ' changed → ' + status, updated.length + ' selected');
  return { success: true, updated: updated, count: updated.length, changed: changed };
}

function editItem_(body, email) {
  if (!body.timestamp) throw new Error('Missing timestamp');
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  const data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.timestamp)) {
      var photoLink = String(data[i][10] || '');
      if (body.image) {
        photoLink = savePhoto_(body.image, body.location, body.timestamp);
      }
      var status = isValidStatus_(body.status) ? body.status : String(data[i][9] || '待整理');
      // getRange(row, col, numRows, numCols) — 1 row, 10 cols (B–K)
      sheet.getRange(i + 1, 2, 1, 10).setValues([[
        body.transportMode || String(data[i][1] || '寄箱'),
        body.location || '',
        body.roomCategory || '',
        body.itemDescription || '',
        body.quantity || '1',
        body.size || '',
        body.weight || '',
        body.estimatedValue || '',
        status,
        photoLink
      ]]);
      try { rebuildTorItemList_(email); } catch (e) {}
      logActivity_(email, 'edited', body.itemDescription || String(data[i][4] || ''), body.location || '');
      return { success: true, photoLink: photoLink, timestamp: body.timestamp };
    }
  }
  throw new Error('Item not found');
}

function deleteItem_(timestamp, email) {
  if (!timestamp) throw new Error('Missing timestamp');
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  const data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(timestamp)) {
      const desc = String(data[i][4] || '');
      try {
        var link = String(data[i][10] || '');
        var match = link.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (match) DriveApp.getFileById(match[1]).setTrashed(true);
      } catch (e) {}
      sheet.deleteRow(i + 1);
      try { rebuildTorItemList_(email); } catch (e) {}
      logActivity_(email, 'deleted', desc, String(data[i][2] || ''));
      return { success: true };
    }
  }
  throw new Error('Item not found');
}


const TOR_LIST_SHEET_NAME = 'Item List for TOR';

function getTorListSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TOR_LIST_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(TOR_LIST_SHEET_NAME);
  }
  return sheet;
}

function formatTorItemName_(desc) {
  var s = String(desc || '').trim();
  if (!s) return '';
  // Keep English mover/ToR style; ensure leading Used when clearly household goods and missing
  if (!/^used\b/i.test(s) && !/^(new|brand new)\b/i.test(s)) {
    // only auto-prefix short noun-like phrases
    if (s.length <= 48 && !/[.!?]$/.test(s)) s = 'Used ' + s.charAt(0).toLowerCase() + s.slice(1);
  }
  // Capitalize first letter
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s.substring(0, 120);
}

function rebuildTorItemList_(email) {
  const inv = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  const data = inv.getDataRange().getValues();
  // Aggregate by normalized description
  const map = {};
  const order = [];
  for (var i = 1; i < data.length; i++) {
    var desc = String(data[i][4] || '').trim();
    if (!desc) continue;
    var qty = parseFloat(String(data[i][5] || '1').replace(/[^0-9.]/g, ''));
    if (!qty || qty < 0) qty = 1;
    var key = desc.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!map[key]) {
      map[key] = { name: formatTorItemName_(desc), qty: 0 };
      order.push(key);
    } else {
      // Prefer longer/more specific display name
      var candidate = formatTorItemName_(desc);
      if (candidate.length > map[key].name.length) map[key].name = candidate;
    }
    map[key].qty += qty;
  }

  const sheet = getTorListSheet_();
  sheet.clear();
  sheet.appendRow(['Item List for TOR', '', '']);
  sheet.appendRow(['Item Number', 'Item', 'Number of Item']);
  sheet.appendRow(['', 'Example: Books', '110 (approximately)']);

  var n = 0;
  for (var k = 0; k < order.length; k++) {
    var row = map[order[k]];
    n++;
    var qtyOut = (Math.round(row.qty * 100) / 100);
    // Whole numbers without decimals
    if (Math.abs(qtyOut - Math.round(qtyOut)) < 0.001) qtyOut = String(Math.round(qtyOut));
    else qtyOut = String(qtyOut);
    sheet.appendRow([n, row.name, qtyOut]);
  }

  sheet.setFrozenRows(2);
  try { sheet.autoResizeColumns(1, 3); } catch (e) {}
  if (email) logActivity_(email, 'tor-list', 'Rebuilt Item List for TOR', n + ' line(s)');
  return { success: true, count: n, sheet: TOR_LIST_SHEET_NAME };
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
