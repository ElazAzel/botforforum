require('dotenv').config();
const { Telegram } = require('telegraf');
const db = require('./db');
const xlsx = require('xlsx');

const telegram = new Telegram(process.env.TELEGRAM_BOT_TOKEN);

module.exports = async (req, res) => {
  const method = req.method;
  const params = method === 'GET' ? req.query : req.body;
  const { action, admin_password, session_id, title, question, admin_tg_id } = params;

  if (!admin_password || admin_password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (action === 'list_sessions') {
      const sessions = await db.getAllSessions();
      const result = sessions.map(s => ({
        session_id: s.session_id,
        title: s.title,
        is_active: !!s.is_active,
        created_at: s.created_at,
        insight_count: (db.getInsightsBySession ? 0 : 0)
      }));
      for (const s of result) {
        const notes = await db.getInsightsBySession(s.session_id);
        s.insight_count = notes.length;
      }
      return res.json({ success: true, sessions: result });

    } else if (action === 'get_insights') {
      if (!session_id) return res.status(400).json({ error: 'session_id required' });
      const session = await db.getSession(session_id);
      const notes = await db.getInsightsBySession(session_id);
      const enriched = await Promise.all(notes.map(async (n) => {
        const u = await db.getUserById(n.tg_id);
        return { ...n, username: u ? u.username : 'Anonymous' };
      }));
      return res.json({ success: true, session, insights: enriched });

    } else if (action === 'push_poll') {
      if (!session_id || !title) {
        return res.status(400).json({ error: 'session_id and title required' });
      }
      const pollQuestion = question || 'Какие главные поинты вы выделите после этой встречи?';
      await db.saveSession(session_id, title, true);
      const users = await db.getAllUsers();
      if (!users || users.length === 0) {
        return res.json({ success: true, message: 'No users', sent: 0 });
      }
      await db.updateAllUsersPendingSession(session_id);
      let sent = 0;
      for (const user of users) {
        try {
          await telegram.sendMessage(user.tg_id,
            `📢 *Опрос по сессии: ${title}*\n\n${pollQuestion}\n\n_Напишите ваш ответ._`,
            { parse_mode: 'Markdown' }
          );
          sent++;
        } catch (e) { console.error('send failed:', user.tg_id, e.message); }
      }
      return res.json({ success: true, message: `Sent to ${sent}/${users.length}`, sent, total: users.length });

    } else if (action === 'trigger_excel') {
      if (!session_id || !admin_tg_id) return res.status(400).json({ error: 'session_id and admin_tg_id required' });
      const session = await db.getSession(session_id);
      const notes = await db.getInsightsBySession(session_id);
      if (!notes || notes.length === 0) {
        await telegram.sendMessage(admin_tg_id, '⚠️ Нет инсайтов для экспорта.');
        return res.json({ success: true, message: 'No insights' });
      }
      const data = await Promise.all(notes.map(async (n, i) => {
        const u = await db.getUserById(n.tg_id);
        return { '№': i + 1, 'Telegram ID': n.tg_id, 'Username': u ? u.username : 'Anonymous', 'Инсайт': n.raw_insight, 'Время': new Date(n.timestamp).toISOString() };
      }));
      const ws = xlsx.utils.json_to_sheet(data);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Инсайты');
      ws['!cols'] = [{ wch: 5 }, { wch: 15 }, { wch: 20 }, { wch: 60 }, { wch: 25 }];
      const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      await telegram.sendDocument(admin_tg_id, { source: buf, filename: `report_${session_id}.xlsx` }, { caption: `📊 Excel: ${session ? session.title : session_id}` });
      return res.json({ success: true, message: 'Excel sent' });

    } else if (action === 'trigger_trends') {
      if (!session_id || !admin_tg_id) return res.status(400).json({ error: 'session_id and admin_tg_id required' });
      const session = await db.getSession(session_id);
      const notes = await db.getInsightsBySession(session_id);
      if (!notes || notes.length === 0) {
        await telegram.sendMessage(admin_tg_id, '⚠️ Нет инсайтов для анализа.');
        return res.json({ success: true, message: 'No insights' });
      }
      await telegram.sendMessage(admin_tg_id, `⏳ Анализирую ${notes.length} инсайтов...`);
      return res.json({ success: true, message: 'Analysis triggered, check Telegram' });

    } else {
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('Admin API error:', err);
    return res.status(500).json({ error: err.message });
  }
};
