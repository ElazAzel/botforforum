require('dotenv').config();
const axios = require('axios');

module.exports = async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN не настроен' });
  }

  // Автоматически определяем URL текущего деплоя Vercel
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const webhookUrl = `${protocol}://${host}/api/webhook`;

  try {
    // Устанавливаем вебхук в Telegram
    const secretToken = process.env.TELEGRAM_SECRET_TOKEN || 'mba_almau_forum_secret_token_2026';
    const response = await axios.post(
      `https://api.telegram.org/bot${token}/setWebhook`,
      { 
        url: webhookUrl,
        secret_token: secretToken
      }
    );

    // Устанавливаем меню команд в Telegram
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

    // Красивая HTML-страничка с результатом
    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>MBA AlmaU Impact Forum — Setup</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 600px; margin: 60px auto; padding: 20px; background: #0f172a; color: #e2e8f0; }
    .card { background: #1e293b; border-radius: 12px; padding: 30px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
    h1 { color: #38bdf8; margin-top: 0; }
    .status { padding: 12px 20px; border-radius: 8px; margin: 16px 0; font-weight: bold; }
    .ok { background: #064e3b; color: #6ee7b7; }
    .fail { background: #7f1d1d; color: #fca5a5; }
    code { background: #334155; padding: 3px 8px; border-radius: 4px; font-size: 14px; }
    .info { color: #94a3b8; font-size: 14px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🎓 MBA AlmaU Impact Forum</h1>
    <div class="status ${result.ok ? 'ok' : 'fail'}">
      ${result.ok ? '✅ Вебхук успешно установлен!' : '❌ Ошибка: ' + (result.description || 'Неизвестная ошибка')}
    </div>
    <p><strong>URL вебхука:</strong><br><code>${webhookUrl}</code></p>
    <p class="info">Теперь откройте Telegram, найдите вашего бота и отправьте команду <code>/start</code>.</p>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
