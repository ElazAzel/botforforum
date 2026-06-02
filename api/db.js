// Простое in-memory хранилище.
// Данные хранятся в оперативной памяти серверлесс-функции.
// На Vercel данные сохраняются пока функция "тёплая" (обычно 5-15 минут между запросами).
// Для конференции длительностью 1-2 дня с активным трафиком — этого достаточно.

const store = {
  users: {},
  sessions: {},
  user_notes: {},
  user_notebooks: {}
};

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
  }
  return store.users[key];
}

async function updateUserPendingSession(tgId, sessionId) {
  const key = String(tgId);
  if (store.users[key]) {
    store.users[key].pending_session_id = sessionId;
    return true;
  }
  return false;
}

async function updateAllUsersPendingSession(sessionId) {
  Object.keys(store.users).forEach(id => {
    store.users[id].pending_session_id = sessionId;
  });
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
  getSession,
  saveSession,
  addInsight,
  getInsightsBySession,
  getUserNotebook,
  updateUserNotebook,
  getAllUsers
};
