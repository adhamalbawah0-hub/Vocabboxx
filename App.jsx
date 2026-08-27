import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as mammoth from 'mammoth';
import {
  Home, Plus, RotateCcw, Settings as SettingsIcon, Volume2,
  Check, X, Flame, Target, Wifi, WifiOff, Download, Upload, Trash2,
  Loader2, ChevronRight, ChevronLeft, Lightbulb, Eye, RefreshCw,
  BookOpen, Sparkles, AlertTriangle, ArrowRight, Award,
  FileText, Type, Headphones, CheckCircle2, MessageSquareText, Layers,
  ChevronDown, ChevronUp, BookMarked, StopCircle,
  Mic, MessageCircle, Compass, Search, TrendingUp
} from 'lucide-react';

/* =========================================================================
   VocabBox — مفرداتي
   الجلسة 1: النواة الأساسية (كلمات، Leitner، مراجعة، نطق، حفظ دائم، لوحة تحكم)
   الجلسة 2: القصص (تحليل AI، تقسيم، قاموس تفاعلي، مفردات/عبارات القصة، اختبار)
   ========================================================================= */

/* ---------------------------- Design Tokens ---------------------------- */
const C = {
  bg: '#14120F',
  bgElevated: '#1B1814',
  card: '#211D18',
  cardAlt: '#28231D',
  border: '#3A342C',
  borderSoft: '#2A251F',
  text: '#EDE6DA',
  textMuted: '#A79C8C',
  textFaint: '#6E6558',
  gold: '#D4A24C',
  goldSoft: 'rgba(212,162,76,0.14)',
  green: '#74A788',
  greenSoft: 'rgba(116,167,136,0.14)',
  red: '#C1685A',
  redSoft: 'rgba(193,104,90,0.14)',
  blue: '#7C9CB8',
  blueSoft: 'rgba(124,156,184,0.14)',
};

const DEFAULT_SETTINGS = {
  leitnerIntervals: { 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 },
  dailyGoal: { type: 'words', value: 10 },
  audio: { voiceURI: '', rate: 1 },
  colors: { accent: C.gold, success: C.green, error: C.red },
  sessionSize: 10,
};

const AI_MODEL = 'claude-sonnet-4-6';

/* ------------------------------ Utilities ------------------------------- */
const todayKey = (d = new Date()) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};
const daysFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString();
const isDue = (iso) => !iso || new Date(iso).getTime() <= Date.now();
const uid = () => `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const normalizeKey = (w) => w.trim().toLowerCase().replace(/\s+/g, ' ');

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function normalizeArabic(str) {
  if (!str) return '';
  return str
    .trim()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىی]/g, 'ي')
    .replace(/[ؤئ]/g, 'ء')
    .replace(/[^\u0600-\u06FF0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function gradeArabicAnswer(userAnswer, acceptedList) {
  const norm = normalizeArabic(userAnswer);
  if (!norm) return { correct: false };
  for (const opt of acceptedList) {
    const nOpt = normalizeArabic(opt);
    if (!nOpt) continue;
    if (norm === nOpt) return { correct: true, matched: opt };
    const maxDist = nOpt.length > 5 ? 1 : 0;
    if (maxDist > 0 && Math.abs(norm.length - nOpt.length) <= 2 && levenshtein(norm, nOpt) <= maxDist) {
      return { correct: true, matched: opt, nearMiss: true };
    }
  }
  return { correct: false };
}

function gradeEnglishAnswer(userAnswer, correctWord) {
  const a = userAnswer.trim().toLowerCase();
  const b = correctWord.trim().toLowerCase();
  if (!a) return { correct: false };
  if (a === b) return { correct: true };
  if (a.length > 4 && levenshtein(a, b) <= 1) return { correct: true, nearMiss: true };
  return { correct: false };
}

function tokenizeWords(text) {
  return (text.toLowerCase().match(/[a-z']+/g) || []);
}

function gradeDictation(userText, correctText) {
  const userTokens = tokenizeWords(userText);
  const correctTokens = tokenizeWords(correctText);
  const userLeft = [...userTokens];
  const missingWords = [];
  const misspelledPairs = [];
  let correctCount = 0;

  for (const cw of correctTokens) {
    const exactIdx = userLeft.indexOf(cw);
    if (exactIdx !== -1) {
      correctCount++;
      userLeft.splice(exactIdx, 1);
      continue;
    }
    // look for a near-miss (typo) among remaining user words
    let bestIdx = -1, bestDist = 99;
    userLeft.forEach((uw, i) => {
      if (Math.abs(uw.length - cw.length) > 2) return;
      const d = levenshtein(uw, cw);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    if (bestIdx !== -1 && bestDist <= (cw.length >= 3 ? 2 : 1)) {
      misspelledPairs.push({ correct: cw, typed: userLeft[bestIdx] });
      userLeft.splice(bestIdx, 1);
    } else {
      missingWords.push(cw);
    }
  }
  const extraWords = userLeft;
  const score = correctTokens.length ? Math.round(((correctCount + misspelledPairs.length * 0.5) / correctTokens.length) * 100) : 0;
  return { score, correctCount, total: correctTokens.length, missingWords, extraWords, misspelledPairs };
}

/* ------------------------------ Storage (durable, offline-first) --------
   window.storage persists across sessions in this environment (the real
   equivalent of IndexedDB here — raw IndexedDB is not reliable inside the
   artifact sandbox, so this key/value store is the actual database layer). */
/* ------------------------------ Schema versioning & migrations ------------------------------
   No structural changes have been needed since v1. This scaffold exists so future sessions
   can add migration steps safely without ever deleting existing user data. */
const DB_SCHEMA_VERSION = 1;
async function runMigrations() {
  let stored = 0;
  try {
    const r = await window.storage.get('db-schema-version');
    stored = r ? parseInt(r.value) || 0 : 0;
  } catch { stored = 0; }
  if (stored >= DB_SCHEMA_VERSION) return;
  // Future migration steps go here, guarded by `if (stored < N) { ... }`, additive only.
  try { await window.storage.set('db-schema-version', String(DB_SCHEMA_VERSION)); } catch {}
}

const db = {
  async getSettings() {
    try {
      const r = await window.storage.get('settings');
      return r ? { ...DEFAULT_SETTINGS, ...JSON.parse(r.value) } : DEFAULT_SETTINGS;
    } catch { return DEFAULT_SETTINGS; }
  },
  async saveSettings(s) {
    await window.storage.set('settings', JSON.stringify(s));
  },
  async getWordsIndex() {
    try {
      const r = await window.storage.get('words-index');
      return r ? JSON.parse(r.value) : [];
    } catch { return []; }
  },
  async saveWordsIndex(list) {
    await window.storage.set('words-index', JSON.stringify(list));
  },
  async getWordDetail(id) {
    try {
      const r = await window.storage.get(`word-detail:${id}`);
      return r ? JSON.parse(r.value) : null;
    } catch { return null; }
  },
  async saveWordDetail(id, detail) {
    await window.storage.set(`word-detail:${id}`, JSON.stringify(detail));
  },
  async deleteWordDetail(id) {
    try { await window.storage.delete(`word-detail:${id}`); } catch {}
  },
  async getStreak() {
    try {
      const r = await window.storage.get('streak');
      return r ? JSON.parse(r.value) : { current: 0, best: 0, lastActiveDate: null, activeDates: [] };
    } catch { return { current: 0, best: 0, lastActiveDate: null, activeDates: [] }; }
  },
  async saveStreak(s) { await window.storage.set('streak', JSON.stringify(s)); },
  async getDailyStats(dateKey) {
    try {
      const r = await window.storage.get(`daily:${dateKey}`);
      return r ? JSON.parse(r.value) : { newWords: 0, reviews: 0, correct: 0, incorrect: 0 };
    } catch { return { newWords: 0, reviews: 0, correct: 0, incorrect: 0 }; }
  },
  async saveDailyStats(dateKey, stats) {
    await window.storage.set(`daily:${dateKey}`, JSON.stringify(stats));
  },
  async listDailyKeys() {
    try {
      const r = await window.storage.list('daily:');
      return r ? r.keys : [];
    } catch { return []; }
  },
  async getStoriesIndex() {
    try {
      const r = await window.storage.get('stories-index');
      return r ? JSON.parse(r.value) : [];
    } catch { return []; }
  },
  async saveStoriesIndex(list) {
    await window.storage.set('stories-index', JSON.stringify(list));
  },
  async getStoryDetail(id) {
    try {
      const r = await window.storage.get(`story-detail:${id}`);
      return r ? JSON.parse(r.value) : null;
    } catch { return null; }
  },
  async saveStoryDetail(id, detail) {
    await window.storage.set(`story-detail:${id}`, JSON.stringify(detail));
  },
  async deleteStoryDetail(id) {
    try { await window.storage.delete(`story-detail:${id}`); } catch {}
  },
  async getScenariosIndex() {
    try {
      const r = await window.storage.get('scenarios-index');
      return r ? JSON.parse(r.value) : {};
    } catch { return {}; }
  },
  async saveScenariosIndex(obj) {
    await window.storage.set('scenarios-index', JSON.stringify(obj));
  },
  async deleteAll() {
    const idx = await db.getWordsIndex();
    for (const w of idx) await db.deleteWordDetail(w.id);
    const stories = await db.getStoriesIndex();
    for (const s of stories) await db.deleteStoryDetail(s.id);
    const dailyKeys = await db.listDailyKeys();
    for (const k of dailyKeys) { try { await window.storage.delete(k); } catch {} }
    try { await window.storage.delete('words-index'); } catch {}
    try { await window.storage.delete('stories-index'); } catch {}
    try { await window.storage.delete('scenarios-index'); } catch {}
    try { await window.storage.delete('streak'); } catch {}
    try { await window.storage.delete('settings'); } catch {}
  },
};

/* ------------------------------ AI generation ---------------------------- */
const WORD_SCHEMA_KEYS = ['word', 'translation', 'acceptedTranslations', 'partOfSpeech', 'contextMeaning', 'pronunciation', 'examples', 'wordFamily', 'collocations'];

function validateWordData(obj) {
  if (!obj || typeof obj !== 'object') return false;
  for (const k of WORD_SCHEMA_KEYS) if (!(k in obj)) return false;
  if (!Array.isArray(obj.acceptedTranslations) || obj.acceptedTranslations.length < 1) return false;
  if (!Array.isArray(obj.examples) || obj.examples.length < 1) return false;
  if (!obj.examples.every(e => e && typeof e.english === 'string' && typeof e.arabic === 'string')) return false;
  if (!Array.isArray(obj.wordFamily)) return false;
  if (!Array.isArray(obj.collocations)) return false;
  if (typeof obj.translation !== 'string' || !obj.translation.trim()) return false;
  return true;
}

const FALLBACK_DICT = {
  protect: { word: 'protect', translation: 'يحمي', acceptedTranslations: ['يحمي', 'يصون'], partOfSpeech: 'verb', contextMeaning: 'يحمي شخصًا أو شيئًا من الضرر أو الخطر', pronunciation: 'prəˈtekt', examples: [{ english: 'Wear sunscreen to protect your skin.', arabic: 'ضع واقي الشمس لحماية بشرتك.' }, { english: 'This software protects your computer from viruses.', arabic: 'يحمي هذا البرنامج جهاز الكمبيوتر من الفيروسات.' }], wordFamily: ['protect', 'protection', 'protective', 'protected'], collocations: ['protect yourself', 'protect someone from', 'protect against'] },
  decide: { word: 'decide', translation: 'يقرر', acceptedTranslations: ['يقرر', 'يحسم'], partOfSpeech: 'verb', contextMeaning: 'يتخذ قرارًا بعد التفكير في الخيارات المتاحة', pronunciation: 'dɪˈsaɪd', examples: [{ english: 'I need to decide which job to take.', arabic: 'أحتاج أن أقرر أي وظيفة سآخذ.' }, { english: 'She decided to move to another city.', arabic: 'قررت الانتقال إلى مدينة أخرى.' }], wordFamily: ['decide', 'decision', 'decisive', 'decisively'], collocations: ['decide to do something', 'decide on', 'make a decision'] },
  achieve: { word: 'achieve', translation: 'يحقق', acceptedTranslations: ['يحقق', 'ينجز'], partOfSpeech: 'verb', contextMeaning: 'ينجح في الوصول إلى هدف بعد جهد', pronunciation: 'əˈtʃiːv', examples: [{ english: 'She worked hard to achieve her dream.', arabic: 'عملت بجد لتحقق حلمها.' }, { english: 'The team achieved great results this year.', arabic: 'حقق الفريق نتائج رائعة هذا العام.' }], wordFamily: ['achieve', 'achievement', 'achiever'], collocations: ['achieve a goal', 'achieve success', 'achieve results'] },
};

async function generateWordData(word) {
  const prompt = `أنت خبير لغوي. أعطني بيانات الكلمة الإنجليزية "${word}" بصيغة JSON فقط بدون أي نص إضافي وبدون علامات markdown، مطابقة تمامًا لهذا الشكل:
{
  "word": "الكلمة بصيغتها القاموسية الصحيحة (lowercase إن كانت اسمًا عاديًا)",
  "translation": "أشيع ترجمة عربية دقيقة",
  "acceptedTranslations": ["2 إلى 4 ترجمات عربية مقبولة"],
  "partOfSpeech": "noun|verb|adjective|adverb|...",
  "contextMeaning": "شرح المعنى بالعربية في جملة واحدة",
  "pronunciation": "النطق بصيغة IPA",
  "examples": [{"english": "جملة إنجليزية طبيعية", "arabic": "ترجمتها"}, {"english": "جملة إنجليزية ثانية مختلفة السياق", "arabic": "ترجمتها"}],
  "wordFamily": ["3 إلى 5 كلمات من نفس العائلة"],
  "collocations": ["3 إلى 5 تعبيرات شائعة تحتوي الكلمة"]
}
أعد JSON فقط، بدون أي شرح.`;

  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error('AI request failed');
  const data = await res.json();
  const text = (data.content || []).map(b => b.text || '').join('');
  const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(clean);
  if (!validateWordData(parsed)) throw new Error('Invalid schema');
  return parsed;
}

/* ------------------------------ Story text utilities ------------------------------- */
function splitIntoSentences(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const matches = clean.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g);
  return (matches || [clean]).map(s => s.trim()).filter(Boolean);
}

function autoPartCount(wordCount) {
  if (wordCount <= 120) return 1;
  const n = Math.round(wordCount / 150);
  return Math.min(8, Math.max(2, n));
}

function splitStoryIntoParts(text, numPartsOption) {
  const sentences = splitIntoSentences(text);
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const n = numPartsOption === 'auto' ? autoPartCount(wordCount) : Math.min(numPartsOption, sentences.length || 1);
  const perPart = Math.ceil(sentences.length / n) || 1;
  const parts = [];
  for (let i = 0; i < sentences.length; i += perPart) {
    parts.push(sentences.slice(i, i + perPart).join(' '));
  }
  return parts.length ? parts : [text];
}

function findOriginalSentence(word, partText) {
  const sentences = splitIntoSentences(partText);
  const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return sentences.find(s => re.test(s)) || sentences[0] || '';
}

function tokenizeForReading(text) {
  // splits text preserving whitespace/punctuation, tagging alphabetic tokens as clickable
  return text.split(/(\s+|[.,!?;:"'"()])/g).filter(t => t !== '');
}

/* ------------------------------ Story AI calls (max_tokens capped at 1000) ------------------------------- */
async function callClaudeJSON(prompt) {
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: AI_MODEL, max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error('AI request failed');
  const data = await res.json();
  const text = (data.content || []).map(b => b.text || '').join('');
  const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(clean);
}

async function estimateStoryLevel(text) {
  const snippet = text.slice(0, 900);
  const prompt = `حلل مستوى هذا النص الإنجليزي حسب معايير CEFR (A1,A2,B1,B2,C1) بناءً على المفردات والتراكيب. أعد JSON فقط بهذا الشكل بدون أي شرح إضافي:
{"level":"A1|A2|B1|B2|C1","theme":"موضوع النص بجملة عربية قصيرة"}
النص:
"""${snippet}"""`;
  try {
    const r = await callClaudeJSON(prompt);
    if (r && r.level) return r;
  } catch {}
  return { level: 'B1', theme: '' };
}

async function analyzePartVocabPhrasesQuiz(partText) {
  const prompt = `حلل هذا المقطع من قصة إنجليزية. استخرج المفردات المهمة (بحد أقصى 6 كلمات غير شائعة جدًا)، العبارات/التعبيرات الشائعة (بحد أقصى 3)، وأسئلة اختبار (3 أسئلة اختيار من متعدد بالعربية عن معنى المفردات أو فهم النص). لكل سؤال اختبار، إن كان يختبر إحدى الكلمات المستخرجة أضف اسمها في relatedWord (وإلا اجعلها null). أعد JSON فقط بهذا الشكل الدقيق بدون أي نص إضافي:
{
  "vocabulary": [{"word":"","translation":"","contextMeaning":"شرح عربي قصير","partOfSpeech":"","pronunciation":"IPA","classification":"essential|useful|advanced"}],
  "phrases": [{"phrase":"","meaning":"شرح عربي قصير","translation":""}],
  "quiz": [{"question":"سؤال بالعربية","options":["","","",""],"correctIndex":0,"relatedWord":null}]
}
المقطع:
"""${partText.slice(0, 1500)}"""`;
  return await callClaudeJSON(prompt);
}

async function generatePhraseDetail(phrase, originalSentence) {
  const prompt = `أعطني تفاصيل هذا التعبير الإنجليزي "${phrase}" بصيغة JSON فقط بدون أي شرح إضافي:
{"phrase":"${phrase}","meaning":"شرح المعنى بالعربية","explanation":"توضيح متى وكيف يُستخدم بجملة أو جملتين بالعربية","originalSentence":"${originalSentence.replace(/"/g, "'")}","originalTranslation":"ترجمة الجملة الأصلية","examples":[{"english":"","arabic":""},{"english":"","arabic":""}]}`;
  return await callClaudeJSON(prompt);
}

/* ------------------------------ Conversation AI ------------------------------- */
async function generateConversationTurn({ context, targetVocab, targetPhrases, history, userMessage }) {
  const vocabList = targetVocab.map(v => `${v.word} (${v.translation})`).join('، ') || 'لا يوجد';
  const phraseList = targetPhrases.map(p => `${p.phrase} (${p.meaning})`).join('، ') || 'لا يوجد';
  const histText = history.map(m => `${m.role === 'ai' ? 'AI' : 'Learner'}: ${m.text}`).join('\n') || '(بداية المحادثة)';
  const prompt = `أنت شريك محادثة إنجليزي ودود يساعد متعلمًا على ممارسة الإنجليزية في سياق: "${context}".
الكلمات المستهدفة التي يجب تشجيع المتعلم على استخدامها بشكل صحيح: ${vocabList}
العبارات المستهدفة: ${phraseList}
سجل المحادثة حتى الآن:
${histText}
${userMessage ? `آخر رسالة من المتعلم: "${userMessage}"` : 'لم يرسل المتعلم شيئًا بعد، ابدأ أنت المحادثة بسؤال طبيعي مرتبط بالسياق.'}

المطلوب:
1) ${userMessage ? 'صحح أخطاء رسالة المتعلم النحوية أو في المفردات إن وجدت بإيجاز شديد (وإلا اجعل hasError=false).' : 'لا يوجد تصحيح لأن المتعلم لم يتحدث بعد.'}
2) حدد تراكميًا (من كامل السجل + آخر رسالة) أي من الكلمات/العبارات المستهدفة استُخدم بشكل صحيح.
3) قدّم ردًا طبيعيًا قصيرًا (جملة أو جملتين) يواصل الحوار بشكل غير مكرر، ويشجّع بلطف على استخدام كلمة أو عبارة مستهدفة لم تُستخدم بعد إن أمكن.
أعد JSON فقط بهذا الشكل الدقيق بدون أي نص إضافي:
{"reply":"English message","correction":{"hasError":false,"original":"","better":"","why":""},"targetUsage":[{"term":"","used":false}]}`;
  return await callClaudeJSON(prompt);
}

