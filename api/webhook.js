require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const db = require('./db');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Static data: Program Schedule info
const PROGRAM_INTRO = `🎓 *MBA AlmaU Impact Forum*

В этом году программа MBA Высшей Школы Бизнеса AlmaU отмечает своё 30-летие. В честь этого события приглашаем вас стать частью MBA AlmaU Impact Forum – двухдневного форума о лидерстве в эпоху неопределенности, управленческом импакте и роли бизнес-образования.

Выберите интересующий день форума ниже:`;

const PROGRAM_DAY1 = `📅 *MBA AlmaU Impact Forum — ДЕНЬ 1 (4 июня)*

• *09:00 – 10:00* | *Регистрация*
• *10:00 – 10:30* | *Открытие форума*
  🗣 Асылбек Кожахметов (Президент AlmaU), Тимур Булдыбаев (Ректор AlmaU), Ксения Южанинова-Караденизли (Декан ВШБ AlmaU)
• *10:45 – 11:45* | *Форсайт-лекция: «Следующие 20 лет: как подготовить бизнес к решающему переходу человечества»*
  🗣 *Павел Лукша* (международный эксперт по трендам)
• *11:45 – 12:15* | *Rave Network & Coffee Break*
• *12:15 – 13:30* | *Панельная дискуссия: «Условия тотальной неопределённости: как не просто выжить, а вырасти?»*
  🗣 *Н. Джарбасов, К. Боранбаев, В. Торгунакова, З. Хашимов*. Модератор: *Дана Токмурзина*
• *13:30 – 14:00* | *Lunch Break*
• *14:00 – 15:15* | *Keynote-сессия: «Leading from the future»*
  🗣 *Тарик Курейши* (CEO Future Readiness Forum & Xponential Group)
• *15:15 – 15:30* | *Break*
• *15:30 – 17:00* | *Воркшоп: «From Inner Stability to Outer Impact: как состояние лидера формирует масштаб его влияния»*
  🗣 *Ильдар Валиуллов* (MBA AlmaU Alumni)`;

const PROGRAM_DAY2 = `📅 *MBA AlmaU Impact Forum — ДЕНЬ 2 (5 июня)*

• *09:00 – 10:00* | *Регистрация*
• *10:00 – 11:00* | *Воркшоп: «Искусство договорённости: Переговоры сквозь призму поведенческих наук»*
  🗣 *Мухит Елеуов* (Выпускник Harvard Kennedy School, ADL Disputes)
• *11:00 – 11:30* | *Coffee Break & Network*
• *11:30 – 13:00* | *Параллельные сессии:*
  1️⃣ *Showcase-дискуссия: «Герои Impact Driven Education»*
     🗣 *К. Исмагулов, Б. Сыздыкова, Б. Култаев, А. Ержанова, М. Ахметсадыков*. Модератор: *Данияр Медетов*
  2️⃣ *Speed Dating: «Менторинг для управленцев»* (по предварительной регистрации)
     🗣 *Озат Байсеркеев, Ирина Уражанова, Мадина Билялова, Ильдар Тапалов*
• *13:00 – 13:30* | *Lunch & Network*
• *13:30 – 14:30* | *Параллельные сессии:*
  1️⃣ *Воркшоп: «Центральная Азия: окно возможностей для нового поколения»*
     🗣 *Мират Ахметсадыков* (MOST)
  2️⃣ *Воркшоп: «Неправильный трудовой договор»*
     🗣 *Татьяна Иссык*
• *14:30 – 14:45* | *Break*
• *14:45 – 15:45* | *Vision Talk: «Beyond Growth: как создавать ценность в мире, где меняются правила игры»*
  🗣 *Ильдар Валиуллов* (MBA AlmaU Alumni)`;

