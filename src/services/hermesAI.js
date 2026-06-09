import NodeCache from 'node-cache';
import config from '../config.js';
import logger from '../utils/logger.js';
import { getHermesSystemPrompt } from './configManager.js';
import { buildSkillsContext } from './skillsManager.js';

// =============================================
// HERMES AGENT CLIENT
// Memanggil Hermes Agent yang berjalan sebagai
// API Server (OpenAI-compatible endpoint)
// =============================================

const HERMES_API_URL = `${config.hermesUrl}/v1/chat/completions`;

// History percakapan per user (30 menit)
const conversationHistory = new NodeCache({ stdTTL: 1800, checkperiod: 60 });

// Track request yang sedang diproses (mencegah double-call)
const pendingRequests = new Map();

// =============================================
// CALL HERMES API
// =============================================
async function callHermes(messages, timeoutMs = 60000) {
  const headers = {
    'Content-Type': 'application/json',
  };

  // Hermes API Server bisa pakai Bearer token jika dikonfigurasi
  if (config.hermesApiKey) {
    headers['Authorization'] = `Bearer ${config.hermesApiKey}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(HERMES_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.hermesModel || 'hermes',
        messages,
        max_tokens: config.hermesMaxTokens || 2048,
        temperature: 0.7,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const error = new Error(err?.error?.message || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '(tidak ada respons)';

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('TIMEOUT');
    }
    throw err;
  }
}

// =============================================
// CHECK HERMES AVAILABILITY
// =============================================
export async function isHermesAvailable() {
  if (!config.hermesUrl) return false;
  try {
    const response = await fetch(`${config.hermesUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// =============================================
// MAIN FUNCTION
// =============================================
export async function askHermes(userId, userMessage, context = {}) {
  if (!config.hermesUrl) {
    throw new Error('HERMES_NOT_CONFIGURED');
  }

  // Cegah duplicate request dari user yang sama
  if (pendingRequests.has(userId)) {
    return '⏳ Masih memproses pesanmu sebelumnya. Tunggu sebentar ya!';
  }

  pendingRequests.set(userId, true);

  try {
    // Susun system prompt untuk Hermes (dinamis + skills)
    let systemPrompt = getHermesSystemPrompt() + buildSkillsContext();
    if (context.groupName) systemPrompt += `\nKamu sedang di grup "${context.groupName}".`;
    if (context.senderName) systemPrompt += `\nSedang berbicara dengan: ${context.senderName}.`;

    // Tambahkan instruksi agentic
    systemPrompt += `\n\nKamu adalah asisten AI canggih dengan kemampuan reasoning mendalam. 
Analisis pertanyaan dengan teliti sebelum menjawab.
Untuk pertanyaan kompleks, berikan jawaban yang terstruktur dan komprehensif.
Jawab dalam Bahasa Indonesia kecuali diminta lain.`;

    // Ambil history percakapan
    const history = conversationHistory.get(userId) || [];

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userMessage },
    ];

    logger.info(`🧠 Hermes → ${userId}: "${userMessage.substring(0, 60)}..."`);

    const replyText = await callHermes(messages);

    // Simpan history (max 20 entri = 10 giliran)
    const newHistory = [
      ...history,
      { role: 'user', content: userMessage },
      { role: 'assistant', content: replyText },
    ];
    conversationHistory.set(userId, newHistory.slice(-20));

    logger.info(`✅ Hermes replied to ${userId}`);
    return replyText;

  } catch (error) {
    logger.error(`❌ Hermes error for ${userId}: ${error.message}`);

    if (error.message === 'TIMEOUT') {
      return '⏳ Pertanyaanmu butuh waktu lebih lama untuk diproses. Coba sederhanakan pertanyaan atau coba lagi.';
    }
    if (error.message === 'HERMES_NOT_CONFIGURED') {
      return '⚠️ Fitur AI lanjutan belum dikonfigurasi. Hubungi admin.';
    }
    if (error.status === 503 || error.status === 502) {
      return '⚠️ Server AI sedang tidak tersedia. Coba lagi sebentar.';
    }

    throw error; // lempar ke aiRouter untuk fallback ke Groq
  } finally {
    pendingRequests.delete(userId);
  }
}

// =============================================
// RESET HISTORY
// =============================================
export function resetHermesConversation(userId) {
  conversationHistory.del(userId);
}

export function getHermesActiveConversations() {
  return conversationHistory.keys().length;
}