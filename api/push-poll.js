require('dotenv').config();
const { Telegram } = require('telegraf');
const db = require('./db');

const telegram = new Telegram(process.env.TELEGRAM_BOT_TOKEN);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { session_id, title, question, admin_password } = req.body;

  // 1. Проверка пароля администратора
  if (!admin_password || admin_password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized: Invalid admin password' });
  }

  if (!session_id || !title) {
    return res.status(400).json({ error: 'Missing required parameters: session_id and title' });
  }

  const pollQuestion = question || 'Какие главные поинты вы выделите после этой встречи?';

  try {
    // 2. Сохраняем сессию в локальной БД как активную
    await db.saveSession(session_id, title, true);

    // 3. Получаем список всех зарегистрированных участников
    const users = await db.getAllUsers();

    if (!users || users.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No registered users found. Session set active, but no notifications were sent.'
      });
    }

    // 4. Переводим всех пользователей в режим ожидания ответа на эту сессию
    await db.updateAllUsersPendingSession(session_id);

    // 5. Производим параллельную отправку вопросов участникам
    const results = await Promise.allSettled(
      users.map(async (user) => {
        try {
          await telegram.sendMessage(
            user.tg_id,
            `📢 *Опрос по сессии: ${title}*\n\n${pollQuestion}\n\n_Пожалуйста, напишите ваш ответ ответным сообщением._`,
            { parse_mode: 'Markdown' }
          );
          return { tg_id: user.tg_id, success: true };
        } catch (err) {
          console.error(`Failed to send broadcast to user ${user.tg_id}:`, err.message);
          return { tg_id: user.tg_id, success: false, error: err.message };
        }
      })
    );

    const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failCount = users.length - successCount;

    return res.status(200).json({
      success: true,
      message: `Broadcasting completed. Success: ${successCount}, Failed: ${failCount}`,
      details: results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason })
    });

  } catch (error) {
    console.error('Push poll endpoint error:', error);
    return res.status(500).json({ error: error.message });
  }
};
