require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const db = require('./db');

const {
  PROGRAM_INTRO,
  SPEAKER_NAMES
} = require('./bot/config');

const {
  registerUser,
  evaluateInsight
} = require('./bot/utils');

const {
  renderMenuKeyboard,
  getMainMenu,
  getNotebookMenu
} = require('./bot/keyboards');

// Import sub-routers
const registerScheduleHandlers = require('./bot/schedule');
const registerSpeakerHandlers = require('./bot/speakers');
const registerNotebookHandlers = require('./bot/notebook');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Global middleware to auto-register/update user on every interaction
bot.use(async (ctx, next) => {
  if (ctx.from) {
    const tgId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || 'Anonymous';
    try {
      await registerUser(tgId, username);
    } catch (e) {
      console.error('Auto-registration failed:', e.message);
    }
  }
  return await next();
});

// Register modular handlers
registerScheduleHandlers(bot);
registerSpeakerHandlers(bot);
registerNotebookHandlers(bot);

// Bot Command: /start
bot.start(async (ctx) => {
  const tgId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || 'Anonymous';
  
  await registerUser(tgId, username);
  await db.updateUserPendingNote(tgId, null); // Clear pending notes input state on start
  
  const activeSession = await db.getActiveSession();
  if (activeSession) {
    await db.updateUserPendingSession(tgId, activeSession.session_id);
    await ctx.reply(
      `👋 Приветствую в боте MBA AlmaU Impact Forum!\n\n📢 Сейчас идёт сбор инсайтов по сессии "${activeSession.title}". Отправьте свой ответ прямо сейчас!`,
      await getMainMenu(tgId)
    );
  } else {
    await ctx.reply(
      `👋 Приветствую в боте MBA AlmaU Impact Forum!\n\nИспользуйте меню ниже для навигации. Во время докладов вы будете получать пуш-опросы для сбора ваших инсайтов.`,
      await getMainMenu(tgId)
    );
  }
});

// Bot Command: /menu
bot.command('menu', async (ctx) => {
  const tgId = ctx.from.id;
  await registerUser(tgId, ctx.from.username || ctx.from.first_name || 'Anonymous');
  await db.updateUserPendingNote(tgId, null);
  await ctx.reply('👋 Главное меню MBA AlmaU Impact Forum:', await getMainMenu(tgId));
});

// Action: main_menu
bot.action('main_menu', async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch (e) { console.warn('answerCbQuery failed:', e.message); }
  const tgId = ctx.from.id;
  await ctx.reply('👋 Главное меню MBA AlmaU Impact Forum:', await getMainMenu(tgId));
});

// Dynamic menu buttons actions handler
bot.action(/^menu_open_(.+)$/, async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (e) { console.warn(e.message); }
  const buttonId = ctx.match[1];
  const tgId = ctx.from.id;
  await registerUser(tgId, ctx.from.username || ctx.from.first_name || 'Anonymous');
  
  const buttons = await db.getButtons();
  const button = buttons.find(b => b.id === buttonId);
  if (!button) {
    return ctx.reply('Кнопка не найдена.');
  }
  
  if (button.type === 'submenu') {
    const text = button.content || 'Выберите действие:';
    await ctx.reply(text, { parse_mode: 'Markdown', ...(await renderMenuKeyboard(tgId, buttonId)) });
  } else if (button.type === 'text') {
    let backCallback = 'main_menu';
    if (button.parentId !== 'main') {
      backCallback = 'menu_open_' + button.parentId;
    }
    await ctx.reply(button.content || '', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '⬅️ Назад', callback_data: backCallback }]
        ]
      }
    });
  }
});

