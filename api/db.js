const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'db.json');
const BLOB_KEY = 'db.json';

let blobModule = null;
if (process.env.BLOB_READ_WRITE_TOKEN) {
  blobModule = require('@vercel/blob');
}

function freshStore() {
  return { users: {}, sessions: {}, user_notes: {}, user_notebooks: {}, categorized_notes: {}, buttons: [], version: 0 };
}

let store = freshStore();
let loadedVersion = 0;

// On Vercel (serverless), we must reload from Blob on EVERY invocation
// because the in-memory store may be stale or from a cold start.
// We track whether the store has been loaded for THIS invocation.
let loadedForThisInvocation = false;

// Helper to merge local modifications with remote modifications to prevent data loss
function mergeStores(local, remote) {
  const merged = freshStore();
  
  // Merge users
  Object.assign(merged.users, remote.users, local.users);
  
  // Merge sessions
  Object.assign(merged.sessions, remote.sessions, local.sessions);
  
  // Merge user_notebooks (deduplicate paragraphs/insights)
  const allNotebookUserIds = new Set([...Object.keys(remote.user_notebooks || {}), ...Object.keys(local.user_notebooks || {})]);
  allNotebookUserIds.forEach(uid => {
    const remoteNb = remote.user_notebooks[uid] || '';
    const localNb = local.user_notebooks[uid] || '';
    
    if (remoteNb && localNb && remoteNb !== localNb) {
      const remoteInsights = remoteNb.split('\n\n').map(s => s.trim()).filter(Boolean);
      const localInsights = localNb.split('\n\n').map(s => s.trim()).filter(Boolean);
      
      const combined = [...remoteInsights];
      localInsights.forEach(li => {
        if (!combined.includes(li)) {
          combined.push(li);
        }
      });
      merged.user_notebooks[uid] = combined.join('\n\n');
    } else {
      merged.user_notebooks[uid] = localNb || remoteNb || '';
    }
  });
  
  // Merge user_notes (session insights arrays)
  const allSessionIds = new Set([...Object.keys(remote.user_notes || {}), ...Object.keys(local.user_notes || {})]);
  allSessionIds.forEach(sid => {
    const remoteNotes = remote.user_notes[sid] || [];
    const localNotes = local.user_notes[sid] || [];
    
    const combined = [];
    const seenIds = new Set();
    [...remoteNotes, ...localNotes].forEach(note => {
      if (note && note.id) {
        if (!seenIds.has(note.id)) {
          seenIds.add(note.id);
          combined.push(note);
        }
      }
    });
    merged.user_notes[sid] = combined;
  });
  
  // Merge categorized_notes
  const allUserIds = new Set([...Object.keys(remote.categorized_notes || {}), ...Object.keys(local.categorized_notes || {})]);
  allUserIds.forEach(uid => {
    const remoteCat = remote.categorized_notes[uid] || { speakers: {}, general: [] };
    const localCat = local.categorized_notes[uid] || { speakers: {}, general: [] };
    
    const speakers = {};
    const allSpeakers = new Set([...Object.keys(remoteCat.speakers || {}), ...Object.keys(localCat.speakers || {})]);
    allSpeakers.forEach(spk => {
      const remoteSpkNotes = remoteCat.speakers[spk] || [];
      const localSpkNotes = localCat.speakers[spk] || [];
      const combined = [...remoteSpkNotes];
      localSpkNotes.forEach(ln => {
        if (!combined.some(rn => rn.text === ln.text && rn.timestamp === ln.timestamp)) {
          combined.push(ln);
        }
      });
      speakers[spk] = combined;
    });
    
    const general = [...(remoteCat.general || [])];
    (localCat.general || []).forEach(ln => {
      if (!general.some(rn => rn.text === ln.text && rn.timestamp === ln.timestamp)) {
        general.push(ln);
      }
    });
    
    merged.categorized_notes[uid] = { speakers, general };
  });
  
  // Merge buttons
  const buttonsMap = {};
  (remote.buttons || []).forEach(b => { buttonsMap[b.id] = b; });
  (local.buttons || []).forEach(b => { buttonsMap[b.id] = b; });
  merged.buttons = Object.values(buttonsMap);
  
  // Remote version incremented by 1
  merged.version = (remote.version || 0) + 1;
  
  return merged;
}

