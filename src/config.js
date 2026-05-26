import dotenv from 'dotenv';
import pino from 'pino';
dotenv.config();

const logger = pino({ level: 'info' });

// =============================================
// OWNER IDs — gabungkan semua format dalam 1 list
// Isi OWNER_IDS di Railway dengan semua ID yang valid:
// nomor HP (628xxx) DAN LID (119xxx) sekaligus
// Contoh: 6285746686316,119228459937962
// =============================================
const rawOwnerIds = (
  process.env.OWNER_IDS ||           // variable baru (recommended)
  process.env.OWNER_NUMBERS ||       // backward compat
  process.env.OWNER_NUMBER ||        // backward compat
  ''
).split(',').map(n => n.trim().replace(/[^0-9]/g, '')).filter(Boolean);

// Gabungkan dengan OWNER_LIDS jika ada
const rawOwnerLids = (process.env.OWNER_LIDS || '')
  .split(',').map(n => n.trim().replace(/[^0-9]/g, '')).filter(Boolean);

// Gabung semua jadi 1 Set untuk lookup O(1)
const OWNER_ID_SET = new Set([...rawOwnerIds, ...rawOwnerLids]);

export const config = {
  // Bot identity
  botName: process.env.BOT_NAME || 'BotKu',
  prefix: process.env.BOT_PREFIX || '!',
  botId: process.env.BOT_ID || 'bot-default',

  // Bot Manager
  managerUrl: process.env.MANAGER_URL || '',
  managerSecret: process.env.MANAGER_SECRET || 'ganti-dengan-rahasia-kuat',

  // Owner (untuk backward compat)
  ownerNumbers: rawOwnerIds,

  // Groq AI
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  aiMaxTokens: parseInt(process.env.AI_MAX_TOKENS) || 1024,
  aiSystemPrompt: process.env.AI_SYSTEM_PROMPT ||
    'Kamu adalah asisten WhatsApp yang helpful dan ramah. Jawab dalam Bahasa Indonesia. Jawaban singkat dan padat, maksimal 3-4 kalimat kecuali diminta detail.',
  aiAutoReplyPrivate: process.env.AI_AUTO_REPLY_PRIVATE !== 'false',
  aiAutoReplyGroup: process.env.AI_AUTO_REPLY_GROUP !== 'false',
  aiCooldownSeconds: parseInt(process.env.AI_COOLDOWN_SECONDS) || 5,

  // Anti-spam
  spamMaxMessages: parseInt(process.env.SPAM_MAX_MESSAGES) || 5,
  spamTimeWindow: parseInt(process.env.SPAM_TIME_WINDOW) || 10,
  spamMuteDuration: parseInt(process.env.SPAM_MUTE_DURATION) || 300,

  // Session path
  sessionPath: process.env.SESSION_PATH || './sessions',
};

/**
 * Cek apakah nomor/LID adalah owner
 * Sangat simpel — hanya lookup di Set
 */
export function isOwnerNumber(number) {
  if (!number) return false;
  const clean = number.replace(/[^0-9]/g, '');
  const result = OWNER_ID_SET.has(clean);
  return result;
}

// Dummy untuk backward compat (tidak dipakai lagi)
export function registerLid() {}

// Log saat startup
logger.info(`👑 Owner IDs terdaftar: ${[...OWNER_ID_SET].join(', ') || 'KOSONG!'}`);

if (!config.groqApiKey) {
  logger.warn('⚠️  GROQ_API_KEY belum diset!');
}
if (OWNER_ID_SET.size === 0) {
  logger.warn('⚠️  Tidak ada Owner ID terdaftar! Set OWNER_IDS di Railway.');
}

export default config;
