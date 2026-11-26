const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('страница /tg/ без оплаты и без trio-bill', () => {
  const html = fs.readFileSync('public/tg/index.html', 'utf8');
  const js = fs.readFileSync('public/app/tg.js', 'utf8');
  const blob = html + '\n' + js;
  assert.equal(/trio-bill|yookassa|оплат|продл|guide\.js/i.test(blob), false);
  assert.equal(html.includes('Оплатить пакет'), false);
  assert.equal(html.includes('trio-resto'), false);
  assert.match(html, /telegram-web-app\.js/);
  assert.match(js, /Откройте в Telegram/);
  assert.match(js, /PD\.tg\.plan = d\.plan/);
  assert.match(fs.readFileSync('public/app/owner.js', 'utf8'), /Регистрация только по приглашению/);
  assert.equal(fs.readFileSync('public/app/guide.js', 'utf8').includes('appendChild(el("style"'), false);
  assert.match(fs.readFileSync('public/app/owner.js', 'utf8'), /\/api\/menu-fetch/);
});

test('прокси меню пускает только белый список', async () => {
  const handler = require('../api/menu-fetch');
  const res = await new Promise((resolve) => {
    const out = { statusCode: 0, setHeader() {}, end(s) { resolve({ status: out.statusCode, json: JSON.parse(s) }); } };
    handler({ method: 'GET', url: '/api/menu-fetch?url=' + encodeURIComponent('https://evil.example/menu.json'), query: {} }, out);
  });
  assert.equal(res.status, 400);
});
