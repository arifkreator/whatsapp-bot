import dotenv from 'dotenv';
dotenv.config();

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

// Helper: cek apakah nomor adalah owner
export function isOwnerNumber(number) {
  const clean = number?.replace(/[^0-9]/g, '');
  return config.ownerNumbers.some(o => o.replace(/[^0-9]/g, '') === clean);
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