// Helper to save user insight to their categorized notes (under speaker or general notes)
async function saveUserInsightAsNote(tgId, sessionTitle, text) {
  let matchedSpeaker = null;
  if (SPEAKER_NAMES && Array.isArray(SPEAKER_NAMES)) {
    for (const name of SPEAKER_NAMES) {
      if (sessionTitle.toLowerCase().includes(name.toLowerCase())) {
        matchedSpeaker = name;
        break;
      }
    }
  }

  if (matchedSpeaker) {
    await db.addSpeakerNote(tgId, matchedSpeaker, `[Инсайт] ${text}`);
  } else {
    await db.addGeneralNote(tgId, `[Инсайт с сессии: ${sessionTitle}] ${text}`);
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

  // Ensure user is registered
  await registerUser(tgId, ctx.from.username || ctx.from.first_name || 'Anonymous');

  // 1. Check if user has a pending categorized note
  const user = await db.getUser(tgId);

  if (user && user.pending_note) {
    const note = user.pending_note;
    await db.updateUserPendingNote(tgId, null);

    if (note.type === 'speaker') {
      await db.addSpeakerNote(tgId, note.name, userInput);
      await ctx.reply(
        `✅ Заметка по спикеру «${note.name}» сохранена в блокнот!`,
        await getNotebookMenu(tgId)
      );
    } else if (note.type === 'general') {
      await db.addGeneralNote(tgId, userInput);
      await ctx.reply(
        '✅ Общая заметка сохранена в блокнот!',
        await getNotebookMenu(tgId)
      );
    }
    return;
  }

  // 2. Check if user is in push-poll feedback state
  if (!user || !user.pending_session_id) {
    return ctx.reply(
      `📝 Чтобы добавить заметку, используйте кнопку «📓 Мой блокнот».\n\nДля отправки инсайта дождитесь пуш-опроса от организаторов.`,
      await getMainMenu(tgId)
    );
  }

  const sessionId = user.pending_session_id;

  // 3. Fetch active session title
  const session = await db.getSession(sessionId);

  if (!session) {
    console.error('Session not found:', sessionId);
    await db.updateUserPendingSession(tgId, null);
    return res.status(200).json({ error: 'Session not found' });
  }

  const sessionTitle = session.title;

  await ctx.reply('⏳ Проверяю ваш инсайт с помощью Interviewer-Agent...');

  try {
    // 4. Evaluate participant input with Gemini
    const result = await evaluateInsight(userInput, sessionTitle);

    if (result.is_valid) {
      const cleanInsight = result.clean_insight;

      // a) Save record to user_notes (for analytics)
      await db.addInsight(tgId, sessionId, cleanInsight);

      // b) Save to user's categorized notes (for notebook grouping and stats)
      await saveUserInsightAsNote(tgId, sessionTitle, cleanInsight);

      await ctx.reply(
        `✅ Инсайт принят и записан в ваш блокнот!\n\n📝 Отформатированный инсайт:\n«${cleanInsight}»\n\n💡 Отправьте ещё инсайт или нажмите кнопку меню для навигации.`,
        await getMainMenu(tgId)
      );

    } else {
      // Input is rejected: prompt for more detailed response using agent feedback
      await ctx.reply(
        `❌ Ваш инсайт не прошел валидацию.\n\nРекомендация ИИ:\n${result.feedback}\n\nПожалуйста, отправьте более подробный ответ.`
      );
    }
  } catch (error) {
    console.error('Error running Interviewer-Agent:', error.message);

    // Fallback: save the insight without AI validation
    await db.addInsight(tgId, sessionId, userInput);
    await saveUserInsightAsNote(tgId, sessionTitle, userInput);

    await ctx.reply(
      '⚠️ ИИ-валидация временно недоступна, но ваш инсайт всё равно сохранён в блокнот! ✅\n\nОтправьте ещё один инсайт или используйте меню.',
      await getMainMenu(tgId)
    );
  }
});

// Vercel Serverless Function entry point
module.exports = async (req, res) => {

  const secretToken = process.env.TELEGRAM_SECRET_TOKEN || 'mba_almau_forum_secret_token_2026';
  const incomingToken = req.headers['x-telegram-bot-api-secret-token'];
  if (incomingToken !== secretToken) {
    console.warn('Unauthorized update request blocked (invalid secret token)');
    return res.status(403).json({ error: 'Forbidden: Invalid secret token' });
  }

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
