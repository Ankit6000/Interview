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
$env:GROQ_API_KEY="your_key"
$env:GROQ_MODEL="llama-3.3-70b-versatile"
npm start
```

Or create a private `.env` file:

```env
GROQ_API_KEY=your_groq_key
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_FALLBACK_MODELS=llama-3.3-70b-versatile,deepseek-r1-distill-qwen-32b,qwen/qwen3-32b
OPENROUTER_API_KEY=your_key
OPENROUTER_MODEL=nvidia/nemotron-3-super-120b-a12b:free
GEMINI_API_KEY=your_google_ai_studio_key
GEMINI_TRANSCRIBE_MODELS=gemini-3.1-flash-lite-preview,gemini-2.5-flash-lite,gemini-2.5-flash
```

Never put the API key inside `public/app.js`; anything in `public/` is visible to users.

OpenRouter free model availability changes. If `deepseek/deepseek-r1:free` is unavailable, choose another current free DeepSeek model from OpenRouter and set `OPENROUTER_MODEL`.

Recommended free model order for this app:

1. Groq `llama-3.3-70b-versatile`
2. Groq `deepseek-r1-distill-qwen-32b`
3. Groq `qwen/qwen3-32b`
4. Groq `deepseek-r1-distill-llama-70b` if your account supports it
5. OpenRouter `nvidia/nemotron-3-super-120b-a12b:free`

## Voice Mode

Jelly uses your browser's built-in speech tools:

- Click **Jelly voice on** to let Jelly speak every question.
- Click **Start AI listening** to record an answer and transcribe it with Gemini.
- If `GEMINI_API_KEY` is missing, Jelly falls back to browser speech recognition.
- AI listening works on `localhost` and on HTTPS deployments.
- Use `GEMINI_TRANSCRIBE_MODELS` as a comma-separated fallback list. Jelly tries the first model, then falls back if a model is unavailable or quota-limited.

DeepSeek and Grok are different providers. Use `DEEPSEEK_API_KEY` for official DeepSeek, or `XAI_API_KEY` for xAI/Grok.

## Disclaimer

Jelly is for interview practice only. It does not provide legal advice and cannot guarantee visa approval.
