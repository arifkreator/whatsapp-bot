import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // Bot identity
  botName: process.env.BOT_NAME || 'BotKu',
  prefix: process.env.BOT_PREFIX || '!',
  ownerNumber: process.env.OWNER_NUMBER || '',

  // Groq AI
  groqApiKey: process.env.GROQ_API_KEY || '',
  // Model gratis terbaik di Groq (pilih salah satu di .env):
  //   llama-3.3-70b-versatile  ← paling pintar, recommended
  //   llama3-8b-8192           ← paling cepat & ringan
  //   gemma2-9b-it             ← alternatif Google model
  //   mixtral-8x7b-32768       ← konteks panjang
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

if (!config.groqApiKey && !process.env.GROQ_API_KEY_1) {
  console.warn('⚠️  GROQ_API_KEY belum diset! Fitur AI tidak akan berfungsi.');
}
if (!config.ownerNumber) {
  console.warn('⚠️  OWNER_NUMBER belum diset! Fitur admin terbatas.');
}

export default config;
