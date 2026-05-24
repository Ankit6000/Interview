const chat = document.querySelector("#chat");
const chatForm = document.querySelector("#chatForm");
const profileForm = document.querySelector("#profileForm");
const messageInput = document.querySelector("#messageInput");
const providerSelect = document.querySelector("#provider");
const modelSelect = document.querySelector("#model");
const providerStatus = document.querySelector("#providerStatus");
const providerHint = document.querySelector("#providerHint");
const answerCount = document.querySelector("#answerCount");
const riskLevel = document.querySelector("#riskLevel");
const resetButton = document.querySelector("#resetButton");
const micButton = document.querySelector("#micButton");
const speakToggle = document.querySelector("#speakToggle");
const endInterviewButton = document.querySelector("#endInterviewButton");
const voiceStatus = document.querySelector("#voiceStatus");
const voiceSelect = document.querySelector("#voiceSelect");
const voiceRate = document.querySelector("#voiceRate");
const voicePitch = document.querySelector("#voicePitch");
const testVoiceButton = document.querySelector("#testVoiceButton");
const quickButtons = document.querySelectorAll(".chip");

let messages = [];
let providerConfig = {};
let recognition = null;
let isListening = false;
let shouldSpeak = true;
let availableVoices = [];
let useAiListening = false;
let mediaRecorder = null;
let mediaStream = null;
let audioChunks = [];
let sendAfterTranscription = false;
let interviewEnded = false;
let interviewStarted = false;

const openingQuestions = [
  "Good morning. Please pass me your passport and I-20. What is the purpose of your trip to the United States?",
  "Hello. Which university are you going to, and why did you choose that program?",
  "Good morning. Tell me briefly: why do you want to study in the United States now?",
  "Please step forward. What program have you been admitted to, and why is it important for your career?",
  "Good morning. Before we discuss documents, explain why you selected this university.",
  "Hello. What are you planning to study in the United States, and who is sponsoring you?",
  "Good morning. Give me a clear reason why this degree makes sense after your previous education.",
  "Please hand me your I-20. What is your university, your course, and your intake?"
];

const idleMessage = "Fill the profile on the left, then click Start interview when you are ready.";

function getProfile() {
  return Object.fromEntries(new FormData(profileForm).entries());
}

function addMessage(role, content) {
  const message = document.createElement("div");
  const isAssistant = role.startsWith("assistant");
  message.className = `message ${isAssistant ? "jelly" : role}`;
  const label = isAssistant ? "Jelly" : role === "user" ? "Student" : "Note";
  message.innerHTML = `<strong>${label}</strong>${escapeHtml(content)}`;
  chat.appendChild(message);
  chat.scrollTop = chat.scrollHeight;

  if (role === "assistant" && shouldSpeak) {
    speakText(content);
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateMetrics() {
  const count = messages.filter(message => message.role === "user").length;
  answerCount.textContent = String(count);
  riskLevel.textContent = count < 3 ? "Warmup" : count < 8 ? "Medium" : "High";
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    providerConfig = config.providers || {};
    useAiListening = Boolean(config.listening?.configured && navigator.mediaDevices && window.MediaRecorder);
  } catch {
    providerConfig = {};
    useAiListening = false;
  }
  updateProviderStatus();
  updateListeningStatus();
}

function updateProviderStatus() {
  const selected = providerSelect.value;
  const config = providerConfig[selected];
  syncModelChoiceToProvider(selected);
  if (config?.configured) {
    providerStatus.textContent = "Live";
    providerStatus.classList.add("live");
    providerHint.textContent = `Using ${modelSelect.value || config.model}. Your API key stays on the local server.`;
  } else {
    providerStatus.textContent = "Offline";
    providerStatus.classList.remove("live");
    providerHint.textContent = "No API key found. Jelly will use built-in F-1 questions and cross-questions.";
  }
}

function syncModelChoiceToProvider(provider) {
  const current = modelSelect.value;
  const isGroqModel =
    current.startsWith("qwen/") ||
    current.startsWith("llama-") ||
    current === "deepseek-r1-distill-qwen-32b" ||
    current === "deepseek-r1-distill-llama-70b" ||
    current === "openai/gpt-oss-120b";

  if (provider === "groq" && !isGroqModel) {
    modelSelect.value = "llama-3.3-70b-versatile";
  }
  if (provider === "openrouter" && isGroqModel) {
    modelSelect.value = "nvidia/nemotron-3-super-120b-a12b:free";
  }
}

async function sendToJelly(text) {
  if (!interviewStarted) {
    addMessage("system", "Click Start interview first so Jelly can begin like a visa officer.");
    return;
  }

  if (interviewEnded) {
    addMessage("system", "This interview has ended. Reset to start a new one.");
    return;
  }

  const trimmed = text.trim();
  if (isListening) {
    stopListening("Transcribing", true);
    return;
  }
  if (!trimmed) return;

  stopListening("Mic paused");
  messages.push({ role: "user", content: trimmed });
  addMessage("user", trimmed);
  updateMetrics();
  messageInput.value = "";

  if (isStopIntent(trimmed)) {
    addMessage("system", "Interview ended by student request. Jelly is preparing your review.");
    await endInterview({ skipNotice: true });
    return;
  }

  setLoading(true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: providerSelect.value,
        model: modelSelect.value,
        profile: getProfile(),
        messages
      })
    });

    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error || "Jelly could not respond.");
    }

    const reply = data.message;
    messages.push({ role: "assistant", content: reply });
    addMessage("assistant", reply);
    if (data.fallbackModel) {
      addMessage("system", `Selected model was unavailable, so Jelly used ${data.fallbackModel}.`);
    }
    if (data.quotaLimited) {
      addMessage("system", "Free AI quota is exhausted for now. Jelly switched to built-in practice mode.");
    }
    if (data.offline) {
      providerStatus.textContent = "Offline";
      providerStatus.classList.remove("live");
    }
  } catch (error) {
    addMessage("system", error.message);
  } finally {
    setLoading(false);
    updateMetrics();
  }
}

