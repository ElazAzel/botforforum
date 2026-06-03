/**
 * Automated test for ALL bot functions.
 * Tests db.js operations + webhook.js module loading + admin/analytics/push-poll.
 * No network calls — purely logic and data flow verification.
 */
require('dotenv').config();

// Override BLOB_READ_WRITE_TOKEN to force local file mode
delete process.env.BLOB_READ_WRITE_TOKEN;

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'db.json');
const DB_BACKUP = path.join(__dirname, 'db.backup.json');

// Backup existing db.json
if (fs.existsSync(DB_PATH)) {
  fs.copyFileSync(DB_PATH, DB_BACKUP);
}

// Reset db.json for clean test
fs.writeFileSync(DB_PATH, JSON.stringify({
  users: {}, sessions: {}, user_notes: {}, user_notebooks: {}, categorized_notes: {}
}, null, 2));

// Force re-require db module with clean state
delete require.cache[require.resolve('./api/db')];
const db = require('./api/db');

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${testName}`);
  } else {
    failed++;
    errors.push(testName);
    console.log(`  ❌ ${testName}`);
  }
}

async function runTests() {
  console.log('\n══════════════════════════════════════════');
  console.log('  🧪 ПОЛНЫЙ АВТОТЕСТ БОТА MBA ALMAU IMPACT FORUM');
  console.log('══════════════════════════════════════════\n');

  // ═══════════════════════════════════════
  // 1. MODULE LOADING
  // ═══════════════════════════════════════
  console.log('📦 1. Загрузка модулей');
  try {
    require('./api/db');
    assert(true, 'db.js загружен');
  } catch (e) {
    assert(false, 'db.js загружен: ' + e.message);
  }
  try {
    require('./api/webhook');
    assert(true, 'webhook.js загружен');
  } catch (e) {
    assert(false, 'webhook.js загружен: ' + e.message);
  }
  try {
    require('./api/admin');
    assert(true, 'admin.js загружен');
  } catch (e) {
    assert(false, 'admin.js загружен: ' + e.message);
  }
  try {
    require('./api/push-poll');
    assert(true, 'push-poll.js загружен');
  } catch (e) {
    assert(false, 'push-poll.js загружен: ' + e.message);
  }
  try {
    require('./api/analytics');
    assert(true, 'analytics.js загружен');
  } catch (e) {
    assert(false, 'analytics.js загружен: ' + e.message);
  }
  try {
    require('./api/setup');
    assert(true, 'setup.js загружен');
  } catch (e) {
    assert(false, 'setup.js загружен: ' + e.message);
  }

  // ═══════════════════════════════════════
  // 2. USER OPERATIONS
  // ═══════════════════════════════════════
  console.log('\n👤 2. Операции с пользователями');

  const user1 = await db.saveUser(111111, 'TestUser1');
  assert(user1 && user1.tg_id === 111111, 'saveUser — создание нового пользователя');
  assert(user1.username === 'TestUser1', 'saveUser — имя пользователя сохранено');
  assert(user1.pending_session_id === null, 'saveUser — pending_session_id = null');
  assert(user1.pending_note === null, 'saveUser — pending_note = null');

  const user1again = await db.saveUser(111111, 'DifferentName');
  assert(user1again.username === 'TestUser1', 'saveUser — не перезаписывает существующего');

  const user2 = await db.saveUser(222222, 'TestUser2');
  assert(user2 && user2.tg_id === 222222, 'saveUser — второй пользователь');

  const user3 = await db.saveUser(333333, null);
  assert(user3.username === 'Anonymous', 'saveUser — null username → Anonymous');

  const got = await db.getUser(111111);
  assert(got && got.tg_id === 111111, 'getUser — получение по ID');

  const missing = await db.getUser(999999);
  assert(missing === null, 'getUser — отсутствующий пользователь = null');

  const byId = await db.getUserById(222222);
  assert(byId && byId.username === 'TestUser2', 'getUserById — работает');

  const allUsers = await db.getAllUsers();
  assert(allUsers.length === 3, 'getAllUsers — 3 пользователя');

  // ═══════════════════════════════════════
  // 3. SESSION OPERATIONS
  // ═══════════════════════════════════════
  console.log('\n📋 3. Операции с сессиями');

  const s1 = await db.saveSession('ses_1', 'Форсайт-лекция Павла Лукши', true);
  assert(s1 && s1.session_id === 'ses_1', 'saveSession — создание сессии');
  assert(s1.is_active === true, 'saveSession — сессия активна');

  const s2 = await db.saveSession('ses_2', 'Keynote Тарик Курейши', true);
  assert(s2.is_active === true, 'saveSession — вторая сессия активна');

  const s1check = await db.getSession('ses_1');
  assert(s1check.is_active === false, 'saveSession — старая сессия деактивирована');

  const active = await db.getActiveSession();
  assert(active && active.session_id === 'ses_2', 'getActiveSession — возвращает ses_2');

  const allSessions = await db.getAllSessions();
  assert(allSessions.length === 2, 'getAllSessions — 2 сессии');

  const noSession = await db.getSession('nonexistent');
  assert(noSession === null, 'getSession — несуществующая = null');

  // ═══════════════════════════════════════
  // 4. PENDING SESSION / PENDING NOTE
  // ═══════════════════════════════════════
  console.log('\n🔄 4. Pending session & pending note');

  await db.updateUserPendingSession(111111, 'ses_1');
  const u1 = await db.getUser(111111);
  assert(u1.pending_session_id === 'ses_1', 'updateUserPendingSession — установка');

  await db.updateAllUsersPendingSession('ses_2');
  const u1b = await db.getUser(111111);
  const u2b = await db.getUser(222222);
  assert(u1b.pending_session_id === 'ses_2', 'updateAllUsersPendingSession — user1');
  assert(u2b.pending_session_id === 'ses_2', 'updateAllUsersPendingSession — user2');

  await db.updateUserPendingNote(111111, { type: 'speaker', name: 'Павел Лукша' });
  const u1c = await db.getUser(111111);
  assert(u1c.pending_note && u1c.pending_note.type === 'speaker', 'updateUserPendingNote — speaker');
  assert(u1c.pending_note.name === 'Павел Лукша', 'updateUserPendingNote — speaker name');

  await db.updateUserPendingNote(111111, { type: 'general' });
  const u1d = await db.getUser(111111);
  assert(u1d.pending_note.type === 'general', 'updateUserPendingNote — general');

  await db.updateUserPendingNote(111111, null);
  const u1e = await db.getUser(111111);
  assert(u1e.pending_note === null, 'updateUserPendingNote — clear');

  const resultMissing = await db.updateUserPendingNote(999999, { type: 'general' });
  assert(resultMissing === false, 'updateUserPendingNote — несуществующий user = false');

  // ═══════════════════════════════════════
  // 5. INSIGHTS
  // ═══════════════════════════════════════
  console.log('\n💡 5. Инсайты');

  const insight1 = await db.addInsight(111111, 'ses_1', 'Искусственный интеллект изменит образование');
  assert(insight1 && insight1.raw_insight === 'Искусственный интеллект изменит образование', 'addInsight — сохранение');
  assert(insight1.tg_id === 111111, 'addInsight — tg_id');
  assert(insight1.session_id === 'ses_1', 'addInsight — session_id');
  assert(insight1.id && insight1.id.length > 0, 'addInsight — генерация ID');

  const insight2 = await db.addInsight(222222, 'ses_1', 'Нужна адаптация к новым реалиям');
  const insight3 = await db.addInsight(111111, 'ses_2', 'Лидерство из будущего — ключевая мысль');

  const ses1insights = await db.getInsightsBySession('ses_1');
  assert(ses1insights.length === 2, 'getInsightsBySession — 2 инсайта в ses_1');

  const ses2insights = await db.getInsightsBySession('ses_2');
  assert(ses2insights.length === 1, 'getInsightsBySession — 1 инсайт в ses_2');

  const noInsights = await db.getInsightsBySession('nonexistent');
  assert(noInsights.length === 0, 'getInsightsBySession — пустой массив для несуществующей');

  const allRaw = await db.getAllInsightsRaw();
  assert(allRaw.length === 3, 'getAllInsightsRaw — всего 3 инсайта');

  // ═══════════════════════════════════════
  // 6. NOTEBOOK (user_notebooks)
  // ═══════════════════════════════════════
  console.log('\n📓 6. Блокноты (user_notebooks)');

  const emptyNb = await db.getUserNotebook(111111);
  assert(emptyNb === '', 'getUserNotebook — пустой по умолчанию');

  await db.updateUserNotebook(111111, '[Сессия: Тест]\n- Первый инсайт');
  const nb1 = await db.getUserNotebook(111111);
  assert(nb1 === '[Сессия: Тест]\n- Первый инсайт', 'updateUserNotebook — запись');

  await db.updateUserNotebook(111111, nb1 + '\n\n[Сессия: Тест2]\n- Второй инсайт');
  const nb2 = await db.getUserNotebook(111111);
  assert(nb2.includes('Первый инсайт') && nb2.includes('Второй инсайт'), 'updateUserNotebook — append');

  const nbMissing = await db.getUserNotebook(999999);
  assert(nbMissing === '', 'getUserNotebook — несуществующий user = пустая строка');

  // ═══════════════════════════════════════
  // 7. CATEGORIZED NOTES
  // ═══════════════════════════════════════
  console.log('\n🏷️  7. Категоризированные заметки');

  await db.addSpeakerNote(111111, 'Павел Лукша', 'Отличная лекция про будущее');
  await db.addSpeakerNote(111111, 'Павел Лукша', 'Интересные данные про технологии');
  await db.addSpeakerNote(111111, 'Тарик Курейши', 'Лидерство из будущего');

  const speakerList = await db.getSpeakerList(111111);
  assert(speakerList.length === 2, 'getSpeakerList — 2 спикера');
  assert(speakerList.includes('Павел Лукша'), 'getSpeakerList — содержит Лукша');
  assert(speakerList.includes('Тарик Курейши'), 'getSpeakerList — содержит Курейши');

  const luksNotes = await db.getSpeakerNotes(111111, 'Павел Лукша');
  assert(luksNotes.length === 2, 'getSpeakerNotes — 2 заметки по Лукша');
  assert(luksNotes[0].text === 'Отличная лекция про будущее', 'getSpeakerNotes — текст');

  const kurNotes = await db.getSpeakerNotes(111111, 'Тарик Курейши');
  assert(kurNotes.length === 1, 'getSpeakerNotes — 1 заметка по Курейши');

  const noSpeakerNotes = await db.getSpeakerNotes(111111, 'Неизвестный');
  assert(noSpeakerNotes.length === 0, 'getSpeakerNotes — пустой массив для неизвестного');

  await db.addGeneralNote(111111, 'Форум отличный!');
  await db.addGeneralNote(111111, 'Нужно больше нетворкинга');

  const genNotes = await db.getGeneralNotes(111111);
  assert(genNotes.length === 2, 'getGeneralNotes — 2 общие заметки');
  assert(genNotes[0].text === 'Форум отличный!', 'getGeneralNotes — текст');

  const catNotes = await db.getCategorizedNotes(111111);
  assert(Object.keys(catNotes.speakers).length === 2, 'getCategorizedNotes — 2 спикера');
  assert(catNotes.general.length === 2, 'getCategorizedNotes — 2 общих');

  const emptyCat = await db.getCategorizedNotes(999999);
  assert(Object.keys(emptyCat.speakers).length === 0, 'getCategorizedNotes — пустые для нового');
  assert(emptyCat.general.length === 0, 'getCategorizedNotes — пустые общие для нового');

  // ═══════════════════════════════════════
  // 8. DELETE SESSION
  // ═══════════════════════════════════════
  console.log('\n🗑️  8. Удаление сессий');

  const deleted = await db.deleteSession('ses_1');
  assert(deleted === true, 'deleteSession — удаление существующей');

  const checkDeleted = await db.getSession('ses_1');
  assert(checkDeleted === null, 'deleteSession — сессия удалена из store');

  const insightsAfterDel = await db.getInsightsBySession('ses_1');
  assert(insightsAfterDel.length === 0, 'deleteSession — инсайты сессии удалены');

  const deletedAgain = await db.deleteSession('ses_1');
  assert(deletedAgain === false, 'deleteSession — повторное удаление = false');

  const remainingSessions = await db.getAllSessions();
  assert(remainingSessions.length === 1, 'getAllSessions — осталась 1 сессия');

  // ═══════════════════════════════════════
  // 9. DATA PERSISTENCE (file)
  // ═══════════════════════════════════════
  console.log('\n💾 9. Персистентность данных');

  const savedData = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  assert(Object.keys(savedData.users).length === 3, 'Файл — 3 пользователя сохранены');
  assert(Object.keys(savedData.sessions).length === 1, 'Файл — 1 сессия сохранена');
  assert(savedData.user_notebooks['111111'] && savedData.user_notebooks['111111'].length > 0, 'Файл — блокнот сохранён');
  assert(savedData.categorized_notes['111111'] !== undefined, 'Файл — категоризированные заметки сохранены');
  assert(savedData.categorized_notes['111111'].speakers['Павел Лукша'].length === 2, 'Файл — заметки по Лукша сохранены');

  // ═══════════════════════════════════════
  // 10. EDGE CASES
  // ═══════════════════════════════════════
  console.log('\n⚠️  10. Граничные случаи');

  // Unicode & special chars
  await db.addSpeakerNote(111111, 'Тест', 'Заметка с *звёздочками* и _подчёркиваниями_ и `кодом`');
  const specialNotes = await db.getSpeakerNotes(111111, 'Тест');
  assert(specialNotes[0].text.includes('*звёздочками*'), 'Спецсимволы в заметках сохраняются');

  // Very long text
  const longText = 'A'.repeat(5000);
  await db.updateUserNotebook(222222, longText);
  const longNb = await db.getUserNotebook(222222);
  assert(longNb.length === 5000, 'Длинный текст блокнота (5000 символов)');

  // Empty string
  await db.updateUserNotebook(333333, '');
  const emptyNbResult = await db.getUserNotebook(333333);
  assert(emptyNbResult === '', 'Пустой блокнот');

  // Numeric-like session IDs
  await db.saveSession('123', 'Numeric ID session');
  const numSession = await db.getSession('123');
  assert(numSession !== null, 'Числовой session_id работает');

  // ═══════════════════════════════════════
  // 11. WEBHOOK HANDLER STRUCTURE
  // ═══════════════════════════════════════
  console.log('\n🔌 11. Структура webhook handler');
  
  const webhookHandler = require('./api/webhook');
  assert(typeof webhookHandler === 'function', 'webhook экспортирует функцию');

  const adminHandler = require('./api/admin');
  assert(typeof adminHandler === 'function', 'admin экспортирует функцию');

  const pushPollHandler = require('./api/push-poll');
  assert(typeof pushPollHandler === 'function', 'push-poll экспортирует функцию');

  const analyticsHandler = require('./api/analytics');
  assert(typeof analyticsHandler === 'function', 'analytics экспортирует функцию');

  const setupHandler = require('./api/setup');
  assert(typeof setupHandler === 'function', 'setup экспортирует функцию');

  // ═══════════════════════════════════════
  // 12. HTML FILES
  // ═══════════════════════════════════════
  console.log('\n🌐 12. HTML файлы');
  
  const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');
  assert(indexHtml.includes('MBA AlmaU Impact Forum'), 'index.html — содержит название');
  assert(indexHtml.includes('/api/setup'), 'index.html — ссылка на setup');
  assert(indexHtml.includes('/admin'), 'index.html — ссылка на admin');

  const adminHtml = fs.readFileSync(path.join(__dirname, 'public', 'admin.html'), 'utf-8');
  assert(adminHtml.includes('MBA AlmaU Impact Forum'), 'admin.html — содержит название');
  assert(adminHtml.includes('push_poll'), 'admin.html — функция push_poll');
  assert(adminHtml.includes('broadcast'), 'admin.html — функция broadcast');
  assert(adminHtml.includes('download_excel'), 'admin.html — функция download_excel');
  assert(adminHtml.includes('delete_session'), 'admin.html — функция delete_session');

  // ═══════════════════════════════════════
  // 13. VERCEL CONFIG
  // ═══════════════════════════════════════
  console.log('\n⚙️  13. Конфигурация Vercel');

  const vercelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf-8'));
  assert(vercelConfig.version === 2, 'vercel.json — version 2');
  
  const buildSrcs = vercelConfig.builds.map(b => b.src);
  assert(buildSrcs.includes('api/webhook.js'), 'vercel.json — build webhook');
  assert(buildSrcs.includes('api/admin.js'), 'vercel.json — build admin');
  assert(buildSrcs.includes('api/push-poll.js'), 'vercel.json — build push-poll');
  assert(buildSrcs.includes('api/analytics.js'), 'vercel.json — build analytics');
  assert(buildSrcs.includes('api/setup.js'), 'vercel.json — build setup');

  const routeDests = vercelConfig.routes.map(r => r.dest);
  assert(routeDests.includes('/api/webhook.js'), 'vercel.json — route webhook');
  assert(routeDests.includes('/api/admin.js'), 'vercel.json — route admin');
  assert(routeDests.includes('/public/admin.html'), 'vercel.json — route admin html');
  assert(routeDests.includes('/public/index.html'), 'vercel.json — route index html');

  // ═══════════════════════════════════════
  // 14. ENV CONFIG
  // ═══════════════════════════════════════
  console.log('\n🔑 14. Переменные окружения');

  assert(!!process.env.TELEGRAM_BOT_TOKEN, 'TELEGRAM_BOT_TOKEN установлен');
  assert(!!process.env.GEMINI_API_KEY, 'GEMINI_API_KEY установлен');
  assert(!!process.env.DEEPSEEK_API_KEY, 'DEEPSEEK_API_KEY установлен');
  assert(!!process.env.ADMIN_PASSWORD, 'ADMIN_PASSWORD установлен');

  // ═══════════════════════════════════════
  // 15. CONCURRENCY & MERGE STORES (CRDT MERGING)
  // ═══════════════════════════════════════
  console.log('\n🔄 15. Конкурентная запись и слияние');

  // Create mock databases representing concurrent writes
  const initialStore = {
    users: {
      "111111": { tg_id: 111111, username: "User1", pending_session_id: null, pending_note: null }
    },
    sessions: {},
    user_notes: {},
    user_notebooks: {
      "111111": "- Initial insight"
    },
    categorized_notes: {
      "111111": {
        speakers: { "Павел Лукша": [{ text: "First note", timestamp: 1717416000000 }] },
        general: [{ text: "General first", timestamp: 1717416000000 }]
      }
    },
    buttons: [],
    version: 1
  };

  // Local state change (User 1 adds speaker note for Pavel Luksha and updates notebook text)
  const localStore = JSON.parse(JSON.stringify(initialStore));
  localStore.categorized_notes["111111"].speakers["Павел Лукша"].push({
    text: "Local new speaker note",
    timestamp: 1717416005000
  });
  localStore.user_notebooks["111111"] += "\n\n- Local new insight";
  localStore.version = 2;

  // Remote state change (concurrent write by another client: User 1 adds general note and a note for another speaker)
  const remoteStore = JSON.parse(JSON.stringify(initialStore));
  remoteStore.categorized_notes["111111"].general.push({
    text: "Remote new general note",
    timestamp: 1717416008000
  });
  remoteStore.categorized_notes["111111"].speakers["Тарик Курейши"] = [{
    text: "Remote speaker note",
    timestamp: 1717416009000
  }];
  remoteStore.user_notebooks["111111"] += "\n\n- Remote new insight";
  remoteStore.version = 2;

  // Perform CRDT merge
  const merged = db.mergeStores(localStore, remoteStore);

  assert(merged.version === 3, 'mergeStores — инкрементирует версию удаленной бд на 1 (версия: 3)');
  
  const mergedLuks = merged.categorized_notes["111111"].speakers["Павел Лукша"];
  assert(mergedLuks.length === 2, 'mergeStores — сохраняет локально добавленную заметку спикера');
  assert(mergedLuks.some(n => n.text === "Local new speaker note"), 'mergeStores — содержит "Local new speaker note"');

  const mergedTarik = merged.categorized_notes["111111"].speakers["Тарик Курейши"];
  assert(mergedTarik && mergedTarik.length === 1, 'mergeStores — сохраняет удаленно добавленного спикера');
  assert(mergedTarik[0].text === "Remote speaker note", 'mergeStores — содержит "Remote speaker note"');

  const mergedGen = merged.categorized_notes["111111"].general;
  assert(mergedGen.length === 2, 'mergeStores — сохраняет удаленно добавленную общую заметку');
  assert(mergedGen.some(n => n.text === "Remote new general note"), 'mergeStores — содержит "Remote new general note"');

  const mergedNotebook = merged.user_notebooks["111111"];
  assert(mergedNotebook.includes("Local new insight") && mergedNotebook.includes("Remote new insight"), 'mergeStores — объединяет тексты блокнота без перезаписи');

  // ═══════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log(`  📊 РЕЗУЛЬТАТЫ: ${passed} ✅  /  ${failed} ❌`);
  console.log('══════════════════════════════════════════');

  if (failed > 0) {
    console.log('\n  ❌ Упавшие тесты:');
    errors.forEach(e => console.log(`     - ${e}`));
  } else {
    console.log('\n  🎉 ВСЕ ТЕСТЫ ПРОЙДЕНЫ!');
  }

  // Restore original db.json
  if (fs.existsSync(DB_BACKUP)) {
    fs.copyFileSync(DB_BACKUP, DB_PATH);
    fs.unlinkSync(DB_BACKUP);
    console.log('\n  💾 db.json восстановлен из бэкапа');
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('FATAL TEST ERROR:', err);
  // Restore db.json on error
  if (fs.existsSync(DB_BACKUP)) {
    fs.copyFileSync(DB_BACKUP, DB_PATH);
    fs.unlinkSync(DB_BACKUP);
  }
  process.exit(1);
});
