# Подача

AI-тренер для официантов по меню

Кабинет (приложение): https://podacha-egor12.vercel.app/app/

Маркетинговая страница: https://podacha-egor12.vercel.app

Часть пакета **Трио** (https://trio-resto.vercel.app)

## Структура

```
index.html      — лендинг сервиса
app/            — кабинет (SPA на hash-роутинге)
  index.html
  *.js, *.css
fonts/
```

## Локальный запуск

```bash
npx serve .
# кабинет: http://localhost:3000/app/
```

Backend: Supabase (`qozyihhlocvgpkchyqsp.supabase.co`).
Оплата: API на trio-resto.