function isStopIntent(text) {
  return (
    /\b(stop|end|quit|finish|done)\b/i.test(text) ||
    /don'?t want to continue/i.test(text) ||
    /\bno\b.*\bcontinue\b/i.test(text)
  );
}

function startInterview() {
  if (interviewStarted && !interviewEnded) {
    addMessage("system", "The interview is already running.");
    return;
  }

  interviewStarted = true;
  interviewEnded = false;
  messages = [];
  chat.innerHTML = "";
  endInterviewButton.disabled = false;
  const opening = pickOpeningQuestion();
  messages.push({ role: "assistant", content: opening });
  addMessage("assistant", opening);
  updateMetrics();
}

function pickOpeningQuestion() {
  const profile = getProfile();
  const namedQuestions = [];

  if (profile.university && profile.program) {
    namedQuestions.push(`Good morning. I see you are going to ${profile.university} for ${profile.program}. Why did you choose this university?`);
    namedQuestions.push(`Please pass me your I-20. What makes ${profile.program} at ${profile.university} the right next step for you?`);
  }

  if (profile.funding || profile.sponsor) {
    namedQuestions.push("Good morning. Who is paying for your studies, and how will you prove the funds?");
  }

  const pool = [...namedQuestions, ...openingQuestions];
  const randomIndex = Math.floor(Math.random() * pool.length);
  return pool[randomIndex];
}

async function endInterview(options = {}) {
  if (interviewEnded) return;

  const answerCount = messages.filter(message => message.role === "user").length;
  if (answerCount === 0) {
    addMessage("system", "Answer at least one question before ending the interview.");
    return;
  }

  stopListening("Mic paused");
  window.speechSynthesis?.cancel();
  interviewEnded = true;
  setLoading(true);
  endInterviewButton.disabled = true;
  endInterviewButton.textContent = "Reviewing";
  if (!options.skipNotice) {
    addMessage("system", "Interview ended. Jelly is preparing your full review.");
  }

  try {
    const response = await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: providerSelect.value,
        model: modelSelect.value,
        profile: getProfile(),
        messages
      })
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error || "Could not generate review.");
    }

    messages.push({ role: "assistant", content: data.review });
    addMessage("assistant review", data.review);
  } catch (error) {
    addMessage("system", error.message);
    interviewEnded = false;
  } finally {
    setLoading(false);
    endInterviewButton.disabled = false;
    endInterviewButton.textContent = "End interview";
  }
}

function setLoading(isLoading) {
  const button = chatForm.querySelector(".primary");
  button.disabled = isLoading;
  button.textContent = isLoading ? "Jelly is thinking" : "Send answer";
}

