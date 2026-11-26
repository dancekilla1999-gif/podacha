const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('страница /tg/ без оплаты и без trio-bill', () => {
  const html = fs.readFileSync('public/tg/index.html', 'utf8');
  const js = fs.readFileSync('public/app/tg.js', 'utf8');
  const blob = html + '\n' + js;
  assert.equal(/trio-bill|yookassa|оплат|продл/i.test(blob), false);
  assert.match(html, /telegram-web-app\.js/);
  assert.equal(html.includes('trio-bill'), false);
  assert.match(js, /Откройте в Telegram/);
  assert.match(fs.readFileSync('public/app/owner.js', 'utf8'), /Регистрация только по приглашению/);
});
