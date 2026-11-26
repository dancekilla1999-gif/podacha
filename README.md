# Подача

AI-тренер для официантов по меню

Кабинет: https://podacha-egor12.vercel.app/app/


## Структура (снято с production Vercel 04.11.2026)

```
public/          — сайт: лендинг + кабинет app/ (байт-в-байт как на проде)
api/*.js         — функции Vercel (обёртки над srv/api)
srv/             — серверный код: агенты, Telegram-бот, cron, интеграции
vercel.json      — cron, заголовки, таймауты
build.sh         — сборка (из файлов репо, либо из релиза в Supabase по release.txt/srv.txt)
```

Деплой на Vercel идёт из монорепозитория **dancekilla1999-gif/trio** (папка с тем же именем).
Секреты — только в переменных окружения Vercel, см. README в trio.

## Telegram Mini App

Кабинет в Telegram: `https://<домен>/tg/`. Сайт, Mini App и API — один origin.
Привязка: в кабинете «Настройки» → «Привязать Telegram» → ссылка `t.me/<бот>/app?startapp=l_<код>`.
Запасной путь — почта и пароль внутри Mini App. Регистрация только по одноразовой ссылке `/app/#/register/<код>`.

Миграция лежит в `sql/20261126_tg_auth.sql`. Её применяет человек после проверки. Из этого репозитория в боевую базу ничего не пишется.
Автотесты идут на локальном Postgres 17 (`docker compose up -d` или сервис в GitHub Actions), а не на боевом Supabase. Схема для пустой базы — `sql/schema_current.sql` (только для теста). Когда появится тестовый проект Supabase, те же тесты запускаются с `TEST_DATABASE_URL`.

```bash
docker compose up -d
export TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/podacha
npm test
```

Приглашение владельца выдаёт только платформенный админ с web-сессии (`platform_admin` или Telegram id из `ADMIN_TELEGRAM_IDS`). Роль в приглашении всегда `owner`. Скрипт: `OWNER_TOKEN=... ADMIN_TELEGRAM_IDS=... TG_SESSION_SECRET=... TEST_DATABASE_URL=... node scripts/owner-invite.js`

Бот настраивается вручную, деплой сам Bot API не вызывает (`TG_SETUP` по умолчанию не равен `1`):

```bash
TG_SETUP=1 TG_BOT_TOKEN=... PUBLIC_URL=https://podacha-egor12.vercel.app TELEGRAM_WEBHOOK_SECRET=... node scripts/tg-setup.js
```

В BotFather укажите ссылку на `/legal/telegram.html`, когда политику можно будет опубликовать. Реквизиты оператора (ИНН, адрес, почта) сюда не подставляются — их ещё нет.

### Переменные окружения

Имена, без значений. В Preview и в репозиторий их не кладём. Сервисный ключ боевой базы — только Production.

| Имя | Зачем |
|---|---|
| `TG_BOT_TOKEN` | токен бота, только сервер |
| `TG_BOT_USERNAME` | имя бота для ссылки и QR, без @ |
| `TELEGRAM_WEBHOOK_SECRET` | секрет заголовка вебхука |
| `TG_SESSION_SECRET` | дополнительный секрет функций сессии. После миграции то же значение один раз пишется в `app.server_secrets` ключом `tg_session_secret` |
| `TG_SESSION_SECRET_PREV` | предыдущий секрет на время ротации |
| `REFRESH_GRACE_KEY` | ключ AES-256-GCM, 32 байта в base64 или hex |
| `IP_SALT` | соль HMAC для IP в журнале |
| `SB_URL` | уже есть |
| `SB_KEY` | публичный ключ, уже есть |
| `SB_SERVICE_KEY` или `SUPABASE_SERVICE_ROLE_KEY` | сервисный ключ, только Production |
| `PUBLIC_URL` | origin кабинета |
| `ALERT_CHAT_ID` | служебный чат, в алерте только счётчики |
| `ADMIN_TELEGRAM_IDS` | Telegram id платформенного админа через запятую; выдача приглашений |
| `CRON_SECRET` | уже есть, для сессий не используется |
| `TG_SETUP` | `1` только когда человек запускает `scripts/tg-setup.js` |

Секреты CI, не Vercel: `TG_REAL_INITDATA`, `TG_TEST_BOT_TOKEN`, необязательный `TG_REAL_INITDATA_TESTDC`, `REQUIRE_REAL_INITDATA`.

Регион функций в `vercel.json`: `fra1`. Пока заголовок `x-vercel-id` с `fra1::` не снят с превью, в документах пишем: Vercel — США (по умолчанию iad1), Supabase — ЕС (Франкфурт).