// Static data: Speaker Biographies
const SPEAKERS_TEXT = `🎤 *Ключевые спикеры MBA AlmaU Impact Forum:*

• *Павел Лукша* — международный эксперт по образовательным и технологическим трендам, соавтор исследований будущего.
• *Тарик Курейши* — CEO Future Readiness Forum и Xponential Group, экс-советник Bloomberg Media.
• *Ильдар Валиуллов* — эксперт в сфере развития людей и сопровождения лидеров, MBA AlmaU Alumni.
• *Мухит Елеуов* — Выпускник Harvard Kennedy School, партнер ADL Disputes.
• *Мират Ахметсадыков* — со-основатель венчурного фонда MOST, MBA AlmaU Alumni.
• *Татьяна Иссык* — профессиональный юрист, эксперт по трудовому праву.
• *Зафар Хашимов* — основатель сети супермаркетов «Корзинка» (Узбекистан).
• *Кайрат Боранбаев* — учредитель Холдинга «АЛМАЛЫ», Президент ФК «Кайрат».
• *Виктория Торгунакова* — CEO Freedom Events.
• *Нурасыл Джарбасов* — председатель совета директоров DEM Group, основатель Astana Venture Club.`;

const SPEAKER_NAMES = [
  'Павел Лукша', 'Тарик Курейши', 'Ильдар Валиуллов',
  'Мухит Елеуов', 'Мират Ахметсадыков', 'Татьяна Иссык',
  'Зафар Хашимов', 'Кайрат Боранбаев', 'Виктория Торгунакова', 'Нурасыл Джарбасов'
];

// Keyboards
const getMainMenu = () => {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📅 Программа', callback_data: 'program' },
          { text: '🎤 Спикеры', callback_data: 'speakers' }
        ],
        [
          { text: '📓 Мой блокнот', callback_data: 'nb' }
        ]
      ]
    }
  };
};

const getProgramMenu = () => {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📅 День 1 (4 июня)', callback_data: 'program_d1' },
          { text: '📅 День 2 (5 июня)', callback_data: 'program_d2' }
        ],
        [
          { text: '⬅️ Главное меню', callback_data: 'main_menu' }
        ]
      ]
    }
  };
};

const getNotebookMenu = () => {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📝 Добавить заметку по спикеру', callback_data: 'nb_sp' }],
        [{ text: '📝 Общая заметка', callback_data: 'nb_gn' }],
        [{ text: '📖 По спикерам', callback_data: 'nb_vsp' }],
        [{ text: '📖 Общие заметки', callback_data: 'nb_vgn' }],
        [{ text: '📖 Весь блокнот', callback_data: 'nb_all' }],
        [{ text: '⬅️ Главное меню', callback_data: 'main_menu' }]
      ]
    }
  };
};

const getSpeakerKeyboard = () => {
  const rows = [];
  for (let i = 0; i < SPEAKER_NAMES.length; i += 2) {
    const row = [];
    row.push({ text: SPEAKER_NAMES[i], callback_data: `spk_${i}` });
    if (i + 1 < SPEAKER_NAMES.length) {
      row.push({ text: SPEAKER_NAMES[i + 1], callback_data: `spk_${i + 1}` });
    }
    rows.push(row);
  }
  rows.push([{ text: '⬅️ Назад', callback_data: 'nb' }]);
  return { reply_markup: { inline_keyboard: rows } };
};

// Graceful registration logic: ensures database records exist without resetting user state
async function registerUser(tgId, username) {
  await db.saveUser(tgId, username);
}

// Bot Command: /start
bot.start(async (ctx) => {
  const tgId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || 'Anonymous';
  
  await registerUser(tgId, username);
  
  const activeSession = await db.getActiveSession();
  if (activeSession) {
    await db.updateUserPendingSession(tgId, activeSession.session_id);
    await ctx.reply(
      `👋 Приветствую в боте конференции Meta-Harness!\n\n📢 Сейчас идёт сбор инсайтов по сессии *"${activeSession.title}"*. Отправьте свой ответ прямо сейчас!`,
      getMainMenu()
    );
  } else {
    await ctx.reply(
      `👋 Приветствую в боте конференции Meta-Harness!\n\nИспользуйте меню ниже для навигации. Во время докладов вы будете получать пуш-опросы для сбора ваших инсайтов.`,
      getMainMenu()
    );
  }
});