async function generateScenarioStory(scenarioLabelAr, scenarioLabelEn) {
  const prompt = `اكتب قصة قصيرة بالإنجليزية (150-220 كلمة) واقعية تدور أحداثها في سياق "${scenarioLabelEn}" (${scenarioLabelAr})، تحتوي على مفردات وتعبيرات شائعة يحتاجها متعلم الإنجليزية في هذا الموقف. أعد JSON فقط بهذا الشكل بدون أي نص إضافي:
{"title":"عنوان عربي قصير للقصة","text":"القصة كاملة بالإنجليزية"}`;
  return await callClaudeJSON(prompt);
}

/* ------------------------------ Build & save a story from raw text (shared by AddStory + Scenarios) ------------------------------- */
async function buildAndSaveStory({ text, title, level, numParts, scenarioId, onProgress }) {
  let finalLevel = level;
  let theme = '';
  if (level === 'auto') {
    onProgress && onProgress('جارٍ تقدير مستوى القصة...');
    try {
      const est = await estimateStoryLevel(text);
      finalLevel = est.level;
      theme = est.theme || '';
    } catch { finalLevel = 'B1'; }
  }

  const rawParts = splitStoryIntoParts(text, numParts === 'auto' ? 'auto' : parseInt(numParts));
  const parts = [];
  let failedParts = 0;
  for (let i = 0; i < rawParts.length; i++) {
    onProgress && onProgress(`جارٍ تحليل الجزء ${i + 1} من ${rawParts.length}...`);
    let analysis = { vocabulary: [], phrases: [], quiz: [] };
    try {
      analysis = await analyzePartVocabPhrasesQuiz(rawParts[i]);
    } catch { failedParts++; }
    parts.push({
      id: uid(),
      title: `الجزء ${i + 1}`,
      content: rawParts[i],
      vocabulary: (analysis.vocabulary || []).map(v => ({ ...v, id: uid(), addedToBox: false })),
      phrases: (analysis.phrases || []).map(p => ({ ...p, id: uid(), detail: null })),
      quiz: analysis.quiz || [],
      progress: { reading: false, listening: false, vocabReviewed: false, quizDone: false, conversationDone: false, quizScore: null },
    });
  }

  const storyId = uid();
  const storyDetail = { id: storyId, title: title || 'قصة بدون عنوان', level: finalLevel, theme, originalText: text, createdAt: new Date().toISOString(), scenarioId: scenarioId || null, parts };
  await db.saveStoryDetail(storyId, storyDetail);

  const wordsCount = parts.reduce((sum, p) => sum + p.vocabulary.length, 0);
  const idx = await db.getStoriesIndex();
  await db.saveStoriesIndex([...idx, { id: storyId, title: storyDetail.title, level: finalLevel, partsCount: parts.length, completedParts: 0, wordsCount, createdAt: storyDetail.createdAt, scenarioId: scenarioId || null }]);

  return { ...storyDetail, failedParts };
}

/* ------------------------------ Scenarios ------------------------------- */
const SCENARIOS = [
  { id: 'airport', label: 'المطار', icon: '✈️', en: 'Airport' },
  { id: 'hotel', label: 'الفندق', icon: '🏨', en: 'Hotel' },
  { id: 'shopping', label: 'التسوق', icon: '🛒', en: 'Shopping' },
  { id: 'restaurant', label: 'المطعم', icon: '🍔', en: 'Restaurant' },
  { id: 'work', label: 'العمل', icon: '💼', en: 'Work' },
  { id: 'study', label: 'الدراسة', icon: '🎓', en: 'Study' },
  { id: 'technology', label: 'التقنية', icon: '💻', en: 'Technology' },
  { id: 'emergency', label: 'الطوارئ', icon: '🚑', en: 'Emergency' },
  { id: 'daily_life', label: 'الحياة اليومية', icon: '🏠', en: 'Daily Life' },
  { id: 'social', label: 'التواصل الاجتماعي', icon: '🤝', en: 'Social' },
];

/* ------------------------------ Learning Path & AI Coach (AI calls) ------------------------------- */
const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];

async function generateLevelStory(level) {
  const prompt = `اكتب قصة إنجليزية قصيرة أصلية (100-150 كلمة) بمستوى ${level} حسب معايير CEFR، عن موضوع يومي عشوائي وممتع ومناسب لمتعلم في هذا المستوى. أعد JSON فقط بدون أي نص إضافي:
{"title":"عنوان عربي قصير للقصة","text":"القصة كاملة بالإنجليزية فقط"}`;
  return await callClaudeJSON(prompt);
}

async function generateCoachStory(words, focusLabel) {
  const prompt = `اكتب قصة إنجليزية قصيرة ومترابطة (100-150 كلمة) بمستوى متوسط، تستخدم هذه الكلمات تحديدًا بشكل متكرر وطبيعي داخل السياق: ${words.join(', ')}. الهدف تثبيت هذه الكلمات في ذهن متعلم يجد صعوبة فيها. أعد JSON فقط بدون أي نص إضافي:
{"title":"عنوان عربي قصير","text":"القصة بالإنجليزية فقط"}`;
  return await callClaudeJSON(prompt);
}

async function generateCoachAdvice(summary) {
  const prompt = `أنت مدرب تعلم لغة إنجليزية ودود. بيانات المتعلم الحالية:
- إجمالي الكلمات: ${summary.total}
- كلمات ضعيفة: ${summary.weakCount} (أمثلة: ${summary.weakSample.join(', ') || 'لا يوجد'})
- دقة عامة: ${summary.accuracy}%
- سلسلة الأيام المتتالية: ${summary.streak}
- المستوى التقديري: ${summary.level}
- قصص قيد التقدم: ${summary.inProgressStories}
اكتب رسالة تحفيزية قصيرة بالعربية (جملة أو جملتين) بأسلوب مدرب شخصي، ثم اقترح إجراءً واحدًا مناسبًا. أعد JSON فقط بهذا الشكل:
{"message":"...","actionType":"weak_story|weak_session|new_level_story|scenario|none","actionLabel":"نص زر قصير بالعربية"}`;
  return await callClaudeJSON(prompt);
}

function estimateUserLevel(wordsIndex, storiesIndex) {
  const levelNum = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5 };
  const strongCount = wordsIndex.filter(w => ['قوية', 'متقنة'].includes(computeMastery(w).label)).length;
  const completed = storiesIndex.filter(s => s.partsCount > 0 && s.completedParts === s.partsCount);
  const avgStoryLevel = completed.length
    ? completed.reduce((sum, s) => sum + (levelNum[s.level] || 2), 0) / completed.length
    : 1;
  const wordScore = Math.min(5, 1 + strongCount / 40);
  const blended = wordScore * 0.5 + avgStoryLevel * 0.5;
  const idx = Math.min(4, Math.max(0, Math.round(blended) - 1));
  return CEFR_LEVELS[idx];
}

/* ------------------------------ Skill tracking & Mastery ------------------------------- */
const SKILL_DEFS = [
  { key: 'meaning', label: 'المعنى', weight: 15 },
  { key: 'reading', label: 'القراءة', weight: 10 },
  { key: 'listening', label: 'الاستماع', weight: 15 },
  { key: 'pronunciation', label: 'النطق', weight: 10 },
  { key: 'writing', label: 'الكتابة', weight: 10 },
  { key: 'context', label: 'السياق', weight: 15 },
  { key: 'conversation', label: 'المحادثة', weight: 15 },
  { key: 'review', label: 'المراجعة', weight: 10 },
];

function emptySkills() {
  const s = {};
  for (const d of SKILL_DEFS) s[d.key] = { correct: 0, total: 0 };
  return s;
}

function bumpSkillOnEntry(entry, skillKeys, isCorrect) {
  if (!entry.skills) entry.skills = emptySkills();
  const keys = Array.isArray(skillKeys) ? skillKeys : [skillKeys];
  for (const k of keys) {
    if (!entry.skills[k]) entry.skills[k] = { correct: 0, total: 0 };
    entry.skills[k].total += 1;
    if (isCorrect) entry.skills[k].correct += 1;
  }
  return entry;
}

async function bumpWordSkill(wordId, skillKeys, isCorrect) {
  const idx = await db.getWordsIndex();
  const entry = idx.find(w => w.id === wordId);
  if (!entry) return;
  bumpSkillOnEntry(entry, skillKeys, isCorrect);
  await db.saveWordsIndex(idx);
}

function computeMastery(entry) {
  const skills = entry.skills || emptySkills();
  const reviewScore = (entry.reviewCount || 0) > 0
    ? Math.min(100, (entry.stage || 0) / 5 * 70 + ((entry.correctCount || 0) / Math.max(1, entry.reviewCount)) * 30)
    : null;
  let weightedSum = 0, weightTotal = 0;
  const perSkill = {};
  for (const d of SKILL_DEFS) {
    if (d.key === 'review') {
      if (reviewScore !== null) { weightedSum += reviewScore * d.weight; weightTotal += d.weight; perSkill[d.key] = Math.round(reviewScore); }
      else perSkill[d.key] = null;
      continue;
    }
    const s = skills[d.key];
    if (s && s.total > 0) {
      const score = Math.round((s.correct / s.total) * 100);
      perSkill[d.key] = score;
      weightedSum += score * d.weight;
      weightTotal += d.weight;
    } else {
      perSkill[d.key] = null;
    }
  }
  const overall = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;
  let label = 'جديدة';
  if (overall >= 95) label = 'متقنة';
  else if (overall >= 80) label = 'قوية';
  else if (overall >= 60) label = 'مألوفة';
  else if (overall >= 40) label = 'قيد التعلم';
  return { overall, label, perSkill };
}

/* ------------------------------ Shared: add word to VocabBox from anywhere ------------------------------- */
async function addWordToBox(rawWord, opts = {}) {
  const nk = normalizeKey(rawWord);
  const idx = await db.getWordsIndex();
  const existing = idx.find(w => w.normalizedKey === nk);
  if (existing) return { status: 'duplicate', entry: existing };

  const id = uid();
  let detail = null;
  let genStatus = 'ready';
  try {
    detail = await generateWordData(rawWord);
  } catch {
    detail = FALLBACK_DICT[nk] || null;
    if (!detail) {
      detail = { word: rawWord, translation: opts.fallbackTranslation || '', acceptedTranslations: opts.fallbackTranslation ? [opts.fallbackTranslation] : [], partOfSpeech: opts.fallbackPOS || '', contextMeaning: opts.fallbackContext || '', pronunciation: opts.fallbackPronunciation || '', examples: [], wordFamily: [], collocations: [] };
      genStatus = detail.translation ? 'ready' : 'pending';
    }
  }
  await db.saveWordDetail(id, detail);
  const entry = {
    id, word: detail.word || rawWord, normalizedKey: nk, translation: detail.translation || '',
    stage: 0, lastReviewedAt: null, nextReviewAt: new Date().toISOString(),
    reviewCount: 0, correctCount: 0, incorrectCount: 0, hintsUsed: 0,
    createdAt: new Date().toISOString(), genStatus, skills: emptySkills(),
    sourceStoryId: opts.storyId || null, sourceStoryTitle: opts.storyTitle || null,
  };
  const updated = [...idx, entry];
  await db.saveWordsIndex(updated);
  const dk = todayKey();
  const ds = await db.getDailyStats(dk);
  ds.newWords += 1;
  await db.saveDailyStats(dk, ds);
  return { status: genStatus, entry, detail };
}

/* ------------------------------ Speech ------------------------------- */
function useVoices() {
  const [voices, setVoices] = useState([]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices().filter(v => v.lang?.toLowerCase().startsWith('en')));
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);
  return voices;
}

function speak(text, { rate = 1, voiceURI = '' } = {}) {
  if (!('speechSynthesis' in window)) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = rate;
    if (voiceURI) {
      const v = window.speechSynthesis.getVoices().find(v => v.voiceURI === voiceURI);
      if (v) u.voice = v;
    }
    window.speechSynthesis.speak(u);
    return true;
  } catch { return false; }
}
const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

/* ------------------------------ Small UI atoms ------------------------------- */
function EnglishText({ children, className = '', style = {} }) {
  return <span dir="ltr" className={className} style={{ unicodeBidi: 'isolate', fontFamily: "'Spectral', serif", ...style }}>{children}</span>;
}

function Toast({ toast }) {
  if (!toast) return null;
  const colorMap = { success: C.green, error: C.red, info: C.blue };
  return (
    <div style={{
      position: 'fixed', bottom: 88, left: '50%', transform: 'translateX(-50%)',
      background: C.cardAlt, border: `1px solid ${C.border}`, color: C.text,
      padding: '10px 18px', borderRadius: 12, fontSize: 14, zIndex: 100,
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', gap: 8,
      maxWidth: '90vw',
    }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: colorMap[toast.type] || C.gold, flexShrink: 0 }} />
      {toast.msg}
    </div>
  );
}

