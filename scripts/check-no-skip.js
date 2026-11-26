#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const text = fs.readFileSync(process.argv[2] || 'test-out.txt', 'utf8');
const m = text.match(/^# skipped (\d+)/m);
if (!m) {
  console.error('В выводе node --test нет строки «# skipped N»');
  process.exit(1);
}
if (m[1] !== '0') {
  console.error('Есть пропущенные тесты: ' + m[1]);
  process.exit(1);
}
console.log('skipped 0');
