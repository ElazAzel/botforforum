const db = require('../db');
const {
  SPEAKERS_TEXT,
  SPEAKER_NAMES
} = require('./config');
const { registerUser } = require('./utils');
const { getSpeakerKeyboard } = require('./keyboards');

module.exports = function registerSpeakerHandlers(bot) {
  bot.command('speakers', async (ctx) => {
    const tgId = ctx.from.id;
    await registerUser(tgId, ctx.from.username || ctx.from.first_name || 'Anonymous');
    await db.updateUserPendingNote(tgId, null);
    const buttons = await db.getButtons();
    const spkBtn = buttons.find(b => b.id === 'btn_speakers');
    const text = spkBtn ? spkBtn.content : SPEAKERS_TEXT;
    await ctx.reply(text || 'Спикеры форума:', { 
      parse_mode: 'Markdown', 
      reply_markup: {
        inline_keyboard: [
          [{ text: '⬅️ Главное меню', callback_data: 'main_menu' }]
        ]
      }
    });
  });

  bot.action('speakers', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch (e) { console.warn('answerCbQuery failed:', e.message); }
    const tgId = ctx.from.id;
    const buttons = await db.getButtons();
    const spkBtn = buttons.find(b => b.id === 'btn_speakers');
    const text = spkBtn ? spkBtn.content : SPEAKERS_TEXT;
    await ctx.reply(text || 'Спикеры форума:', { 
      parse_mode: 'Markdown', 
      reply_markup: {
        inline_keyboard: [
          [{ text: '⬅️ Главное меню', callback_data: 'main_menu' }]
        ]
      }
    });
  });

  // Action listeners for each speaker selected from the lists
  SPEAKER_NAMES.forEach((name, i) => {
    bot.action(`spk_${i}`, async (ctx) => {
      try { await ctx.answerCbQuery(); } catch (e) { console.warn(e.message); }
      const tgId = ctx.from.id;
      await registerUser(tgId, ctx.from.username || ctx.from.first_name || 'Anonymous');
      await db.updateUserPendingNote(tgId, { type: 'speaker', name });
      await ctx.reply(
        `📝 *Напишите вашу заметку по спикеру ${name}:*\n\n` +
        `💡 _Пример: «Спикер выделил 3 ключевых тренда развития ИИ в бизнесе на 2026 год.»_`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Отмена', callback_data: 'nb_cancel' }]
            ]
          }
        }
      );
    });
  });
};
