const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

test('l_ не привязывает чат отчётов, 18hex вызывает tg_bind, /start без кода — приветствие', async () => {
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      calls.push(Buffer.concat(chunks).toString('utf8'));
      res.end('{"ok":false}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  process.env.SB_URL = 'http://127.0.0.1:' + port;
  process.env.SB_KEY = 'test-publishable';
  process.env.CRON_SECRET = 'cron-test-secret';
  delete process.env.TG_BOT_TOKEN;
  delete require.cache[require.resolve('../srv/lib/sb')];
  delete require.cache[require.resolve('../srv/api/tg')];
  const handler = require('../srv/api/tg');
  assert.equal(handler.classifyStart('/start l_abcdefghijklmnopqrstuv').type, 'mini_link');
  assert.equal(handler.classifyStart('/start abcdef0123456789ab').type, 'report');
  assert.equal(handler.classifyStart('/start').type, 'welcome');
  assert.equal(handler.classifyStart('/app').type, 'welcome');
  const secret = crypto.createHash('sha256').update('tg:cron-test-secret').digest('hex').slice(0, 48);
  async function post(text) {
    await handler({
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': secret },
      body: { message: { chat: { id: 1, type: 'private', first_name: 'A' }, text } }
    }, {
      statusCode: 0,
      setHeader() {},
      end() {}
    });
  }
  await post('/start l_abcdefghijklmnopqrstuv');
  await post('/start');
  await post('/start abcdef0123456789ab');
  server.close();
  const bodies = calls.map((s) => s);
  assert.equal(bodies.some((b) => b.includes('l_abcdefghijklmnopqrstuv') && b.includes('tg_bind')), false);
  assert.equal(bodies.filter((b) => b.includes('tg_bind')).length, 1);
  assert.match(bodies.find((b) => b.includes('tg_bind')), /abcdef0123456789ab/);
});

test('TG_SETUP по умолчанию не вызывает setWebhook', async () => {
  const urls = [];
  const orig = global.fetch;
  global.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, text: async () => '[]', json: async () => [] };
  };
  delete process.env.TG_SETUP;
  process.env.CRON_SECRET = 'cron-test-secret';
  process.env.SB_URL = 'http://127.0.0.1:9';
  process.env.SB_KEY = 'test-publishable';
  delete require.cache[require.resolve('../srv/lib/sb')];
  delete require.cache[require.resolve('../srv/api/cron')];
  const cron = require('../srv/api/cron');
  const res = { statusCode: 0, headers: {}, setHeader() {}, end() {} };
  try {
    await cron({ method: 'GET', headers: { authorization: 'Bearer cron-test-secret' }, query: {} }, res);
  } catch (e) { /* база может не ответить на jobs — вебхук всё равно не зовём */ }
  global.fetch = orig;
  assert.equal(urls.some((u) => u.includes('setWebhook')), false);
});
