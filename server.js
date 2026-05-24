const http = require("http");
const fs = require("fs");
const path = require("path");

loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_TRANSCRIBE_MODELS = (
  process.env.GEMINI_TRANSCRIBE_MODELS ||
  process.env.GEMINI_TRANSCRIBE_MODEL ||
  "gemini-3.1-flash-lite-preview,gemini-2.5-flash-lite,gemini-2.5-flash"
)
  .split(",")
  .map(model => model.trim())
  .filter(Boolean);
const GROQ_FALLBACK_MODELS = (
  process.env.GROQ_FALLBACK_MODELS ||
  "llama-3.3-70b-versatile,deepseek-r1-distill-qwen-32b,qwen/qwen3-32b"
)
  .split(",")
  .map(model => model.trim())
  .filter(Boolean);

const providerConfigs = {
  groq: {
    baseUrl: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1/chat/completions",
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    headers: {}
  },
  openrouter: {
    baseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1/chat/completions",
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-super-120b-a12b:free",
    headers: {
      "HTTP-Referer": process.env.APP_URL || `http://localhost:${PORT}`,
      "X-Title": "Jelly F1 Interview Coach"
    }
  },
  deepseek: {
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/chat/completions",
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    headers: {}
  },
  xai: {
    baseUrl: process.env.XAI_BASE_URL || "https://api.x.ai/v1/chat/completions",
    apiKey: process.env.XAI_API_KEY,
    model: process.env.XAI_MODEL || "grok-4.1-fast",
    headers: {}
  }
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 12_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function safeJoin(base, target) {
  const targetPath = path.normalize(path.join(base, target));
  return targetPath.startsWith(base) ? targetPath : null;
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = safeJoin(PUBLIC_DIR, requestedPath);

  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(content);
  });
}

function buildSystemPrompt(profile) {
  return `You are Jelly, a realistic F-1 student visa interview practice officer.

Your job is interview practice, not legal advice. Be professional, concise, and a little strict. Ask one question at a time. Use the student's answers to ask probing follow-up questions, cross-questions, and consistency checks.

Interview goals:
- Check genuine student intent.
- Check program, university, and academic preparedness.
- Check funding clarity and sponsor credibility.
- Check ties to the home country and post-study plans.
- Check SEVIS/I-20 awareness, living plans, and basic visa readiness.

Question style:
- Start with direct F-1 visa interview questions.
- Start the session with standard static questions about purpose, university, program, funding, and return plans.
- After the warmup, freely choose the best next move: a standard question, a cross-question, a rapid-fire mini round, or a document/consistency check.
- Ask complex cross-questions whenever answers are vague, memorized, contradictory, too broad, or sound rehearsed.
- Use rapid-fire rounds occasionally: ask 2-3 short questions in one turn when the student is doing well or needs pressure practice.
- Keep each response short and interview-like.
- Do not reveal your scoring rubric, hidden reasoning, analysis, or labels like "Reason", "Static", "Cross-question", or "Rapid-fire" unless the student explicitly asks for feedback.
- Do not put stage directions, explanations, or non-spoken notes in parentheses or markdown.
- Do not guarantee approval or denial.
- Do not give scores, risk summaries, or overall feedback in the middle of the interview.
- If the student asks for feedback, give specific improvements and a stronger sample answer.
- Before moving to a new topic, ask at least one useful follow-up or cross-question inside the current topic when the student's answer is incomplete, vague, over-polished, or document-dependent.
- For funding, verify sponsor occupation, income, bank balance, liquid funds, loan/savings split, first-year cost, second-year plan, and supporting documents before moving on.
- For academics, verify specific course, prerequisite knowledge, project/background connection, why this university over alternatives, and why not study the same program at home before moving on.
- For home ties and post-study plans, verify specific target roles, companies or sector, family/property/career ties, and what the student will do if offered US employment.

Student profile:
Name: ${profile.name || "Not provided"}
University: ${profile.university || "Not provided"}
Program: ${profile.program || "Not provided"}
Degree level: ${profile.degreeLevel || "Not provided"}
Intake: ${profile.intake || "Not provided"}
Funding source: ${profile.funding || "Not provided"}
Sponsor: ${profile.sponsor || "Not provided"}
Home country/city: ${profile.home || "Not provided"}
Career goal: ${profile.goal || "Not provided"}
Prior education/work: ${profile.background || "Not provided"}

Begin or continue the interview naturally.`;
}

function buildReviewPrompt(profile) {
  return `You are Jelly, an F-1 visa interview coach. The interview has ended. Review the student's performance.

Output a structured review with:
1. Overall score out of 10.
2. Approval-readiness verdict: Strong, Borderline, or Risky.
3. Biggest strengths.
4. Biggest risks.
5. Answer-by-answer review. For each student answer, include:
   - What worked.
   - What was weak or risky.
   - One stronger sample answer sentence in the student's voice.
6. Top 5 next practice questions.

Be direct and practical. Keep the full review under 900 words. Do not guarantee visa approval or denial.

Student profile:
Name: ${profile.name || "Not provided"}
University: ${profile.university || "Not provided"}
Program: ${profile.program || "Not provided"}
Degree level: ${profile.degreeLevel || "Not provided"}
Intake: ${profile.intake || "Not provided"}
Funding source: ${profile.funding || "Not provided"}
Sponsor: ${profile.sponsor || "Not provided"}
Home country/city: ${profile.home || "Not provided"}
Career goal: ${profile.goal || "Not provided"}
Prior education/work: ${profile.background || "Not provided"}`;
}