function speakText(text) {
  if (!("speechSynthesis" in window)) {
    voiceStatus.textContent = "Voice output unavailable";
    return;
  }

  const spokenText = cleanSpokenText(text);
  if (!spokenText) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(spokenText);
  utterance.lang = "en-US";
  utterance.rate = Number(voiceRate.value || 0.9);
  utterance.pitch = Number(voicePitch.value || 0.98);
  utterance.volume = 1;

  const preferredVoice = getSelectedVoice();
  if (preferredVoice) {
    utterance.voice = preferredVoice;
    utterance.lang = preferredVoice.lang;
  }

  window.speechSynthesis.speak(utterance);
}

function loadVoices() {
  if (!("speechSynthesis" in window)) {
    voiceSelect.innerHTML = "<option>Voice unavailable</option>";
    voiceSelect.disabled = true;
    testVoiceButton.disabled = true;
    return;
  }

  availableVoices = window.speechSynthesis.getVoices();
  if (!availableVoices.length) return;

  const rankedVoices = [...availableVoices].sort((a, b) => scoreVoice(b) - scoreVoice(a));
  voiceSelect.innerHTML = rankedVoices
    .map(voice => `<option value="${escapeHtml(voice.name)}">${escapeHtml(voice.name)} (${escapeHtml(voice.lang)})</option>`)
    .join("");

  const savedVoice = localStorage.getItem("jellyVoiceName");
  if (savedVoice && rankedVoices.some(voice => voice.name === savedVoice)) {
    voiceSelect.value = savedVoice;
  } else {
    voiceSelect.value = rankedVoices[0].name;
  }
}

function scoreVoice(voice) {
  const name = voice.name.toLowerCase();
  const langScore = /^en[-_](us|gb|in|au)/i.test(voice.lang) ? 20 : 0;
  const naturalScore = /(natural|online|neural|aria|jenny|guy|sara|sonia|libby|ava|andrew|emma|brian|google|microsoft)/i.test(name) ? 40 : 0;
  const localPenalty = voice.localService ? 0 : 5;
  const roboticPenalty = /(david|zira|mark|desktop|compact)/i.test(name) ? -8 : 0;
  return langScore + naturalScore + localPenalty + roboticPenalty;
}

function getSelectedVoice() {
  return availableVoices.find(voice => voice.name === voiceSelect.value) || availableVoices[0];
}

function saveVoiceSettings() {
  localStorage.setItem("jellyVoiceName", voiceSelect.value);
  localStorage.setItem("jellyVoiceRate", voiceRate.value);
  localStorage.setItem("jellyVoicePitch", voicePitch.value);
}

function loadVoiceSettings() {
  const savedRate = localStorage.getItem("jellyVoiceRate");
  const savedPitch = localStorage.getItem("jellyVoicePitch");
  if (savedRate) voiceRate.value = savedRate;
  if (savedPitch) voicePitch.value = savedPitch;
}

function cleanSpokenText(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[[^\]]*]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/^\s*(reason|note|analysis|rubric)\s*:\s*.*$/gim, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function setupSpeechRecognition() {
  if (useAiListening) {
    updateListeningStatus();
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    micButton.disabled = true;
    micButton.textContent = "Mic unavailable";
    voiceStatus.textContent = "Use Chrome or Edge for speech input";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.continuous = true;

  recognition.onstart = () => {
    isListening = true;
    micButton.textContent = "Stop speaking";
    micButton.classList.add("recording");
    voiceStatus.textContent = "Listening";
    window.speechSynthesis?.cancel();
  };

  recognition.onresult = event => {
    let transcript = "";
    for (let index = 0; index < event.results.length; index += 1) {
      transcript += event.results[index][0].transcript;
    }
    messageInput.value = transcript.trim();
  };

  recognition.onerror = event => {
    voiceStatus.textContent = event.error === "not-allowed" ? "Mic permission blocked" : "Mic stopped";
  };

  recognition.onend = () => {
    isListening = false;
    micButton.textContent = "Start speaking";
    micButton.classList.remove("recording");
    if (voiceStatus.textContent === "Listening") {
      voiceStatus.textContent = "Mic ready";
    }
  };
}

function updateListeningStatus() {
  if (useAiListening) {
    micButton.disabled = false;
    micButton.textContent = "Start AI listening";
    voiceStatus.textContent = "Gemini listening ready";
  }
}

function pickAudioMimeType() {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg"
  ];
  return types.find(type => MediaRecorder.isTypeSupported(type)) || "";
}

