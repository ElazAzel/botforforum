require('dotenv').config();
const { Telegram } = require('telegraf');
const db = require('./db');
const xlsx = require('xlsx');

const telegram = new Telegram(process.env.TELEGRAM_BOT_TOKEN);

module.exports = async (req, res) => {
  const method = req.method;
  const params = method === 'GET' ? req.query : req.body;
  const { action, admin_password, session_id, title, question } = params;

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
        insight_count: 0
      }));
      for (const s of result) {
        const notes = await db.getInsightsBySession(s.session_id);
        s.insight_count = notes.length;
      }
      result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
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
      const pollQuestion = question || 'Какие главные поинты вы выделили после этой встречи?';
      await db.saveSession(session_id, title, true);
      const users = await db.getAllUsers();
      if (!users || users.length === 0) {
        return res.json({ success: true, message: 'No users', sent: 0, total: 0 });
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
      return res.json({ success: true, sent, total: users.length });

    } else if (action === 'broadcast') {
      const { message, image_base64 } = params;
      if (!message) return res.status(400).json({ error: 'message required' });
      const users = await db.getAllUsers();
      if (!users || users.length === 0) {
        return res.json({ success: true, sent: 0, total: 0 });
      }
      let sent = 0;
      for (const user of users) {
        try {
          if (image_base64) {
            const buf = Buffer.from(image_base64, 'base64');
            await telegram.sendPhoto(user.tg_id, { source: buf, filename: 'image.jpg' }, { caption: message, parse_mode: 'Markdown' });
          } else {
            await telegram.sendMessage(user.tg_id, message, { parse_mode: 'Markdown' });
          }
          sent++;
        } catch (e) { console.error('broadcast failed:', user.tg_id, e.message); }
      }
      return res.json({ success: true, sent, total: users.length });

    } else if (action === 'delete_session') {
      if (!session_id) return res.status(400).json({ error: 'session_id required' });
      const deleted = await db.deleteSession(session_id);
      return res.json({ success: true, deleted });

    } else if (action === 'download_excel') {
      if (!session_id) return res.status(400).json({ error: 'session_id required' });
      const session = await db.getSession(session_id);
      const notes = await db.getInsightsBySession(session_id);
      if (!notes || notes.length === 0) {
        return res.status(404).json({ error: 'No insights' });
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
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="report_${session_id}.xlsx"`);
      return res.end(buf);

    } else {
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('Admin API error:', err);
    return res.status(500).json({ error: err.message });
  }
};
