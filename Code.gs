// ============ CONFIGURATION ============
const SHEET_ID = '1Uqr9wK9SonaXbsBlTzw5CWYWPGozGlZAksdh6ekGvDk';
const DRIVE_FOLDER_ID = '1zDSkyqyLU-DjHbZ3gkSdY8tAi8qbrcFn';

// Script Properties (Project Settings -> Script Properties):
//   GEMINI_API_KEY = your Gemini API key
//   ALLOWED_EMAILS = monchai.kung@gmail.com,kristintsang@gmail.com

const ACTIVITY_SHEET_NAME = 'Activity Log';
const GOOGLE_CLIENT_ID = '869989444444-o666m973d6ofrfnaip7g0lthsmi6l5g3.apps.googleusercontent.com';
const VALID_STATUSES = ['待整理', '待打包', '已打包', '已入箱', '已寄出'];
const OPEN_RATE_LIMIT_SEC = 3600;
const ALLOWED_DEVICES = ['iPhone', 'iPad', 'Android', 'Mac', 'Windows', 'Unknown'];
const ALLOWED_BROWSERS = ['Safari', 'Chrome iOS', 'Firefox iOS', 'Edge iOS', 'Chrome', 'Firefox', 'Edge', 'Other'];
const ALLOWED_MODES = ['PWA', 'Browser'];
const ALLOWED_NETWORKS = ['slow-2g', '2g', '3g', '4g', ''];

function doGet() {
  return jsonResponse({ status: 'ok', message: 'ToR Inventory API is running', model: 'gemini-2.5-flash', version: 'v15' });
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
      case 'edit': return jsonResponse(editItem_(body, user.email));
      case 'delete': return jsonResponse(deleteItem_(body.timestamp, user.email));
      case 'activity': return jsonResponse(getActivityLog_());
      case 'open': return jsonResponse(logAppOpen_(body.client || {}, user.email));
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

function analyzeImage_(base64Image) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in Script Properties');

  const prompt =
    'Identify the main personal item in this photo for UK Transfer of Residence customs inventory. ' +
    'Return JSON only with keys: transportMode, location, roomCategory, itemDescription, quantity, size, weight, estimatedValue. ' +
    'transportMode: "shipped" or "handcarry". itemDescription: required short English phrase e.g. "Used laptop computer". ' +
    'roomCategory: 客廳|睡房|廚房|浴室|書房|其他. quantity: 1. estimatedValue: number GBP.';

  const schema = {
    type: 'OBJECT',
    properties: {
      transportMode: { type: 'STRING' },
      location: { type: 'STRING' },
      roomCategory: { type: 'STRING' },
      itemDescription: { type: 'STRING' },
      quantity: { type: 'NUMBER' },
      size: { type: 'STRING' },
      weight: { type: 'STRING' },
      estimatedValue: { type: 'NUMBER' }
    },
    required: ['transportMode', 'itemDescription']
  };

  const payload = {
    contents: [{ parts: [
      { text: prompt },
      { inline_data: { mime_type: 'image/jpeg', data: base64Image } }
    ]}],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseSchema: schema
    }
  };

  const models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash-lite'];
  let resp = null;
  let lastError = '';

  for (var m = 0; m < models.length; m++) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + models[m] + ':generateContent?key=' + apiKey;
    for (var attempt = 1; attempt <= 2; attempt++) {
      resp = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      const code = resp.getResponseCode();
      if (code === 200) break;

      lastError = resp.getContentText();
      const retryable = code === 503 || code === 429 || code === 500;
      if (!retryable || attempt === 2) break;
      Utilities.sleep(500);
    }
    if (resp.getResponseCode() === 200) break;
  }

  if (resp.getResponseCode() !== 200) {
    if (resp.getResponseCode() === 503) {
      throw new Error('AI is busy right now. Please wait a few seconds and try again.');
    }
    if (resp.getResponseCode() === 429) {
      throw new Error('AI rate limit reached. Wait 30 seconds and try again. AI 請求太密，請稍等再試。');
    }
    throw new Error('Gemini API error: ' + lastError);
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
    location: grab('location'),
    roomCategory: grab('roomCategory') || grab('room_category'),
    itemDescription: grab('itemDescription') || grab('item_description') || grab('description'),
    quantity: grabNum('quantity') || 1,
    size: grab('size'),
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

  var transport = String(pick('transportMode', 'transport_mode', '運送方式', 'mode')).toLowerCase();
  if (transport.indexOf('hand') !== -1 || transport.indexOf('手提') !== -1) transport = 'handcarry';
  else transport = 'shipped';

  var desc = String(pick('itemDescription', 'item_description', 'description', '物品描述', 'desc', 'item', 'name', 'title', 'product', 'object'));

  return {
    transportMode: transport,
    location: String(pick('location', 'boxNumber', 'box_number', '存放位置', '箱號')),
    roomCategory: String(pick('roomCategory', 'room_category', '房間分類', 'room')),
    itemDescription: desc,
    quantity: pick('quantity', 'qty', '數量') || 1,
    size: String(pick('size', '尺寸')),
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
  const photoLink = savePhoto_(body.image, body.location, timestamp);
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
  logActivity_(email, 'added', desc, (body.location || '') + ' · ' + status);
  return { success: true, photoLink: photoLink, timestamp: timestamp };
}

function savePhoto_(base64Image, location, timestamp) {
  const blob = Utilities.newBlob(
    Utilities.base64Decode(base64Image),
    'image/jpeg',
    sanitizeFilename_(location) + '_' + Date.now() + '.jpg'
  );
  const file = DriveApp.getFolderById(DRIVE_FOLDER_ID).createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
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
      logActivity_(email, 'deleted', desc, String(data[i][2] || ''));
      return { success: true };
    }
  }
  throw new Error('Item not found');
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
