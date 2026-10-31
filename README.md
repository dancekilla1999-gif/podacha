# Подача

AI-тренер для официантов по меню

Кабинет: https://podacha-egor12.vercel.app/app/

Лендинг: https://podacha-egor12.vercel.app

Часть пакета **Трио** (https://trio-resto.vercel.app)

## Статус восстановления (31.10.2026)

- `app/index.html` — восстановлен с production Vercel
- Полный исходный код (все JS/CSS/fonts/media) лежит в архиве `podacha-full.zip` (скачан с Vercel)
- Чтобы получить полный рабочий проект — распакуй zip в корень репозитория и сделай commit

## Структура

```
index.html      — лендинг
app/            — кабинет (SPA)
  index.html
  core.js, owner.js, staff.js, team.js, content.js, agents-ui.js, guide.js, trio-bill.js
  app.css, trio-skin.css, agents.css
fonts/
css/
media/
```

## Локальный запуск

```bash
npx serve .
# кабинет: http://localhost:3000/app/
```

Backend: Supabase (`qozyihhlocvgpkchyqsp.supabase.co`).
