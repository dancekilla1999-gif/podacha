#!/usr/bin/env node
// Одноразовое приглашение владельца. Пишет в ту базу, чей TEST_DATABASE_URL или DATABASE_URL задан.
// На боевой Supabase не запускать без отдельного решения. Секрет в вывод не попадает целиком в логи сервера:
// скрипт печатает только код приглашения и ссылку — это и есть то, что нужно передать человеку.
'use strict';
const db = require('../srv/lib/db');
if (!process.env.TG_SESSION_SECRET || !(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || process.env.SB_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
  console.error('Нужны TG_SESSION_SECRET и адрес базы (TEST_DATABASE_URL, DATABASE_URL или SB_SERVICE_KEY).');
  process.exit(1);
}
const base = (process.env.PUBLIC_URL || 'https://podacha-egor12.vercel.app').replace(/\/+$/, '');
db.service('pd_owner_invite_issue', { p_note: process.argv[2] || '', p_secret: process.env.TG_SESSION_SECRET })
  .then(function (row) {
    console.log(base + '/app/#/register/' + row.code);
    return db.close();
  })
  .catch(function () { console.error('Не удалось выдать приглашение'); process.exit(1); });
