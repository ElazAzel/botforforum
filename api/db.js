const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'db.json');

function loadFromFile() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed.users && parsed.sessions && parsed.user_notes && parsed.user_notebooks) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('db.json load failed, using fresh store:', err.message);
  }
  return { users: {}, sessions: {}, user_notes: {}, user_notebooks: {} };
}

function saveToFile() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.warn('db.json save failed (read-only fs?):', err.message);
  }
}

let store = loadFromFile();

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
      created_at: new Date().toISOString()
    };
    saveToFile();
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

// --- УТИЛИТЫ ---
async function getAllUsers() {
  return Object.values(store.users);
}

module.exports = {
  getUser,
  saveUser,
  updateUserPendingSession,
  updateAllUsersPendingSession,
  getActiveSession,
  getSession,
  saveSession,
  addInsight,
  getInsightsBySession,
  getUserNotebook,
  updateUserNotebook,
  getAllUsers
};
