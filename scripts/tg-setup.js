#!/usr/bin/env node
// Ручная настройка бота. По умолчанию ничего не вызывает.
// Запуск человеком: TG_SETUP=1 TG_BOT_TOKEN=... PUBLIC_URL=https://... TELEGRAM_WEBHOOK_SECRET=... node scripts/tg-setup.js
'use strict';
if (process.env.TG_SETUP !== '1') {
  console.log('TG_SETUP is not 1 — Telegram API не вызывался. Для боевой настройки запустите с TG_SETUP=1.');
  process.exit(0);
}
const token = process.env.TG_BOT_TOKEN;
const base = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!token || !base || !secret) {
  console.error('Нужны TG_BOT_TOKEN, PUBLIC_URL и TELEGRAM_WEBHOOK_SECRET. Значения в чат не выводим.');
  process.exit(1);
}
const api = 'https://api.telegram.org/bot' + token + '/';
async function call(method, body) {
  const r = await fetch(api + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(function () { return {}; });
  if (!r.ok || data.ok === false) {
    console.error(method + ' failed');
    process.exit(1);
  }
}
(async function () {
  await call('setWebhook', { url: base + '/api/tg', secret_token: secret, allowed_updates: ['message'] });
  await call('setMyCommands', { commands: [
    { command: 'start', description: 'Начало' },
    { command: 'app', description: 'Открыть кабинет' },
    { command: 'help', description: 'Помощь' },
    { command: 'team', description: 'Обучение' },
    { command: 'plan', description: 'План на неделю' },
    { command: 'menu', description: 'Проверка меню' },
    { command: 'guest', description: 'ИИ-гость' }
  ] });
  await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Кабинет', web_app: { url: base + '/tg/' } } });
  console.log('Готово: вебхук, команды и кнопка меню. Проверьте getWebhookInfo и /start.');
})().catch(function () { console.error('setup failed'); process.exit(1); });
