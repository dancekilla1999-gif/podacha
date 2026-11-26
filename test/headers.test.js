const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

function applies(source, urlPath) {
  if (source === '/(.*)') return urlPath.startsWith('/');
  if (source === '/((?!tg/).*)') return /^\/(?!tg\/).*/.test(urlPath);
  if (source === '/app/:path*') return urlPath === '/app' || urlPath.startsWith('/app/');
  if (source === '/tg/:path*') return urlPath === '/tg' || urlPath.startsWith('/tg/');
  if (source === '/vendor/(.*)') return urlPath.startsWith('/vendor/');
  if (source === '/media/(.*)') return urlPath.startsWith('/media/');
  return false;
}

function headersFor(urlPath) {
  const out = {};
  for (const rule of cfg.headers) {
    if (!applies(rule.source, urlPath)) continue;
    for (const h of rule.headers) out[h.key.toLowerCase()] = h.value;
  }
  return out;
}

test('регион функций — fra1', () => {
  assert.deepEqual(cfg.regions, ['fra1']);
});

test('заголовки /tg/ и /app/ по vercel.json', async () => {
  const app = headersFor('/app/index.html');
  const tg = headersFor('/tg/');
  const root = headersFor('/');
  assert.equal(app['x-frame-options'], 'DENY');
  assert.match(app['content-security-policy'], /script-src 'self'/);
  assert.match(app['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(app['content-security-policy'].includes('unsafe-inline'), false);
  assert.equal(tg['x-frame-options'], undefined);
  assert.match(tg['content-security-policy'], /frame-ancestors https:\/\/web\.telegram\.org https:\/\/\*\.telegram\.org/);
  assert.match(tg['content-security-policy'], /script-src 'self' https:\/\/telegram\.org/);
  assert.equal(root['x-frame-options'], 'DENY');
  assert.equal(headersFor('/tg/')['x-frame-options'], undefined);
  assert.equal(headersFor('/tg/index.html')['x-frame-options'], undefined);

  const server = http.createServer((req, res) => {
    const h = headersFor(req.url);
    Object.keys(h).forEach((k) => res.setHeader(k, h[k]));
    res.end('ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  async function get(p) {
    const r = await fetch('http://127.0.0.1:' + port + p);
    await r.text();
    return r.headers;
  }
  const a = await get('/app/');
  const t = await get('/tg/');
  server.close();
  assert.equal(a.get('x-frame-options'), 'DENY');
  assert.match(a.get('content-security-policy'), /connect-src 'self' https:\/\/qozyihhlocvgpkchyqsp\.supabase\.co/);
  assert.equal(t.get('x-frame-options'), null);
  assert.match(t.get('content-security-policy'), /frame-ancestors https:\/\/web\.telegram\.org/);
  assert.equal(String(t.get('access-control-allow-credentials') || ''), '');
});