bot.action('program', async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch (e) { console.warn('answerCbQuery failed:', e.message); }
  await ctx.reply(PROGRAM_INTRO, { parse_mode: 'Markdown', ...getProgramMenu() });
});

bot.action('program_d1', async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch (e) { console.warn('answerCbQuery failed:', e.message); }
  await ctx.reply(PROGRAM_DAY1, { parse_mode: 'Markdown', ...getProgramMenu() });
});

bot.action('program_d2', async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch (e) { console.warn('answerCbQuery failed:', e.message); }
  await ctx.reply(PROGRAM_DAY2, { parse_mode: 'Markdown', ...getProgramMenu() });
});

bot.action('speakers', async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch (e) { console.warn('answerCbQuery failed:', e.message); }
  await ctx.reply(SPEAKERS_TEXT, { 
    parse_mode: 'Markdown', 
    reply_markup: {
      inline_keyboard: [
        [{ text: '⬅️ Главное меню', callback_data: 'main_menu' }]
      ]
    }
  });
});

bot.action('main_menu', async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch (e) { console.warn('answerCbQuery failed:', e.message); }
  await ctx.reply('👋 Главное меню бота конференции Meta-Harness:', getMainMenu());
});

// Notebook sub-menu
bot.action('nb', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (e) { console.warn(e.message); }
  await ctx.reply('📓 *Мой блокнот*\n\nВыберите действие:', { parse_mode: 'Markdown', ...getNotebookMenu() });
});

// Add note for a speaker — show speaker list
bot.action('nb_sp', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (e) { console.warn(e.message); }
  await ctx.reply('🎤 Выберите спикера, по которому хотите добавить заметку:', getSpeakerKeyboard());
});

// Add general note — prompt user
bot.action('nb_gn', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (e) { console.warn(e.message); }
  const tgId = ctx.from.id;
  await db.updateUserPendingNote(tgId, { type: 'general' });
  await ctx.reply('📝 Напишите вашу общую заметку о форуме прямо сейчас.');
});

// Speaker selected — set pending_note and prompt
SPEAKER_NAMES.forEach((name, i) => {
  bot.action(`spk_${i}`, async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) { console.warn(e.message); }
    const tgId = ctx.from.id;
    await db.updateUserPendingNote(tgId, { type: 'speaker', name });
    await ctx.reply(`📝 Напишите вашу заметку по спикеру *${name}*:`, { parse_mode: 'Markdown' });
  });
});

// View notes grouped by speaker
bot.action('nb_vsp', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (e) { console.warn(e.message); }
  const tgId = ctx.from.id;
  await registerUser(tgId, ctx.from.username || 'Anonymous');
  const notes = await db.getCategorizedNotes(tgId);
  const speakerNames = Object.keys(notes.speakers);
  
  if (speakerNames.length === 0) {
    return ctx.reply('У вас пока нет заметок по спикерам.', getNotebookMenu());
  }

  let text = '';
  for (const name of speakerNames) {
    const items = notes.speakers[name];
    text += `*${name}:*\n`;
    items.forEach(n => { text += `• ${n.text}\n`; });
    text += '\n';
  }

  if (text.length > 4000) {
    const buf = Buffer.from(text, 'utf-8');
    await ctx.replyWithDocument({ source: buf, filename: `speaker_notes_${tgId}.txt` }, { caption: '📖 Заметки по спикерам', ...getNotebookMenu() });
  } else {
    await ctx.reply(`📖 *Заметки по спикерам:*\n\n${text}`, { parse_mode: 'Markdown', ...getNotebookMenu() });
  }
});

