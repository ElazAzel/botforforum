require('dotenv').config();
const http = require('http');
const url = require('url');

const webhookHandler = require('./api/webhook');
const pushPollHandler = require('./api/push-poll');
const analyticsHandler = require('./api/analytics');
const setupHandler = require('./api/setup');
const adminHandler = require('./api/admin');

// Создаем сервер, симулирующий среду Vercel Serverless
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Обогащаем объект ответа методами Vercel
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  };
  res.send = (text) => {
    res.end(text);
  };

  // Чтение входящего тела запроса
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', async () => {
    if (body) {
      try {
        req.body = JSON.parse(body);
      } catch (e) {
        req.body = {};
      }
    } else {
      req.body = {};
    }
    
    // Передаем параметры URL (query params)
    req.query = parsedUrl.query;

    console.log(`[${new Date().toLocaleTimeString()}] [${req.method}] ${pathname}`);

    try {
      if (pathname === '/api/webhook') {
        await webhookHandler(req, res);
      } else if (pathname === '/api/push-poll') {
        await pushPollHandler(req, res);
      } else if (pathname === '/api/analytics') {
        await analyticsHandler(req, res);
      } else if (pathname === '/api/setup') {
        await setupHandler(req, res);
      } else if (pathname === '/api/admin') {
        await adminHandler(req, res);
      } else if (pathname === '/admin') {
        const fs = require('fs');
        const path = require('path');
        try {
          const html = fs.readFileSync(path.join(__dirname, 'public', 'admin.html'), 'utf-8');
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(html);
        } catch (err) {
          res.statusCode = 404;
          res.end('Admin page not found');
        }
      } else if (pathname === '/') {
        const fs = require('fs');
        const path = require('path');
        try {
          const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(html);
        } catch (err) {
          res.statusCode = 404;
          res.end('Not Found');
        }
      } else {
        res.statusCode = 404;
        res.end('Not Found');
      }
    } catch (err) {
      console.error('Ошибка сервера при обработке запроса:', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Локальный сервер запущен на http://localhost:${PORT}`);
  console.log(` - Вебхук Telegram: http://localhost:${PORT}/api/webhook`);
  console.log(` - Пуш-опросы (Admin): http://localhost:${PORT}/api/push-poll`);
  console.log(` - Аналитика и отчеты (Admin): http://localhost:${PORT}/api/analytics`);
  console.log(` - Установка вебхука: http://localhost:${PORT}/api/setup`);
  console.log(` - Админ-панель: http://localhost:${PORT}/admin`);
  console.log(` - Admin API: http://localhost:${PORT}/api/admin`);
  console.log(` - БД файл: db.json`);
});