async function callModel(payload) {
  const providerName = payload.provider || "openrouter";
  const config = providerConfigs[providerName];

  if (!config) {
    throw new Error("Unknown provider.");
  }

  if (!config.apiKey) {
    return {
      offline: true,
      message: makeOfflineResponse(payload)
    };
  }

  const request = {
    temperature: 0.55,
    messages: [
      { role: "system", content: buildSystemPrompt(payload.profile || {}) },
      ...(payload.messages || []).slice(-18)
    ]
  };

  const { json, fallbackModel, quotaLimited } = await callChatCompletionWithFallback(config, payload, request);

  if (quotaLimited) {
    return {
      offline: true,
      quotaLimited: true,
      message: makeOfflineResponse(payload)
    };
  }

  return {
    offline: false,
    fallbackModel,
    message: json.choices?.[0]?.message?.content || "I could not generate the next question. Please try again."
  };
}

async function callReviewModel(payload) {
  const providerName = payload.provider || "openrouter";
  const config = providerConfigs[providerName];

  if (!config?.apiKey) {
    return makeOfflineReview(payload);
  }

  const request = {
    temperature: 0.35,
    max_tokens: 1800,
    messages: [
      { role: "system", content: buildReviewPrompt(payload.profile || {}) },
      ...(payload.messages || []).slice(-28),
      { role: "user", content: "End the interview now and provide the full review." }
    ]
  };

  const { json, quotaLimited } = await callChatCompletionWithFallback(config, payload, request);

  if (quotaLimited) {
    return makeOfflineReview(payload);
  }

  return json.choices?.[0]?.message?.content || makeOfflineReview(payload);
}

async function callChatCompletionWithFallback(config, payload, request) {
  const models = getCandidateModels(payload.provider, payload.model || config.model, config.model);
  let lastError = "";

  for (const model of models) {
    const response = await fetch(config.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        ...config.headers
      },
      body: JSON.stringify({
        ...request,
        model
      })
    });

    if (response.ok) {
      return {
        json: await response.json(),
        fallbackModel: model !== (payload.model || config.model) ? model : undefined,
        quotaLimited: false
      };
    }

    const text = await response.text();
    if (isQuotaOrRateLimitError(response.status, text)) {
      return { json: null, quotaLimited: true };
    }

    lastError = cleanProviderError(response.status, text);
    if (!shouldTryNextModel(response.status, text)) {
      throw new Error(lastError);
    }
  }

  throw new Error(lastError || "No available model could answer right now.");
}

function getCandidateModels(providerName, selectedModel, defaultModel) {
  const models = [selectedModel, defaultModel];
  if (providerName === "groq") {
    models.push(...GROQ_FALLBACK_MODELS);
  }
  return [...new Set(models.filter(Boolean))];
}

function shouldTryNextModel(status, text) {
  return status === 400 && /model|decommission|not.*support|invalid|does not exist|not found/i.test(text);
}

async function transcribeWithGemini(payload) {
  if (!GEMINI_API_KEY) {
    throw new Error("Gemini listening is not configured. Add GEMINI_API_KEY to .env.");
  }

  const audioBase64 = payload.audioBase64;
  const mimeType = payload.mimeType || "audio/webm";
  if (!audioBase64) {
    throw new Error("No audio was received.");
  }

  const requestBody = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "Transcribe this F-1 visa interview answer. The speaker may have an Indian accent and may mention universities, sponsors, I-20, SEVIS, visa, funding, courses, or US cities. Return only the corrected transcript in first person. Do not add explanations."
          },
          {
            inline_data: {
              mime_type: mimeType,
              data: audioBase64
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 512
    }
  });

  let lastError = "";
  for (const model of GEMINI_TRANSCRIBE_MODELS) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody
      }
    );

    if (!response.ok) {
      const text = await response.text();
      lastError = `Gemini transcription error ${response.status} on ${model}: ${text.slice(0, 500)}`;
      if ([400, 401, 403].includes(response.status)) continue;
      if ([429, 503].includes(response.status)) continue;
      throw new Error(lastError);
    }

    const json = await response.json();
    const transcript = json.candidates?.[0]?.content?.parts?.map(part => part.text || "").join(" ").trim();
    if (transcript) {
      return {
        transcript: transcript.replace(/^["']|["']$/g, "").trim(),
        model
      };
    }

    lastError = `Gemini could not hear a clear answer with ${model}.`;
  }

  throw new Error(lastError || "Gemini could not transcribe the audio.");
}