// View general notes
bot.action('nb_vgn', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (e) { console.warn(e.message); }
  const tgId = ctx.from.id;
  await registerUser(tgId, ctx.from.username || 'Anonymous');
  const notes = await db.getGeneralNotes(tgId);

  if (notes.length === 0) {
    return ctx.reply('У вас пока нет общих заметок.', getNotebookMenu());
  }

  const text = notes.map(n => `• ${n.text}`).join('\n');
  if (text.length > 4000) {
    const buf = Buffer.from(text, 'utf-8');
    await ctx.replyWithDocument({ source: buf, filename: `general_notes_${tgId}.txt` }, { caption: '📖 Общие заметки', ...getNotebookMenu() });
  } else {
    await ctx.reply(`📖 *Общие заметки:*\n\n${text}`, { parse_mode: 'Markdown', ...getNotebookMenu() });
  }
});

// View entire notebook (original behavior)
bot.action('nb_all', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (e) { console.warn(e.message); }
  const tgId = ctx.from.id;
  await registerUser(tgId, ctx.from.username || 'Anonymous');
  const text = await db.getUserNotebook(tgId);
    
  if (!text || text.trim() === '') {
    return ctx.reply('📓 *Ваш блокнот пока пуст.*\n\nДобавляйте заметки через меню блокнота или отвечайте на пуш-опросы.', { parse_mode: 'Markdown', ...getNotebookMenu() });
  }
  
  if (text.length > 4000) {
    const buffer = Buffer.from(text, 'utf-8');
    await ctx.replyWithDocument({ source: buffer, filename: `notebook_${tgId}.txt` }, {
      caption: '📓 Весь блокнот (отправлен файлом)',
      ...getNotebookMenu()
    });
  } else {
    await ctx.reply(`📓 *Весь блокнот:*\n\n${text}`, { parse_mode: 'Markdown', ...getNotebookMenu() });
  }
});

