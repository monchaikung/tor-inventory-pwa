// ============ CONFIGURATION ============
const SHEET_ID = '1Uqr9wK9SonaXbsBlTzw5CWYWPGozGlZAksdh6ekGvDk';
const DRIVE_FOLDER_ID = '1zDSkyqyLU-DjHbZ3gkSdY8tAi8qbrcFn';

// Script Properties (Project Settings -> Script Properties):
//   GEMINI_API_KEY = your Gemini API key
//   ALLOWED_EMAILS = monchai.kung@gmail.com,kristintsang@gmail.com

function doGet() {
  return jsonResponse({ status: 'ok', message: 'ToR Inventory API is running', model: 'gemini-3.6-flash', version: 'v4' });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const user = verifyAccess_(body.idToken);
    if (!user) return jsonResponse({ success: false, error: 'Access denied' });

    switch (body.action) {
      case 'analyze': return jsonResponse(analyzeImage_(body.image));
      case 'save': return jsonResponse(saveItem_(body));
      case 'search': return jsonResponse(searchItems_(body.query || ''));
      case 'update': return jsonResponse(updateStatus_(body.timestamp, body.status));
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
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + idToken,
    { muteHttpExceptions: true }
  );
  if (resp.getResponseCode() !== 200) return null;
  const payload = JSON.parse(resp.getContentText());
  const email = payload.email;
  const allowed = (PropertiesService.getScriptProperties().getProperty('ALLOWED_EMAILS') || '')
    .split(',').map(function(e) { return e.trim().toLowerCase(); });
  if (allowed.indexOf(email.toLowerCase()) === -1) return null;
  return { email: email };
}

function analyzeImage_(base64Image) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in Script Properties');

  const prompt = 'Analyze this photo for UK Transfer of Residence inventory. Return ONLY valid JSON (no markdown): {"transportMode":"shipped or handcarry","location":"box number or one of: 隨身背囊, 上機行李箱 (20吋), 上機大行李箱","roomCategory":"客廳|睡房|廚房|浴室|書房|其他","itemDescription":"ToR1 English description e.g. Used clothing","quantity":1,"size":"","weight":"","estimatedValue":0}. Small personal items->handcarry+隨身背囊. Large items->shipped.';

  const payload = {
    contents: [{ parts: [
      { text: prompt },
      { inline_data: { mime_type: 'image/jpeg', data: base64Image } }
    ]}],
    generationConfig: { temperature: 0.2, maxOutputTokens: 512 }
  };

  const models = ['gemini-3.6-flash', 'gemini-3.5-flash-lite'];
  let resp = null;
  let lastError = '';

  for (let m = 0; m < models.length; m++) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + models[m] + ':generateContent?key=' + apiKey;
    for (let attempt = 1; attempt <= 3; attempt++) {
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
      if (!retryable || attempt === 3) break;
      Utilities.sleep(1000 * attempt);
    }
    if (resp.getResponseCode() === 200) break;
  }

  if (resp.getResponseCode() !== 200) {
    if (resp.getResponseCode() === 503) {
      throw new Error('AI is busy right now. Please wait a few seconds and try again.');
    }
    throw new Error('Gemini API error: ' + lastError);
  }

  const result = JSON.parse(resp.getContentText());
  const text = result.candidates[0].content.parts[0].text;
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return { success: true, suggestions: JSON.parse(cleaned) };
}

function saveItem_(body) {
  const timestamp = new Date().toISOString();
  const photoLink = savePhoto_(body.image, body.location, timestamp);
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  sheet.appendRow([
    timestamp,
    body.transportMode || '寄箱',
    body.location || '',
    body.roomCategory || '',
    body.itemDescription || '',
    body.quantity || '1',
    body.size || '',
    body.weight || '',
    body.estimatedValue || '',
    body.status || '待整理',
    photoLink
  ]);
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

function updateStatus_(timestamp, status) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  const data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(timestamp)) {
      sheet.getRange(i + 1, 10).setValue(status);
      return { success: true };
    }
  }
  throw new Error('Item not found');
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
