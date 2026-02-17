# Telegram Calendar Bot

A Telegram bot that adds events to your Google Calendar. Send it event details in text or as a photo (invitation, flyer, screenshot), and it will create the event for you. Built with [Base44](https://base44.com).

## Features

- **Text**: Describe an event in natural language (“Dentist next Tuesday at 3pm”).
- **Images**: Send a photo of an invitation, flyer, or screenshot; the bot extracts details and creates the event.
- **Clarifications**: If something is missing or unclear, the bot asks before creating.

## Prerequisites

- Node.js 18+
- A [Base44](https://base44.com) account
- A Telegram bot token ([BotFather](https://t.me/BotFather))
- A Google account (for Calendar)

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/telegram-calendar-bot.git
cd telegram-calendar-bot
npm install
```

### 2. Base44 project

Install the Base44 CLI and log in:

```bash
npm install -g base44@latest
npx base44 login
```

Link this repo to a Base44 app (create a new app or link to an existing one):

```bash
# Create a new Base44 app and link
npx base44 link --create --name telegram-calendar-bot

# Or link to an existing project
npx base44 link --projectId YOUR_PROJECT_ID
```

### 3. Environment variables

Copy the example env file and set your values:

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | **Required.** From [@BotFather](https://t.me/BotFather): create a bot, then paste the token. |
| `GOOGLE_CALENDAR_ID` | **Required.** Your calendar ID. Use `primary` for your main Google calendar, or use the email/ID from [Google Calendar settings](https://calendar.google.com/calendar/r/settings) → your calendar → “Integrate calendar” → Calendar ID. |
| `TIMEZONE` | Optional. Timezone for new events (e.g. `America/New_York`, `Europe/London`). Default: `Asia/Jerusalem`. |

For **deployed** functions, set these in your Base44 project (e.g. in the dashboard under your app’s settings or function environment). Local runs use `.env`.

### 4. Google Calendar connector

The bot uses Base44’s Google Calendar connector for OAuth. Push the connector and complete authorization:

```bash
npx base44 connectors push
```

When prompted, sign in with the Google account that owns the calendar you use for `GOOGLE_CALENDAR_ID`.

### 5. Deploy to Base44

Deploy entities, functions, and connectors:

```bash
npx base44 deploy -y
```

Or deploy only what you need:

```bash
npx base44 entities push
npx base44 functions deploy
npx base44 connectors push   # if you haven’t authorized yet
```

After deployment, note the **webhook URL** for the `telegram-webhook` function (e.g. from the Base44 dashboard or CLI output).

### 6. Set the Telegram webhook

Tell Telegram to send updates to your webhook URL:

```bash
# Replace YOUR_BOT_TOKEN and YOUR_WEBHOOK_URL with your values
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=YOUR_WEBHOOK_URL"
```

Example:

```bash
curl -X POST "https://api.telegram.org/bot123456:ABC-DEF/setWebhook?url=https://your-app.base44.io/functions/telegram-webhook"
```

To clear the webhook (e.g. to stop receiving updates):

```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/deleteWebhook"
```

---

## Project structure

```
telegram-calendar-bot/
├── base44/
│   ├── config.jsonc          # Base44 project config
│   ├── entities/             # TelegramChat entity (conversation state)
│   ├── functions/
│   │   ├── telegram-webhook/  # Receives Telegram updates, calls LLM + Calendar
│   │   └── create-calendar-event/  # Optional; used by agent for creating events
│   ├── connectors/
│   │   └── googlecalendar.jsonc  # Google Calendar OAuth
│   └── agents/               # Optional agent configs
├── .env.example
├── .gitignore
└── README.md
```

---

## How it works

1. User sends a message or photo to the bot on Telegram.
2. Telegram sends an update to your `telegram-webhook` URL.
3. For photos: the bot downloads the image, uploads it to Base44, and uses vision to extract event details.
4. A prompt + (optionally) image or extracted text is sent to the Base44 LLM; it returns either `create_event`, `ask_clarification`, or `chat`.
5. If `create_event`: the webhook uses the Google Calendar connector to create the event and replies with a link.
6. Conversation state is stored in the `TelegramChat` entity for follow-up messages.

---

## Troubleshooting

- **“Bot token not configured”**  
  Set `TELEGRAM_BOT_TOKEN` in your Base44 app / function environment (or in `.env` when running locally).

- **“Couldn’t create event in Google Calendar”**  
  Ensure you’ve run `npx base44 connectors push` and completed Google sign-in. Check that `GOOGLE_CALENDAR_ID` is correct (use `primary` or the calendar’s ID from Google Calendar settings).

- **Webhook not receiving updates**  
  Confirm the webhook URL is set with `setWebhook` and that the URL is publicly reachable (HTTPS). Check Base44 function logs for errors.

- **Images not processed**  
  Ensure the `telegram-webhook` function has access to Base44 file upload and LLM/vision; check function logs for upload or API errors.

---

## License

MIT
