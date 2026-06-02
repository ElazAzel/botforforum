require('dotenv').config();
const { Telegram } = require('telegraf');
const xlsx = require('xlsx');
const axios = require('axios');
const db = require('./db');

// Инициализация Telegram API клиента
const telegram = new Telegram(process.env.TELEGRAM_BOT_TOKEN);

// Утилита анализа трендов через DeepSeek API с поддержкой повторных попыток
async function runDeepSeekAnalysis(insightsText, sessionTitle) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY environment variable is not defined.');
  }

  const systemPrompt = `Ты — Смысловой Аналитик Meta-Harness. Перед тобой массив сырых инсайтов участников конференции по сессии "${sessionTitle}". Проведи глубокий мета-анализ:
1. Выдели ТОП-5 сквозных трендов (о чем говорят чаще всего).
2. Найди 3 уникальные, нестандартные или критические мысли, полезные для организаторов.
3. Сформируй список из 10 самых частотных концептуальных слов для облака тегов.

Ответ выдай строго в чистом Markdown-формате без вводных слов и приветствий.`;

  const url = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions';
  
  let retries = 3;
  let delay = 1000;

  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.post(
        url,
        {
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: insightsText }
          ],
          temperature: 0.2
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          timeout: 25000
        }
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response content from DeepSeek API');
      }

      return content;
    } catch (error) {
      const status = error.response?.status;
      if (status === 429 && i < retries - 1) {
        console.warn(`DeepSeek 429 rate limit hit. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      } else {
        console.error('Error calling DeepSeek API:', error.message);
        if (i === retries - 1) {
          throw error;
        }
      }
    }
  }
}

// Serverless-обработчик GET/POST запросов аналитики
module.exports = async (req, res) => {
  const method = req.method;
  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const params = method === 'GET' ? req.query : req.body;
  const { action, session_id, admin_tg_id, admin_password } = params;

  // 1. Проверка пароля администратора
  if (!admin_password || admin_password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized: Invalid admin password' });
  }

  if (!action || !session_id || !admin_tg_id) {
    return res.status(400).json({ error: 'Missing required parameters: action, session_id, admin_tg_id' });
  }

  try {
    // 2. Получаем данные сессии
    const session = await db.getSession(session_id);
    if (!session) {
      return res.status(404).json({ error: `Session not found in DB: ${session_id}` });
    }

    const sessionTitle = session.title;

    // Действие: Экспорт в Excel
    if (action === 'excel') {
      const notes = await db.getInsightsBySession(session_id);

      if (!notes || notes.length === 0) {
        await telegram.sendMessage(admin_tg_id, `⚠️ По сессии "${sessionTitle}" (${session_id}) пока нет сохраненных инсайтов для экспорта.`);
        return res.status(200).json({ success: true, message: 'No insights found to export.' });
      }

      // Сортировка инсайтов: сначала новые
      notes.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      // Форматирование данных для таблицы Excel с параллельным чтением пользователей из БД
      const formattedData = await Promise.all(
        notes.map(async (note, index) => {
          const user = await db.getUser(note.tg_id);
          return {
            '№': index + 1,
            'Telegram ID': note.tg_id || 'N/A',
            'Username': user ? (user.username || 'Anonymous') : 'Anonymous',
            'Инсайт': note.raw_insight,
            'Дата и время (UTC)': new Date(note.timestamp).toISOString()
          };
        })
      );

      // Генерация Excel-книги в памяти
      const worksheet = xlsx.utils.json_to_sheet(formattedData);
      const workbook = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(workbook, worksheet, 'Инсайты');

      // Настройка ширины колонок
      worksheet['!cols'] = [
        { wch: 5 },   // №
        { wch: 15 },  // Telegram ID
        { wch: 20 },  // Username
        { wch: 60 },  // Insight
        { wch: 25 }   // Time
      ];

      const excelBuffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      // Отправка файла администратору в Telegram
      await telegram.sendDocument(
        admin_tg_id,
        {
          source: excelBuffer,
          filename: `report_${session_id}.xlsx`
        },
        {
          caption: `📊 Excel-отчет по сессии:\n"${sessionTitle}" (${session_id})\nВсего инсайтов: ${notes.length}`
        }
      );

      return res.status(200).json({ success: true, message: 'Excel report compiled and sent.' });

    } else if (action === 'trends') {
      // Действие: ИИ-анализ трендов
      const notes = await db.getInsightsBySession(session_id);

      if (!notes || notes.length === 0) {
        await telegram.sendMessage(admin_tg_id, `⚠️ По сессии "${sessionTitle}" (${session_id}) нет инсайтов для ИИ-анализа.`);
        return res.status(200).json({ success: true, message: 'No insights found for AI analysis.' });
      }

      const insightsText = notes.map((note, index) => `${index + 1}. ${note.raw_insight}`).join('\n');

      await telegram.sendMessage(admin_tg_id, `⏳ Запускаю ИИ-анализ трендов по сессии "${sessionTitle}" (${notes.length} инс.)...`);

      // Запуск анализа через модель DeepSeek
      const analysisMarkdown = await runDeepSeekAnalysis(insightsText, sessionTitle);

      // Проверка размера текста: если превышает лимит Telegram (4096 символов), шлем файлом
      if (analysisMarkdown.length > 4000) {
        const docBuffer = Buffer.from(analysisMarkdown, 'utf-8');
        await telegram.sendDocument(
          admin_tg_id,
          {
            source: docBuffer,
            filename: `trends_${session_id}.md`
          },
          {
            caption: `🤖 ИИ-Анализ трендов по сессии: "${sessionTitle}"`
          }
        );
      } else {
        await telegram.sendMessage(
          admin_tg_id,
          `🤖 *Результаты ИИ-анализа трендов для сессии "${sessionTitle}":*\n\n${analysisMarkdown}`,
          { parse_mode: 'Markdown' }
        );
      }

      return res.status(200).json({ success: true, message: 'AI trend analysis completed and sent.' });

    } else {
      return res.status(400).json({ error: `Invalid action: ${action}. Use 'excel' or 'trends'.` });
    }

  } catch (error) {
    console.error('Analytics endpoint error:', error);
    return res.status(500).json({ error: error.message });
  }
};
