const db = require('../db');
const {
  PROGRAM_INTRO,
  PROGRAM_DAY1,
  PROGRAM_DAY2
} = require('./config');
const { registerUser } = require('./utils');
const { renderMenuKeyboard, getProgramMenu } = require('./keyboards');

module.exports = function registerScheduleHandlers(bot) {
  bot.command('program', async (ctx) => {
    const tgId = ctx.from.id;
    await registerUser(tgId, ctx.from.username || ctx.from.first_name || 'Anonymous');
    await db.updateUserPendingNote(tgId, null);
    const buttons = await db.getButtons();
    const progBtn = buttons.find(b => b.id === 'btn_program');
    const text = progBtn ? progBtn.content : PROGRAM_INTRO;
    await ctx.reply(text || 'Программа форума:', { parse_mode: 'Markdown', ...(await renderMenuKeyboard(tgId, 'btn_program')) });
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
};
