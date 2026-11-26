const test = require('node:test');
const assert = require('node:assert/strict');
const { validateInitData, signInitData } = require('../srv/lib/telegram');

function fields(extra) {
  return Object.assign({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAEtest',
    signature: 'ed25519-signature-value',
    user: JSON.stringify({
      id: 424242,
      first_name: 'Тест',
      username: 'tester',
      language_code: 'ru',
      photo_url: 'https://cdn.example.test/a.jpg',
      phone_number: '+79990000000'
    })
  }, extra || {});
}

test('synthetic initData: signature входит в проверку, лишние поля пользователя отбрасываются', () => {
  const token = 'test-bot-token-not-a-telegram-token';
  const init = signInitData(fields(), token);
  const ok = validateInitData(init, token, { maxAgeSec: 600 });
  assert.equal(ok.ok, true);
  assert.equal(ok.user.id, '424242');
  assert.equal(ok.user.first_name, 'Тест');
  assert.equal(ok.user.username, 'tester');
  assert.equal(ok.user.language_code, 'ru');
  assert.equal('photo_url' in ok.user, false);
  assert.equal('phone_number' in ok.user, false);
  assert.equal(validateInitData(init, token, { excludeSignature: true }).ok, false);
  assert.equal(validateInitData(init, 'other-token').ok, false);
  assert.equal(validateInitData(init, 'other-token').error, 'BAD_HASH');
});

test('порча любого поля, включая signature, даёт BAD_HASH', () => {
  const token = 'test-bot-token-not-a-telegram-token';
  const init = signInitData(fields(), token);
  const map = new URLSearchParams(init);
  for (const key of [...map.keys()]) {
    const tampered = new URLSearchParams(init);
    tampered.set(key, tampered.get(key) + 'x');
    const bad = validateInitData(tampered.toString(), token);
    assert.equal(bad.ok, false, key);
    assert.equal(bad.error, 'BAD_HASH', key);
  }
});

test('auth_date: 10 минут, час и 60 секунд в будущее', () => {
  const token = 'test-bot-token-not-a-telegram-token';
  const now = Date.now();
  const fresh = signInitData(fields({ auth_date: String(Math.floor(now / 1000) - 9 * 60) }), token);
  assert.equal(validateInitData(fresh, token, { now, maxAgeSec: 600 }).ok, true);
  const old10 = signInitData(fields({ auth_date: String(Math.floor(now / 1000) - 11 * 60) }), token);
  assert.equal(validateInitData(old10, token, { now, maxAgeSec: 600 }).error, 'EXPIRED');
  assert.equal(validateInitData(old10, token, { now, maxAgeSec: 3600 }).ok, true);
  const oldHour = signInitData(fields({ auth_date: String(Math.floor(now / 1000) - 61 * 60) }), token);
  assert.equal(validateInitData(oldHour, token, { now, maxAgeSec: 3600 }).error, 'EXPIRED');
  const future = signInitData(fields({ auth_date: String(Math.floor(now / 1000) + 61) }), token);
  assert.equal(validateInitData(future, token, { now, maxAgeSec: 3600 }).error, 'EXPIRED');
  const skew = signInitData(fields({ auth_date: String(Math.floor(now / 1000) + 30) }), token);
  assert.equal(validateInitData(skew, token, { now, maxAgeSec: 600 }).ok, true);
});

const requireReal = process.env.REQUIRE_REAL_INITDATA === '1';
const hasReal = !!(process.env.TG_REAL_INITDATA && process.env.TG_TEST_BOT_TOKEN);
test('реальный initData с signature', { skip: !requireReal && !hasReal }, () => {
  const real = process.env.TG_REAL_INITDATA || '';
  const token = process.env.TG_TEST_BOT_TOKEN || '';
  if (!real || !token) {
    console.info('fail');
    throw new Error('fail');
  }
  const authDate = Number(new URLSearchParams(real).get('auth_date'));
  const ok = validateInitData(real, token, { now: authDate * 1000, maxAgeSec: 600 });
  const dropped = validateInitData(real, token, { now: authDate * 1000, maxAgeSec: 600, excludeSignature: true });
  const pass = ok.ok === true && dropped.ok === false;
  console.info(pass ? 'ok' : 'fail');
  assert.equal(pass, true);
});

test('необязательный вектор test DC не пропускает сьют', () => {
  const extra = process.env.TG_REAL_INITDATA_TESTDC || '';
  const token = process.env.TG_TEST_BOT_TOKEN || '';
  if (!extra || !token) return;
  const authDate = Number(new URLSearchParams(extra).get('auth_date'));
  assert.equal(validateInitData(extra, token, { now: authDate * 1000 }).ok, true);
});