async function loadFromBlob() {
  if (!blobModule) return false;
  try {
    const { blobs } = await blobModule.list({ prefix: BLOB_KEY, limit: 1 });
    if (!blobs || blobs.length === 0) {
      console.log('No blob found with key:', BLOB_KEY);
      return false;
    }
    const blobUrl = blobs[0].url;
    const response = await fetch(blobUrl);
    if (!response.ok) {
      console.warn('Failed to fetch blob:', response.status);
      return false;
    }
    const text = await response.text();
    const parsed = JSON.parse(text);
    if (parsed.users && parsed.sessions) {
      store = freshStore();
      Object.keys(parsed).forEach(k => {
        if (store[k] !== undefined && typeof parsed[k] === 'object' && !Array.isArray(parsed[k])) {
          Object.assign(store[k], parsed[k]);
        } else if (parsed[k] !== undefined) {
          store[k] = parsed[k];
        }
      });
      loadedVersion = store.version || 0;
    }
    return true;
  } catch (err) {
    console.warn('loadFromBlob failed:', err.message);
    return false;
  }
}

// For local dev: sync file read/write
function loadFromFile() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const d = fs.readFileSync(DB_PATH, 'utf-8');
      const p = JSON.parse(d);
      if (p.users && p.sessions) {
        store = freshStore();
        Object.keys(p).forEach(k => {
          if (store[k] !== undefined && typeof p[k] === 'object' && !Array.isArray(p[k])) {
            Object.assign(store[k], p[k]);
          } else if (p[k] !== undefined) {
            store[k] = p[k];
          }
        });
        loadedVersion = store.version || 0;
      }
    }
  } catch (e) {
    console.warn('loadFromFile failed:', e.message);
  }
}

function saveToFile() {
  try {
    const d = JSON.stringify(store, null, 2);
    fs.writeFileSync(DB_PATH, d, 'utf-8');
  } catch (err) {
    console.warn('file save failed:', err.message);
  }
}

