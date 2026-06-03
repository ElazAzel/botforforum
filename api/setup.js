require('dotenv').config();
const axios = require('axios');

module.exports = async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return res.status(200).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN не настроен' });
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const webhookUrl = `${protocol}://${host}/api/webhook`;

  try {
    const secretToken = process.env.TELEGRAM_SECRET_TOKEN || 'mba_almau_forum_secret_token_2026';
    const response = await axios.post(
      `https://api.telegram.org/bot${token}/setWebhook`,
      { 
        url: webhookUrl,
        secret_token: secretToken
      }
    );

    try {
      await axios.post(
        `https://api.telegram.org/bot${token}/setMyCommands`,
        {
          commands: [
            { command: 'start', description: 'Запустить бота / Главное меню' },
            { command: 'program', description: 'Программа форума' },
            { command: 'speakers', description: 'Спикеры форума' },
            { command: 'notebook', description: 'Мой блокнот' },
            { command: 'menu', description: 'Главное меню' }
          ]
        }
      );
    } catch (cmdErr) {
      console.warn('Failed to set Telegram commands:', cmdErr.message);
    }

    const result = response.data;
    if (result.ok) {
      return res.status(200).json({ ok: true, success: true, message: 'Вебхук успешно установлен!', url: webhookUrl });
    } else {
      return res.status(200).json({ ok: false, success: false, error: result.description || 'Неизвестная ошибка Telegram API' });
    }
  } catch (err) {
    console.error('Setup error:', err.message);
    return res.status(200).json({ 
      ok: false, 
      success: false, 
      error: err.response?.data?.description || err.message 
    });
  }
};