function ConfirmModal({ open, title, body, confirmLabel = 'تأكيد', danger, onConfirm, onCancel, requireText }) {
  const [text, setText] = useState('');
  useEffect(() => { if (open) setText(''); }, [open]);
  if (!open) return null;
  const disabled = requireText ? text !== requireText : false;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '20px 20px 0 0', padding: 20, width: '100%', maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          {danger && <AlertTriangle size={18} color={C.red} />}
          <h3 style={{ fontFamily: "'Cairo', sans-serif", fontWeight: 700, fontSize: 17, color: C.text, margin: 0 }}>{title}</h3>
        </div>
        <p style={{ color: C.textMuted, fontSize: 14, lineHeight: 1.7, marginBottom: 14 }}>{body}</p>
        {requireText && (
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={requireText}
            dir="ltr"
            style={{ width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', color: C.text, marginBottom: 14, fontFamily: "'JetBrains Mono', monospace" }}
          />
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '11px 0', borderRadius: 12, background: C.cardAlt, border: `1px solid ${C.border}`, color: C.text, fontFamily: "'Cairo', sans-serif", fontWeight: 600 }}>إلغاء</button>
          <button onClick={onConfirm} disabled={disabled} style={{ flex: 1, padding: '11px 0', borderRadius: 12, background: disabled ? C.borderSoft : (danger ? C.red : C.gold), border: 'none', color: disabled ? C.textFaint : '#14120F', fontFamily: "'Cairo', sans-serif", fontWeight: 700, opacity: disabled ? 0.6 : 1 }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Word detail display ------------------------------- */
function WordFullCard({ detail, settings, compact, wordId }) {
  if (!detail) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <EnglishText style={{ fontSize: compact ? 26 : 32, fontWeight: 600, color: C.text }}>{detail.word}</EnglishText>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => speak(detail.word, settings.audio)} style={iconBtnStyle}>
            <Volume2 size={18} color={C.gold} />
          </button>
          <PronunciationCheck word={detail.word} wordId={wordId} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: C.textFaint, fontFamily: "'JetBrains Mono', monospace" }} dir="ltr">/{detail.pronunciation}/</span>
        <span style={pillStyle(C.blueSoft, C.blue)}>{detail.partOfSpeech}</span>
      </div>
      <div style={{ fontSize: 20, color: C.gold, fontFamily: "'Cairo', sans-serif", fontWeight: 700 }}>{detail.translation}</div>
      <div style={{ fontSize: 14, color: C.textMuted, lineHeight: 1.8 }}>{detail.contextMeaning}</div>
      <div>
        {detail.examples?.map((ex, i) => (
          <div key={i} style={{ marginBottom: 10, background: C.bgElevated, borderRadius: 12, padding: 12, border: `1px solid ${C.borderSoft}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <EnglishText style={{ fontSize: 15, color: C.text }}>{ex.english}</EnglishText>
              <button onClick={() => speak(ex.english, settings.audio)} style={{ ...iconBtnStyle, padding: 4 }}>
                <Volume2 size={14} color={C.textFaint} />
              </button>
            </div>
            <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>{ex.arabic}</div>
          </div>
        ))}
      </div>
      {detail.wordFamily?.length > 0 && (
        <div>
          <div style={labelStyle}>عائلة الكلمة</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {detail.wordFamily.map((w, i) => <span key={i} style={pillStyle(C.cardAlt, C.textMuted)}><EnglishText>{w}</EnglishText></span>)}
          </div>
        </div>
      )}
      {detail.collocations?.length > 0 && (
        <div>
          <div style={labelStyle}>تعبيرات شائعة</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {detail.collocations.map((w, i) => <span key={i} style={pillStyle(C.goldSoft, C.gold)}><EnglishText>{w}</EnglishText></span>)}
          </div>
        </div>
      )}
    </div>
  );
}

/* --------------------------------- Pronunciation Practice --------------------------------- */
function PronunciationCheck({ word, wordId }) {
  const [status, setStatus] = useState('idle'); // idle | listening | result
  const [transcript, setTranscript] = useState('');
  const [correct, setCorrect] = useState(false);
  const recRef = useRef(null);

  if (!speechRecognitionSupported) return null;

  const start = () => {
    setStatus('listening');
    setTranscript('');
    const r = createRecognizer({
      onResult: (text) => {
        const isCorrect = gradeEnglishAnswer(text, word).correct;
        setTranscript(text);
        setCorrect(isCorrect);
        setStatus('result');
        if (wordId) bumpWordSkill(wordId, 'pronunciation', isCorrect);
      },
      onEnd: () => setStatus(s => (s === 'listening' ? 'idle' : s)),
      onError: () => setStatus('idle'),
    });
    recRef.current = r;
    try { r.start(); } catch { setStatus('idle'); }
  };

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button onClick={start} disabled={status === 'listening'} style={{ ...iconBtnStyle, background: status === 'listening' ? C.redSoft : C.cardAlt }}>
        <Mic size={16} color={status === 'listening' ? C.red : C.gold} />
      </button>
      {status === 'result' && (
        <span style={{ fontSize: 12, color: correct ? C.green : C.red, display: 'flex', alignItems: 'center', gap: 4 }}>
          {correct ? <Check size={12} /> : <X size={12} />} <EnglishText>{transcript || '—'}</EnglishText>
        </span>
      )}
      {status === 'listening' && <span style={{ fontSize: 12, color: C.textFaint }}>استمع الآن...</span>}
    </div>
  );
}

const iconBtnStyle = { background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 10, padding: 8, display: 'flex', cursor: 'pointer' };
const labelStyle = { fontSize: 12, color: C.textFaint, marginBottom: 6, fontFamily: "'Cairo', sans-serif", fontWeight: 600 };
const pillStyle = (bg, color) => ({ background: bg, color, padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 500 });

/* ================================ PAGES ================================ */

/* --------------------------------- Dashboard --------------------------------- */
function Dashboard({ wordsIndex, streak, settings, dailyStats, online, onNavigate }) {
  const stats = useMemo(() => {
    const newC = wordsIndex.filter(w => w.stage === 0 && w.genStatus !== 'pending').length;
    const dueC = wordsIndex.filter(w => w.stage > 0 && isDue(w.nextReviewAt) && w.genStatus !== 'pending').length;
    const learning = wordsIndex.filter(w => w.stage >= 1 && w.stage <= 2).length;
    const mastered = wordsIndex.filter(w => w.stage === 5).length;
    const weak = wordsIndex.filter(w => isWeakWord(w)).length;
    const pending = wordsIndex.filter(w => w.genStatus === 'pending').length;
    return { newC, dueC, learning, mastered, weak, pending, total: wordsIndex.length };
  }, [wordsIndex]);

  const activityCount = dailyStats.reviews + dailyStats.newWords;
  const AVG_SECONDS_PER_ITEM = 35; // rough real-world estimate for a review/add interaction
  const isMinutesGoal = settings.dailyGoal.type === 'minutes';
  const goalProgress = isMinutesGoal ? Math.round((activityCount * AVG_SECONDS_PER_ITEM) / 60) : activityCount;
  const goalTarget = settings.dailyGoal.value;
  const goalPct = Math.min(100, Math.round((goalProgress / Math.max(1, goalTarget)) * 100));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, color: C.textFaint }}>أهلًا بك في</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Cairo', sans-serif", color: C.text }}>📦 VocabBox</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => onNavigate('wordsList')} style={iconBtnStyle}><Layers size={16} color={C.textMuted} /></button>
          <button onClick={() => onNavigate('analytics')} style={iconBtnStyle}><TrendingUp size={16} color={C.textMuted} /></button>
          <button onClick={() => onNavigate('search')} style={iconBtnStyle}><Search size={16} color={C.textMuted} /></button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: online ? C.green : C.red }}>
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}
            {online ? 'متصل' : 'غير متصل'}
          </div>
        </div>
      </div>

      {/* streak + goal */}
      <button onClick={() => onNavigate('todayPractice')} style={{ ...cardStyle, textAlign: 'right', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', border: `1px solid rgba(212,162,76,0.35)`, background: C.goldSoft }}>
        <div style={{ fontSize: 24 }}>📅</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'Cairo', sans-serif", fontWeight: 700, fontSize: 14, color: C.text }}>تدريب اليوم</div>
          <div style={{ fontSize: 12, color: C.textFaint, marginTop: 2 }}>خطة قصيرة متوازنة مبنية على تقدمك</div>
        </div>
        <ChevronLeft size={16} color={C.gold} />
      </button>

      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ ...cardStyle, flex: 1, textAlign: 'center' }}>
          <Flame size={22} color={C.gold} style={{ margin: '0 auto 6px' }} />
          <div style={{ fontSize: 24, fontWeight: 800, color: C.gold, fontFamily: "'JetBrains Mono', monospace" }}>{streak.current}</div>
          <div style={{ fontSize: 12, color: C.textFaint }}>أيام متتالية</div>
        </div>
        <div style={{ ...cardStyle, flex: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.textMuted }}><Target size={14} color={C.gold} /> الهدف اليومي</div>
            <span style={{ fontSize: 12, color: C.textFaint, fontFamily: "'JetBrains Mono', monospace" }}>{goalProgress} / {goalTarget}{isMinutesGoal ? ' د' : ''}</span>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: C.bgElevated, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${goalPct}%`, background: C.gold, borderRadius: 999, transition: 'width .3s' }} />
          </div>
        </div>
      </div>

      {/* stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <button onClick={() => onNavigate('wordsList', 'new')} style={{ all: 'unset', cursor: 'pointer' }}><StatBox label="كلمات جديدة" value={stats.newC} color={C.blue} /></button>
        <button onClick={() => onNavigate('review')} style={{ all: 'unset', cursor: 'pointer' }}><StatBox label="مستحقة اليوم" value={stats.dueC} color={C.gold} /></button>
        <button onClick={() => onNavigate('wordsList', 'learning')} style={{ all: 'unset', cursor: 'pointer' }}><StatBox label="قيد التعلم" value={stats.learning} color={C.textMuted} /></button>
        <button onClick={() => onNavigate('wordsList', 'mastered')} style={{ all: 'unset', cursor: 'pointer' }}><StatBox label="متقنة" value={stats.mastered} color={C.green} /></button>
      </div>

      {stats.pending > 0 && (
        <button onClick={() => onNavigate('wordsList', 'pending')} style={{ ...cardStyle, background: C.goldSoft, border: `1px solid rgba(212,162,76,0.3)`, display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'right', cursor: 'pointer' }}>
          <RefreshCw size={16} color={C.gold} />
          <div style={{ fontSize: 13, color: C.text, flex: 1 }}>لدى <b style={{ color: C.gold }}>{stats.pending}</b> كلمة لم تتم معالجتها بعد — اضغط لإعادة المحاولة.</div>
          <ChevronLeft size={15} color={C.gold} />
        </button>
      )}

      {stats.weak > 0 && (
        <button onClick={() => onNavigate('weakWords')} style={{ ...cardStyle, background: C.redSoft, border: `1px solid rgba(193,104,90,0.3)`, display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'right', cursor: 'pointer' }}>
          <AlertTriangle size={18} color={C.red} />
          <div style={{ fontSize: 13, color: C.text, flex: 1 }}>لديك <b style={{ color: C.red }}>{stats.weak}</b> كلمة ضعيفة تحتاج تركيزًا إضافيًا.</div>
          <ChevronLeft size={15} color={C.red} />
        </button>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={() => onNavigate('review')} disabled={stats.dueC + stats.newC === 0} style={{ ...primaryBtnStyle, flex: 1, opacity: (stats.dueC + stats.newC === 0) ? 0.5 : 1 }}>
          <RotateCcw size={16} /> ابدأ المراجعة
        </button>
        <button onClick={() => onNavigate('add')} style={{ ...secondaryBtnStyle, flex: 1 }}>
          <Plus size={16} /> كلمة جديدة
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={() => onNavigate('learningPath')} style={{ ...cardStyle, flex: 1, textAlign: 'center', cursor: 'pointer' }}>
          <div style={{ fontSize: 20, marginBottom: 4 }}>🗺️</div>
          <div style={{ fontSize: 12, fontFamily: "'Cairo', sans-serif", fontWeight: 600, color: C.text }}>مسار التعلم</div>
        </button>
        <button onClick={() => onNavigate('aiCoach')} style={{ ...cardStyle, flex: 1, textAlign: 'center', cursor: 'pointer' }}>
          <div style={{ fontSize: 20, marginBottom: 4 }}>🧠</div>
          <div style={{ fontSize: 12, fontFamily: "'Cairo', sans-serif", fontWeight: 600, color: C.text }}>مدرب VocabBox</div>
        </button>
      </div>

      {stats.total === 0 && (
        <div style={{ ...cardStyle, textAlign: 'center', padding: 28 }}>
          <BookOpen size={28} color={C.textFaint} style={{ margin: '0 auto 10px' }} />
          <div style={{ color: C.textMuted, fontSize: 14, lineHeight: 1.8 }}>لا توجد كلمات بعد.<br />ابدأ بإضافة أول كلمة إنجليزية لتتعلمها.</div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, color }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 26, fontWeight: 800, color, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
      <div style={{ fontSize: 12, color: C.textFaint, marginTop: 2 }}>{label}</div>
    </div>
  );
}

/* --------------------------------- Skill Matrix & Mastery ------------------------------ */
function SkillMatrixCard({ entry }) {
  const { overall, label, perSkill } = useMemo(() => computeMastery(entry), [entry]);
  const labelColor = overall >= 95 ? C.gold : overall >= 80 ? C.green : overall >= 60 ? C.blue : overall >= 40 ? C.textMuted : C.textFaint;
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={labelStyle}>مصفوفة الإتقان</div>
        <span style={pillStyle(`${labelColor}22`, labelColor)}>{label} · {overall}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: C.bgElevated, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ height: '100%', width: `${overall}%`, background: labelColor, borderRadius: 999 }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {SKILL_DEFS.map(d => {
          const score = perSkill[d.key];
          const icon = score === null ? '⚪' : score >= 80 ? '✅' : score >= 40 ? '⚠️' : '❌';
          return (
            <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13 }}>{icon}</span>
              <span style={{ fontSize: 13, color: C.textMuted, width: 64, flexShrink: 0 }}>{d.label}</span>
              <div style={{ flex: 1, height: 5, borderRadius: 999, background: C.bgElevated, overflow: 'hidden' }}>
                {score !== null && <div style={{ height: '100%', width: `${score}%`, background: score >= 80 ? C.green : score >= 40 ? C.gold : C.red, borderRadius: 999 }} />}
              </div>
              <span style={{ fontSize: 11, color: C.textFaint, width: 30, textAlign: 'left', fontFamily: "'JetBrains Mono', monospace" }}>{score === null ? '—' : `${score}%`}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------------- Analytics --------------------------------- */
function AnalyticsPage({ wordsIndex, streak, onBack }) {
  const [weekly, setWeekly] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        const key = todayKey(d);
        const stats = await db.getDailyStats(key);
        days.push({ key, label: d.toLocaleDateString('ar', { weekday: 'short' }), ...stats });
      }
      setWeekly(days);
      setLoading(false);
    })();
  }, []);

  const agg = useMemo(() => {
    let correct = 0, incorrect = 0, hints = 0, reviewedWords = 0;
    const skillTotals = {};
    for (const d of SKILL_DEFS) skillTotals[d.key] = { correct: 0, total: 0 };
    for (const w of wordsIndex) {
      correct += w.correctCount || 0;
      incorrect += w.incorrectCount || 0;
      hints += w.hintsUsed || 0;
      if ((w.reviewCount || 0) > 0) reviewedWords++;
      const skills = w.skills || {};
      for (const d of SKILL_DEFS) {
        if (d.key === 'review' || !skills[d.key]) continue;
        skillTotals[d.key].correct += skills[d.key].correct;
        skillTotals[d.key].total += skills[d.key].total;
      }
    }
    const accuracy = (correct + incorrect) > 0 ? Math.round((correct / (correct + incorrect)) * 100) : 0;
    const forgettingRate = (correct + incorrect) > 0 ? Math.round((incorrect / (correct + incorrect)) * 100) : 0;
    const avgHints = reviewedWords > 0 ? (hints / reviewedWords).toFixed(1) : '0';

    const distribution = { 'جديدة': 0, 'قيد التعلم': 0, 'مألوفة': 0, 'قوية': 0, 'متقنة': 0 };
    for (const w of wordsIndex) distribution[computeMastery(w).label]++;

    return { accuracy, forgettingRate, avgHints, skillTotals, distribution, totalReviews: correct + incorrect };
  }, [wordsIndex]);

  const maxReviews = Math.max(1, ...weekly.map(d => d.reviews || 0));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={iconBtnStyle}><ChevronRight size={16} color={C.textMuted} /></button>
        <h2 style={pageTitleStyle}>📊 التحليلات</h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <StatBox label="دقة عامة" value={`${agg.accuracy}%`} color={C.green} />
        <StatBox label="معدل النسيان" value={`${agg.forgettingRate}%`} color={C.red} />
        <StatBox label="متوسط التلميحات" value={agg.avgHints} color={C.gold} />
      </div>

      <div style={cardStyle}>
        <div style={{ ...labelStyle, marginBottom: 10 }}>النشاط الأسبوعي</div>
        {loading ? <Loader2 size={18} className="spin" color={C.gold} /> : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 90 }}>
            {weekly.map(d => (
              <div key={d.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{ width: '100%', height: 70, display: 'flex', alignItems: 'flex-end' }}>
                  <div style={{ width: '100%', height: `${Math.max(4, ((d.reviews || 0) / maxReviews) * 70)}px`, background: d.reviews > 0 ? C.gold : C.borderSoft, borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 10, color: C.textFaint }}>{d.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ ...labelStyle, marginBottom: 10 }}>الدقة حسب المهارة</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SKILL_DEFS.filter(d => d.key !== 'review').map(d => {
            const t = agg.skillTotals[d.key];
            const score = t.total > 0 ? Math.round((t.correct / t.total) * 100) : null;
            return (
              <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: C.textMuted, width: 64, flexShrink: 0 }}>{d.label}</span>
                <div style={{ flex: 1, height: 6, borderRadius: 999, background: C.bgElevated, overflow: 'hidden' }}>
                  {score !== null && <div style={{ height: '100%', width: `${score}%`, background: score >= 80 ? C.green : score >= 40 ? C.gold : C.red, borderRadius: 999 }} />}
                </div>
                <span style={{ fontSize: 11, color: C.textFaint, width: 34, fontFamily: "'JetBrains Mono', monospace" }}>{score === null ? '—' : `${score}%`}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ ...labelStyle, marginBottom: 10 }}>توزيع الإتقان</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Object.entries(agg.distribution).map(([label, count]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: C.textMuted, width: 70, flexShrink: 0 }}>{label}</span>
              <div style={{ flex: 1, height: 6, borderRadius: 999, background: C.bgElevated, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${wordsIndex.length ? (count / wordsIndex.length) * 100 : 0}%`, background: C.blue, borderRadius: 999 }} />
              </div>
              <span style={{ fontSize: 11, color: C.textFaint, width: 20, fontFamily: "'JetBrains Mono', monospace" }}>{count}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <StatBox label="أفضل سلسلة" value={streak.best} color={C.gold} />
        <StatBox label="إجمالي المراجعات" value={agg.totalReviews} color={C.blue} />
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/* --------------------------------- Words List & Detail --------------------------------- */
function WordsListPage({ wordsIndex, onBack, onOpenWord, initialFilter }) {
  const [filter, setFilter] = useState(initialFilter || 'all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    let list = wordsIndex;
    if (filter === 'new') list = list.filter(w => w.stage === 0);
    else if (filter === 'learning') list = list.filter(w => w.stage >= 1 && w.stage <= 2);
    else if (filter === 'familiar') list = list.filter(w => w.stage === 3 || w.stage === 4);
    else if (filter === 'mastered') list = list.filter(w => w.stage === 5);
    else if (filter === 'weak') list = list.filter(w => isWeakWord(w));
    else if (filter === 'pending') list = list.filter(w => w.genStatus === 'pending');
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const qAr = normalizeArabic(query);
      list = list.filter(w => w.word.toLowerCase().includes(q) || (qAr && normalizeArabic(w.translation).includes(qAr)));
    }
    return [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [wordsIndex, filter, query]);

  const filters = [
    { id: 'all', label: 'الكل' },
    { id: 'new', label: 'جديدة' },
    { id: 'learning', label: 'قيد التعلم' },
    { id: 'familiar', label: 'مألوفة' },
    { id: 'mastered', label: 'متقنة' },
    { id: 'weak', label: 'ضعيفة' },
    { id: 'pending', label: '⚠️ لم تُعالج' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={iconBtnStyle}><ChevronRight size={16} color={C.textMuted} /></button>
        <h2 style={pageTitleStyle}>كلماتي ({wordsIndex.length})</h2>
      </div>

      <div style={{ position: 'relative' }}>
        <Search size={15} color={C.textFaint} style={{ position: 'absolute', top: 12, right: 12 }} />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث..." style={{ width: '100%', background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 38px 10px 12px', color: C.text }} />
      </div>

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
        {filters.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{ padding: '7px 12px', borderRadius: 10, background: filter === f.id ? C.gold : C.bgElevated, border: `1px solid ${filter === f.id ? C.gold : C.border}`, color: filter === f.id ? '#14120F' : C.textMuted, fontSize: 12, fontFamily: "'Cairo', sans-serif", fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 && <div style={{ ...cardStyle, textAlign: 'center', color: C.textFaint, fontSize: 13 }}>لا توجد كلمات مطابقة</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(w => {
          const { overall } = computeMastery(w);
          return (
            <button key={w.id} onClick={() => onOpenWord(w.id)} style={{ ...cardStyle, textAlign: 'right', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: w.genStatus === 'pending' ? C.redSoft : C.goldSoft, color: w.genStatus === 'pending' ? C.red : C.gold, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, flexShrink: 0 }}>
                {w.genStatus === 'pending' ? '⚠️' : `B${w.stage}`}
              </span>
              <div style={{ flex: 1 }}>
                <EnglishText style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{w.word}</EnglishText>
                <div style={{ fontSize: 12, color: w.genStatus === 'pending' ? C.textFaint : C.gold }}>{w.genStatus === 'pending' ? 'بحاجة لإعادة المعالجة' : w.translation}</div>
              </div>
              <span style={{ fontSize: 11, color: C.textFaint, fontFamily: "'JetBrains Mono', monospace" }}>{overall}%</span>
              <ChevronLeft size={14} color={C.textFaint} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WordDetailPage({ wordId, settings, onBack, showToast, refreshIndex }) {
  const [entry, setEntry] = useState(null);
  const [detail, setDetail] = useState(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    const idx = await db.getWordsIndex();
    setEntry(idx.find(w => w.id === wordId) || null);
    setDetail(await db.getWordDetail(wordId));
  }, [wordId]);

  useEffect(() => { load(); }, [load]);

  const retry = async () => {
    setRetrying(true);
    try {
      const fresh = await generateWordData(entry.word);
      await db.saveWordDetail(entry.id, fresh);
      const idx = await db.getWordsIndex();
      const updated = idx.map(w => w.id === entry.id ? { ...w, translation: fresh.translation, genStatus: 'ready' } : w);
      await db.saveWordsIndex(updated);
      await refreshIndex();
      await load();
      showToast('تم توليد بيانات الكلمة بنجاح', 'success');
    } catch {
      showToast('تعذّر التوليد الآن، حاول لاحقًا', 'error');
    } finally {
      setRetrying(false);
    }
  };

  if (!entry || !detail) return <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={22} className="spin" color={C.gold} /><style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={iconBtnStyle}><ChevronRight size={16} color={C.textMuted} /></button>
        <h2 style={pageTitleStyle}>تفاصيل الكلمة</h2>
      </div>
      {entry.genStatus === 'pending' ? (
        <div style={{ ...cardStyle, textAlign: 'center', padding: 24 }}>
          <AlertTriangle size={22} color={C.gold} style={{ margin: '0 auto 8px' }} />
          <EnglishText style={{ fontSize: 18, fontWeight: 700, color: C.text, display: 'block', marginBottom: 4 }}>{entry.word}</EnglishText>
          <div style={{ color: C.textMuted, fontSize: 13, marginBottom: 14 }}>لم تتم معالجة هذه الكلمة بعد بسبب خطأ سابق في التوليد.</div>
          <button onClick={retry} disabled={retrying} style={{ ...primaryBtnStyle, width: '100%' }}>
            {retrying ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} إعادة المحاولة
          </button>
        </div>
      ) : (
        <div style={cardStyle}><WordFullCard detail={detail} settings={settings} wordId={entry.id} /></div>
      )}
      <SkillMatrixCard entry={entry} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <StatBox label="مراجعات" value={entry.reviewCount || 0} color={C.blue} />
        <StatBox label="صحيحة" value={entry.correctCount || 0} color={C.green} />
        <StatBox label="خاطئة" value={entry.incorrectCount || 0} color={C.red} />
      </div>
      {entry.sourceStoryTitle && <div style={{ fontSize: 12, color: C.textFaint }}>من قصة: {entry.sourceStoryTitle}</div>}
    </div>
  );
}

/* --------------------------------- Weak Words --------------------------------- */
function WeakWordsPage({ wordsIndex, onBack, onStartSession }) {
  const weakList = useMemo(() =>
    wordsIndex.filter(w => isWeakWord(w)).sort((a, b) => weaknessScore(b) - weaknessScore(a)),
  [wordsIndex]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={iconBtnStyle}><ChevronRight size={16} color={C.textMuted} /></button>
        <h2 style={pageTitleStyle}>⚠️ الكلمات الضعيفة</h2>
      </div>

      {weakList.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: 'center', padding: 28 }}>
          <CheckCircle2 size={26} color={C.green} style={{ margin: '0 auto 10px' }} />
          <div style={{ color: C.textMuted, fontSize: 14 }}>لا توجد كلمات ضعيفة حاليًا. أداؤك ممتاز!</div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, color: C.textMuted }}>هذه الكلمات يخطئ فيها المستخدم كثيرًا أو يحتاج تلميحات متكررة فيها.</div>
          <button onClick={onStartSession} style={primaryBtnStyle}><Sparkles size={16} /> بدء جلسة الكلمات الضعيفة ({weakList.length})</button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {weakList.map(w => (
              <div key={w.id} style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <EnglishText style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{w.word}</EnglishText>
                  <div style={{ fontSize: 12, color: C.gold, marginTop: 2 }}>{w.translation}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, fontSize: 11, color: C.textFaint, fontFamily: "'JetBrains Mono', monospace" }}>
                  <span style={{ color: C.green }}>✓{w.correctCount || 0}</span>
                  <span style={{ color: C.red }}>✗{w.incorrectCount || 0}</span>
                  {w.hintsUsed > 0 && <span>💡{w.hintsUsed}</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* --------------------------------- Search --------------------------------- */
function SearchPage({ wordsIndex, storiesIndex, onBack, onOpenStory }) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [storyMatches, setStoryMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const detailCacheRef = useRef(new Map());

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  const wordMatches = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    const qAr = normalizeArabic(query);
    return wordsIndex.filter(w =>
      w.word.toLowerCase().includes(q) || (qAr && normalizeArabic(w.translation).includes(qAr))
    ).slice(0, 20);
  }, [query, wordsIndex]);

  useEffect(() => {
    if (!debouncedQuery.trim() || debouncedQuery.trim().length < 2) { setStoryMatches([]); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const q = debouncedQuery.trim().toLowerCase();
      const qAr = normalizeArabic(debouncedQuery);
      const results = [];
      for (const s of storiesIndex) {
        if (cancelled) return;
        if (s.title.toLowerCase().includes(q)) results.push({ type: 'story', storyId: s.id, title: s.title });
        let detail = detailCacheRef.current.get(s.id);
        if (!detail) {
          detail = await db.getStoryDetail(s.id);
          if (detail) detailCacheRef.current.set(s.id, detail);
        }
        if (!detail) continue;
        for (const part of detail.parts) {
          if (part.content.toLowerCase().includes(q)) {
            results.push({ type: 'part', storyId: s.id, storyTitle: s.title, partTitle: part.title, snippet: part.content.slice(0, 90) });
          }
          for (const ph of part.phrases) {
            if (ph.phrase.toLowerCase().includes(q) || (qAr && normalizeArabic(ph.meaning).includes(qAr))) {
              results.push({ type: 'phrase', storyId: s.id, storyTitle: s.title, phrase: ph.phrase, meaning: ph.meaning });
            }
          }
        }
      }
      if (!cancelled) { setStoryMatches(results.slice(0, 25)); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [debouncedQuery, storiesIndex]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={iconBtnStyle}><ChevronRight size={16} color={C.textMuted} /></button>
        <h2 style={pageTitleStyle}>🔎 البحث</h2>
      </div>

      <div style={{ position: 'relative' }}>
        <Search size={15} color={C.textFaint} style={{ position: 'absolute', top: 12, right: 12 }} />
        <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث عن كلمة، عبارة، أو قصة..." style={{ width: '100%', background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 38px 10px 12px', color: C.text }} />
      </div>

      {!query.trim() && <div style={{ ...cardStyle, textAlign: 'center', color: C.textFaint, fontSize: 13 }}>ابحث في الكلمات والعبارات والقصص</div>}

      {wordMatches.length > 0 && (
        <div>
          <div style={labelStyle}>الكلمات</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {wordMatches.map(w => (
              <div key={w.id} style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <EnglishText style={{ fontSize: 14, color: C.text }}>{w.word}</EnglishText>
                <span style={{ fontSize: 13, color: C.gold }}>{w.translation}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: 10 }}><Loader2 size={18} className="spin" color={C.gold} /></div>}

      {storyMatches.filter(m => m.type === 'story').length > 0 && (
        <div>
          <div style={labelStyle}>القصص</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {storyMatches.filter(m => m.type === 'story').map((m, i) => (
              <button key={i} onClick={() => onOpenStory(m.storyId)} style={{ ...cardStyle, textAlign: 'right', cursor: 'pointer' }}>{m.title}</button>
            ))}
          </div>
        </div>
      )}

      {storyMatches.filter(m => m.type === 'part').length > 0 && (
        <div>
          <div style={labelStyle}>مقاطع القصص</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {storyMatches.filter(m => m.type === 'part').map((m, i) => (
              <button key={i} onClick={() => onOpenStory(m.storyId)} style={{ ...cardStyle, textAlign: 'right', cursor: 'pointer' }}>
                <div style={{ fontSize: 12, color: C.textFaint, marginBottom: 4 }}>{m.storyTitle} · {m.partTitle}</div>
                <EnglishText style={{ fontSize: 13, color: C.textMuted }}>...{m.snippet}...</EnglishText>
              </button>
            ))}
          </div>
        </div>
      )}

      {storyMatches.filter(m => m.type === 'phrase').length > 0 && (
        <div>
          <div style={labelStyle}>العبارات</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {storyMatches.filter(m => m.type === 'phrase').map((m, i) => (
              <button key={i} onClick={() => onOpenStory(m.storyId)} style={{ ...cardStyle, textAlign: 'right', cursor: 'pointer' }}>
                <EnglishText style={{ fontSize: 14, color: C.text }}>{m.phrase}</EnglishText>
                <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{m.meaning}</div>
              </button>
            ))}
          </div>
        </div>
      )}
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

const cardStyle = { background: C.card, border: `1px solid ${C.borderSoft}`, borderRadius: 16, padding: 14 };
const primaryBtnStyle = { background: C.gold, color: '#14120F', border: 'none', borderRadius: 14, padding: '13px 0', fontFamily: "'Cairo', sans-serif", fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' };
const secondaryBtnStyle = { background: C.cardAlt, color: C.text, border: `1px solid ${C.border}`, borderRadius: 14, padding: '13px 0', fontFamily: "'Cairo', sans-serif", fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' };

/* --------------------------------- Add Word --------------------------------- */
function AddWordPage({ wordsIndex, refreshIndex, showToast, settings }) {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('idle'); // idle | checking | generating | done | duplicate | pending
  const [newDetail, setNewDetail] = useState(null);
  const [newId, setNewId] = useState(null);

  const handleAdd = async () => {
    const raw = input.trim();
    if (!raw || !/^[a-zA-Z\s'-]+$/.test(raw)) {
      showToast('أدخل كلمة إنجليزية صحيحة', 'error');
      return;
    }
    const nk = normalizeKey(raw);
    if (wordsIndex.some(w => w.normalizedKey === nk)) {
      setStatus('duplicate');
      return;
    }
    setStatus('generating');
    const result = await addWordToBox(raw);
    await refreshIndex();
    setNewDetail(result.detail);
    setNewId(result.entry.id);
    setStatus(result.status === 'pending' ? 'pending' : 'done');
    if (result.status === 'pending') showToast('تمت إضافة الكلمة، لكن تعذّر توليد بياناتها الآن — يمكنك إعادة المحاولة', 'info');
    else showToast('تمت إضافة الكلمة بنجاح', 'success');
  };

  const retryGenerate = async () => {
    if (!newId) return;
    setStatus('generating');
    try {
      const detail = await generateWordData(newDetail.word || input.trim());
      await db.saveWordDetail(newId, detail);
      const idx = await db.getWordsIndex();
      const updated = idx.map(w => w.id === newId ? { ...w, translation: detail.translation, genStatus: 'ready' } : w);
      await db.saveWordsIndex(updated);
      await refreshIndex();
      setNewDetail(detail);
      setStatus('done');
      showToast('تم توليد البيانات بنجاح', 'success');
    } catch {
      setStatus('pending');
      showToast('لا يزال التوليد غير متاح، حاول لاحقًا', 'error');
    }
  };

  const reset = () => { setInput(''); setStatus('idle'); setNewDetail(null); setNewId(null); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 90 }}>
      <h2 style={pageTitleStyle}>➕ كلمة جديدة</h2>

      {status !== 'done' && status !== 'pending' && (
        <div style={cardStyle}>
          <div style={labelStyle}>الكلمة الإنجليزية</div>
          <input
            dir="ltr"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && status !== 'generating' && handleAdd()}
            placeholder="e.g. protect"
            style={{ width: '100%', background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', color: C.text, fontSize: 18, fontFamily: "'Spectral', serif" }}
          />
          {status === 'duplicate' && (
            <div style={{ marginTop: 10, fontSize: 13, color: C.gold, display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={14} /> هذه الكلمة موجودة بالفعل في مفرداتك.
            </div>
          )}
          <button onClick={handleAdd} disabled={status === 'generating' || !input.trim()} style={{ ...primaryBtnStyle, width: '100%', marginTop: 12, opacity: (status === 'generating' || !input.trim()) ? 0.6 : 1 }}>
            {status === 'generating' ? <><Loader2 size={16} className="spin" /> جارٍ التوليد...</> : <><Sparkles size={16} /> إضافة وتوليد البيانات</>}
          </button>
        </div>
      )}

      {(status === 'done' || status === 'pending') && newDetail && (
        <div style={cardStyle}>
          {status === 'pending' ? (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <AlertTriangle size={22} color={C.gold} style={{ margin: '0 auto 8px' }} />
              <div style={{ color: C.text, fontFamily: "'Cairo', sans-serif", fontWeight: 700, marginBottom: 4 }}><EnglishText>{newDetail.word || input}</EnglishText></div>
              <div style={{ color: C.textMuted, fontSize: 13, marginBottom: 14 }}>تم حفظ الكلمة، لكن تعذّر توليد بياناتها الآن. يمكنك إعادة المحاولة لاحقًا.</div>
              <button onClick={retryGenerate} style={{ ...secondaryBtnStyle, width: '100%' }}><RefreshCw size={15} /> إعادة المحاولة</button>
            </div>
          ) : (
            <WordFullCard detail={newDetail} settings={settings} />
          )}
          <button onClick={reset} style={{ ...primaryBtnStyle, width: '100%', marginTop: 16 }}>
            <Plus size={16} /> إضافة كلمة أخرى
          </button>
        </div>
      )}

      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

const pageTitleStyle = { fontSize: 19, fontWeight: 800, color: C.text, fontFamily: "'Cairo', sans-serif", margin: 0 };

/* --------------------------------- Review Session --------------------------------- */
const QUESTION_TYPES = ['en_ar', 'ar_en', 'mcq', 'listening', 'dictation'];

function buildQueue(wordsIndex, sessionSize, mode = 'normal') {
  if (mode === 'weak') {
    return wordsIndex
      .filter(w => isWeakWord(w))
      .sort((a, b) => weaknessScore(b) - weaknessScore(a))
      .slice(0, sessionSize);
  }
  const due = wordsIndex.filter(w => w.stage > 0 && isDue(w.nextReviewAt))
    .sort((a, b) => {
      const aWeak = a.incorrectCount > a.correctCount ? 0 : 1;
      const bWeak = b.incorrectCount > b.correctCount ? 0 : 1;
      if (aWeak !== bWeak) return aWeak - bWeak;
      return new Date(a.nextReviewAt) - new Date(b.nextReviewAt);
    });
  const fresh = wordsIndex.filter(w => w.stage === 0);
  const queue = [...due];
  for (const w of fresh) {
    if (queue.length >= sessionSize) break;
    queue.push(w);
  }
  return queue.slice(0, Math.max(sessionSize, due.length ? Math.min(due.length, sessionSize * 2) : sessionSize));
}

function isWeakWord(w) {
  return (w.incorrectCount > 0 && w.incorrectCount >= w.correctCount) || (w.hintsUsed || 0) >= 2;
}
function weaknessScore(w) {
  return (w.incorrectCount || 0) * 2 + (w.hintsUsed || 0) - (w.correctCount || 0) * 0.5;
}

/* Dynamic Difficulty: a real per-word score derived from tracked error/hint history,
   used to bias which question type is served and whether extra context is shown. */
function computeDifficulty(entry) {
  const attempts = (entry.correctCount || 0) + (entry.incorrectCount || 0);
  if (attempts === 0) return 30; // unknown yet — neutral-low difficulty
  const errorRate = (entry.incorrectCount || 0) / attempts;
  const hintsRatio = Math.min(1, (entry.hintsUsed || 0) / Math.max(1, entry.reviewCount || 1));
  return Math.round(Math.min(100, errorRate * 65 + hintsRatio * 35));
}

function pickQuestionType(entry, wordCount, detail, difficulty = 30) {
  const candidates = ['en_ar'];
  if (entry.stage >= 1) candidates.push('ar_en');
  if (wordCount >= 4) candidates.push('mcq');
  if (speechSupported && entry.stage >= 1) candidates.push('listening');
  if (speechSupported && entry.stage >= 2 && detail?.examples?.[0]?.english) candidates.push('dictation');

  if (difficulty >= 55) {
    // Harder word for this learner: favor easier recognition formats, more repetition.
    if (wordCount >= 4) candidates.push('mcq', 'mcq', 'mcq');
    candidates.push('en_ar', 'en_ar');
  } else if (difficulty <= 15 && entry.stage >= 2) {
    // Easy/mastered-leaning word: push toward harder production formats.
    candidates.push('ar_en', 'ar_en');
    if (speechSupported && detail?.examples?.[0]?.english) candidates.push('dictation');
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function ReviewSession({ wordsIndex, settings, refreshIndex, streak, refreshStreak, dailyStats, refreshDailyStats, showToast, onExit, mode = 'normal', sessionSizeOverride }) {
  const [queue, setQueue] = useState(null);
  const [pos, setPos] = useState(0);
  const [detail, setDetail] = useState(null);
  const [qType, setQType] = useState(null);
  const [answer, setAnswer] = useState('');
  const [phase, setPhase] = useState('loading'); // loading|question|feedback|summary
  const [feedback, setFeedback] = useState(null);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hintLevel, setHintLevel] = useState(0);
  const [mcqOptions, setMcqOptions] = useState([]);
  const [sessionStats, setSessionStats] = useState({ correct: 0, incorrect: 0, total: 0 });
  const [currentDifficulty, setCurrentDifficulty] = useState(30);
  const [skippedPending, setSkippedPending] = useState(0);

  useEffect(() => {
    const q = buildQueue(wordsIndex, sessionSizeOverride || settings.sessionSize || 10, mode);
    setQueue(q);
    setPos(0);
  }, []); // eslint-disable-line

  const loadCurrent = useCallback(async (q, i) => {
    if (!q || i >= q.length) { setPhase('summary'); return; }
    setPhase('loading');
    const entry = q[i];
    const d = await db.getWordDetail(entry.id);
    if (!d || d.genStatus === 'pending' || !d.translation) {
      // skip words without generated data yet
      setSkippedPending(n => n + 1);
      loadCurrent(q, i + 1);
      return;
    }
    setDetail(d);
    const difficulty = computeDifficulty(entry);
    setCurrentDifficulty(difficulty);
    const type = pickQuestionType(entry, wordsIndex.length, d, difficulty);
    setQType(type);
    setAnswer('');
    setHintsUsed(0);
    setHintLevel(0);
    if (type === 'mcq') {
      const others = wordsIndex.filter(w => w.id !== entry.id && w.translation).sort(() => Math.random() - 0.5).slice(0, 3);
      const opts = [...others.map(o => o.translation), d.translation].sort(() => Math.random() - 0.5);
      setMcqOptions(opts);
    }
    if (type === 'listening') {
      setTimeout(() => speak(d.word, settings.audio), 300);
    }
    if (type === 'dictation') {
      setTimeout(() => speak(d.examples[0].english, settings.audio), 300);
    }
    setPhase('question');
  }, [wordsIndex, settings]);

  useEffect(() => {
    if (queue) loadCurrent(queue, pos);
  }, [queue, pos, loadCurrent]);

  if (phase === 'loading' || !queue) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Loader2 size={26} className="spin" color={C.gold} /><style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>;
  }

  if (phase === 'summary') {
    const acc = sessionStats.total ? Math.round((sessionStats.correct / sessionStats.total) * 100) : 0;
    if (sessionStats.total === 0 && skippedPending > 0) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 90, textAlign: 'center', paddingTop: 30 }}>
          <AlertTriangle size={36} color={C.gold} style={{ margin: '0 auto' }} />
          <h2 style={pageTitleStyle}>لا توجد كلمات جاهزة للمراجعة</h2>
          <div style={{ color: C.textMuted, fontSize: 14, lineHeight: 1.8, padding: '0 10px' }}>
            {skippedPending} كلمة لم تتم معالجتها بعد بسبب خطأ في توليد بياناتها. اذهب إلى "كلماتي" لإعادة المحاولة.
          </div>
          <button onClick={onExit} style={primaryBtnStyle}>العودة للرئيسية</button>
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 90, textAlign: 'center', paddingTop: 30 }}>
        <Award size={40} color={C.gold} style={{ margin: '0 auto' }} />
        <h2 style={pageTitleStyle}>انتهت الجلسة 🎉</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ ...cardStyle, flex: 1 }}><div style={{ fontSize: 22, fontWeight: 800, color: C.green, fontFamily: "'JetBrains Mono', monospace" }}>{sessionStats.correct}</div><div style={{ fontSize: 12, color: C.textFaint }}>صحيحة</div></div>
          <div style={{ ...cardStyle, flex: 1 }}><div style={{ fontSize: 22, fontWeight: 800, color: C.red, fontFamily: "'JetBrains Mono', monospace" }}>{sessionStats.incorrect}</div><div style={{ fontSize: 12, color: C.textFaint }}>خاطئة</div></div>
          <div style={{ ...cardStyle, flex: 1 }}><div style={{ fontSize: 22, fontWeight: 800, color: C.gold, fontFamily: "'JetBrains Mono', monospace" }}>{acc}%</div><div style={{ fontSize: 12, color: C.textFaint }}>الدقة</div></div>
        </div>
        <button onClick={onExit} style={primaryBtnStyle}>العودة للرئيسية</button>
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ color: C.textMuted, marginBottom: 16 }}>{mode === 'weak' ? 'لا توجد كلمات ضعيفة حاليًا — أداؤك جيد!' : 'لا توجد كلمات مستحقة للمراجعة الآن.'}</div>
        <button onClick={onExit} style={primaryBtnStyle}>العودة للرئيسية</button>
      </div>
    );
  }

  const entry = queue[pos];

  const submitAnswer = async (isCorrect, userAnswerDisplay, extra = {}) => {
    const newIdx = await db.getWordsIndex();
    let w = newIdx.find(x => x.id === entry.id);
    if (!w) return;
    const intervals = settings.leitnerIntervals;
    if (isCorrect) {
      w.stage = Math.min(5, (w.stage || 0) + 1);
      w.correctCount = (w.correctCount || 0) + 1;
    } else {
      w.stage = 1;
      w.incorrectCount = (w.incorrectCount || 0) + 1;
    }
    w.reviewCount = (w.reviewCount || 0) + 1;
    w.lastReviewedAt = new Date().toISOString();
    w.nextReviewAt = daysFromNow(intervals[w.stage] || 1);
    w.hintsUsed = (w.hintsUsed || 0) + hintsUsed;
    const skillMap = { en_ar: ['meaning', 'reading'], ar_en: ['writing', 'meaning'], mcq: ['meaning'], listening: ['listening'], dictation: ['listening', 'context'] };
    bumpSkillOnEntry(w, skillMap[qType] || ['meaning'], isCorrect);
    await db.saveWordsIndex(newIdx);
    await refreshIndex();

    const dk = todayKey();
    const ds = await db.getDailyStats(dk);
    ds.reviews += 1;
    if (isCorrect) ds.correct += 1; else ds.incorrect += 1;
    await db.saveDailyStats(dk, ds);
    await refreshDailyStats();

    const s = await db.getStreak();
    const today = dk;
    if (s.lastActiveDate !== today) {
      const yesterday = todayKey(new Date(Date.now() - 86400000));
      s.current = s.lastActiveDate === yesterday ? s.current + 1 : 1;
      s.best = Math.max(s.best, s.current);
      s.lastActiveDate = today;
      s.activeDates = [...(s.activeDates || []), today].slice(-120);
      await db.saveStreak(s);
      await refreshStreak();
    }

    setSessionStats(prev => ({ correct: prev.correct + (isCorrect ? 1 : 0), incorrect: prev.incorrect + (isCorrect ? 0 : 1), total: prev.total + 1 }));
    setFeedback({ isCorrect, userAnswer: userAnswerDisplay, ...extra });
    setPhase('feedback');
  };

  const handleCheck = () => {
    if (qType === 'dictation') {
      const target = detail.examples[0].english;
      const result = gradeDictation(answer, target);
      const correct = result.score >= 80;
      submitAnswer(correct, answer, { dictationResult: result, dictationTarget: target });
    } else if (qType === 'ar_en' || qType === 'listening') {
      const r = gradeEnglishAnswer(answer, detail.word);
      submitAnswer(r.correct, answer);
    } else {
      const r = gradeArabicAnswer(answer, [detail.translation, ...(detail.acceptedTranslations || [])]);
      submitAnswer(r.correct, answer);
    }
  };

  const handleMcq = (opt) => submitAnswer(opt === detail.translation, opt);

  const next = () => setPos(p => p + 1);

  const hints = () => {
    const level = hintLevel + 1;
    setHintLevel(level);
    setHintsUsed(h => h + 1);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 90 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={onExit} style={iconBtnStyle}><X size={16} color={C.textMuted} /></button>
        <div style={{ fontSize: 12, color: C.textFaint, fontFamily: "'JetBrains Mono', monospace" }}>{pos + 1} / {queue.length}</div>
      </div>
      <div style={{ height: 4, background: C.bgElevated, borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${((pos) / queue.length) * 100}%`, background: C.gold, transition: 'width .3s' }} />
      </div>

      {phase === 'question' && (
        <div style={{ ...cardStyle, position: 'relative' }}>
          <span style={{ position: 'absolute', top: -10, right: 14, background: C.gold, color: '#14120F', fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 999, fontFamily: "'JetBrains Mono', monospace" }}>B{entry.stage || 0}</span>
          {currentDifficulty >= 55 && detail.contextMeaning && ['ar_en', 'listening', 'dictation'].includes(qType) && (
            <div style={{ fontSize: 12, color: C.textFaint, background: C.bgElevated, borderRadius: 8, padding: '6px 10px', marginBottom: 12 }}>
              💡 سياق مساعد: {detail.contextMeaning}
            </div>
          )}

          {qType === 'en_ar' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <EnglishText style={{ fontSize: 30, fontWeight: 600, color: C.text }}>{detail.word}</EnglishText>
                <button onClick={() => speak(detail.word, settings.audio)} style={iconBtnStyle}><Volume2 size={17} color={C.gold} /></button>
              </div>
              <div style={{ fontSize: 14, color: C.textMuted, marginBottom: 10 }}>ما معنى الكلمة بالعربية؟</div>
            </>
          )}
          {qType === 'ar_en' && (
            <>
              <div style={{ fontSize: 24, fontWeight: 700, color: C.gold, fontFamily: "'Cairo', sans-serif", marginBottom: 14 }}>{detail.translation}</div>
              <div style={{ fontSize: 14, color: C.textMuted, marginBottom: 10 }}>اكتب الكلمة بالإنجليزية</div>
            </>
          )}
          {qType === 'listening' && (
            <>
              <div style={{ textAlign: 'center', margin: '10px 0 18px' }}>
                <button onClick={() => speak(detail.word, settings.audio)} style={{ ...iconBtnStyle, padding: 18, borderRadius: 999 }}>
                  <Volume2 size={26} color={C.gold} />
                </button>
              </div>
              <div style={{ fontSize: 14, color: C.textMuted, marginBottom: 10, textAlign: 'center' }}>استمع واكتب الكلمة التي سمعتها</div>
            </>
          )}
          {qType === 'dictation' && (
            <>
              <div style={{ textAlign: 'center', margin: '10px 0 18px' }}>
                <button onClick={() => speak(detail.examples[0].english, settings.audio)} style={{ ...iconBtnStyle, padding: 18, borderRadius: 999 }}>
                  <Headphones size={26} color={C.gold} />
                </button>
              </div>
              <div style={{ fontSize: 14, color: C.textMuted, marginBottom: 10, textAlign: 'center' }}>إملاء: استمع واكتب الجملة كاملة</div>
            </>
          )}

          {qType === 'mcq' ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <EnglishText style={{ fontSize: 28, fontWeight: 600, color: C.text }}>{detail.word}</EnglishText>
              <button onClick={() => speak(detail.word, settings.audio)} style={iconBtnStyle}><Volume2 size={17} color={C.gold} /></button>
            </div>
          ) : null}

          {qType === 'mcq' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {mcqOptions.map((opt, i) => (
                <button key={i} onClick={() => handleMcq(opt)} style={{ textAlign: 'right', padding: '12px 14px', borderRadius: 12, background: C.bgElevated, border: `1px solid ${C.border}`, color: C.text, fontSize: 15, cursor: 'pointer' }}>
                  {opt}
                </button>
              ))}
            </div>
          ) : (
            <>
              {qType === 'dictation' ? (
                <textarea
                  dir="ltr"
                  value={answer}
                  onChange={e => setAnswer(e.target.value)}
                  placeholder="type the full sentence you heard..."
                  rows={3}
                  style={{ width: '100%', background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', color: C.text, fontSize: 16, marginBottom: 12, fontFamily: "'Spectral', serif", resize: 'vertical' }}
                />
              ) : (
                <input
                  dir={qType === 'en_ar' ? 'rtl' : 'ltr'}
                  value={answer}
                  onChange={e => setAnswer(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && answer.trim() && handleCheck()}
                  placeholder={qType === 'en_ar' ? 'اكتب المعنى...' : 'type the word...'}
                  style={{ width: '100%', background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', color: C.text, fontSize: 16, marginBottom: 12, fontFamily: qType === 'en_ar' ? "'Cairo', sans-serif" : "'Spectral', serif" }}
                />
              )}
              {hintLevel > 0 && qType !== 'dictation' && (
                <div style={{ fontSize: 13, color: C.gold, background: C.goldSoft, borderRadius: 10, padding: '8px 12px', marginBottom: 12 }}>
                  {hintLevel === 1 && <>أول حرف: <EnglishText>{detail.word[0]}</EnglishText></>}
                  {hintLevel === 2 && <>عدد الحروف: {detail.word.length}</>}
                  {hintLevel >= 3 && <>مثال: <EnglishText>{detail.examples?.[0]?.english}</EnglishText></>}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                {hintLevel < 3 && qType !== 'dictation' && (
                  <button onClick={hints} style={{ ...secondaryBtnStyle, flex: 1 }}><Lightbulb size={15} /> تلميح</button>
                )}
                <button onClick={handleCheck} disabled={!answer.trim()} style={{ ...primaryBtnStyle, flex: 2, opacity: !answer.trim() ? 0.5 : 1 }}><Check size={15} /> تحقق</button>
              </div>
            </>
          )}
        </div>
      )}

      {phase === 'feedback' && (
        <div style={{ ...cardStyle, borderColor: feedback.isCorrect ? 'rgba(116,167,136,0.4)' : 'rgba(193,104,90,0.4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            {feedback.isCorrect ? <Check size={20} color={C.green} /> : <X size={20} color={C.red} />}
            <span style={{ fontFamily: "'Cairo', sans-serif", fontWeight: 700, color: feedback.isCorrect ? C.green : C.red, fontSize: 16 }}>
              {feedback.isCorrect ? 'ممتاز!' : 'إجابة غير صحيحة'}
            </span>
          </div>
          {!feedback.isCorrect && qType !== 'dictation' && (
            <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 14, background: C.bgElevated, borderRadius: 10, padding: '10px 12px' }}>
              إجابتك: <span style={{ color: C.red }}>{feedback.userAnswer || '—'}</span>
            </div>
          )}
          {feedback.dictationResult && (
            <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 14, background: C.bgElevated, borderRadius: 10, padding: '10px 12px', lineHeight: 1.9 }}>
              <div>الجملة: <EnglishText style={{ color: C.text }}>{feedback.dictationTarget}</EnglishText></div>
              <div>النتيجة: <span style={{ color: C.gold, fontFamily: "'JetBrains Mono', monospace" }}>{feedback.dictationResult.score}%</span> ({feedback.dictationResult.correctCount}/{feedback.dictationResult.total} كلمة صحيحة)</div>
              {feedback.dictationResult.missingWords.length > 0 && <div>كلمات ناقصة: <EnglishText style={{ color: C.red }}>{feedback.dictationResult.missingWords.join(', ')}</EnglishText></div>}
              {feedback.dictationResult.extraWords.length > 0 && <div>كلمات زائدة: <EnglishText style={{ color: C.gold }}>{feedback.dictationResult.extraWords.join(', ')}</EnglishText></div>}
              {feedback.dictationResult.misspelledPairs.length > 0 && <div>أخطاء إملائية: <EnglishText style={{ color: C.gold }}>{feedback.dictationResult.misspelledPairs.map(p => `${p.typed}→${p.correct}`).join(', ')}</EnglishText></div>}
            </div>
          )}
          <WordFullCard detail={detail} settings={settings} compact wordId={entry.id} />
          <button onClick={next} style={{ ...primaryBtnStyle, width: '100%', marginTop: 16 }}>
            التالي <ArrowRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

/* --------------------------------- Settings --------------------------------- */
function SettingsPage({ settings, saveSettings, wordsIndex, refreshIndex, showToast, streak, refreshStreak, refreshStories }) {
  const voices = useVoices();
  const [local, setLocal] = useState(settings);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => setLocal(settings), [settings]);

  const update = (patch) => {
    const next = { ...local, ...patch };
    setLocal(next);
    saveSettings(next);
  };

  const exportData = async () => {
    const details = {};
    for (const w of wordsIndex) details[w.id] = await db.getWordDetail(w.id);
    const storiesIndex = await db.getStoriesIndex();
    const storyDetails = {};
    for (const s of storiesIndex) storyDetails[s.id] = await db.getStoryDetail(s.id);
    const dailyKeys = await db.listDailyKeys();
    const dailyStats = {};
    for (const k of dailyKeys) {
      try { const r = await window.storage.get(k); if (r) dailyStats[k] = JSON.parse(r.value); } catch {}
    }
    const scenariosIndex = await db.getScenariosIndex();
    const payload = { version: 3, exportedAt: new Date().toISOString(), settings: local, wordsIndex, wordDetails: details, storiesIndex, storyDetails, scenariosIndex, streak, dailyStats };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `vocabbox-backup-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('تم تصدير النسخة الاحتياطية', 'success');
  };

  const importData = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.wordsIndex) || !parsed.settings) {
          showToast('ملف غير صالح — لم يتم استبدال البيانات', 'error');
          return;
        }
        if (!window.confirm('سيتم استبدال جميع بياناتك الحالية بالنسخة المستوردة. هل تريد المتابعة؟')) return;
        await db.saveSettings(parsed.settings);
        await db.saveWordsIndex(parsed.wordsIndex);
        for (const [id, detail] of Object.entries(parsed.wordDetails || {})) await db.saveWordDetail(id, detail);
        if (Array.isArray(parsed.storiesIndex)) {
          await db.saveStoriesIndex(parsed.storiesIndex);
          for (const [id, detail] of Object.entries(parsed.storyDetails || {})) await db.saveStoryDetail(id, detail);
        }
        if (parsed.scenariosIndex) await db.saveScenariosIndex(parsed.scenariosIndex);
        if (parsed.streak) await db.saveStreak(parsed.streak);
        for (const [k, v] of Object.entries(parsed.dailyStats || {})) await window.storage.set(k, JSON.stringify(v));
        await refreshIndex();
        await refreshStreak();
        if (refreshStories) await refreshStories();
        showToast('تم استعادة النسخة الاحتياطية بنجاح', 'success');
      } catch {
        showToast('تعذّرت قراءة الملف — لم يتم استبدال البيانات', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const doDeleteAll = async () => {
    await db.deleteAll();
    setConfirmDeleteAll(false);
    window.location.reload();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 90 }}>
      <h2 style={pageTitleStyle}>⚙️ الإعدادات</h2>

      <SettingsSection title="نظام Leitner (بالأيام)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6 }}>
          {[1, 2, 3, 4, 5].map(stage => (
            <div key={stage} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: C.textFaint, marginBottom: 4 }}>B{stage}</div>
              <input
                type="number" min={1}
                value={local.leitnerIntervals[stage]}
                onChange={e => update({ leitnerIntervals: { ...local.leitnerIntervals, [stage]: Math.max(1, parseInt(e.target.value) || 1) } })}
                style={{ width: '100%', background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 4px', color: C.text, textAlign: 'center', fontFamily: "'JetBrains Mono', monospace" }}
              />
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="الهدف اليومي">
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {['words', 'minutes'].map(t => (
            <button key={t} onClick={() => update({ dailyGoal: { ...local.dailyGoal, type: t } })} style={{ flex: 1, padding: '9px 0', borderRadius: 10, background: local.dailyGoal.type === t ? C.goldSoft : C.bgElevated, border: `1px solid ${local.dailyGoal.type === t ? C.gold : C.border}`, color: local.dailyGoal.type === t ? C.gold : C.textMuted, fontFamily: "'Cairo', sans-serif", fontSize: 13, fontWeight: 600 }}>
              {t === 'words' ? 'عدد كلمات' : 'دقائق'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(local.dailyGoal.type === 'words' ? [5, 10, 15, 20] : [10, 15, 20, 30]).map(v => (
            <button key={v} onClick={() => update({ dailyGoal: { ...local.dailyGoal, value: v } })} style={{ flex: 1, padding: '8px 0', borderRadius: 10, background: local.dailyGoal.value === v ? C.gold : C.bgElevated, border: `1px solid ${local.dailyGoal.value === v ? C.gold : C.border}`, color: local.dailyGoal.value === v ? '#14120F' : C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 13 }}>
              {v}
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="الصوت">
        {!speechSupported && <div style={{ fontSize: 13, color: C.textFaint, marginBottom: 8 }}>النطق الصوتي غير مدعوم في هذا المتصفح.</div>}
        <div style={labelStyle}>الصوت</div>
        <select
          value={local.audio.voiceURI}
          onChange={e => update({ audio: { ...local.audio, voiceURI: e.target.value } })}
          disabled={!speechSupported}
          style={{ width: '100%', background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', color: C.text, marginBottom: 12 }}
        >
          <option value="">افتراضي</option>
          {voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
        </select>
        <div style={labelStyle}>السرعة</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[0.75, 1, 1.25, 1.5].map(r => (
            <button key={r} onClick={() => update({ audio: { ...local.audio, rate: r } })} style={{ flex: 1, padding: '8px 0', borderRadius: 10, background: local.audio.rate === r ? C.gold : C.bgElevated, border: `1px solid ${local.audio.rate === r ? C.gold : C.border}`, color: local.audio.rate === r ? '#14120F' : C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 13 }}>
              {r}x
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="النسخ الاحتياطي والاستعادة">
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={exportData} style={{ ...secondaryBtnStyle, flex: 1 }}><Download size={15} /> تصدير</button>
          <button onClick={() => fileRef.current?.click()} style={{ ...secondaryBtnStyle, flex: 1 }}><Upload size={15} /> استعادة</button>
          <input ref={fileRef} type="file" accept="application/json" onChange={importData} style={{ display: 'none' }} />
        </div>
      </SettingsSection>

      <SettingsSection title="منطقة الخطر" danger>
        <button onClick={() => setConfirmDeleteAll(true)} style={{ width: '100%', padding: '12px 0', borderRadius: 12, background: C.redSoft, border: `1px solid rgba(193,104,90,0.4)`, color: C.red, fontFamily: "'Cairo', sans-serif", fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Trash2 size={15} /> حذف جميع البيانات
        </button>
      </SettingsSection>

      <ConfirmModal
        open={confirmDeleteAll}
        title="حذف جميع البيانات"
        body="هذا الإجراء نهائي ولا يمكن التراجع عنه. سيتم حذف كل الكلمات والتقدم والإحصائيات. اكتب DELETE للتأكيد."
        confirmLabel="حذف نهائيًا"
        danger
        requireText="DELETE"
        onConfirm={doDeleteAll}
        onCancel={() => setConfirmDeleteAll(false)}
      />
    </div>
  );
}

function SettingsSection({ title, children, danger }) {
  return (
    <div style={{ ...cardStyle, borderColor: danger ? 'rgba(193,104,90,0.3)' : C.borderSoft }}>
      <div style={{ ...labelStyle, marginBottom: 10, fontSize: 13, color: danger ? C.red : C.textMuted }}>{title}</div>
      {children}
    </div>
  );
}

/* --------------------------------- Interactive Dictionary Popup --------------------------------- */
function DictionaryPopup({ word, contextMeaning, translation, partOfSpeech, pronunciation, example, onClose, onAdd, alreadyAdded, settings }) {
  const [adding, setAdding] = useState(false);
  const handleAdd = async () => {
    setAdding(true);
    await onAdd();
    setAdding(false);
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 150, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '20px 20px 0 0', padding: 20, width: '100%', maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <EnglishText style={{ fontSize: 24, fontWeight: 600, color: C.text }}>{word}</EnglishText>
            <button onClick={() => speak(word, settings.audio)} style={iconBtnStyle}><Volume2 size={15} color={C.gold} /></button>
          </div>
          <button onClick={onClose} style={iconBtnStyle}><X size={15} color={C.textMuted} /></button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          {pronunciation && <span dir="ltr" style={{ fontSize: 12, color: C.textFaint, fontFamily: "'JetBrains Mono', monospace" }}>/{pronunciation}/</span>}
          {partOfSpeech && <span style={pillStyle(C.blueSoft, C.blue)}>{partOfSpeech}</span>}
        </div>
        <div style={{ fontSize: 19, color: C.gold, fontFamily: "'Cairo', sans-serif", fontWeight: 700, marginBottom: 6 }}>{translation}</div>
        {contextMeaning && <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 10, lineHeight: 1.7 }}>{contextMeaning}</div>}
        {example && (
          <div style={{ background: C.bgElevated, borderRadius: 10, padding: 10, marginBottom: 14, borderRight: `2px solid ${C.gold}` }}>
            <EnglishText style={{ fontSize: 13, color: C.textMuted }}>{example}</EnglishText>
          </div>
        )}
        <button onClick={handleAdd} disabled={alreadyAdded || adding} style={{ ...primaryBtnStyle, width: '100%', opacity: alreadyAdded ? 0.6 : 1 }}>
          {adding ? <Loader2 size={15} className="spin" /> : alreadyAdded ? <><Check size={15} /> مضافة بالفعل</> : <><Plus size={15} /> إضافة إلى VocabBox</>}
        </button>
      </div>
    </div>
  );
}

/* --------------------------------- Reading text with clickable words --------------------------------- */
function ReadableText({ text, onWordClick }) {
  const tokens = useMemo(() => tokenizeForReading(text), [text]);
  return (
    <p dir="ltr" style={{ fontFamily: "'Spectral', serif", fontSize: 17, lineHeight: 2, color: C.text, textAlign: 'left', margin: 0 }}>
      {tokens.map((tok, i) => {
        if (/^[a-zA-Z']+$/.test(tok)) {
          return (
            <span key={i} onClick={() => onWordClick(tok)} style={{ cursor: 'pointer', borderBottom: `1px dashed ${C.borderSoft}` }}>
              {tok}
            </span>
          );
        }
        return <React.Fragment key={i}>{tok}</React.Fragment>;
      })}
    </p>
  );
}

/* --------------------------------- Conversation Panel (reusable) --------------------------------- */
const MAX_CONVO_TURNS = 6;

function ConversationPanel({ context, targetVocab, targetPhrases, settings, showToast, onComplete }) {
  const [messages, setMessages] = useState([]);
  const [usage, setUsage] = useState(() => {
    const m = {};
    [...targetVocab.map(v => v.word), ...targetPhrases.map(p => p.phrase)].forEach(t => { m[t] = false; });
    return m;
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [turns, setTurns] = useState(0);
  const [ended, setEnded] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const scrollRef = useRef(null);
  const sendingRef = useRef(false);

  const applyUsage = (targetUsage) => {
    if (!Array.isArray(targetUsage)) return;
    setUsage(prev => {
      const next = { ...prev };
      for (const t of targetUsage) {
        if (t.used) {
          const key = Object.keys(next).find(k => k.toLowerCase() === (t.term || '').toLowerCase()) || t.term;
          if (key) next[key] = true;
        }
      }
      return next;
    });
  };

  const startConversation = useCallback(async () => {
    setLoading(true);
    try {
      const r = await generateConversationTurn({ context, targetVocab, targetPhrases, history: [], userMessage: null });
      setMessages([{ role: 'ai', text: r.reply }]);
      applyUsage(r.targetUsage);
      if (autoSpeak) speak(r.reply, settings.audio);
    } catch {
      setMessages([{ role: 'ai', text: "Hi! Let's start practicing. Tell me a bit about this topic." }]);
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line

  useEffect(() => { startConversation(); }, [startConversation]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading || sendingRef.current) return;
    sendingRef.current = true;
    setInput('');
    const newMessages = [...messages, { role: 'user', text }];
    setMessages(newMessages);
    setLoading(true);
    try {
      const history = newMessages.map(m => ({ role: m.role, text: m.text }));
      const r = await generateConversationTurn({ context, targetVocab, targetPhrases, history: history.slice(0, -1), userMessage: text });
      applyUsage(r.targetUsage);
      const withCorrection = r.correction?.hasError
        ? [...newMessages.slice(0, -1), { ...newMessages[newMessages.length - 1], correction: r.correction }]
        : newMessages;
      setMessages([...withCorrection, { role: 'ai', text: r.reply }]);
      if (autoSpeak) speak(r.reply, settings.audio);
      setTurns(t => t + 1);
    } catch {
      showToast('تعذّر الحصول على رد الآن، حاول مرة أخرى', 'error');
    } finally {
      setLoading(false);
      sendingRef.current = false;
    }
  };

  const finish = () => {
    setEnded(true);
    onComplete && onComplete(usage);
  };

  const usedCount = Object.values(usage).filter(Boolean).length;
  const totalTargets = Object.keys(usage).length;

  if (ended) {
    return (
      <div style={{ ...cardStyle, textAlign: 'center' }}>
        <Award size={26} color={C.gold} style={{ margin: '0 auto 10px' }} />
        <div style={{ fontFamily: "'Cairo', sans-serif", fontWeight: 700, color: C.text, marginBottom: 10 }}>انتهت المحادثة</div>
        <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 12 }}>استخدمت {usedCount} من {totalTargets} من الكلمات/العبارات المستهدفة</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
          {Object.entries(usage).map(([term, used]) => (
            <span key={term} style={pillStyle(used ? C.greenSoft : C.redSoft, used ? C.green : C.red)}>
              {used ? <Check size={10} style={{ display: 'inline', marginLeft: 3 }} /> : <X size={10} style={{ display: 'inline', marginLeft: 3 }} />} <EnglishText>{term}</EnglishText>
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {totalTargets > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {Object.entries(usage).map(([term, used]) => (
            <span key={term} style={pillStyle(used ? C.greenSoft : C.cardAlt, used ? C.green : C.textFaint)}>
              {used && <Check size={10} style={{ display: 'inline', marginLeft: 3 }} />} <EnglishText>{term}</EnglishText>
            </span>
          ))}
        </div>
      )}

      <div ref={scrollRef} style={{ ...cardStyle, maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'ai' ? 'flex-start' : 'flex-end' }}>
            <div style={{ maxWidth: '85%', background: m.role === 'ai' ? C.bgElevated : C.goldSoft, borderRadius: 12, padding: '9px 12px' }}>
              <EnglishText style={{ fontSize: 14, color: C.text }}>{m.text}</EnglishText>
            </div>
            {m.correction && (
              <div style={{ maxWidth: '85%', marginTop: 4, background: C.redSoft, borderRadius: 10, padding: '8px 10px', fontSize: 12 }}>
                <div style={{ color: C.red }}>الأفضل: <EnglishText>{m.correction.better}</EnglishText></div>
                <div style={{ color: C.textMuted, marginTop: 2 }}>{m.correction.why}</div>
              </div>
            )}
          </div>
        ))}
        {loading && <div style={{ alignSelf: 'flex-start' }}><Loader2 size={16} className="spin" color={C.textFaint} /></div>}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          dir="ltr"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="type your reply in English..."
          disabled={loading}
          style={{ flex: 1, background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 12, padding: '11px 14px', color: C.text, fontFamily: "'Spectral', serif", fontSize: 16 }}
        />
        <button onClick={send} disabled={loading || !input.trim()} style={{ ...primaryBtnStyle, width: 52, padding: 0, opacity: (loading || !input.trim()) ? 0.5 : 1 }}><ArrowRight size={16} /></button>
      </div>
      <button onClick={finish} disabled={turns < 2} style={{ ...secondaryBtnStyle, opacity: turns < 2 ? 0.5 : 1 }}>
        {turns < 2 ? 'تحدّث أكثر لإنهاء الجلسة' : 'إنهاء المحادثة'}
      </button>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/* --------------------------------- Stories List --------------------------------- */
function StoriesListPage({ storiesIndex, onOpen, onAddNew, onOpenPhrases }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={pageTitleStyle}>📖 القصص</h2>
        <button onClick={onAddNew} style={{ ...primaryBtnStyle, padding: '8px 14px' }}><Plus size={15} /> قصة جديدة</button>
      </div>

      <button onClick={onOpenPhrases} style={{ ...secondaryBtnStyle, alignSelf: 'flex-start', padding: '7px 12px', fontSize: 12 }}>
        <MessageCircle size={13} /> عرض كل العبارات المستخرجة
      </button>

      {storiesIndex.length === 0 && (
        <div style={{ ...cardStyle, textAlign: 'center', padding: 28 }}>
          <BookMarked size={28} color={C.textFaint} style={{ margin: '0 auto 10px' }} />
          <div style={{ color: C.textMuted, fontSize: 14, lineHeight: 1.8 }}>لا توجد قصص بعد.<br />أضف أول قصة لتبدأ التعلم من خلالها.</div>
        </div>
      )}

      {storiesIndex.map(s => {
        const pct = s.partsCount ? Math.round((s.completedParts / s.partsCount) * 100) : 0;
        return (
          <button key={s.id} onClick={() => onOpen(s.id)} style={{ ...cardStyle, textAlign: 'right', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: "'Cairo', sans-serif", fontWeight: 700, fontSize: 15, color: C.text }}>{s.title}</span>
              <span style={pillStyle(C.goldSoft, C.gold)}>{s.level}</span>
            </div>
            <div style={{ fontSize: 12, color: C.textFaint }}>{s.partsCount} أجزاء · {s.wordsCount || 0} كلمة</div>
            <div style={{ height: 6, borderRadius: 999, background: C.bgElevated, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? C.green : C.gold, borderRadius: 999 }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------- Add Story --------------------------------- */
function AddStoryPage({ storiesIndex, refreshStories, showToast, onDone }) {
  const [title, setTitle] = useState('');
  const [level, setLevel] = useState('auto');
  const [inputMode, setInputMode] = useState('write'); // write | txt | docx
  const [content, setContent] = useState('');
  const [numParts, setNumParts] = useState('auto');
  const [processing, setProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const fileRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (inputMode === 'txt') {
      const text = await file.text();
      setContent(text);
    } else if (inputMode === 'docx') {
      try {
        const buf = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: buf });
        setContent(result.value || '');
      } catch {
        showToast('تعذّر قراءة ملف DOCX', 'error');
      }
    }
    if (!title) setTitle(file.name.replace(/\.(txt|docx)$/i, ''));
  };

  const handleCreate = async () => {
    const text = content.trim();
    if (!text || text.split(/\s+/).length < 15) {
      showToast('أدخل نصًا إنجليزيًا لا يقل عن بضع جمل', 'error');
      return;
    }
    setProcessing(true);
    try {
      const storyDetail = await buildAndSaveStory({
        text, title: title.trim(), level, numParts,
        onProgress: (msg) => setProgressMsg(msg),
      });
      await refreshStories();
      if (storyDetail.failedParts > 0) {
        showToast(`تم إنشاء القصة، لكن تعذّر تحليل ${storyDetail.failedParts} من ${storyDetail.parts.length} أجزاء تلقائيًا — يمكنك فتح الجزء وسيبقى قابلاً للاستخدام بدون مفردات/اختبار مستخرج`, 'info');
      } else {
        showToast('تم إنشاء القصة بنجاح', 'success');
      }
      onDone(storyDetail.id);
    } catch (e) {
      showToast('حدث خطأ أثناء معالجة القصة', 'error');
    } finally {
      setProcessing(false);
      setProgressMsg('');
    }
  };

  if (processing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', gap: 16 }}>
        <Loader2 size={30} color={C.gold} className="spin" />
        <div style={{ color: C.textMuted, fontSize: 14, textAlign: 'center' }}>{progressMsg}</div>
        <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => onDone(null)} style={iconBtnStyle}><ChevronRight size={16} color={C.textMuted} /></button>
        <h2 style={pageTitleStyle}>قصة جديدة</h2>
      </div>

      <div style={cardStyle}>
        <div style={labelStyle}>عنوان القصة</div>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="مثال: رحلة إلى باريس" style={{ width: '100%', background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', color: C.text, marginBottom: 14 }} />

        <div style={labelStyle}>المستوى</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {['auto', 'A1', 'A2', 'B1', 'B2', 'C1'].map(l => (
            <button key={l} onClick={() => setLevel(l)} style={{ padding: '7px 12px', borderRadius: 10, background: level === l ? C.gold : C.bgElevated, border: `1px solid ${level === l ? C.gold : C.border}`, color: level === l ? '#14120F' : C.textMuted, fontSize: 13, fontFamily: "'Cairo', sans-serif", fontWeight: 600 }}>
              {l === 'auto' ? 'تلقائي (AI)' : l}
            </button>
          ))}
        </div>

        <div style={labelStyle}>طريقة الإدخال</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {[{ id: 'write', icon: Type, label: 'كتابة' }, { id: 'txt', icon: FileText, label: 'TXT' }, { id: 'docx', icon: FileText, label: 'DOCX' }].map(m => (
            <button key={m.id} onClick={() => { setInputMode(m.id); setContent(''); }} style={{ flex: 1, padding: '9px 0', borderRadius: 10, background: inputMode === m.id ? C.goldSoft : C.bgElevated, border: `1px solid ${inputMode === m.id ? C.gold : C.border}`, color: inputMode === m.id ? C.gold : C.textMuted, fontSize: 13, fontFamily: "'Cairo', sans-serif", fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <m.icon size={13} /> {m.label}
            </button>
          ))}
        </div>

        {inputMode === 'write' ? (
          <textarea dir="ltr" value={content} onChange={e => setContent(e.target.value)} placeholder="Paste or write the English story here..." rows={8} style={{ width: '100%', background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', color: C.text, fontFamily: "'Spectral', serif", fontSize: 16, resize: 'vertical' }} />
        ) : (
          <div>
            <button onClick={() => fileRef.current?.click()} style={{ ...secondaryBtnStyle, width: '100%' }}><Upload size={15} /> اختر ملف {inputMode.toUpperCase()}</button>
            <input ref={fileRef} type="file" accept={inputMode === 'txt' ? '.txt' : '.docx'} onChange={handleFile} style={{ display: 'none' }} />
            {content && <div style={{ marginTop: 10, fontSize: 12, color: C.green }}>✓ تم تحميل {content.trim().split(/\s+/).length} كلمة</div>}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={labelStyle}>عدد الأجزاء</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['auto', 3, 5, 10].map(n => (
            <button key={n} onClick={() => setNumParts(n)} style={{ flex: 1, padding: '9px 0', borderRadius: 10, background: numParts === n ? C.gold : C.bgElevated, border: `1px solid ${numParts === n ? C.gold : C.border}`, color: numParts === n ? '#14120F' : C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 13 }}>
              {n === 'auto' ? 'تلقائي' : n}
            </button>
          ))}
        </div>
      </div>

      <button onClick={handleCreate} style={primaryBtnStyle}><Sparkles size={16} /> إنشاء وتحليل القصة</button>
    </div>
  );
}

/* --------------------------------- Story Part Page --------------------------------- */
function StoryPartPage({ story, part, wordsIndex, onUpdatePart, onBack, settings, showToast }) {
  const [tab, setTab] = useState('reading');
  const [popupWord, setPopupWord] = useState(null);
  const [speaking, setSpeaking] = useState(false);
  const [quizPos, setQuizPos] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState([]);
  const [quizFeedback, setQuizFeedback] = useState(null);
  const [expandedPhrase, setExpandedPhrase] = useState(null);
  const [phraseLoading, setPhraseLoading] = useState(null);

  const addedKeys = useMemo(() => new Set(wordsIndex.map(w => w.normalizedKey)), [wordsIndex]);

  const patchPart = (patch) => onUpdatePart({ ...part, ...patch });
  const patchProgress = (patch) => patchPart({ progress: { ...part.progress, ...patch } });

  const openWordPopup = (tok) => {
    const nk = normalizeKey(tok);
    const known = part.vocabulary.find(v => normalizeKey(v.word) === nk);
    setPopupWord({
      word: tok,
      translation: known?.translation || '',
      contextMeaning: known?.contextMeaning || '',
      partOfSpeech: known?.partOfSpeech || '',
      pronunciation: known?.pronunciation || '',
      example: findOriginalSentence(tok, part.content),
      known: !!known,
    });
  };

  const addWordFromPopup = async (w) => {
    const res = await addWordToBox(w.word, {
      storyId: story.id, storyTitle: story.title,
      fallbackTranslation: w.translation, fallbackContext: w.contextMeaning, fallbackPOS: w.partOfSpeech, fallbackPronunciation: w.pronunciation,
    });
    if (res.status === 'duplicate') showToast('هذه الكلمة موجودة بالفعل', 'info');
    else showToast('تمت الإضافة إلى VocabBox', 'success');
    if (w.known) {
      patchPart({ vocabulary: part.vocabulary.map(v => v.word === w.word ? { ...v, addedToBox: true } : v) });
    }
    setPopupWord(null);
  };

  const playListening = () => {
    if (!speechSupported) { showToast('النطق غير مدعوم في هذا المتصفح', 'error'); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(part.content);
    u.lang = 'en-US';
    u.rate = settings.audio.rate;
    if (settings.audio.voiceURI) {
      const v = window.speechSynthesis.getVoices().find(v => v.voiceURI === settings.audio.voiceURI);
      if (v) u.voice = v;
    }
    u.onend = () => { setSpeaking(false); patchProgress({ listening: true }); };
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  };
  const stopListening = () => { window.speechSynthesis.cancel(); setSpeaking(false); };

  const expandPhrase = async (phrase) => {
    if (phrase.detail) { setExpandedPhrase(expandedPhrase === phrase.id ? null : phrase.id); return; }
    setPhraseLoading(phrase.id);
    try {
      const sentence = findOriginalSentence(phrase.phrase.split(' ')[0], part.content);
      const detail = await generatePhraseDetail(phrase.phrase, sentence);
      patchPart({ phrases: part.phrases.map(p => p.id === phrase.id ? { ...p, detail } : p) });
      setExpandedPhrase(phrase.id);
    } catch {
      showToast('تعذّر تحميل تفاصيل العبارة الآن', 'error');
    } finally {
      setPhraseLoading(null);
    }
  };

  const submitQuizAnswer = (optIndex) => {
    const q = part.quiz[quizPos];
    const correct = optIndex === q.correctIndex;
    setQuizFeedback({ correct, optIndex });
    setQuizAnswers(a => [...a, correct]);
    if (q.relatedWord) {
      const match = wordsIndex.find(w => w.normalizedKey === normalizeKey(q.relatedWord));
      if (match) bumpWordSkill(match.id, 'context', correct);
    }
  };
  const nextQuiz = () => {
    setQuizFeedback(null);
    if (quizPos + 1 >= part.quiz.length) {
      const score = Math.round((quizAnswers.filter(Boolean).length / part.quiz.length) * 100);
      patchProgress({ quizDone: true, quizScore: score });
    } else {
      setQuizPos(p => p + 1);
    }
  };

  const tabs = [
    { id: 'reading', icon: BookOpen, label: 'قراءة', done: part.progress.reading },
    { id: 'listening', icon: Headphones, label: 'استماع', done: part.progress.listening },
    { id: 'vocabulary', icon: Layers, label: 'مفردات', done: part.progress.vocabReviewed },
    { id: 'phrases', icon: MessageSquareText, label: 'عبارات', done: false, optional: true },
    { id: 'quiz', icon: CheckCircle2, label: 'اختبار', done: part.progress.quizDone },
    { id: 'conversation', icon: MessageCircle, label: 'محادثة', done: part.progress.conversationDone },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={iconBtnStyle}><ChevronRight size={16} color={C.textMuted} /></button>
        <div>
          <div style={{ fontSize: 12, color: C.textFaint }}>{story.title}</div>
          <div style={{ fontFamily: "'Cairo', sans-serif", fontWeight: 700, fontSize: 16, color: C.text }}>{part.title}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 10px', borderRadius: 10, background: tab === t.id ? C.goldSoft : 'transparent', border: `1px solid ${tab === t.id ? C.gold : 'transparent'}`, whiteSpace: 'nowrap', color: tab === t.id ? C.gold : C.textMuted, fontSize: 12, fontFamily: "'Cairo', sans-serif", fontWeight: 600, flexShrink: 0 }}>
            <t.icon size={13} /> {t.label} {t.done && <Check size={11} color={C.green} />}
          </button>
        ))}
      </div>

      {tab === 'reading' && (
        <div style={cardStyle}>
          <ReadableText text={part.content} onWordClick={openWordPopup} />
          {!part.progress.reading && (
            <button onClick={() => patchProgress({ reading: true })} style={{ ...primaryBtnStyle, width: '100%', marginTop: 16 }}><Check size={15} /> أكملت القراءة</button>
          )}
        </div>
      )}

      {tab === 'listening' && (
        <div style={{ ...cardStyle, textAlign: 'center', padding: 28 }}>
          <button onClick={speaking ? stopListening : playListening} style={{ ...iconBtnStyle, padding: 22, borderRadius: 999, margin: '0 auto 16px' }}>
            {speaking ? <StopCircle size={30} color={C.red} /> : <Volume2 size={30} color={C.gold} />}
          </button>
          <div style={{ color: C.textMuted, fontSize: 13, marginBottom: 6 }}>{speaking ? 'جارٍ الاستماع...' : 'اضغط للاستماع للمقطع كاملًا'}</div>
          <div style={{ fontSize: 12, color: C.textFaint }}>السرعة: {settings.audio.rate}x (يمكن تغييرها من الإعدادات)</div>
          {part.progress.listening && <div style={{ marginTop: 14, color: C.green, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Check size={14} /> أكملت الاستماع</div>}
        </div>
      )}

      {tab === 'vocabulary' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {['essential', 'useful', 'advanced'].map(cls => {
            const items = part.vocabulary.filter(v => v.classification === cls);
            if (!items.length) return null;
            const labels = { essential: '🔑 أساسية', useful: '👍 مفيدة', advanced: '⭐ متقدمة' };
            return (
              <div key={cls}>
                <div style={{ ...labelStyle, marginBottom: 8 }}>{labels[cls]}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {items.map(v => {
                    const already = addedKeys.has(normalizeKey(v.word)) || v.addedToBox;
                    return (
                      <div key={v.id} style={cardStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <EnglishText style={{ fontSize: 17, fontWeight: 600, color: C.text }}>{v.word}</EnglishText>
                            <button onClick={() => speak(v.word, settings.audio)} style={{ ...iconBtnStyle, padding: 5 }}><Volume2 size={13} color={C.gold} /></button>
                          </div>
                          <span style={{ color: C.gold, fontFamily: "'Cairo', sans-serif", fontWeight: 700, fontSize: 14 }}>{v.translation}</span>
                        </div>
                        {v.contextMeaning && <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>{v.contextMeaning}</div>}
                        <button onClick={() => addWordFromPopup(v)} disabled={already} style={{ ...secondaryBtnStyle, width: '100%', padding: '8px 0', fontSize: 12, opacity: already ? 0.6 : 1 }}>
                          {already ? <><Check size={13} /> مضافة</> : <><Plus size={13} /> إضافة إلى VocabBox</>}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {part.vocabulary.length === 0 && <div style={{ ...cardStyle, textAlign: 'center', color: C.textFaint, fontSize: 13 }}>لم يتم استخراج مفردات لهذا الجزء</div>}
          {!part.progress.vocabReviewed && part.vocabulary.length > 0 && (
            <button onClick={() => patchProgress({ vocabReviewed: true })} style={primaryBtnStyle}><Check size={15} /> أكملت مراجعة المفردات</button>
          )}
        </div>
      )}

      {tab === 'phrases' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {part.phrases.length === 0 && <div style={{ ...cardStyle, textAlign: 'center', color: C.textFaint, fontSize: 13 }}>لا توجد عبارات مستخرجة لهذا الجزء</div>}
          {part.phrases.map(p => (
            <div key={p.id} style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <EnglishText style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{p.phrase}</EnglishText>
                <button onClick={() => expandPhrase(p)} style={iconBtnStyle}>
                  {phraseLoading === p.id ? <Loader2 size={14} className="spin" color={C.gold} /> : (expandedPhrase === p.id ? <ChevronUp size={14} color={C.textMuted} /> : <ChevronDown size={14} color={C.textMuted} />)}
                </button>
              </div>
              <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>{p.meaning}</div>
              {expandedPhrase === p.id && p.detail && (
                <div style={{ marginTop: 12, borderTop: `1px solid ${C.borderSoft}`, paddingTop: 12 }}>
                  <div style={{ fontSize: 12, color: C.textFaint, marginBottom: 6 }}>{p.detail.explanation}</div>
                  {p.detail.examples?.map((ex, i) => (
                    <div key={i} style={{ background: C.bgElevated, borderRadius: 8, padding: 8, marginBottom: 6 }}>
                      <EnglishText style={{ fontSize: 13, color: C.text }}>{ex.english}</EnglishText>
                      <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{ex.arabic}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'quiz' && (
        <div>
          {part.quiz.length === 0 && <div style={{ ...cardStyle, textAlign: 'center', color: C.textFaint, fontSize: 13 }}>لا يوجد اختبار لهذا الجزء</div>}
          {part.progress.quizDone && (
            <div style={{ ...cardStyle, textAlign: 'center' }}>
              <Award size={26} color={C.gold} style={{ margin: '0 auto 8px' }} />
              <div style={{ fontFamily: "'Cairo', sans-serif", fontWeight: 700, color: C.text }}>نتيجتك: {part.progress.quizScore}%</div>
              <button onClick={() => { patchProgress({ quizDone: false, quizScore: null }); setQuizPos(0); setQuizAnswers([]); }} style={{ ...secondaryBtnStyle, width: '100%', marginTop: 12 }}><RefreshCw size={14} /> إعادة الاختبار</button>
            </div>
          )}
          {!part.progress.quizDone && part.quiz.length > 0 && (
            <div style={cardStyle}>
              <div style={{ fontSize: 12, color: C.textFaint, marginBottom: 10 }}>سؤال {quizPos + 1} من {part.quiz.length}</div>
              <div style={{ fontSize: 15, color: C.text, marginBottom: 14, lineHeight: 1.8 }}>{part.quiz[quizPos].question}</div>
              {!quizFeedback ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {part.quiz[quizPos].options.map((opt, i) => (
                    <button key={i} onClick={() => submitQuizAnswer(i)} style={{ textAlign: 'right', padding: '11px 14px', borderRadius: 10, background: C.bgElevated, border: `1px solid ${C.border}`, color: C.text, fontSize: 14 }}>{opt}</button>
                  ))}
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: quizFeedback.correct ? C.green : C.red }}>
                    {quizFeedback.correct ? <Check size={16} /> : <X size={16} />}
                    {quizFeedback.correct ? 'إجابة صحيحة' : `الإجابة الصحيحة: ${part.quiz[quizPos].options[part.quiz[quizPos].correctIndex]}`}
                  </div>
                  <button onClick={nextQuiz} style={{ ...primaryBtnStyle, width: '100%' }}>التالي <ArrowRight size={15} /></button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'conversation' && (
        <div>
          {(part.vocabulary.length === 0 && part.phrases.length === 0) ? (
            <div style={{ ...cardStyle, textAlign: 'center', color: C.textFaint, fontSize: 13 }}>لا توجد مفردات أو عبارات مستهدفة لهذا الجزء لبناء محادثة عليها</div>
          ) : (
            <ConversationPanel
              context={`${story.title} — ${part.title}`}
              targetVocab={part.vocabulary.slice(0, 5).map(v => ({ word: v.word, translation: v.translation }))}
              targetPhrases={part.phrases.slice(0, 3).map(p => ({ phrase: p.phrase, meaning: p.meaning }))}
              settings={settings}
              showToast={showToast}
              onComplete={(usage) => {
                patchProgress({ conversationDone: true });
                Object.entries(usage || {}).forEach(([term, used]) => {
                  const match = wordsIndex.find(w => w.normalizedKey === normalizeKey(term));
                  if (match) bumpWordSkill(match.id, 'conversation', used);
                });
              }}
            />
          )}
        </div>
      )}

      {popupWord && (
        <DictionaryPopup
          {...popupWord}
          alreadyAdded={addedKeys.has(normalizeKey(popupWord.word))}
          onAdd={() => addWordFromPopup(popupWord)}
          onClose={() => setPopupWord(null)}
          settings={settings}
        />
      )}
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/* --------------------------------- Story Detail --------------------------------- */
function isPartComplete(p) {
  const hasConvTargets = (p.vocabulary.length > 0 || p.phrases.length > 0);
  return p.progress.reading && p.progress.listening && p.progress.vocabReviewed && p.progress.quizDone && (!hasConvTargets || p.progress.conversationDone);
}

function StoryDetailPage({ storyId, wordsIndex, showToast, onBack, settings, refreshStories, initialPartId }) {
  const [story, setStory] = useState(null);
  const [activePartId, setActivePartId] = useState(initialPartId || null);
  const [showOriginal, setShowOriginal] = useState(false);

  const load = useCallback(async () => {
    const s = await db.getStoryDetail(storyId);
    setStory(s);
  }, [storyId]);

  useEffect(() => { load(); }, [load]);

  const updatePart = async (updatedPart) => {
    const newParts = story.parts.map(p => p.id === updatedPart.id ? updatedPart : p);
    const newStory = { ...story, parts: newParts };
    setStory(newStory);
    await db.saveStoryDetail(story.id, newStory);
    const completed = newParts.filter(p => isPartComplete(p)).length;
    const idx = await db.getStoriesIndex();
    await db.saveStoriesIndex(idx.map(s => s.id === story.id ? { ...s, completedParts: completed } : s));
    await refreshStories();
  };

  if (!story) return <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={24} color={C.gold} className="spin" /><style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>;

  if (activePartId) {
    const part = story.parts.find(p => p.id === activePartId);
    return <StoryPartPage story={story} part={part} wordsIndex={wordsIndex} onUpdatePart={updatePart} onBack={() => setActivePartId(null)} settings={settings} showToast={showToast} />;
  }

  const completed = story.parts.filter(p => isPartComplete(p)).length;
  const allDone = completed === story.parts.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={iconBtnStyle}><ChevronRight size={16} color={C.textMuted} /></button>
        <h2 style={pageTitleStyle}>{story.title}</h2>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={pillStyle(C.goldSoft, C.gold)}>{story.level}</span>
        <span style={pillStyle(C.cardAlt, C.textMuted)}>{story.parts.length} أجزاء</span>
        {allDone && <span style={pillStyle(C.greenSoft, C.green)}>✓ القصة مكتملة</span>}
      </div>

      {story.theme && <div style={{ fontSize: 13, color: C.textMuted }}>{story.theme}</div>}

      <button onClick={() => setShowOriginal(s => !s)} style={{ ...secondaryBtnStyle, alignSelf: 'flex-start', padding: '7px 12px', fontSize: 12 }}>
        <Eye size={13} /> {showOriginal ? 'إخفاء النص الأصلي' : 'عرض النص الأصلي'}
      </button>
      {showOriginal && (
        <div style={{ ...cardStyle, maxHeight: 220, overflowY: 'auto' }}>
          <EnglishText style={{ fontSize: 14, color: C.textMuted, lineHeight: 1.9 }}>{story.originalText}</EnglishText>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {story.parts.map((p, i) => {
          const signals = [p.progress.reading, p.progress.listening, p.progress.vocabReviewed, p.progress.quizDone, p.progress.conversationDone];
          const doneCount = signals.filter(Boolean).length;
          const pct = isPartComplete(p) ? 100 : Math.round((doneCount / 5) * 100);
          return (
            <button key={p.id} onClick={() => setActivePartId(p.id)} style={{ ...cardStyle, textAlign: 'right', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: pct === 100 ? C.greenSoft : C.bgElevated, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: pct === 100 ? C.green : C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 13 }}>
                {pct === 100 ? <Check size={16} /> : i + 1}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "'Cairo', sans-serif", fontWeight: 600, fontSize: 14, color: C.text }}>{p.title}</div>
                <div style={{ height: 4, borderRadius: 999, background: C.bgElevated, overflow: 'hidden', marginTop: 6 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: C.gold, borderRadius: 999 }} />
                </div>
              </div>
              <ChevronLeft size={16} color={C.textFaint} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------------- Scenarios --------------------------------- */
function ScenariosListPage({ onOpenStory, showToast }) {
  const [scenariosIndex, setScenariosIndex] = useState({});
  const [loading, setLoading] = useState(true);
  const [generatingId, setGeneratingId] = useState(null);
  const [progressMsg, setProgressMsg] = useState('');

  useEffect(() => { (async () => { setScenariosIndex(await db.getScenariosIndex()); setLoading(false); })(); }, []);

  const openScenario = async (s) => {
    const existing = scenariosIndex[s.id];
    if (existing?.storyId) {
      onOpenStory(existing.storyId);
      return;
    }
    setGeneratingId(s.id);
    try {
      setProgressMsg('جارٍ إنشاء قصة السيناريو...');
      const gen = await generateScenarioStory(s.label, s.en);
      const storyDetail = await buildAndSaveStory({
        text: gen.text, title: gen.title || s.label, level: 'auto', numParts: 'auto',
        scenarioId: s.id, onProgress: (msg) => setProgressMsg(msg),
      });
      const idx = await db.getScenariosIndex();
      const updated = { ...idx, [s.id]: { storyId: storyDetail.id, createdAt: new Date().toISOString() } };
      await db.saveScenariosIndex(updated);
      setScenariosIndex(updated);
      if (storyDetail.failedParts > 0) showToast(`تعذّر تحليل ${storyDetail.failedParts} من أجزاء هذا السيناريو تلقائيًا`, 'info');
      onOpenStory(storyDetail.id);
    } catch {
      showToast('تعذّر إنشاء محتوى هذا السيناريو الآن، حاول لاحقًا', 'error');
    } finally {
      setGeneratingId(null);
      setProgressMsg('');
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={24} color={C.gold} className="spin" /><style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 90 }}>
      <h2 style={pageTitleStyle}>🎯 السيناريوهات</h2>
      <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.8 }}>مواقف حياتية واقعية — مفردات وعبارات وقصة قصيرة ومحادثة مبنية عليها.</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {SCENARIOS.map(s => {
          const done = !!scenariosIndex[s.id]?.storyId;
          const isGenerating = generatingId === s.id;
          return (
            <button key={s.id} onClick={() => openScenario(s)} disabled={!!generatingId} style={{ ...cardStyle, textAlign: 'center', cursor: 'pointer', opacity: generatingId && !isGenerating ? 0.5 : 1, position: 'relative' }}>
              {done && <span style={{ position: 'absolute', top: 8, left: 8 }}><Check size={13} color={C.green} /></span>}
              {isGenerating ? (
                <Loader2 size={26} className="spin" color={C.gold} style={{ margin: '4px auto 8px' }} />
              ) : (
                <div style={{ fontSize: 26, marginBottom: 6 }}>{s.icon}</div>
              )}
              <div style={{ fontFamily: "'Cairo', sans-serif", fontWeight: 600, fontSize: 13, color: C.text }}>{s.label}</div>
              {isGenerating && <div style={{ fontSize: 10, color: C.textFaint, marginTop: 4 }}>{progressMsg}</div>}
            </button>
          );
        })}
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/* --------------------------------- Global Phrases Hub --------------------------------- */
function PhrasesPage({ storiesIndex, wordsIndex, settings, showToast, onBack }) {
  const [loading, setLoading] = useState(true);
  const [phrases, setPhrases] = useState([]); // {id, phrase, meaning, storyTitle, storyId, sentence, detail}
  const [expandedId, setExpandedId] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(null);
  const [query, setQuery] = useState('');
  const [practicingPhrase, setPracticingPhrase] = useState(null);

  useEffect(() => {
    (async () => {
      const seen = new Set();
      const all = [];
      for (const s of storiesIndex) {
        const detail = await db.getStoryDetail(s.id);
        if (!detail) continue;
        for (const part of detail.parts) {
          for (const p of part.phrases) {
            const key = normalizeKey(p.phrase);
            if (seen.has(key)) continue;
            seen.add(key);
            all.push({ id: p.id, phrase: p.phrase, meaning: p.meaning, storyTitle: detail.title, storyId: detail.id, sentence: findOriginalSentence(p.phrase.split(' ')[0], part.content), detail: p.detail || null });
          }
        }
      }
      setPhrases(all);
      setLoading(false);
    })();
  }, [storiesIndex]);

  const filtered = phrases.filter(p => !query.trim() || p.phrase.toLowerCase().includes(query.toLowerCase()) || p.meaning.includes(query));

  const expand = async (p) => {
    if (p.detail) { setExpandedId(expandedId === p.id ? null : p.id); return; }
    setLoadingDetail(p.id);
    try {
      const detail = await generatePhraseDetail(p.phrase, p.sentence);
      setPhrases(prev => prev.map(x => x.id === p.id ? { ...x, detail } : x));
      setExpandedId(p.id);
    } catch {
      showToast('تعذّر تحميل التفاصيل الآن', 'error');
    } finally {
      setLoadingDetail(null);
    }
  };

  if (practicingPhrase) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 90 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => setPracticingPhrase(null)} style={iconBtnStyle}><ChevronRight size={16} color={C.textMuted} /></button>
          <h2 style={pageTitleStyle}>تدرّب: <EnglishText>{practicingPhrase.phrase}</EnglishText></h2>
        </div>
        <ConversationPanel
          context={`Practicing the phrase "${practicingPhrase.phrase}" naturally`}
          targetVocab={[]}
          targetPhrases={[{ phrase: practicingPhrase.phrase, meaning: practicingPhrase.meaning }]}
          settings={settings}
          showToast={showToast}
          onComplete={() => {}}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={iconBtnStyle}><ChevronRight size={16} color={C.textMuted} /></button>
        <h2 style={pageTitleStyle}>💬 العبارات</h2>
      </div>

      <div style={{ position: 'relative' }}>
        <Search size={15} color={C.textFaint} style={{ position: 'absolute', top: 12, right: 12 }} />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث عن عبارة..." style={{ width: '100%', background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 38px 10px 12px', color: C.text }} />
      </div>

      {loading && <div style={{ padding: 30, textAlign: 'center' }}><Loader2 size={22} color={C.gold} className="spin" /></div>}
      {!loading && filtered.length === 0 && <div style={{ ...cardStyle, textAlign: 'center', color: C.textFaint, fontSize: 13 }}>لا توجد عبارات مطابقة. العبارات تُستخرج تلقائيًا من القصص والسيناريوهات.</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(p => (
          <div key={p.id} style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <EnglishText style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{p.phrase}</EnglishText>
              <button onClick={() => expand(p)} style={iconBtnStyle}>
                {loadingDetail === p.id ? <Loader2 size={14} className="spin" color={C.gold} /> : (expandedId === p.id ? <ChevronUp size={14} color={C.textMuted} /> : <ChevronDown size={14} color={C.textMuted} />)}
              </button>
            </div>
            <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>{p.meaning}</div>
            <div style={{ fontSize: 11, color: C.textFaint, marginTop: 4 }}>من: {p.storyTitle}</div>
            {expandedId === p.id && p.detail && (
              <div style={{ marginTop: 12, borderTop: `1px solid ${C.borderSoft}`, paddingTop: 12 }}>
                <div style={{ fontSize: 12, color: C.textFaint, marginBottom: 8 }}>{p.detail.explanation}</div>
                {p.detail.examples?.map((ex, i) => (
                  <div key={i} style={{ background: C.bgElevated, borderRadius: 8, padding: 8, marginBottom: 6 }}>
                    <EnglishText style={{ fontSize: 13, color: C.text }}>{ex.english}</EnglishText>
                    <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{ex.arabic}</div>
                  </div>
                ))}
                <button onClick={() => setPracticingPhrase(p)} style={{ ...secondaryBtnStyle, width: '100%', marginTop: 6, fontSize: 12 }}><MessageCircle size={13} /> تدرّب في محادثة</button>
              </div>
            )}
          </div>
        ))}
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/* --------------------------------- Learning Path --------------------------------- */
function LearningPathPage({ wordsIndex, storiesIndex, onBack, onOpenStory, showToast }) {
  const [generatingLevel, setGeneratingLevel] = useState(null);
  const [progressMsg, setProgressMsg] = useState('');
  const estimatedLevel = useMemo(() => estimateUserLevel(wordsIndex, storiesIndex), [wordsIndex, storiesIndex]);

  const createLevelStory = async (level) => {
    setGeneratingLevel(level);
    try {
      setProgressMsg('جارٍ كتابة قصة جديدة بهذا المستوى...');
      const gen = await generateLevelStory(level);
      const storyDetail = await buildAndSaveStory({ text: gen.text, title: gen.title, level, numParts: 'auto', onProgress: setProgressMsg });
      if (storyDetail.failedParts > 0) showToast(`تعذّر تحليل ${storyDetail.failedParts} من أجزاء القصة تلقائيًا`, 'info');
      onOpenStory(storyDetail.id);
    } catch {
      showToast('تعذّر إنشاء قصة لهذا المستوى الآن', 'error');
    } finally {
      setGeneratingLevel(null);
      setProgressMsg('');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={iconBtnStyle}><ChevronRight size={16} color={C.textMuted} /></button>
        <h2 style={pageTitleStyle}>🗺️ مسار التعلم</h2>
      </div>

      <div style={{ ...cardStyle, textAlign: 'center', background: C.goldSoft, border: `1px solid rgba(212,162,76,0.3)` }}>
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 4 }}>مستواك التقديري (بناءً على تقدمك الفعلي)</div>
        <div style={{ fontSize: 30, fontWeight: 800, color: C.gold, fontFamily: "'JetBrains Mono', monospace" }}>{estimatedLevel}</div>
      </div>

      <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.8 }}>يمكنك التعلم من أي مستوى تحتاجه، بلا ترتيب إلزامي.</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {CEFR_LEVELS.map(level => {
          const levelStories = storiesIndex.filter(s => s.level === level);
          const completed = levelStories.filter(s => s.partsCount > 0 && s.completedParts === s.partsCount).length;
          const isCurrent = level === estimatedLevel;
          const isGenerating = generatingLevel === level;
          return (
            <div key={level} style={{ ...cardStyle, border: isCurrent ? `1px solid ${C.gold}` : `1px solid ${C.borderSoft}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, fontSize: 18, color: isCurrent ? C.gold : C.text }}>{level}</span>
                  {isCurrent && <span style={pillStyle(C.goldSoft, C.gold)}>مستواك الحالي</span>}
                </div>
                <span style={{ fontSize: 12, color: C.textFaint }}>{completed}/{levelStories.length} قصص مكتملة</span>
              </div>

              {levelStories.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                  {levelStories.slice(0, 3).map(s => (
                    <button key={s.id} onClick={() => onOpenStory(s.id)} style={{ textAlign: 'right', background: C.bgElevated, border: `1px solid ${C.borderSoft}`, borderRadius: 8, padding: '8px 10px', color: C.textMuted, fontSize: 12, cursor: 'pointer' }}>
                      {s.title} {s.partsCount > 0 && s.completedParts === s.partsCount && '✓'}
                    </button>
                  ))}
                </div>
              )}

              <button onClick={() => createLevelStory(level)} disabled={!!generatingLevel} style={{ ...secondaryBtnStyle, width: '100%', fontSize: 12, padding: '9px 0', opacity: generatingLevel && !isGenerating ? 0.5 : 1 }}>
                {isGenerating ? <><Loader2 size={13} className="spin" /> {progressMsg}</> : <><Sparkles size={13} /> أنشئ قصة جديدة بهذا المستوى</>}
              </button>
            </div>
          );
        })}
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/* --------------------------------- Today's Practice --------------------------------- */
function findNextIncompletePart(storiesIndex) {
  return storiesIndex.find(s => s.partsCount > 0 && s.completedParts < s.partsCount) || null;
}

function TodayPracticePage({ wordsIndex, storiesIndex, dailyStats, settings, onBack, onStartReview, onOpenStory, onOpenPhrases }) {
  const dueCount = wordsIndex.filter(w => w.stage > 0 && isDue(w.nextReviewAt)).length;
  const weakList = wordsIndex.filter(w => isWeakWord(w));
  const nextStory = findNextIncompletePart(storiesIndex);
  const reviewGoal = Math.min(5, dueCount);
  const weakGoal = Math.min(2, weakList.length);

  const reviewDone = dailyStats.reviews >= reviewGoal && reviewGoal > 0;

  const items = [
    { id: 'review', icon: RotateCcw, title: `${reviewGoal} كلمات للمراجعة`, subtitle: reviewGoal > 0 ? `${Math.min(dailyStats.reviews, reviewGoal)}/${reviewGoal} اليوم` : 'لا توجد كلمات مستحقة', done: reviewGoal === 0 || reviewDone, action: () => onStartReview('normal', reviewGoal || 5), disabled: reviewGoal === 0 },
    { id: 'weak', icon: AlertTriangle, title: `${weakGoal} كلمات ضعيفة`, subtitle: weakGoal > 0 ? 'تحتاج تركيزًا إضافيًا' : 'لا توجد كلمات ضعيفة حاليًا', done: weakGoal === 0, action: () => onStartReview('weak', weakGoal || 2), disabled: weakGoal === 0 },
    { id: 'story', icon: BookOpen, title: nextStory ? nextStory.title : 'لا توجد قصة قيد التقدم', subtitle: nextStory ? `${nextStory.completedParts}/${nextStory.partsCount} أجزاء مكتملة` : 'أضف قصة جديدة من صفحة القصص', done: false, action: () => nextStory && onOpenStory(nextStory.id), disabled: !nextStory },
    { id: 'phrases', icon: MessageCircle, title: 'تدرّب على عبارات', subtitle: 'تصفح العبارات المستخرجة وتدرّب عليها', done: false, action: onOpenPhrases, disabled: false },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={iconBtnStyle}><ChevronRight size={16} color={C.textMuted} /></button>
        <h2 style={pageTitleStyle}>📅 تدريب اليوم</h2>
      </div>
      <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.8 }}>خطة قصيرة متوازنة بين المراجعة والمحتوى الجديد، مبنية على تقدمك الفعلي.</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map(it => (
          <button key={it.id} onClick={it.action} disabled={it.disabled} style={{ ...cardStyle, textAlign: 'right', display: 'flex', alignItems: 'center', gap: 12, cursor: it.disabled ? 'default' : 'pointer', opacity: it.disabled ? 0.5 : 1 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: it.done ? C.greenSoft : C.goldSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {it.done ? <Check size={17} color={C.green} /> : <it.icon size={17} color={C.gold} />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "'Cairo', sans-serif", fontWeight: 600, fontSize: 14, color: C.text }}>{it.title}</div>
              <div style={{ fontSize: 12, color: C.textFaint, marginTop: 2 }}>{it.subtitle}</div>
            </div>
            {!it.disabled && <ChevronLeft size={15} color={C.textFaint} />}
          </button>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------- AI Coach --------------------------------- */
function AICoachPage({ wordsIndex, storiesIndex, streak, onBack, onStartWeakSession, onOpenStory, showToast }) {
  const [advice, setAdvice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const summary = useMemo(() => {
    const weakList = wordsIndex.filter(w => isWeakWord(w));
    const correct = wordsIndex.reduce((s, w) => s + (w.correctCount || 0), 0);
    const incorrect = wordsIndex.reduce((s, w) => s + (w.incorrectCount || 0), 0);
    const accuracy = (correct + incorrect) > 0 ? Math.round((correct / (correct + incorrect)) * 100) : 0;
    const inProgressStories = storiesIndex.filter(s => s.partsCount > 0 && s.completedParts < s.partsCount).length;
    return {
      total: wordsIndex.length,
      weakCount: weakList.length,
      weakSample: weakList.slice(0, 6).map(w => w.word),
      accuracy,
      streak: streak.current,
      level: estimateUserLevel(wordsIndex, storiesIndex),
      inProgressStories,
    };
  }, [wordsIndex, storiesIndex, streak]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await generateCoachAdvice(summary);
        setAdvice(r);
      } catch {
        setAdvice({ message: summary.weakCount > 0 ? `لديك ${summary.weakCount} كلمة ضعيفة — لنركّز عليها اليوم.` : 'أداؤك جيد! استمر في المراجعة اليومية.', actionType: summary.weakCount > 0 ? 'weak_session' : 'none', actionLabel: 'ابدأ جلسة الكلمات الضعيفة' });
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line

  const runAction = async () => {
    if (!advice) return;
    if (advice.actionType === 'weak_session') { onStartWeakSession(); return; }
    if (advice.actionType === 'weak_story') {
      setActing(true);
      try {
        const words = summary.weakSample.length ? summary.weakSample : wordsIndex.slice(0, 5).map(w => w.word);
        const gen = await generateCoachStory(words, summary.level);
        const storyDetail = await buildAndSaveStory({ text: gen.text, title: gen.title || 'جلسة المدرب', level: 'auto', numParts: 'auto' });
        if (storyDetail.failedParts > 0) showToast(`تعذّر تحليل ${storyDetail.failedParts} من أجزاء الجلسة تلقائيًا`, 'info');
        onOpenStory(storyDetail.id);
      } catch {
        showToast('تعذّر إنشاء الجلسة الآن، حاول لاحقًا', 'error');
      } finally {
        setActing(false);
      }
      return;
    }
    if (advice.actionType === 'new_level_story') {
      setActing(true);
      try {
        const gen = await generateLevelStory(summary.level);
        const storyDetail = await buildAndSaveStory({ text: gen.text, title: gen.title, level: summary.level, numParts: 'auto' });
        if (storyDetail.failedParts > 0) showToast(`تعذّر تحليل ${storyDetail.failedParts} من أجزاء القصة تلقائيًا`, 'info');
        onOpenStory(storyDetail.id);
      } catch {
        showToast('تعذّر إنشاء قصة الآن', 'error');
      } finally {
        setActing(false);
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={iconBtnStyle}><ChevronRight size={16} color={C.textMuted} /></button>
        <h2 style={pageTitleStyle}>🧠 مدرب VocabBox</h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <StatBox label="دقتك" value={`${summary.accuracy}%`} color={C.green} />
        <StatBox label="ضعيفة" value={summary.weakCount} color={C.red} />
        <StatBox label="مستواك" value={summary.level} color={C.gold} />
      </div>

      <div style={cardStyle}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 10 }}><Loader2 size={22} className="spin" color={C.gold} /></div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ fontSize: 22 }}>🧠</div>
              <div style={{ fontSize: 14, color: C.text, lineHeight: 1.8 }}>{advice.message}</div>
            </div>
            {advice.actionType !== 'none' && (
              <button onClick={runAction} disabled={acting} style={{ ...primaryBtnStyle, width: '100%', marginTop: 14, opacity: acting ? 0.6 : 1 }}>
                {acting ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} {advice.actionLabel || 'تنفيذ'}
              </button>
            )}
          </>
        )}
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/* ================================ APP SHELL ================================ */
export default function App() {
  const [page, setPage] = useState('dashboard');
  const [reviewMode, setReviewMode] = useState('normal');
  const [reviewSessionSize, setReviewSessionSize] = useState(null);
  const [wordsListFilter, setWordsListFilter] = useState('all');
  const [activeWordId, setActiveWordId] = useState(null);
  const [initialPartId, setInitialPartId] = useState(null);
  const [wordsIndex, setWordsIndex] = useState([]);
  const [storiesIndex, setStoriesIndex] = useState([]);
  const [activeStoryId, setActiveStoryId] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [streak, setStreak] = useState({ current: 0, best: 0, lastActiveDate: null, activeDates: [] });
  const [dailyStats, setDailyStats] = useState({ newWords: 0, reviews: 0, correct: 0, incorrect: 0 });
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const showToast = useCallback((msg, type = 'info') => {
    setToast({ msg, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const refreshIndex = useCallback(async () => setWordsIndex(await db.getWordsIndex()), []);
  const refreshStreak = useCallback(async () => setStreak(await db.getStreak()), []);
  const refreshDailyStats = useCallback(async () => setDailyStats(await db.getDailyStats(todayKey())), []);
  const refreshStories = useCallback(async () => setStoriesIndex(await db.getStoriesIndex()), []);

  const saveSettings = useCallback(async (s) => { setSettings(s); await db.saveSettings(s); }, []);

  useEffect(() => {
    (async () => {
      await runMigrations();
      const [s, idx, st, ds, sIdx] = await Promise.all([db.getSettings(), db.getWordsIndex(), db.getStreak(), db.getDailyStats(todayKey()), db.getStoriesIndex()]);
      setSettings(s); setWordsIndex(idx); setStreak(st); setDailyStats(ds); setStoriesIndex(sIdx);
      setLoading(false);
    })();
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const navItems = [
    { id: 'dashboard', icon: Home, label: 'الرئيسية' },
    { id: 'add', icon: Plus, label: 'كلمة جديدة' },
    { id: 'review', icon: RotateCcw, label: 'المراجعة' },
    { id: 'stories', icon: BookOpen, label: 'القصص' },
    { id: 'scenarios', icon: Compass, label: 'السيناريوهات' },
    { id: 'settings', icon: SettingsIcon, label: 'الإعدادات' },
  ];

  const goToPage = (p, filter) => {
    setActiveStoryId(null);
    setInitialPartId(null);
    if (p === 'wordsList') setWordsListFilter(filter || 'all');
    setPage(p);
  };

  const startReview = (mode, size) => {
    setReviewMode(mode);
    setReviewSessionSize(size || null);
    goToPage('review');
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={28} color={C.gold} className="spin" />
        <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <div dir="rtl" lang="ar" style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: "'Cairo', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&family=Spectral:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        input, select, textarea { font-size: 16px; }
        input:focus, select:focus, button:focus { outline: 2px solid ${C.gold}; outline-offset: 1px; }
        ::selection { background: ${C.goldSoft}; }
      `}</style>

      <div style={{ maxWidth: 520, margin: '0 auto', padding: '18px 16px 0' }}>
        {page === 'dashboard' && <Dashboard wordsIndex={wordsIndex} streak={streak} settings={settings} dailyStats={dailyStats} online={online} onNavigate={goToPage} />}
        {page === 'add' && <AddWordPage wordsIndex={wordsIndex} refreshIndex={refreshIndex} showToast={showToast} settings={settings} />}
        {page === 'review' && (
          <ReviewSession
            key={wordsIndex.length /* rebuild queue when words change externally is fine to ignore mid-session */}
            wordsIndex={wordsIndex}
            settings={settings}
            refreshIndex={refreshIndex}
            streak={streak}
            refreshStreak={refreshStreak}
            dailyStats={dailyStats}
            refreshDailyStats={refreshDailyStats}
            showToast={showToast}
            mode={reviewMode}
            sessionSizeOverride={reviewSessionSize}
            onExit={() => { setReviewMode('normal'); setReviewSessionSize(null); goToPage('dashboard'); }}
          />
        )}
        {page === 'weakWords' && (
          <WeakWordsPage wordsIndex={wordsIndex} onBack={() => goToPage('dashboard')} onStartSession={() => startReview('weak')} />
        )}
        {page === 'search' && (
          <SearchPage wordsIndex={wordsIndex} storiesIndex={storiesIndex} onBack={() => goToPage('dashboard')} onOpenStory={(id) => { setPage('stories'); setActiveStoryId(id); }} />
        )}
        {page === 'wordsList' && (
          <WordsListPage wordsIndex={wordsIndex} onBack={() => goToPage('dashboard')} onOpenWord={(id) => { setActiveWordId(id); setPage('wordDetail'); }} initialFilter={wordsListFilter} />
        )}
        {page === 'wordDetail' && (
          <WordDetailPage wordId={activeWordId} settings={settings} onBack={() => setPage('wordsList')} showToast={showToast} refreshIndex={refreshIndex} />
        )}
        {page === 'analytics' && (
          <AnalyticsPage wordsIndex={wordsIndex} streak={streak} onBack={() => goToPage('dashboard')} />
        )}
        {page === 'stories' && !activeStoryId && (
          <StoriesListPage storiesIndex={storiesIndex} onOpen={(id) => setActiveStoryId(id)} onAddNew={() => setPage('addStory')} onOpenPhrases={() => setPage('phrases')} />
        )}
        {page === 'stories' && activeStoryId && (
          <StoryDetailPage storyId={activeStoryId} wordsIndex={wordsIndex} showToast={showToast} onBack={() => setActiveStoryId(null)} settings={settings} refreshStories={refreshStories} initialPartId={initialPartId} />
        )}
        {page === 'addStory' && (
          <AddStoryPage
            storiesIndex={storiesIndex}
            refreshStories={refreshStories}
            showToast={showToast}
            onDone={(newId) => { setPage('stories'); if (newId) setActiveStoryId(newId); }}
          />
        )}
        {page === 'scenarios' && (
          <ScenariosListPage
            showToast={showToast}
            onOpenStory={async (storyId) => { await refreshStories(); setPage('stories'); setActiveStoryId(storyId); }}
          />
        )}
        {page === 'phrases' && (
          <PhrasesPage storiesIndex={storiesIndex} wordsIndex={wordsIndex} settings={settings} showToast={showToast} onBack={() => setPage('stories')} />
        )}
        {page === 'learningPath' && (
          <LearningPathPage
            wordsIndex={wordsIndex}
            storiesIndex={storiesIndex}
            onBack={() => goToPage('dashboard')}
            onOpenStory={async (storyId) => { await refreshStories(); setPage('stories'); setActiveStoryId(storyId); }}
            showToast={showToast}
          />
        )}
        {page === 'todayPractice' && (
          <TodayPracticePage
            wordsIndex={wordsIndex}
            storiesIndex={storiesIndex}
            dailyStats={dailyStats}
            settings={settings}
            onBack={() => goToPage('dashboard')}
            onStartReview={(mode, size) => startReview(mode, size)}
            onOpenStory={(storyId) => { setActiveStoryId(storyId); setPage('stories'); }}
            onOpenPhrases={() => setPage('phrases')}
          />
        )}
        {page === 'aiCoach' && (
          <AICoachPage
            wordsIndex={wordsIndex}
            storiesIndex={storiesIndex}
            streak={streak}
            onBack={() => goToPage('dashboard')}
            onStartWeakSession={() => startReview('weak')}
            onOpenStory={async (storyId) => { await refreshStories(); await refreshIndex(); setPage('stories'); setActiveStoryId(storyId); }}
            showToast={showToast}
          />
        )}
        {page === 'settings' && (
          <SettingsPage
            settings={settings}
            saveSettings={saveSettings}
            wordsIndex={wordsIndex}
            refreshIndex={refreshIndex}
            showToast={showToast}
            streak={streak}
            refreshStreak={refreshStreak}
            refreshStories={refreshStories}
          />
        )}
      </div>

      {/* bottom nav */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'rgba(27,24,20,0.95)', backdropFilter: 'blur(10px)', borderTop: `1px solid ${C.borderSoft}`, zIndex: 50 }}>
        <div style={{ maxWidth: 520, margin: '0 auto', display: 'flex', padding: '8px 6px calc(8px + env(safe-area-inset-bottom))' }}>
          {navItems.map(item => {
            const Icon = item.icon;
            const active = page === item.id
              || (item.id === 'stories' && (page === 'addStory' || page === 'phrases'));
            return (
              <button key={item.id} onClick={() => goToPage(item.id)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '6px 0', background: 'none', border: 'none', cursor: 'pointer' }}>
                <Icon size={20} color={active ? C.gold : C.textFaint} />
                <span style={{ fontSize: 10, color: active ? C.gold : C.textFaint, fontWeight: active ? 700 : 400 }}>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <Toast toast={toast} />
    </div>
  );
}
