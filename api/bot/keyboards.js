const db = require('../db');
const { SPEAKER_NAMES } = require('./config');

const renderMenuKeyboard = async (tgId, parentId = 'main') => {
  try {
    const buttons = await db.getButtons();
    
    // Filter and sort buttons for this parent
    const levelButtons = buttons.filter(b => b.parentId === parentId);
    
    // Group by row
    const rowsMap = {};
    levelButtons.forEach(b => {
      const r = b.row !== undefined ? b.row : 0;
      if (!rowsMap[r]) rowsMap[r] = [];
      
      // Map to Telegram inline keyboard format
      const tb = { text: b.text };
      if (b.type === 'url') {
        tb.url = b.url;
      } else if (b.type === 'system') {
        tb.callback_data = b.content; // e.g. 'nb'
      } else {
        // submenu or text button
        tb.callback_data = 'menu_open_' + b.id;
      }
      rowsMap[r].push(tb);
    });
    
    // Sort rows and compile inline keyboard
    const inline_keyboard = [];
    const sortedRowKeys = Object.keys(rowsMap).sort((a, b) => Number(a) - Number(b));
    sortedRowKeys.forEach(r => {
      inline_keyboard.push(rowsMap[r]);
    });
    
    // Append back button if we are not at the main menu
    if (parentId !== 'main') {
      const currentParentBtn = buttons.find(b => b.id === parentId);
      let backCallback = 'main_menu';
      if (currentParentBtn && currentParentBtn.parentId !== 'main') {
        backCallback = 'menu_open_' + currentParentBtn.parentId;
      }
      inline_keyboard.push([{ text: '⬅️ Назад', callback_data: backCallback }]);
    }
    
    return { reply_markup: { inline_keyboard } };
  } catch (err) {
    console.error('Error rendering menu keyboard:', err);
    // Safe fallback static menu
    return {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📅 Программа', callback_data: 'program' }, { text: '🎤 Спикеры', callback_data: 'speakers' }],
          [{ text: '📓 Мой блокнот', callback_data: 'nb' }]
        ]
      }
    };
  }
};

const getMainMenu = async (tgId) => {
  return await renderMenuKeyboard(tgId, 'main');
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

const getNotebookMenu = async (tgId) => {
  let speakerCount = 0;
  let generalCount = 0;
  let totalCount = 0;
  if (tgId) {
    try {
      const categorized = await db.getCategorizedNotes(tgId);
      speakerCount = Object.values(categorized.speakers).reduce((sum, list) => sum + list.length, 0);
      generalCount = categorized.general.length;
      
      const legacyNotebook = await db.getUserNotebook(tgId);
      const hasInsights = legacyNotebook && legacyNotebook.trim() ? 1 : 0;
      const insightCount = hasInsights ? legacyNotebook.split('\n\n').filter(Boolean).length : 0;
      totalCount = speakerCount + generalCount + insightCount;
    } catch (e) {
      console.error('Error fetching notebook stats for menu:', e.message);
    }
  }

  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📝 Добавить заметку по спикеру', callback_data: 'nb_sp' }],
        [{ text: '📝 Общая заметка', callback_data: 'nb_gn' }],
        [{ text: `📖 По спикерам (${speakerCount})`, callback_data: 'nb_vsp' }],
        [{ text: `📖 Общие заметки (${generalCount})`, callback_data: 'nb_vgn' }],
        [{ text: `📖 Весь блокнот (${totalCount})`, callback_data: 'nb_all' }],
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

module.exports = {
  renderMenuKeyboard,
  getMainMenu,
  getProgramMenu,
  getNotebookMenu,
  getSpeakerKeyboard
};