const offlineQuestions = [
  "Why did you choose this university instead of a similar university in your home country?",
  "Why this specific program, and how does it connect to your past education?",
  "Who is paying for your studies, and what is their annual income?",
  "Can you explain your total first-year cost from the I-20 and how it will be covered?",
  "What other universities admitted or rejected you, and why did you choose this one?",
  "What will you do after graduation?",
  "Why should I believe you will return home after your studies?",
  "If you get a good job offer in the USA after graduation, what will you do?",
  "What subjects will you study in your first semester?",
  "Where will you live, and how much will it cost?",
  "What does your sponsor do, and why are they willing to fund you?",
  "Why not study in Canada, the UK, Australia, or your home country?",
  "How did you learn about this university?",
  "What is your backup plan if your visa is refused?",
  "Tell me about your academic gap or work experience, if any."
];

const crossQuestions = [
  "You said that earlier, but give me one specific example that proves it.",
  "That sounds memorized. Can you explain it in simpler words?",
  "Why is this answer not just a reason to immigrate permanently?",
  "What document can support what you just said?",
  "If your sponsor has other responsibilities, how can they afford this?",
  "How exactly will this degree help you in your home country?",
  "What makes this university stronger for your goal than the cheaper option?",
  "Your answer is broad. Name one course, professor, lab, or career outcome."
];

const rapidFireRounds = [
  "Quick round. What is your university name? What is your program? When does your course start?",
  "Rapid fire. Who is your sponsor? What is your first-year cost? How will you pay the second year?",
  "Short answers only. Why this university? Why this program? What will you do after graduation?",
  "Pressure round. What is your SEVIS fee status? Where will you live? Name one subject in your first semester."
];

function makeOfflineResponse(payload) {
  const messages = payload.messages || [];
  const studentAnswers = messages.filter(message => message.role === "user").length;
  const lastAnswer = [...messages].reverse().find(message => message.role === "user")?.content || "";
  const needsCross = lastAnswer.length < 80 || /\b(good|best|better|opportunity|future|dream|because|usa)\b/i.test(lastAnswer);

  if (studentAnswers > 2 && studentAnswers % 4 === 0) {
    return rapidFireRounds[studentAnswers % rapidFireRounds.length];
  }

  if (studentAnswers > 1 && needsCross) {
    return crossQuestions[studentAnswers % crossQuestions.length];
  }

  return offlineQuestions[studentAnswers % offlineQuestions.length];
}

function isQuotaOrRateLimitError(status, text) {
  return (
    status === 429 ||
    status === 402 ||
    /rate limit|quota|free-models-per-day|insufficient_quota|out of credits/i.test(text)
  );
}

function cleanProviderError(status, text) {
  if (isQuotaOrRateLimitError(status, text)) {
    return "The free AI quota is temporarily exhausted. Jelly will continue with built-in practice questions.";
  }

  if (status === 401 || status === 403) {
    return "The AI provider key was rejected. Please check the server environment variables.";
  }

  return `The AI provider returned an error (${status}). Please try again.`;
}

function makeOfflineReview(payload) {
  const answers = (payload.messages || []).filter(message => message.role === "user");
  const answerCount = answers.length;
  return `Overall score: ${answerCount >= 8 ? "7" : "6"}/10

Verdict: ${answerCount >= 8 ? "Borderline to strong" : "Borderline"}

Biggest strengths:
- You completed ${answerCount} answer${answerCount === 1 ? "" : "s"}.
- You are practicing under interview-style pressure.

Biggest risks:
- Some answers may need more specific documents, numbers, course names, and home-country plans.
- Funding and return intent usually need precise, confident answers.

Answer-by-answer review:
${answers.map((answer, index) => `${index + 1}. "${answer.content}"
What worked: You answered the question instead of avoiding it.
What was weak or risky: Make sure this answer includes specific evidence, not only general intention.
Stronger sample: I would answer with one clear reason, one supporting detail, and one document or concrete example.`).join("\n\n")}

Top 5 next practice questions:
1. Why this university over other admits?
2. Who is funding you, and what documents prove the funds?
3. What is your total first-year cost from the I-20?
4. What exact job or sector will you target after returning home?
5. What will you do if you receive a US job offer after graduation?`;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url.startsWith("/api/config")) {
    sendJson(res, 200, {
      providers: Object.fromEntries(
        Object.entries(providerConfigs).map(([name, config]) => [
          name,
          {
            configured: Boolean(config.apiKey),
            model: config.model,
            fallbackModels: name === "groq" ? GROQ_FALLBACK_MODELS : undefined
          }
        ])
      ),
      listening: {
        configured: Boolean(GEMINI_API_KEY),
        model: GEMINI_TRANSCRIBE_MODELS[0],
        fallbackModels: GEMINI_TRANSCRIBE_MODELS
      }
    });
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/transcribe")) {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const result = await transcribeWithGemini(payload);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, {
        error: error.message || "Unexpected transcription error."
      });
    }
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/chat")) {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const result = await callModel(payload);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, {
        error: error.message || "Unexpected server error."
      });
    }
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/review")) {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const review = await callReviewModel(payload);
      sendJson(res, 200, { review });
    } catch (error) {
      sendJson(res, 500, {
        error: error.message || "Unexpected review error."
      });
    }
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Jelly is running at http://localhost:${PORT}`);
});
