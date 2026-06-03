const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'db.json');
const BLOB_KEY = 'db.json';

let blobModule = null;
if (process.env.BLOB_READ_WRITE_TOKEN) {
  blobModule = require('@vercel/blob');
}

function freshStore() {
  return { users: {}, sessions: {}, user_notes: {}, user_notebooks: {}, categorized_notes: {}, buttons: [] };
}

let store = freshStore();

// On Vercel (serverless), we must reload from Blob on EVERY invocation
// because the in-memory store may be stale or from a cold start.
// We track whether the store has been loaded for THIS invocation.
let loadedForThisInvocation = false;

async function loadFromBlob() {
  if (!blobModule) return false;
  try {
    // Use list() to find the blob by prefix, then fetch its content
    const { blobs } = await blobModule.list({ prefix: BLOB_KEY, limit: 1 });
    if (!blobs || blobs.length === 0) {
      console.log('No blob found with key:', BLOB_KEY);
      return false;
    }
    const blobUrl = blobs[0].url;
    // Fetch the blob content using its URL
    const response = await fetch(blobUrl);
    if (!response.ok) {
      console.warn('Failed to fetch blob:', response.status);
      return false;
    }
    const text = await response.text();
    const parsed = JSON.parse(text);
    if (parsed.users && parsed.sessions) {
      // Reset store to fresh then merge, ensuring all keys exist
      store = freshStore();
      Object.keys(parsed).forEach(k => {
        if (store[k] !== undefined && typeof parsed[k] === 'object' && !Array.isArray(parsed[k])) {
          Object.assign(store[k], parsed[k]);
        } else if (parsed[k] !== undefined) {
          store[k] = parsed[k];
        }
      });
    }
    return true;
  } catch (err) {
    console.warn('loadFromBlob failed:', err.message);
    return false;
  }
}

async function saveToBlob() {
  if (!blobModule) return;
  try {
    const data = JSON.stringify(store, null, 2);
    await blobModule.put(BLOB_KEY, data, {
      contentType: 'application/json',
      access: 'public',
      addRandomSuffix: false
    });
  } catch (err) {
    console.warn('saveToBlob failed:', err.message);
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

// Unified save: saves to both file and blob
async function save() {
  saveToFile();
  await saveToBlob();
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
  deleteButton
};
