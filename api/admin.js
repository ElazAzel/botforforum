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
      
      // Parallel sending to avoid serverless execution timeouts
      const results = await Promise.allSettled(
        users.map(async (user) => {
          try {
            try {
              await telegram.sendMessage(user.tg_id,
                `📢 *Опрос по сессии: ${title}*\n\n${pollQuestion}\n\n_Напишите ваш ответ._`,
                { parse_mode: 'Markdown' }
              );
            } catch (markdownErr) {
              console.warn(`Markdown send failed for user ${user.tg_id}, retrying in plain text:`, markdownErr.message);
              const plainMsg = `📢 Опрос по сессии: ${title}\n\n${pollQuestion}\n\nНапишите ваш ответ.`;
              await telegram.sendMessage(user.tg_id, plainMsg);
            }
            return true;
          } catch (e) {
            console.error('send failed:', user.tg_id, e.message);
            return false;
          }
        })
      );
      const sent = results.filter(r => r.status === 'fulfilled' && r.value).length;
      return res.json({ success: true, sent, total: users.length });

    } else if (action === 'broadcast') {
      const { message, image_base64 } = params;
      if (!message) return res.status(400).json({ error: 'message required' });
      const users = await db.getAllUsers();
      if (!users || users.length === 0) {
        return res.json({ success: true, sent: 0, total: 0 });
      }
      
      // Parallel sending to avoid serverless execution timeouts
      const results = await Promise.allSettled(
        users.map(async (user) => {
          try {
            if (image_base64) {
              const buf = Buffer.from(image_base64, 'base64');
              try {
                await telegram.sendPhoto(user.tg_id, { source: buf, filename: 'image.jpg' }, { caption: message, parse_mode: 'Markdown' });
              } catch (markdownErr) {
                console.warn(`Broadcast photo Markdown send failed for user ${user.tg_id}, retrying in plain text:`, markdownErr.message);
                await telegram.sendPhoto(user.tg_id, { source: buf, filename: 'image.jpg' }, { caption: message });
              }
            } else {
              try {
                await telegram.sendMessage(user.tg_id, message, { parse_mode: 'Markdown' });
              } catch (markdownErr) {
                console.warn(`Broadcast message Markdown send failed for user ${user.tg_id}, retrying in plain text:`, markdownErr.message);
                await telegram.sendMessage(user.tg_id, message);
              }
            }
            return true;
          } catch (e) {
            console.error('broadcast failed:', user.tg_id, e.message);
            return false;
          }
        })
      );
      const sent = results.filter(r => r.status === 'fulfilled' && r.value).length;
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

      // Auto-fit column widths based on cell content
      const colWidths = [5, 15, 15, 40, 20];
      data.forEach(row => {
        const keys = Object.keys(row);
        keys.forEach((k, idx) => {
          const val = String(row[k] || '');
          if (val.length + 3 > colWidths[idx]) colWidths[idx] = val.length + 3;
        });
      });
      if (colWidths[3] > 80) colWidths[3] = 80;
      ws['!cols'] = colWidths.map(w => ({ wch: w }));

      // Force gridlines visibility
      if (!ws['!views']) ws['!views'] = [];
      ws['!views'][0] = { showGridLines: true };

      const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="report_${session_id}.xlsx"`);
      return res.end(buf);

    } else if (action === 'get_buttons') {
      const buttons = await db.getButtons();
      return res.json({ success: true, buttons });

    } else if (action === 'save_button') {
      const { id, text, type, parentId, row, content, url } = params;
      if (!id || !text || !type) {
        return res.status(400).json({ error: 'id, text, type are required' });
      }
      await db.saveButton({
        id,
        text,
        type,
        parentId: parentId || 'main',
        row: parseInt(row, 10) || 0,
        content: content || '',
        url: url || ''
      });
      return res.json({ success: true });

    } else if (action === 'delete_button') {
      const { button_id } = params;
      if (!button_id) return res.status(400).json({ error: 'button_id required' });
      const deleted = await db.deleteButton(button_id);
      return res.json({ success: true, deleted });

    } else if (action === 'diagnose') {
      let botInfo = null;
      let botError = null;
      try {
        botInfo = await telegram.getMe();
      } catch (err) {
        botError = err.message;
      }
      
      const dbUsers = await db.getAllUsers();
      const dbSessions = await db.getAllSessions();
      const dbInsights = await db.getAllInsightsRaw();

      let blobStatus = 'Disconnected';
      let blobFiles = [];
      let blobError = null;
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        blobStatus = 'Connected';
        try {
          const blobModule = require('@vercel/blob');
          const { blobs } = await blobModule.list();
          blobFiles = blobs.map(b => ({ pathname: b.pathname, size: b.size, url: b.url }));
        } catch (err) {
          blobError = err.message;
        }
      }

      return res.json({
        success: true,
        bot: {
          token_configured: !!process.env.TELEGRAM_BOT_TOKEN,
          info: botInfo,
          error: botError
        },
        database: {
          users_count: dbUsers.length,
          sessions_count: dbSessions.length,
          insights_count: dbInsights.length,
          users_list: dbUsers.map(u => ({ tg_id: u.tg_id, username: u.username, created_at: u.created_at }))
        },
        blob: {
          status: blobStatus,
          files: blobFiles,
          error: blobError
        }
      });

    } else if (action === 'test_send') {
      const { target_tg_id, test_message } = params;
      if (!target_tg_id) return res.status(400).json({ error: 'target_tg_id required' });
      const msgText = test_message || 'Тестовое сообщение от панели администратора бота MBA AlmaU Impact Forum.';
      try {
        await telegram.sendMessage(target_tg_id, msgText);
        return res.json({ success: true, message: 'Test message sent successfully!' });
      } catch (err) {
        return res.json({ success: false, error: err.message });
      }

    } else {
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('Admin API error:', err);
    return res.status(500).json({ error: err.message });
  }
};
