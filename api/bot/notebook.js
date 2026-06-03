const db = require('../db');
const { registerUser } = require('./utils');
const { getNotebookMenu, getSpeakerKeyboard } = require('./keyboards');

module.exports = function registerNotebookHandlers(bot) {
  bot.command(['notebook', 'notes'], async (ctx) => {
    const tgId = ctx.from.id;
    await registerUser(tgId, ctx.from.username || ctx.from.first_name || 'Anonymous');
    await db.updateUserPendingNote(tgId, null);
    await ctx.reply('📓 Мой блокнот\n\nВыберите действие:', await getNotebookMenu(tgId));
  });

  // Notebook sub-menu callback
  bot.action('nb', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) { console.warn(e.message); }
    const tgId = ctx.from.id;
    await ctx.reply('📓 Мой блокнот\n\nВыберите действие:', await getNotebookMenu(tgId));
  });

  // Add note for a speaker — show speaker list
  bot.action('nb_sp', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) { console.warn(e.message); }
    const tgId = ctx.from.id;
    await registerUser(tgId, ctx.from.username || ctx.from.first_name || 'Anonymous');
    await ctx.reply('🎤 Выберите спикера, по которому хотите добавить заметку:', getSpeakerKeyboard());
  });

  // Add general note — prompt user
  bot.action('nb_gn', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) { console.warn(e.message); }
    const tgId = ctx.from.id;
    await registerUser(tgId, ctx.from.username || ctx.from.first_name || 'Anonymous');
    await db.updateUserPendingNote(tgId, { type: 'general' });
    await ctx.reply(
      '📝 *Напишите вашу общую заметку о форуме прямо сейчас.*\n\n' +
      '💡 _Пример: «Отличная организация сессии, интересные спикеры и полезные контакты на кофе-брейке!»_',
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

  // Cancel note input handler
  bot.action('nb_cancel', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) { console.warn(e.message); }
    const tgId = ctx.from.id;
    await db.updateUserPendingNote(tgId, null);
    await ctx.reply('❌ Ввод заметки отменен.', await getNotebookMenu(tgId));
  });

  // View notes grouped by speaker
  bot.action('nb_vsp', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) { console.warn(e.message); }
    const tgId = ctx.from.id;
    await registerUser(tgId, ctx.from.username || ctx.from.first_name || 'Anonymous');
    const notes = await db.getCategorizedNotes(tgId);
    const speakerNames = Object.keys(notes.speakers);
    
    if (speakerNames.length === 0) {
      return ctx.reply('У вас пока нет заметок по спикерам.', await getNotebookMenu(tgId));
    }

    let text = '';
    for (const name of speakerNames) {
      const items = notes.speakers[name];
      text += `🎤 ${name}:\n`;
      items.forEach(n => { text += `  • ${n.text}\n`; });
      text += '\n';
    }

    if (text.length > 4000) {
      const buf = Buffer.from(text, 'utf-8');
      await ctx.replyWithDocument({ source: buf, filename: `speaker_notes_${tgId}.txt` }, { caption: '📖 Заметки по спикерам', ...(await getNotebookMenu(tgId)) });
    } else {
      await ctx.reply(`📖 Заметки по спикерам:\n\n${text}`, await getNotebookMenu(tgId));
    }
  });

  // View general notes
  bot.action('nb_vgn', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) { console.warn(e.message); }
    const tgId = ctx.from.id;
    await registerUser(tgId, ctx.from.username || ctx.from.first_name || 'Anonymous');
    const notes = await db.getGeneralNotes(tgId);

    if (notes.length === 0) {
      return ctx.reply('У вас пока нет общих заметок.', await getNotebookMenu(tgId));
    }

    const text = notes.map(n => `• ${n.text}`).join('\n');
    if (text.length > 4000) {
      const buf = Buffer.from(text, 'utf-8');
      await ctx.replyWithDocument({ source: buf, filename: `general_notes_${tgId}.txt` }, { caption: '📖 Общие заметки', ...(await getNotebookMenu(tgId)) });
    } else {
      await ctx.reply(`📖 Общие заметки:\n\n${text}`, await getNotebookMenu(tgId));
    }
  });

  // View entire notebook — compile from all sources
  bot.action('nb_all', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) { console.warn(e.message); }
    const tgId = ctx.from.id;
    await registerUser(tgId, ctx.from.username || ctx.from.first_name || 'Anonymous');

    // Compile full notebook from categorized_notes + user_notebooks (insights)
    const categorized = await db.getCategorizedNotes(tgId);
    const legacyNotebook = await db.getUserNotebook(tgId);
    
    let parts = [];

    // Insights from push-poll (stored in user_notebooks)
    if (legacyNotebook && legacyNotebook.trim()) {
      parts.push('📋 Инсайты с сессий:\n' + legacyNotebook);
    }

    // Speaker notes from categorized_notes
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

    // General notes from categorized_notes
    if (categorized.general.length > 0) {
      let gnText = '📝 Общие заметки:';
      categorized.general.forEach(n => { gnText += `\n  • ${n.text}`; });
      parts.push(gnText);
    }

    const fullText = parts.join('\n\n─────────────────────\n\n');
      
    if (!fullText || fullText.trim() === '') {
      return ctx.reply('📓 Ваш блокнот пока пуст.\n\nДобавляйте заметки через меню блокнота или отвечайте на пуш-опросы.', await getNotebookMenu(tgId));
    }
    
    if (fullText.length > 4000) {
      const buffer = Buffer.from(fullText, 'utf-8');
      await ctx.replyWithDocument({ source: buffer, filename: `notebook_${tgId}.txt` }, {
        caption: '📓 Весь блокнот (отправлен файлом)',
        ...(await getNotebookMenu(tgId))
      });
    } else {
      await ctx.reply(`📓 Весь блокнот:\n\n${fullText}`, await getNotebookMenu(tgId));
    }
  });
};
