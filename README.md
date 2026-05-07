# Voicebot Backend

Standalone Express backend for the Centurion University voicebot.

## Setup

```bash
npm install
```

Update `.env`:

```env
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o-mini
```

## Run

```bash
npm start
```

Open:

```text
http://localhost:3000/
```

Test chat:

```bash
curl -X POST http://localhost:3000/chat ^
  -H "Content-Type: application/json" ^
  -d "{\"message\":\"What is Tarang?\"}"
```