async function startAiListening() {
  try {
    window.speechSynthesis?.cancel();
    audioChunks = [];
    sendAfterTranscription = false;
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    const mimeType = pickAudioMimeType();
    mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
    mediaRecorder.ondataavailable = event => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };
    mediaRecorder.onstop = () => {
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      cleanupMediaStream();
      transcribeAudio(blob, sendAfterTranscription);
    };
    mediaRecorder.start();
    isListening = true;
    micButton.textContent = "Stop and transcribe";
    micButton.classList.add("recording");
    voiceStatus.textContent = "AI listening";
  } catch (error) {
    voiceStatus.textContent = "Mic permission blocked";
    addMessage("system", error.message || "Could not start microphone.");
  }
}

function cleanupMediaStream() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
  }
  mediaStream = null;
}

function stopAiListening(statusText = "Transcribing", autoSend = false) {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;
  sendAfterTranscription = autoSend;
  voiceStatus.textContent = statusText;
  micButton.textContent = "Transcribing";
  micButton.classList.remove("recording");
  isListening = false;
  mediaRecorder.stop();
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function transcribeAudio(blob, autoSend) {
  if (blob.size < 1200) {
    voiceStatus.textContent = "No clear audio";
    micButton.textContent = "Start AI listening";
    return;
  }

  try {
    const audioBase64 = await blobToBase64(blob);
    const response = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mimeType: blob.type || "audio/webm",
        audioBase64
      })
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error || "AI listening failed.");
    }

    const transcript = data.transcript.trim();
    messageInput.value = transcript;
    voiceStatus.textContent = "Transcript ready";
    if (autoSend) {
      sendToJelly(transcript);
    }
  } catch (error) {
    voiceStatus.textContent = "AI listening failed";
    addMessage("system", error.message);
  } finally {
    micButton.textContent = "Start AI listening";
  }
}

function stopListening(statusText = "Mic ready", autoSend = false) {
  if (useAiListening) {
    stopAiListening(statusText, autoSend);
    return;
  }
  if (!recognition || !isListening) return;
  voiceStatus.textContent = statusText;
  recognition.stop();
}

function toggleListening() {
  if (useAiListening) {
    if (isListening) {
      stopAiListening();
    } else {
      startAiListening();
    }
    return;
  }

  if (!recognition) return;
  if (isListening) {
    stopListening();
  } else {
    window.speechSynthesis?.cancel();
    recognition.start();
  }
}

function toggleSpeaking() {
  shouldSpeak = !shouldSpeak;
  speakToggle.textContent = shouldSpeak ? "Jelly voice on" : "Jelly voice off";
  speakToggle.classList.toggle("active", shouldSpeak);
  if (!shouldSpeak) {
    window.speechSynthesis?.cancel();
  }
}

function resetSession() {
  window.speechSynthesis?.cancel();
  stopListening("Mic ready");
  interviewStarted = false;
  interviewEnded = false;
  endInterviewButton.disabled = false;
  endInterviewButton.textContent = "End interview";
  messages = [];
  chat.innerHTML = "";
  addMessage("system", idleMessage);
  updateMetrics();
}

chatForm.addEventListener("submit", event => {
  event.preventDefault();
  if (isListening) {
    stopListening("Transcribing", true);
    return;
  }
  stopListening("Mic paused");
  sendToJelly(messageInput.value);
});

messageInput.addEventListener("keydown", event => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    if (isListening) {
      stopListening("Transcribing", true);
      return;
    }
    stopListening("Mic paused");
    sendToJelly(messageInput.value);
  }
});

providerSelect.addEventListener("change", updateProviderStatus);
modelSelect.addEventListener("change", updateProviderStatus);
resetButton.addEventListener("click", resetSession);
micButton.addEventListener("click", toggleListening);
speakToggle.addEventListener("click", toggleSpeaking);
endInterviewButton.addEventListener("click", endInterview);
voiceSelect.addEventListener("change", saveVoiceSettings);
voiceRate.addEventListener("input", saveVoiceSettings);
voicePitch.addEventListener("input", saveVoiceSettings);
testVoiceButton.addEventListener("click", () => {
  speakText("Good morning. I am Jelly. Why did you choose this university for your F one visa?");
});

quickButtons.forEach(button => {
  button.addEventListener("click", () => {
    if (button.dataset.action === "start") {
      startInterview();
      return;
    }
    sendToJelly(button.dataset.prompt);
  });
});

loadConfig();
loadVoiceSettings();
loadVoices();
if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = loadVoices;
}
setupSpeechRecognition();
resetSession();
