const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'db.json');
const BLOB_KEY = 'db.json';

let blobPut, blobGet;
if (process.env.BLOB_READ_WRITE_TOKEN) {
  const m = require('@vercel/blob');
  blobPut = m.put; blobGet = m.get;
}

function freshStore() {
  return { users: {}, sessions: {}, user_notes: {}, user_notebooks: {}, categorized_notes: {} };
}

const Empty = Symbol('pending');
let store = Empty;

function initSync() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const d = fs.readFileSync(DB_PATH, 'utf-8');
      const p = JSON.parse(d);
      if (p.users && p.sessions) { store = p; return; }
    }
  } catch (e) {}
  store = freshStore();
}
initSync();

if (blobGet) {
  blobGet(BLOB_KEY).then(b => {
    if (!b) return;
    return b.text().then(t => {
      const p = JSON.parse(t);
      if (p.users && p.sessions) store = p;
    });
  }).catch(() => {});
}

function saveToFile() {
  try {
    const d = JSON.stringify(store, null, 2);
    fs.writeFileSync(DB_PATH, d, 'utf-8');
    if (blobPut) blobPut(BLOB_KEY, d, { contentType: 'application/json', access: 'private' }).catch(() => {});
  } catch (err) {
    console.warn('db save failed:', err.message);
  }
}

// --- ПОЛЬЗОВАТЕЛИ ---
async function getUser(tgId) {
  return store.users[String(tgId)] || null;
}

async function saveUser(tgId, username) {
  const key = String(tgId);
  if (!store.users[key]) {
    store.users[key] = {
      tg_id: Number(tgId),
      username: username || 'Anonymous',
      pending_session_id: null,
      pending_note: null,
      created_at: new Date().toISOString()
    };
    saveToFile();
  } else {
    if (store.users[key].pending_note === undefined) {
      store.users[key].pending_note = null;
      saveToFile();
    }
  }
  return store.users[key];
}

async function updateUserPendingSession(tgId, sessionId) {
  const key = String(tgId);
  if (store.users[key]) {
    store.users[key].pending_session_id = sessionId;
    saveToFile();
    return true;
  }
  return false;
}

async function updateUserPendingNote(tgId, noteData) {
  const key = String(tgId);
  if (!store.users[key]) return false;
  store.users[key].pending_note = noteData;
  saveToFile();
  return true;
}

async function updateAllUsersPendingSession(sessionId) {
  Object.keys(store.users).forEach(id => {
    store.users[id].pending_session_id = sessionId;
  });
  saveToFile();
}

async function getActiveSession() {
  const sessions = Object.values(store.sessions);
  return sessions.find(s => s.is_active) || null;
}

// --- СЕССИИ ---
async function getSession(sessionId) {
  return store.sessions[sessionId] || null;
}

async function saveSession(sessionId, title, isActive = false) {
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

  saveToFile();
  return session;
}

// --- ИНСАЙТЫ ---
async function addInsight(tgId, sessionId, rawInsight) {
  const newNote = {
    id: Math.random().toString(36).substring(2, 11),
    tg_id: Number(tgId),
    session_id: sessionId,
    raw_insight: rawInsight,
    timestamp: new Date().toISOString()
  };
  if (!store.user_notes[sessionId]) store.user_notes[sessionId] = [];
  store.user_notes[sessionId].push(newNote);
  saveToFile();
  return newNote;
}

async function getInsightsBySession(sessionId) {
  return store.user_notes[sessionId] || [];
}

// --- БЛОКНОТЫ ---
async function getUserNotebook(tgId) {
  return store.user_notebooks[String(tgId)] || '';
}

async function updateUserNotebook(tgId, text) {
  store.user_notebooks[String(tgId)] = text;
  saveToFile();
}

// --- КАТЕГОРИЗИРОВАННЫЕ ЗАМЕТКИ (по спикерам / общее) ---
async function addSpeakerNote(tgId, speakerName, text) {
  const key = String(tgId);
  if (!store.categorized_notes[key]) store.categorized_notes[key] = { speakers: {}, general: [] };
  if (!store.categorized_notes[key].speakers[speakerName]) store.categorized_notes[key].speakers[speakerName] = [];
  store.categorized_notes[key].speakers[speakerName].push({
    text, timestamp: new Date().toISOString()
  });
  saveToFile();
  return true;
}

async function addGeneralNote(tgId, text) {
  const key = String(tgId);
  if (!store.categorized_notes[key]) store.categorized_notes[key] = { speakers: {}, general: [] };
  store.categorized_notes[key].general.push({
    text, timestamp: new Date().toISOString()
  });
  saveToFile();
  return true;
}

async function getCategorizedNotes(tgId) {
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

// --- АДМИНИСТРИРОВАНИЕ ---
async function getAllSessions() {
  return Object.values(store.sessions);
}

async function deleteSession(sessionId) {
  const existed = !!store.sessions[sessionId];
  delete store.sessions[sessionId];
  delete store.user_notes[sessionId];
  Object.keys(store.users).forEach(id => {
    if (store.users[id].pending_session_id === sessionId) {
      store.users[id].pending_session_id = null;
    }
  });
  saveToFile();
  return existed;
}

async function getAllInsightsRaw() {
  const all = [];
  Object.keys(store.user_notes).forEach(sessionId => {
    store.user_notes[sessionId].forEach(note => {
      all.push(note);
    });
  });
  return all;
}

async function getUserById(tgId) {
  return store.users[String(tgId)] || null;
}

// --- УТИЛИТЫ ---
async function getAllUsers() {
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
  getAllUsers
};
