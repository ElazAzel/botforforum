/**
 * Детальный тест блокнотов: полная симуляция пользовательского потока.
 * Проверяет сохранение и вывод заметок по спикерам, общих заметок,
 * инсайтов из push-poll и полную компиляцию блокнота.
 */
require('dotenv').config();
delete process.env.BLOB_READ_WRITE_TOKEN;

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'db.json');
const DB_BACKUP = path.join(__dirname, 'db.backup2.json');

if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, DB_BACKUP);

// Clean state
fs.writeFileSync(DB_PATH, JSON.stringify({
  users: {}, sessions: {}, user_notes: {}, user_notebooks: {}, categorized_notes: {}
}, null, 2));

delete require.cache[require.resolve('./api/db')];
const db = require('./api/db');

let passed = 0, failed = 0;
const errors = [];

function assert(condition, testName) {
  if (condition) { passed++; console.log(`  ✅ ${testName}`); }
  else { failed++; errors.push(testName); console.log(`  ❌ ${testName}`); }
}

async function runTests() {
  console.log('\n══════════════════════════════════════════');
  console.log('  📓 ТЕСТ БЛОКНОТОВ: СОХРАНЕНИЕ И ВЫВОД');
  console.log('══════════════════════════════════════════\n');

  const USER_ID = 777777;
  const USER_ID2 = 888888;

  // Регистрация пользователей
  await db.saveUser(USER_ID, 'Ильяс');
  await db.saveUser(USER_ID2, 'Анна');

  // ═══════════════════════════════════════
  // СЦЕНАРИЙ 1: Заметка по спикеру
  // ═══════════════════════════════════════
  console.log('📝 СЦЕНАРИЙ 1: Заметка по спикеру');
  console.log('   (Пользователь нажимает «📝 Добавить заметку по спикеру» → выбирает спикера → пишет текст)');

  // Шаг 1: Пользователь нажимает кнопку спикера → устанавливается pending_note
  await db.updateUserPendingNote(USER_ID, { type: 'speaker', name: 'Павел Лукша' });
  const u1 = await db.getUser(USER_ID);
  assert(u1.pending_note !== null, '1.1 pending_note установлен');
  assert(u1.pending_note.type === 'speaker', '1.2 тип = speaker');
  assert(u1.pending_note.name === 'Павел Лукша', '1.3 имя спикера = Павел Лукша');

  // Шаг 2: Пользователь отправляет текст → бот сохраняет заметку и очищает pending_note
  const noteText1 = 'Очень интересная мысль про 20 лет будущего и подготовку бизнеса';
  await db.updateUserPendingNote(USER_ID, null); // clear pending
  await db.addSpeakerNote(USER_ID, 'Павел Лукша', noteText1);

  const u1after = await db.getUser(USER_ID);
  assert(u1after.pending_note === null, '1.4 pending_note очищен после сохранения');

  // Шаг 3: Проверяем что заметка сохранилась в categorized_notes
  const notes1 = await db.getCategorizedNotes(USER_ID);
  assert(notes1.speakers['Павел Лукша'] !== undefined, '1.5 categorized_notes содержит Павел Лукша');
  assert(notes1.speakers['Павел Лукша'].length === 1, '1.6 1 заметка по Лукша');
  assert(notes1.speakers['Павел Лукша'][0].text === noteText1, '1.7 текст заметки совпадает');
  assert(notes1.speakers['Павел Лукша'][0].timestamp !== undefined, '1.8 timestamp присутствует');

  // Шаг 4: Добавим ещё одну заметку по тому же спикеру
  const noteText2 = 'Нужно адаптировать бизнес-модели к новой реальности';
  await db.updateUserPendingNote(USER_ID, { type: 'speaker', name: 'Павел Лукша' });
  await db.updateUserPendingNote(USER_ID, null);
  await db.addSpeakerNote(USER_ID, 'Павел Лукша', noteText2);

  const notes1b = await db.getSpeakerNotes(USER_ID, 'Павел Лукша');
  assert(notes1b.length === 2, '1.9 теперь 2 заметки по Лукша');
  assert(notes1b[0].text === noteText1, '1.10 первая заметка на месте');
  assert(notes1b[1].text === noteText2, '1.11 вторая заметка на месте');

  // Шаг 5: Заметка по другому спикеру
  await db.addSpeakerNote(USER_ID, 'Тарик Курейши', 'Leading from the future — ключевая концепция');
  const speakerList = await db.getSpeakerList(USER_ID);
  assert(speakerList.length === 2, '1.12 теперь 2 спикера в списке');
  assert(speakerList.includes('Павел Лукша'), '1.13 Лукша в списке');
  assert(speakerList.includes('Тарик Курейши'), '1.14 Курейши в списке');

  // ═══════════════════════════════════════
  // СЦЕНАРИЙ 2: Общая заметка
  // ═══════════════════════════════════════
  console.log('\n📝 СЦЕНАРИЙ 2: Общая заметка');
  console.log('   (Пользователь нажимает «📝 Общая заметка» → пишет текст)');

  await db.updateUserPendingNote(USER_ID, { type: 'general' });
  const u2 = await db.getUser(USER_ID);
  assert(u2.pending_note.type === 'general', '2.1 pending_note = general');

  const genText1 = 'Форум отлично организован, нетворкинг на высоте!';
  await db.updateUserPendingNote(USER_ID, null);
  await db.addGeneralNote(USER_ID, genText1);

  const genNotes = await db.getGeneralNotes(USER_ID);
  assert(genNotes.length === 1, '2.2 1 общая заметка');
  assert(genNotes[0].text === genText1, '2.3 текст общей заметки совпадает');

  // Вторая общая заметка
  await db.addGeneralNote(USER_ID, 'Нужно больше воркшопов по AI');
  const genNotes2 = await db.getGeneralNotes(USER_ID);
  assert(genNotes2.length === 2, '2.4 теперь 2 общие заметки');

  // ═══════════════════════════════════════
  // СЦЕНАРИЙ 3: Инсайт через push-poll
  // ═══════════════════════════════════════
  console.log('\n📝 СЦЕНАРИЙ 3: Инсайт через push-poll');
  console.log('   (Админ запускает опрос → пользователь отвечает → Gemini валидирует → сохраняется в блокнот)');

  // Создаём сессию
  await db.saveSession('ses_forum', 'Форсайт-лекция Павла Лукши', true);
  await db.updateAllUsersPendingSession('ses_forum');

  const u3 = await db.getUser(USER_ID);
  assert(u3.pending_session_id === 'ses_forum', '3.1 pending_session_id установлен');

  // Симулируем сохранение инсайта (после валидации Gemini)
  const cleanInsight = 'Искусственный интеллект кардинально изменит систему образования в ближайшие 10 лет';
  await db.addInsight(USER_ID, 'ses_forum', cleanInsight);
  
  // Записываем в user_notebooks (как делает webhook.js)
  const currentNb = await db.getUserNotebook(USER_ID);
  const appendText = `[Сессия: Форсайт-лекция Павла Лукши]\n- ${cleanInsight}`;
  const newNb = currentNb ? `${currentNb}\n\n${appendText}` : appendText;
  await db.updateUserNotebook(USER_ID, newNb);

  const nb = await db.getUserNotebook(USER_ID);
  assert(nb.includes(cleanInsight), '3.2 инсайт записан в user_notebooks');
  assert(nb.includes('[Сессия: Форсайт-лекция'), '3.3 метка сессии присутствует');

  // Второй инсайт
  const insight2 = 'Бизнес-лидерам необходимо развивать адаптивное мышление';
  await db.addInsight(USER_ID, 'ses_forum', insight2);
  const nb2text = `${nb}\n\n[Сессия: Форсайт-лекция Павла Лукши]\n- ${insight2}`;
  await db.updateUserNotebook(USER_ID, nb2text);

  const insightsSes = await db.getInsightsBySession('ses_forum');
  assert(insightsSes.length === 2, '3.4 2 инсайта в сессии');

  const nbFull = await db.getUserNotebook(USER_ID);
  assert(nbFull.includes(cleanInsight), '3.5 первый инсайт в блокноте');
  assert(nbFull.includes(insight2), '3.6 второй инсайт в блокноте');

  // ═══════════════════════════════════════
  // СЦЕНАРИЙ 4: Просмотр «По спикерам» (nb_vsp)
  // ═══════════════════════════════════════
  console.log('\n📖 СЦЕНАРИЙ 4: Просмотр «По спикерам»');

  const catNotes = await db.getCategorizedNotes(USER_ID);
  const spNames = Object.keys(catNotes.speakers);
  assert(spNames.length === 2, '4.1 2 спикера в блокноте');

  // Симулируем формирование текста как в webhook.js (nb_vsp)
  let viewText = '';
  for (const name of spNames) {
    const items = catNotes.speakers[name];
    viewText += `🎤 ${name}:\n`;
    items.forEach(n => { viewText += `  • ${n.text}\n`; });
    viewText += '\n';
  }
  assert(viewText.includes('Павел Лукша'), '4.2 Лукша отображается');
  assert(viewText.includes('Тарик Курейши'), '4.3 Курейши отображается');
  assert(viewText.includes(noteText1), '4.4 первая заметка по Лукша отображается');
  assert(viewText.includes(noteText2), '4.5 вторая заметка по Лукша отображается');
  assert(viewText.includes('Leading from the future'), '4.6 заметка по Курейши отображается');
  console.log('\n   Предпросмотр вывода «По спикерам»:');
  console.log('   ─────────────────────────────');
  viewText.split('\n').forEach(l => console.log('   ' + l));

  // ═══════════════════════════════════════
  // СЦЕНАРИЙ 5: Просмотр «Общие заметки» (nb_vgn)
  // ═══════════════════════════════════════
  console.log('📖 СЦЕНАРИЙ 5: Просмотр «Общие заметки»');

  const genView = await db.getGeneralNotes(USER_ID);
  const genViewText = genView.map(n => `• ${n.text}`).join('\n');
  assert(genViewText.includes(genText1), '5.1 первая общая заметка отображается');
  assert(genViewText.includes('Нужно больше воркшопов'), '5.2 вторая общая заметка отображается');
  console.log('\n   Предпросмотр вывода «Общие заметки»:');
  console.log('   ─────────────────────────────');
  genViewText.split('\n').forEach(l => console.log('   ' + l));

  // ═══════════════════════════════════════
  // СЦЕНАРИЙ 6: Просмотр «Весь блокнот» (nb_all)
  // ═══════════════════════════════════════
  console.log('\n📖 СЦЕНАРИЙ 6: Просмотр «Весь блокнот» (nb_all) — полная компиляция');

  // Точная логика из webhook.js nb_all:
  const categorized = await db.getCategorizedNotes(USER_ID);
  const legacyNotebook = await db.getUserNotebook(USER_ID);
  
  let parts = [];

  if (legacyNotebook && legacyNotebook.trim()) {
    parts.push('📋 Инсайты с сессий:\n' + legacyNotebook);
  }

  const speakerNames = Object.keys(categorized.speakers);
  if (speakerNames.length > 0) {
    let spText = '🎤 Заметки по спикерам:';
    for (const name of speakerNames) {
      const items = categorized.speakers[name];
      spText += `\n\n${name}:`;
      items.forEach(n => { spText += `\n  • ${n.text}`; });
    }
    parts.push(spText);
  }

  if (categorized.general.length > 0) {
    let gnText = '📝 Общие заметки:';
    categorized.general.forEach(n => { gnText += `\n  • ${n.text}`; });
    parts.push(gnText);
  }

  const fullText = parts.join('\n\n─────────────────────\n\n');

  assert(parts.length === 3, '6.1 блокнот состоит из 3 секций');
  assert(fullText.includes('📋 Инсайты с сессий'), '6.2 секция инсайтов присутствует');
  assert(fullText.includes('🎤 Заметки по спикерам'), '6.3 секция спикеров присутствует');
  assert(fullText.includes('📝 Общие заметки'), '6.4 секция общих присутствует');
  assert(fullText.includes(cleanInsight), '6.5 инсайт из push-poll в полном блокноте');
  assert(fullText.includes(noteText1), '6.6 заметка по спикеру в полном блокноте');
  assert(fullText.includes(genText1), '6.7 общая заметка в полном блокноте');
  assert(fullText.includes('─────────────────────'), '6.8 разделители между секциями');

  console.log('\n   Предпросмотр вывода «Весь блокнот»:');
  console.log('   ═══════════════════════════════════');
  fullText.split('\n').forEach(l => console.log('   ' + l));
  console.log('   ═══════════════════════════════════');

  // ═══════════════════════════════════════
  // СЦЕНАРИЙ 7: Изоляция данных между пользователями
  // ═══════════════════════════════════════
  console.log('\n🔒 СЦЕНАРИЙ 7: Изоляция данных между пользователями');

  await db.addSpeakerNote(USER_ID2, 'Ильдар Валиуллов', 'Воркшоп был полезным');
  await db.addGeneralNote(USER_ID2, 'Спасибо организаторам!');

  const user1cat = await db.getCategorizedNotes(USER_ID);
  const user2cat = await db.getCategorizedNotes(USER_ID2);
  assert(Object.keys(user1cat.speakers).length === 2, '7.1 у user1 свои 2 спикера');
  assert(Object.keys(user2cat.speakers).length === 1, '7.2 у user2 свой 1 спикер');
  assert(user2cat.speakers['Ильдар Валиуллов'] !== undefined, '7.3 user2 имеет Валиуллов');
  assert(user2cat.speakers['Павел Лукша'] === undefined, '7.4 user2 НЕ имеет Лукша');
  assert(user1cat.general.length === 2, '7.5 у user1 2 общие заметки');
  assert(user2cat.general.length === 1, '7.6 у user2 1 общая заметка');

  const user1nb = await db.getUserNotebook(USER_ID);
  const user2nb = await db.getUserNotebook(USER_ID2);
  assert(user1nb.includes(cleanInsight), '7.7 инсайт user1 только у user1');
  assert(user2nb === '', '7.8 user2 не имеет чужих инсайтов');

  // ═══════════════════════════════════════
  // СЦЕНАРИЙ 8: Персистентность на диске
  // ═══════════════════════════════════════
  console.log('\n💾 СЦЕНАРИЙ 8: Персистентность данных на диске');

  const saved = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  
  assert(saved.categorized_notes[String(USER_ID)] !== undefined, '8.1 categorized_notes user1 на диске');
  assert(saved.categorized_notes[String(USER_ID)].speakers['Павел Лукша'].length === 2, '8.2 2 заметки по Лукша на диске');
  assert(saved.categorized_notes[String(USER_ID)].general.length === 2, '8.3 2 общие заметки на диске');
  assert(saved.user_notebooks[String(USER_ID)].includes(cleanInsight), '8.4 инсайт в user_notebooks на диске');
  assert(saved.user_notes['ses_forum'].length === 2, '8.5 2 инсайта сессии на диске');
  assert(saved.categorized_notes[String(USER_ID2)] !== undefined, '8.6 categorized_notes user2 на диске');

  // ═══════════════════════════════════════
  // РЕЗУЛЬТАТЫ
  // ═══════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log(`  📊 РЕЗУЛЬТАТЫ: ${passed} ✅  /  ${failed} ❌`);
  console.log('══════════════════════════════════════════');

  if (failed > 0) {
    console.log('\n  ❌ Упавшие тесты:');
    errors.forEach(e => console.log(`     - ${e}`));
  } else {
    console.log('\n  🎉 ВСЕ ТЕСТЫ БЛОКНОТОВ ПРОЙДЕНЫ!');
  }

  if (fs.existsSync(DB_BACKUP)) {
    fs.copyFileSync(DB_BACKUP, DB_PATH);
    fs.unlinkSync(DB_BACKUP);
    console.log('  💾 db.json восстановлен\n');
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('FATAL:', err);
  if (fs.existsSync(DB_BACKUP)) { fs.copyFileSync(DB_BACKUP, DB_PATH); fs.unlinkSync(DB_BACKUP); }
  process.exit(1);
});
