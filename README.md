# Jelly F-1 Interview Coach

Jelly is a local web app for F-1 visa interview practice. It asks realistic visa-officer questions, follows up with cross-questions, and gives periodic feedback.

## Run

```powershell
npm start
```

Open `http://localhost:3000`.

## AI Provider

The app works without an API key using an offline question engine.

For AI responses, set one of these environment variables before running:

```powershell
$env:OPENROUTER_API_KEY="your_key"
$env:OPENROUTER_MODEL="nvidia/nemotron-3-super-120b-a12b:free"
npm start
```

Or create a private `.env` file:

```env
OPENROUTER_API_KEY=your_key
OPENROUTER_MODEL=nvidia/nemotron-3-super-120b-a12b:free
```

Never put the API key inside `public/app.js`; anything in `public/` is visible to users.

OpenRouter free model availability changes. If `deepseek/deepseek-r1:free` is unavailable, choose another current free DeepSeek model from OpenRouter and set `OPENROUTER_MODEL`.

Recommended free model order for this app:

1. `nvidia/nemotron-3-super-120b-a12b:free`
2. `deepseek/deepseek-v4-flash:free`
3. `deepseek/deepseek-r1:free`
4. `openai/gpt-oss-120b:free`
5. `openrouter/free`

## Voice Mode

Jelly uses your browser's built-in speech tools:

- Click **Jelly voice on** to let Jelly speak every question.
- Click **Start speaking** to dictate your answer.
- Speech input works best in Chrome or Edge on `localhost`.

DeepSeek and Grok are different providers. Use `DEEPSEEK_API_KEY` for official DeepSeek, or `XAI_API_KEY` for xAI/Grok.

## Disclaimer

Jelly is for interview practice only. It does not provide legal advice and cannot guarantee visa approval.
