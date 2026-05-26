import dotenv from 'dotenv';
import pino from 'pino';
dotenv.config();

const logger = pino({ level: 'info' });

export const config = {
  // Bot identity
  botName: process.env.BOT_NAME || 'BotKu',
  prefix: process.env.BOT_PREFIX || '!',
  botId: process.env.BOT_ID || 'bot-default',

  // Bot Manager
  managerUrl: process.env.MANAGER_URL || '',
  managerSecret: process.env.MANAGER_SECRET || 'ganti-dengan-rahasia-kuat',

  // =============================================
  // OWNER — nomor khusus kamu sebagai pemilik platform
  // Format: 628xxx (tanpa + atau spasi)
  // Bisa isi lebih dari 1 nomor, pisahkan dengan koma
  // Contoh: 628111,628222
  // =============================================
  ownerNumbers: (process.env.OWNER_NUMBERS || process.env.OWNER_NUMBER || '')
    .split(',')
    .map(n => n.trim())
    .filter(Boolean),

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

// Cache LID mapping — { lid: phoneNumber }
// Diisi saat bot menerima pesan pertama dari owner
const lidToPhone = new Map();

/**
 * Daftarkan mapping LID → nomor HP
 * Dipanggil dari messageHandler saat menerima pesan
 */
export function registerLid(lid, phoneNumber) {
  if (lid && phoneNumber && !lidToPhone.has(lid)) {
    lidToPhone.set(lid, phoneNumber);
    logger.info(`🔗 LID mapped: ${lid} → ${phoneNumber}`);
  }
}

/**
 * Cek apakah nomor/LID adalah owner
 */
export function isOwnerNumber(number) {
  if (!number) return false;
  const clean = number.replace(/[^0-9]/g, '');

  // DEBUG LOG — hapus setelah owner terdeteksi
  const ownerLids = (process.env.OWNER_LIDS || '')
    .split(',').map(l => l.trim()).filter(Boolean);
  console.log(`🔍 DEBUG isOwner check:
    input        : "${number}"
    clean        : "${clean}"
    ownerNumbers : ${JSON.stringify(config.ownerNumbers)}
    ownerLids    : ${JSON.stringify(ownerLids)}
    lidCache     : ${JSON.stringify([...lidToPhone.entries()])}
  `);

  // 1. Cek langsung via nomor HP (format 628xxx)
  const directMatch = config.ownerNumbers.some(
    o => o.replace(/[^0-9]/g, '') === clean
  );
  if (directMatch) {
    console.log(`✅ DEBUG: MATCH via nomor HP`);
    return true;
  }

  // 2. Cek via LID mapping
  const mappedPhone = lidToPhone.get(clean);
  if (mappedPhone) {
    const lidMatch = config.ownerNumbers.some(
      o => o.replace(/[^0-9]/g, '') === mappedPhone.replace(/[^0-9]/g, '')
    );
    if (lidMatch) {
      console.log(`✅ DEBUG: MATCH via LID mapping`);
      return true;
    }
  }

  // 3. Cek OWNER_LIDS di env
  const lidsMatch = ownerLids.includes(clean);
  if (lidsMatch) {
    console.log(`✅ DEBUG: MATCH via OWNER_LIDS env`);
    return true;
  }

  console.log(`❌ DEBUG: TIDAK MATCH — bukan owner`);
  return false;
}

// Validasi
if (!config.groqApiKey && !process.env.GROQ_API_KEY_1) {
  console.warn('⚠️  GROQ_API_KEY belum diset! Fitur AI tidak akan berfungsi.');
}
if (config.ownerNumbers.length === 0) {
  console.warn('⚠️  OWNER_NUMBERS belum diset! Fitur owner tidak aktif.');
} else {
  console.info(`👑 Owner terdaftar: ${config.ownerNumbers.join(', ')}`);
}

export default config;