// Unified save with version checks and write retry loops
async function save() {
  if (blobModule) {
    let retries = 3;
    while (retries > 0) {
      try {
        const { blobs } = await blobModule.list({ prefix: BLOB_KEY, limit: 1 });
        if (blobs && blobs.length > 0) {
          const blobUrl = blobs[0].url;
          const response = await fetch(blobUrl);
          if (response.ok) {
            const text = await response.text();
            const remoteStore = JSON.parse(text);
            const remoteVersion = remoteStore.version || 0;
            
            if (remoteVersion !== loadedVersion) {
              console.log(`Version conflict! Loaded: ${loadedVersion}, Remote: ${remoteVersion}. Merging...`);
              store = mergeStores(store, remoteStore);
            } else {
              store.version = loadedVersion + 1;
            }
          }
        } else {
          store.version = 1;
        }
        
        // Write updated state to Blob
        const data = JSON.stringify(store, null, 2);
        await blobModule.put(BLOB_KEY, data, {
          contentType: 'application/json',
          access: 'public',
          addRandomSuffix: false
        });
        
        loadedVersion = store.version;
        break; // Success!
      } catch (err) {
        retries--;
        console.warn(`Vercel Blob save attempt failed (retries left: ${retries}):`, err.message);
        if (retries === 0) {
          saveToFile();
        } else {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
  }
  
  saveToFile();
}

// Ensure data is loaded before any operation.
// On Vercel: always reload from Blob to get fresh data (serverless = stateless).
// Locally: load from file once.
async function ensureLoaded() {
  if (blobModule) {
    // Always reload from blob on each invocation to avoid stale data
    if (!loadedForThisInvocation) {
      await loadFromBlob();
      loadedForThisInvocation = true;
      // Reset after 5 seconds so next request within same warm instance reloads
      setTimeout(() => { loadedForThisInvocation = false; }, 5000);
    }
  } else {
    // Local dev: load from file once
    if (!loadedForThisInvocation) {
      loadFromFile();
      loadedForThisInvocation = true;
    }
  }
}

// --- ПОЛЬЗОВАТЕЛИ ---
async function getUser(tgId) {
  await ensureLoaded();
  return store.users[String(tgId)] || null;
}

async function saveUser(tgId, username) {
  await ensureLoaded();
  const key = String(tgId);
  if (!store.users[key]) {
    store.users[key] = {
      tg_id: Number(tgId),
      username: username || 'Anonymous',
      pending_session_id: null,
      pending_note: null,
      created_at: new Date().toISOString()
    };
    await save();
  } else {
    if (store.users[key].pending_note === undefined) {
      store.users[key].pending_note = null;
      await save();
    }
  }
  return store.users[key];
}

async function updateUserPendingSession(tgId, sessionId) {
  await ensureLoaded();
  const key = String(tgId);
  if (store.users[key]) {
    store.users[key].pending_session_id = sessionId;
    await save();
    return true;
  }
  return false;
}

async function updateUserPendingNote(tgId, noteData) {
  await ensureLoaded();
  const key = String(tgId);
  if (!store.users[key]) return false;
  store.users[key].pending_note = noteData;
  await save();
  return true;
}

async function updateAllUsersPendingSession(sessionId) {
  await ensureLoaded();
  Object.keys(store.users).forEach(id => {
    store.users[id].pending_session_id = sessionId;
  });
  await save();
}

async function getActiveSession() {
  await ensureLoaded();
  const sessions = Object.values(store.sessions);
  return sessions.find(s => s.is_active) || null;
}

// --- СЕССИИ ---
async function getSession(sessionId) {
  await ensureLoaded();
  return store.sessions[sessionId] || null;
}

async function saveSession(sessionId, title, isActive = false) {
  await ensureLoaded();
  let session = store.sessions[sessionId];
  if (session) {
    session.title = title;
    session.is_active = isActive;
  } else {
    session = {
      session_id: sessionId,
      title: title,
      is_active: isActive,
      created_at: new Date().toISOString()
    };
    store.sessions[sessionId] = session;
  }

  if (isActive) {
    Object.keys(store.sessions).forEach(id => {
      if (id !== sessionId) store.sessions[id].is_active = false;
    });
  }

  await save();
  return session;
}

// --- ИНСАЙТЫ ---
async function addInsight(tgId, sessionId, rawInsight) {
  await ensureLoaded();
  const newNote = {
    id: Math.random().toString(36).substring(2, 11),
    tg_id: Number(tgId),
    session_id: sessionId,
    raw_insight: rawInsight,
    timestamp: new Date().toISOString()
  };
  if (!store.user_notes[sessionId]) store.user_notes[sessionId] = [];
  store.user_notes[sessionId].push(newNote);
  await save();
  return newNote;
}

async function getInsightsBySession(sessionId) {
  await ensureLoaded();
  return store.user_notes[sessionId] || [];
}

// --- БЛОКНОТЫ ---
async function getUserNotebook(tgId) {
  await ensureLoaded();
  return store.user_notebooks[String(tgId)] || '';
}

async function updateUserNotebook(tgId, text) {
  await ensureLoaded();
  store.user_notebooks[String(tgId)] = text;
  await save();
}

// --- КАТЕГОРИЗИРОВАННЫЕ ЗАМЕТКИ ---
async function addSpeakerNote(tgId, speakerName, text) {
  await ensureLoaded();
  const key = String(tgId);
  if (!store.categorized_notes[key]) store.categorized_notes[key] = { speakers: {}, general: [] };
  if (!store.categorized_notes[key].speakers[speakerName]) store.categorized_notes[key].speakers[speakerName] = [];
  store.categorized_notes[key].speakers[speakerName].push({
    text, timestamp: new Date().toISOString()
  });
  await save();
  return true;
}

async function addGeneralNote(tgId, text) {
  await ensureLoaded();
  const key = String(tgId);
  if (!store.categorized_notes[key]) store.categorized_notes[key] = { speakers: {}, general: [] };
  store.categorized_notes[key].general.push({
    text, timestamp: new Date().toISOString()
  });
  await save();
  return true;
}

async function getCategorizedNotes(tgId) {
  await ensureLoaded();
  const key = String(tgId);
  return store.categorized_notes[key] || { speakers: {}, general: [] };
}

async function getSpeakerList(tgId) {
  const notes = await getCategorizedNotes(tgId);
  return Object.keys(notes.speakers);
}

async function getSpeakerNotes(tgId, speakerName) {
  const notes = await getCategorizedNotes(tgId);
  return notes.speakers[speakerName] || [];
}

async function getGeneralNotes(tgId) {
  const notes = await getCategorizedNotes(tgId);
  return notes.general || [];
}

function getDefaultButtons() {
  return [
    { id: 'btn_program', text: '📅 Программа', type: 'submenu', parentId: 'main', row: 0 },
    { id: 'btn_speakers', text: '🎤 Спикеры', type: 'text', content: `🎤 *Ключевые спикеры MBA AlmaU Impact Forum:*\n\n• *Павел Лукша* — международный эксперт по образовательным и технологическим трендам, соавтор исследований будущего.\n• *Тарик Курейши* — CEO Future Readiness Forum и Xponential Group, экс-советник Bloomberg Media.\n• *Ильдар Валиуллов* — эксперт в сфере развития людей и сопровождения лидеров, MBA AlmaU Alumni.\n• *Мухит Елеуов* — Выпускник Harvard Kennedy School, партнер ADL Disputes.\n• *Мират Ахметсадыков* — со-основатель венчурного фонда MOST, MBA AlmaU Alumni.\n• *Татьяна Иссык* — профессиональный юрист, эксперт по трудовому праву.\n• *Зафар Хашимов* — основатель сети супермаркетов «Корзинка» (Узбекистан).\n• *Кайрат Боранбаев* — учредитель Холдинга «АЛМАЛЫ», Президент ФК «Кайрат».\n• *Виктория Торгунакова* — CEO Freedom Events.\n• *Нурасыл Джарбасов* — председатель совета директоров DEM Group, основатель Astana Venture Club.`, parentId: 'main', row: 0 },
    { id: 'btn_nb', text: '📓 Мой блокнот', type: 'system', content: 'nb', parentId: 'main', row: 1 },
    { id: 'btn_program_d1', text: '📅 День 1 (4 июня)', type: 'text', content: `📅 *MBA AlmaU Impact Forum — ДЕНЬ 1 (4 июня)*\n\n• *09:00 – 10:00* | *Регистрация*\n• *10:00 – 10:30* | *Открытие форума*\n  🗣 Асылбек Кожахметов (Президент AlmaU), Тимур Булдыбаев (Ректор AlmaU), Ксения Южанинова-Караденизли (Декан ВШБ AlmaU)\n• *10:45 – 11:45* | *Форсайт-лекция: «Следующие 20 лет: как подготовить бизнес к решающему переходу человечества»*\n  🗣 *Павел Лукша* (международный эксперт по трендам)\n• *11:45 – 12:15* | *Rave Network & Coffee Break*\n• *12:15 – 13:30* | *Панельная дискуссия: «Условия тотальной неопределённости: как не просто выжить, а вырасти?»*\n  🗣 *Н. Джарбасов, К. Боранбаев, В. Торгунакова, З. Хашимов*. Модератор: *Дана Токмурзина*\n• *13:30 – 14:00* | *Lunch Break*\n• *14:00 – 15:15* | *Keynote-сессия: «Leading from the future»*\n  🗣 *Тарик Курейши* (CEO Future Readiness Forum & Xponential Group)\n• *15:15 – 15:30* | *Break*\n• *15:30 – 17:00* | *Воркшоп: «From Inner Stability to Outer Impact: как состояние лидера формирует масштаб его влияния»*\n  🗣 *Ильдар Валиуллов* (MBA AlmaU Alumni)`, parentId: 'btn_program', row: 0 },
    { id: 'btn_program_d2', text: '📅 День 2 (5 июня)', type: 'text', content: `📅 *MBA AlmaU Impact Forum — ДЕНЬ 2 (5 июня)*\n\n• *09:00 – 10:00* | *Регистрация*\n• *10:00 – 11:00* | *Воркшоп: «Искусство договорённости: Переговоры сквозь призму поведенческих наук»*\n  🗣 *Мухит Елеуов* (Выпускник Harvard Kennedy School, ADL Disputes)\n• *11:00 – 11:30* | *Coffee Break & Network*\n• *11:30 – 13:00* | *Параллельные сессии:*\n  1️⃣ *Showcase-дискуссия: «Герои Impact Driven Education»*\n     🗣 *К. Исмагулов, Б. Сыздыкова, Б. Култаев, А. Ержанова, М. Ахметсадыков*. Модератор: *Данияр Медетов*\n  2️⃣ *Speed Dating: «Менторинг для управленцев»* (по предварительной регистрации)\n     🗣 *Озат Байсеркеев, Ирина Уражанова, Мадина Билялова, Ильдар Тапалов*\n• *13:00 – 13:30* | *Lunch & Network*\n• *13:30 – 14:30* | *Параллельные сессии:*\n  1️⃣ *Воркшоп: «Центральная Азия: окно возможностей для нового поколения»*\n     🗣 *Мират Ахметсадыков* (MOST)\n  2️⃣ *Воркшоп: «Неправильный трудовой договор»*\n     🗣 *Татьяна Иссык*\n• *14:30 – 14:45* | *Break*\n• *14:45 – 15:45* | *Vision Talk: «Beyond Growth: как создавать ценность в мире, где меняются правила игры»*\n  🗣 *Ильдар Валиуллов* (MBA AlmaU Alumni)`, parentId: 'btn_program', row: 0 }
  ];
}

async function getButtons() {
  await ensureLoaded();
  if (!store.buttons || store.buttons.length === 0) {
    store.buttons = getDefaultButtons();
    await save();
  }
  return store.buttons;
}

async function saveButton(button) {
  await ensureLoaded();
  if (!store.buttons) store.buttons = getDefaultButtons();
  
  const existingIndex = store.buttons.findIndex(b => b.id === button.id);
  if (existingIndex > -1) {
    store.buttons[existingIndex] = { ...store.buttons[existingIndex], ...button };
  } else {
    store.buttons.push(button);
  }
  await save();
  return true;
}

async function deleteButton(buttonId) {
  await ensureLoaded();
  if (!store.buttons) store.buttons = getDefaultButtons();
  
  const initialLength = store.buttons.length;
  store.buttons = store.buttons.filter(b => b.id !== buttonId);
  
  store.buttons.forEach(b => {
    if (b.parentId === buttonId) {
      b.parentId = 'main';
    }
  });
  
  await save();
  return store.buttons.length < initialLength;
}

// --- АДМИНИСТРИРОВАНИЕ ---
async function getAllSessions() {
  await ensureLoaded();
  return Object.values(store.sessions);
}

async function deleteSession(sessionId) {
  await ensureLoaded();
  const existed = !!store.sessions[sessionId];
  delete store.sessions[sessionId];
  delete store.user_notes[sessionId];
  Object.keys(store.users).forEach(id => {
    if (store.users[id].pending_session_id === sessionId) {
      store.users[id].pending_session_id = null;
    }
  });
  await save();
  return existed;
}

async function getAllInsightsRaw() {
  await ensureLoaded();
  const all = [];
  Object.keys(store.user_notes).forEach(sessionId => {
    store.user_notes[sessionId].forEach(note => {
      all.push(note);
    });
  });
  return all;
}

async function getUserById(tgId) {
  await ensureLoaded();
  return store.users[String(tgId)] || null;
}

async function getAllUsers() {
  await ensureLoaded();
  return Object.values(store.users);
}

module.exports = {
  getUser,
  saveUser,
  updateUserPendingSession,
  updateUserPendingNote,
  updateAllUsersPendingSession,
  getActiveSession,
  getSession,
  saveSession,
  addInsight,
  getInsightsBySession,
  getUserNotebook,
  updateUserNotebook,
  addSpeakerNote,
  addGeneralNote,
  getCategorizedNotes,
  getSpeakerList,
  getSpeakerNotes,
  getGeneralNotes,
  getAllSessions,
  getAllInsightsRaw,
  getUserById,
  deleteSession,
  getAllUsers,
  getButtons,
  saveButton,
  deleteButton,
  mergeStores
};
