# Настройка Donation Queue Bot

## Шаг 1 — Установка зависимостей

```bash
cd donation-bot
npm install
```

## Шаг 2 — Telegram Bot Token

1. Откройте @BotFather в Telegram
2. Введите /newbot (или используйте существующий)
3. Скопируйте токен
> ⚠️ Текущий токен был показан публично — сбросьте его через /revoke в @BotFather!

## Шаг 3 — Google Sheets

### 3.1 Создайте Google Таблицу
1. Откройте sheets.google.com
2. Создайте новую таблицу
3. Назовите первый лист: `Donations`
4. Скопируйте ID таблицы из URL:
   `https://docs.google.com/spreadsheets/d/ВОТ_ЭТО_ID/edit`

### 3.2 Service Account (для доступа бота к таблице)
1. Откройте console.cloud.google.com
2. Создайте новый проект (или выберите существующий)
3. Включите "Google Sheets API":
   - API & Services → Enable APIs → поиск "Google Sheets API" → Enable
4. Создайте Service Account:
   - API & Services → Credentials → Create Credentials → Service Account
   - Дайте любое имя, нажмите Done
5. Откройте созданный Service Account → Keys → Add Key → JSON
6. Скачайте JSON файл и переименуйте в `credentials.json`
7. Положите `credentials.json` в папку `donation-bot/`
8. Скопируйте email сервисного аккаунта (выглядит как: name@project.iam.gserviceaccount.com)
9. В Google Таблице: Поделиться → вставьте этот email → роль "Редактор"

## Шаг 4 — Узнайте свой Telegram user_id (для админа)

Напишите боту @userinfobot в Telegram — он покажет ваш ID.

## Шаг 5 — Создайте .env файл

```bash
cp .env.example .env
```

Заполните `.env`:
```
BOT_TOKEN=ваш_токен_от_botfather
ADMIN_IDS=ваш_telegram_id
SPREADSHEET_ID=id_вашей_таблицы
SHEET_NAME=Donations
GOOGLE_CREDENTIALS_PATH=./credentials.json
```

## Шаг 6 — Запуск

```bash
npm start
```

Или в режиме разработки (с авто-перезапуском):
```bash
npm run dev
```

---

## Команды бота

### Для пользователей:
| Команда | Описание |
|---------|----------|
| /start  | Подать заявку на донацию |
| /status | Проверить свой статус |
| /queue  | Показать текущую очередь |
| /list   | Последние 10 одобренных донаций |
| /help   | Справка |

### Для администраторов:
| Команда | Описание |
|---------|----------|
| /approve <user_id> | Одобрить заявку |
| /reject <user_id>  | Отклонить заявку |
| /admin  | Список команд админа |

---

## Структура Google Таблицы

| user_id | name | amount | payment_method | proof_link | status | queue_position | created_at |
|---------|------|--------|---------------|------------|--------|----------------|------------|
| 123456  | Иван | 5000   | Kaspi         | https://.. | approved | 1            | 2024-01-01T... |

---

## Несколько администраторов

В `.env` укажите ID через запятую:
```
ADMIN_IDS=123456789,987654321,555444333
```