// Evaluate user input using Gemini API as Interviewer-Agent with rate-limit retries
async function evaluateInsight(userInput, sessionTitle) {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not defined.');
  }

  const systemInstructionText = `You are the Interviewer-Agent of the Meta-Harness system.
Your goal is to validate the insights submitted by conference participants for the session titled: "${sessionTitle}".

Analyze the participant's message.
Criteria:
- The insight must be meaningful, specific, and related to the presentation or topic of the session.
- Reject trivial or one-word messages like "ok", "cool", "normal", "good", "yes", "thanks", "interesting", etc.
- Reject gibberish or spam.

Response format:
You MUST respond with a JSON object:
{
  "is_valid": true/false,
  "clean_insight": "A polished, clean, and grammatically correct version of the insight in Russian",
  "feedback": "If is_valid is false, write a polite, short message in Russian asking the user to expand or clarify. If is_valid is true, leave this empty."
}`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `System instructions:\n${systemInstructionText}\n\nParticipant message: "${userInput}"`
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2
    }
  };

  let retries = 3;
  let delay = 1000;
  
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-1.5-flash'}:generateContent?key=${geminiApiKey}`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!responseText) {
        throw new Error('Empty response from Gemini API');
      }

      let cleaned = responseText.trim();
      const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        cleaned = jsonMatch[1].trim();
      }
      return JSON.parse(cleaned);
    } catch (error) {
      const status = error.response?.status;
      if (status === 429 && i < retries - 1) {
        console.warn(`Gemini 429 rate limit hit. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      } else {
        console.error('Error calling Gemini API:', error.message);
        if (i === retries - 1) {
          throw error;
        }
      }
    }
  }
}

// User text response intercepts: acts as the entry point for feedback loops
bot.on('text', async (ctx) => {
  const tgId = ctx.from.id;
  const userInput = ctx.message.text;

  // Do not process commands
  if (userInput.startsWith('/')) {
    return;
  }

  // 1. Check if user has a pending categorized note
  const user = await db.getUser(tgId);

  if (user && user.pending_note) {
    const note = user.pending_note;
    await db.updateUserPendingNote(tgId, null);

    if (note.type === 'speaker') {
      await db.addSpeakerNote(tgId, note.name, userInput);
      await ctx.reply(
        `✅ Заметка по спикеру *${note.name}* сохранена в блокнот!`,
        { parse_mode: 'Markdown', ...getNotebookMenu() }
      );
    } else if (note.type === 'general') {
      await db.addGeneralNote(tgId, userInput);
      await ctx.reply(
        '✅ Общая заметка сохранена в блокнот!',
        { parse_mode: 'Markdown', ...getNotebookMenu() }
      );
    }
    return;
  }

  // 2. Check if user is in push-poll feedback state
  if (!user || !user.pending_session_id) {
    return ctx.reply(
      `🤖 Чтобы сохранить инсайт в блокнот, пожалуйста, дождитесь пуш-опроса от организаторов.\n\nИспользуйте меню для навигации:`,
      getMainMenu()
    );
  }

  const sessionId = user.pending_session_id;

  // 2. Fetch active session title
  const session = await db.getSession(sessionId);

  if (!session) {
    console.error('Session not found:', sessionId);
    await db.updateUserPendingSession(tgId, null);
    return ctx.reply(
      'Сессия, на которую вы отвечали, уже завершена. Дождитесь следующего опроса.',
      getMainMenu()
    );
  }

  const sessionTitle = session.title;

  await ctx.reply('⏳ Проверяю ваш инсайт с помощью Interviewer-Agent...');

  try {
    // 3. Evaluate participant input with Gemini
    const result = await evaluateInsight(userInput, sessionTitle);

    if (result.is_valid) {
      const cleanInsight = result.clean_insight;

      // a) Save record to user_notes
      await db.addInsight(tgId, sessionId, cleanInsight);

      // b) Append note to user's compiled notebook text
      const currentText = await db.getUserNotebook(tgId);
      const appendText = `[Сессия: ${sessionTitle}]\n- ${cleanInsight}`;
      const newText = currentText ? `${currentText}\n\n${appendText}` : appendText;

      await db.updateUserNotebook(tgId, newText);

      await ctx.reply(
        `✅ *Инсайт принят и записан в ваш блокнот!*\n\n📝 *Отформатированный инсайт:*\n"${cleanInsight}"\n\n💡 Отправьте ещё инсайт или нажмите кнопку меню для навигации.`,
        { parse_mode: 'Markdown', ...getMainMenu() }
      );

    } else {
      // Input is rejected: prompt for more detailed response using agent feedback
      await ctx.reply(
        `❌ *Ваш инсайт не прошел валидацию.*\n\n*Рекомендация ИИ:*\n${result.feedback}\n\nПожалуйста, отправьте более подробный ответ.`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    console.error('Error running Interviewer-Agent:', error.message);
    await ctx.reply('⚠️ Произошла ошибка при обработке инсайта. Попробуйте сформулировать ответ подробнее и прислать снова.');
  }
});

// Auto-setup webhook on Vercel — avoids manual /api/setup after each deploy
let lastWebhookUrl = '';

async function ensureWebhook(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const currentUrl = `${proto}://${host}/api/webhook`;
  if (currentUrl === lastWebhookUrl) return;
  try {
    const r = await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, { url: currentUrl });
    if (r.data?.ok) {
      lastWebhookUrl = currentUrl;
      console.log('Webhook set to', currentUrl);
    }
  } catch (e) {
    console.warn('Webhook auto-setup failed:', e.message);
  }
}

// Vercel Serverless Function entry point
module.exports = async (req, res) => {
  await ensureWebhook(req);

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(200).send('Webhook is up and running.');
  }

  try {
    await bot.handleUpdate(req.body);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Telegraf handleUpdate error:', err);
    return res.status(200).json({ error: err.message });
  }
};
