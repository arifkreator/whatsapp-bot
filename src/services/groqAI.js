import NodeCache from 'node-cache';
import config from '../config.js';
import logger from '../utils/logger.js';
import { getSystemPrompt } from './configManager.js';
import { buildSkillsContext } from './skillsManager.js';

// =============================================
// GROQ CLIENT — pakai fetch langsung, no SDK needed
// =============================================
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// =============================================
// ROTASI MULTI API KEY
// Daftarkan hingga 5 key di .env:
//   GROQ_API_KEY, GROQ_API_KEY_1, GROQ_API_KEY_2, dst.
// =============================================
function loadApiKeys() {
  const keys = [];
  if (config.groqApiKey) keys.push(config.groqApiKey);
  for (let i = 1; i <= 5; i++) {
    const k = process.env[`GROQ_API_KEY_${i}`];
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

const apiKeys = loadApiKeys();
// Reset exhausted key tiap 1 jam (Groq rate limit per menit/jam, bukan harian)
const exhaustedKeys = new NodeCache({ stdTTL: 3600, checkperiod: 300 });
let currentKeyIndex = 0;

function getActiveKey() {
  for (let i = 0; i < apiKeys.length; i++) {
    const idx = (currentKeyIndex + i) % apiKeys.length;
    if (!exhaustedKeys.get(apiKeys[idx])) {
      currentKeyIndex = idx;
      return { key: apiKeys[idx], idx };
    }
  }
  return null;
}

function markKeyExhausted(key) {
  exhaustedKeys.set(key, true);
  logger.warn(`🔑 Groq Key ke-${apiKeys.indexOf(key) + 1} rate limited, beralih ke key berikutnya...`);
  currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
}

// =============================================
// RATE LIMITER PER USER
// =============================================
const userCooldown = new NodeCache({ stdTTL: config.aiCooldownSeconds, checkperiod: 5 });

function isUserOnCooldown(userId) {
  return !!userCooldown.get(userId);
}

function setUserCooldown(userId) {
  userCooldown.set(userId, true, config.aiCooldownSeconds);
}

// =============================================
// SMART FILTER — jawab sapaan lokal, hemat quota
// =============================================
const QUICK_REPLIES = {
  '/^(halo|hai|hi|hello|hey|hei|halo bot|hai bot)[\s!.]*$/i':
    '👋 Halo! Ada yang bisa aku bantu?',
  '/^(apa kabar|gimana kabar|how are you)[\s?!.]*$/i':
    '😊 Baik! Kamu sendiri gimana? Ada yang mau ditanyakan?',
  '/^(makasih|thanks|thank you|thx|tengkyu|terima kasih)[\s!.]*$/i':
    '😊 Sama-sama! Senang bisa membantu!',
  '/^(ok|oke|okay|sip|siap|iyaa?|yap|yep|baik)[\s!.]*$/i':
    '👍 Siap! Kalau ada yang perlu dibantu, tanya aja ya.',
};

function getQuickReply(text) {
  for (const [pattern, reply] of Object.entries(QUICK_REPLIES)) {
    const regex = new RegExp(
      pattern.slice(1, pattern.lastIndexOf('/')),
      pattern.slice(pattern.lastIndexOf('/') + 1)
    );
    if (regex.test(text.trim())) return reply;
  }
  return null;
}

// =============================================
// HISTORY PERCAKAPAN (30 menit)
// =============================================
const conversationHistory = new NodeCache({ stdTTL: 1800, checkperiod: 60 });

// =============================================
// CALL GROQ API
// =============================================
async function callGroq(apiKey, messages) {
  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.groqModel,
      messages,
      max_tokens: config.aiMaxTokens,
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const error = new Error(err?.error?.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '(tidak ada respons)';
}

// =============================================
// MAIN FUNCTION
// =============================================
export async function askGroq(userId, userMessage, context = {}) {
  if (apiKeys.length === 0) {
    return '⚠️ Fitur AI belum dikonfigurasi. Hubungi admin untuk mengatur GROQ_API_KEY.';
  }

  // 1. Quick reply lokal
  const quick = getQuickReply(userMessage);
  if (quick) {
    logger.info(`⚡ Quick reply untuk ${userId}`);
    return quick;
  }

  // 2. Cooldown per user
  if (isUserOnCooldown(userId)) {
    return `⏳ Sabar ya! Tunggu ${config.aiCooldownSeconds} detik sebelum tanya lagi.`;
  }

  // 3. Ambil key aktif
  const active = getActiveKey();
  if (!active) {
    return `😴 Semua API key sedang rate-limited. Tunggu beberapa menit lalu coba lagi.\n💡 Tambahkan lebih banyak GROQ_API_KEY di .env`;
  }

  try {
    setUserCooldown(userId);

    // Susun system prompt (dinamis dari configManager + skills)
    let systemPrompt = getSystemPrompt() + buildSkillsContext();
    if (context.groupName) systemPrompt += `\nKamu sedang di grup "${context.groupName}".`;
    if (context.senderName) systemPrompt += `\nSedang berbicara dengan: ${context.senderName}.`;

    // Ambil history & susun messages
    const history = conversationHistory.get(userId) || [];
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userMessage },
    ];

    logger.debug(`🤖 Groq [key-${active.idx + 1}] → ${userId}`);

    const replyText = await callGroq(active.key, messages);

    // Simpan history (max 20 entri = 10 giliran)
    const newHistory = [...history, { role: 'user', content: userMessage }, { role: 'assistant', content: replyText }];
    conversationHistory.set(userId, newHistory.slice(-20));

    logger.info(`✅ Groq [key-${active.idx + 1}] replied to ${userId}`);
    return replyText;

  } catch (error) {
    logger.error(`❌ Groq error [key-${active.idx + 1}]: ${error.message}`);

    // Rate limited — tandai key & coba key berikutnya
    if (error.status === 429) {
      markKeyExhausted(active.key);
      const next = getActiveKey();
      if (next) {
        logger.info(`🔄 Retry dengan key-${next.idx + 1}...`);
        try {
          const history = conversationHistory.get(userId) || [];
          const messages = [
            { role: 'system', content: getSystemPrompt() },
            ...history,
            { role: 'user', content: userMessage },
          ];
          const replyText = await callGroq(next.key, messages);
          const newHistory = [...history, { role: 'user', content: userMessage }, { role: 'assistant', content: replyText }];
          conversationHistory.set(userId, newHistory.slice(-20));
          return replyText;
        } catch {
          // gagal juga
        }
      }
      return `⏳ Bot sedang sibuk. Coba lagi dalam 1-2 menit ya!`;
    }

    if (error.status === 401) return '❌ API Key Groq tidak valid. Hubungi admin.';
    if (error.status === 503) return '⚠️ Server Groq sedang maintenance. Coba lagi sebentar.';

    return '❌ Terjadi kesalahan. Coba lagi sebentar.';
  }
}

export function resetConversation(userId) {
  conversationHistory.del(userId);
}

export function getActiveConversations() {
  return conversationHistory.keys().length;
}

export function getQuotaStatus() {
  const exhausted = exhaustedKeys.keys().length;
  return {
    totalKeys: apiKeys.length,
    activeKeys: apiKeys.length - exhausted,
    exhaustedKeys: exhausted,
    currentKey: currentKeyIndex + 1,
  };
}