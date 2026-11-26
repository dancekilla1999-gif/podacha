const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test('в public нет токенов бота, сервисных ключей и initData', () => {
  const root = path.join(__dirname, '..', 'public');
  const files = walk(root, []);
  const bot = /\d{8,10}:[A-Za-z0-9_-]{35}/;
  const service = /sb_secret_|service_role|SUPABASE_SERVICE_ROLE/i;
  const initData = /auth_date=\d+&(?:.|&){0,200}hash=[0-9a-f]{64}/i;
  const hits = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (bot.test(text) || service.test(text) || initData.test(text)) hits.push(path.relative(root, file));
  }
  assert.deepEqual(hits, []);
});
