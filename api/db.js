const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Флаг использования облачного KV (автоматически прописывается Vercel при подключении базы данных одной кнопкой)
const isProductionKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'db.json');

// --- ЛОКАЛЬНАЯ JSON БД (ДЛЯ РАЗРАБОТКИ) ---
function readLocalDb() {
  if (!fs.existsSync(dbPath)) {
    const initial = { users: {}, sessions: {}, user_notes: {}, user_notebooks: {} };
    fs.writeFileSync(dbPath, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch (err) {
    console.error('Ошибка чтения db.json, сброс структуры:', err.message);
    return { users: {}, sessions: {}, user_notes: {}, user_notebooks: {} };
  }
}

function writeLocalDb(data) {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Ошибка записи db.json:', err.message);
  }
}

// --- ОБЛАЧНЫЙ KV REDIS (ДЛЯ ДЕПЛОЯ НА VERCEL) ---
async function redisCall(cmd, ...args) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  try {
    const res = await axios.post(url, [cmd, ...args], {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });
    return res.data.result;
  } catch (err) {
    console.error(`Ошибка KV при вызове ${cmd}:`, err.message);
    return null;
  }
}

// --- УНИФИЦИРОВАННЫЙ ИНТЕРФЕЙС БАЗЫ ДАННЫХ ---

// 1. Участники (Users)
async function getUser(tgId) {
  if (isProductionKV) {
    const data = await redisCall('GET', `user:${tgId}`);
    return data ? JSON.parse(data) : null;
  } else {
    const db = readLocalDb();
    return db.users[String(tgId)] || null;
  }
}

async function saveUser(tgId, username) {
  if (isProductionKV) {
    let user = await getUser(tgId);
    if (!user) {
      user = {
        tg_id: Number(tgId),
        username: username || 'Anonymous',
        pending_session_id: null,
        created_at: new Date().toISOString()
      };
      await redisCall('SET', `user:${tgId}`, JSON.stringify(user));
      await redisCall('SADD', 'users_list', String(tgId));
    }
    return user;
  } else {
    const db = readLocalDb();
    if (!db.users) db.users = {};
    let user = db.users[String(tgId)];
    if (!user) {
      user = {
        tg_id: Number(tgId),
        username: username || 'Anonymous',
        pending_session_id: null,
        created_at: new Date().toISOString()
      };
      db.users[String(tgId)] = user;
      writeLocalDb(db);
    }
    return user;
  }
}

async function updateUserPendingSession(tgId, sessionId) {
  if (isProductionKV) {
    const user = await getUser(tgId);
    if (user) {
      user.pending_session_id = sessionId;
      await redisCall('SET', `user:${tgId}`, JSON.stringify(user));
      return true;
    }
    return false;
  } else {
    const db = readLocalDb();
    if (db.users && db.users[String(tgId)]) {
      db.users[String(tgId)].pending_session_id = sessionId;
      writeLocalDb(db);
      return true;
    }
    return false;
  }
}

async function updateAllUsersPendingSession(sessionId) {
  if (isProductionKV) {
    const userIds = await redisCall('SMEMBERS', 'users_list');
    if (userIds && userIds.length > 0) {
      const pipeline = userIds.map(async (id) => {
        const user = await getUser(id);
        if (user) {
          user.pending_session_id = sessionId;
          await redisCall('SET', `user:${id}`, JSON.stringify(user));
        }
      });
      await Promise.allSettled(pipeline);
    }
  } else {
    const db = readLocalDb();
    Object.keys(db.users || {}).forEach(id => {
      db.users[id].pending_session_id = sessionId;
    });
    writeLocalDb(db);
  }
}

// 2. Сессии (Sessions)
async function getSession(sessionId) {
  if (isProductionKV) {
    const data = await redisCall('GET', `session:${sessionId}`);
    return data ? JSON.parse(data) : null;
  } else {
    const db = readLocalDb();
    return db.sessions[sessionId] || null;
  }
}

async function saveSession(sessionId, title, isActive = false) {
  if (isProductionKV) {
    let session = await getSession(sessionId);
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
    }
    await redisCall('SET', `session:${sessionId}`, JSON.stringify(session));
    await redisCall('SADD', 'sessions_list', sessionId);

    if (isActive) {
      const sessionIds = await redisCall('SMEMBERS', 'sessions_list');
      if (sessionIds) {
        for (const id of sessionIds) {
          if (id !== sessionId) {
            const other = await getSession(id);
            if (other && other.is_active) {
              other.is_active = false;
              await redisCall('SET', `session:${id}`, JSON.stringify(other));
            }
          }
        }
      }
    }
    return session;
  } else {
    const db = readLocalDb();
    if (!db.sessions) db.sessions = {};
    let session = db.sessions[sessionId];
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
      db.sessions[sessionId] = session;
    }

    if (isActive) {
      Object.keys(db.sessions).forEach(id => {
        if (id !== sessionId) {
          db.sessions[id].is_active = false;
        }
      });
    }

    writeLocalDb(db);
    return session;
  }
}

// 3. Инсайты (Notes)
async function addInsight(tgId, sessionId, rawInsight) {
  const newNote = {
    id: Math.random().toString(36).substring(2, 11),
    tg_id: Number(tgId),
    session_id: sessionId,
    raw_insight: rawInsight,
    timestamp: new Date().toISOString()
  };

  if (isProductionKV) {
    await redisCall('RPUSH', `notes:${sessionId}`, JSON.stringify(newNote));
    return newNote;
  } else {
    const db = readLocalDb();
    if (!db.user_notes) db.user_notes = {};
    if (!db.user_notes[sessionId]) db.user_notes[sessionId] = [];
    db.user_notes[sessionId].push(newNote);
    writeLocalDb(db);
    return newNote;
  }
}

async function getInsightsBySession(sessionId) {
  if (isProductionKV) {
    const len = await redisCall('LLEN', `notes:${sessionId}`);
    if (!len || len === 0) return [];
    const rawList = await redisCall('LRANGE', `notes:${sessionId}`, '0', String(len - 1));
    return rawList ? rawList.map(item => JSON.parse(item)) : [];
  } else {
    const db = readLocalDb();
    if (!db.user_notes) db.user_notes = {};
    return db.user_notes[sessionId] || [];
  }
}

// 4. Личные блокноты (Notebooks)
async function getUserNotebook(tgId) {
  if (isProductionKV) {
    const data = await redisCall('GET', `notebook:${tgId}`);
    return data || '';
  } else {
    const db = readLocalDb();
    return db.user_notebooks[String(tgId)] || '';
  }
}

async function updateUserNotebook(tgId, text) {
  if (isProductionKV) {
    await redisCall('SET', `notebook:${tgId}`, text);
  } else {
    const db = readLocalDb();
    db.user_notebooks[String(tgId)] = text;
    writeLocalDb(db);
  }
}

// Получить всех участников форума (для экспорта)
async function getAllUsers() {
  if (isProductionKV) {
    const userIds = await redisCall('SMEMBERS', 'users_list');
    if (!userIds || userIds.length === 0) return [];
    const users = [];
    for (const id of userIds) {
      const u = await getUser(id);
      if (u) users.push(u);
    }
    return users;
  } else {
    const db = readLocalDb();
    return Object.values(db.users || {});
  }
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
  getAllUsers,
  isProductionKV
};
