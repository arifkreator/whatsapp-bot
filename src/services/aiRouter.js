import config from '../config.js';
import logger from '../utils/logger.js';
import { askGroq } from './groqAI.js';
import { askHermes, isHermesAvailable } from './hermesAI.js';

// =============================================
// AI ROUTER
// Menentukan apakah pesan perlu Groq (cepat/simple)
// atau Hermes Agent (lambat/kompleks/reasoning)
// =============================================

// Cache status Hermes (cek tiap 2 menit agar tidak spam ping)
let hermesAvailable = null;
let lastHermesCheck = 0;
const HERMES_CHECK_INTERVAL = 2 * 60 * 1000; // 2 menit

async function getHermesStatus() {
  const now = Date.now();
  if (now - lastHermesCheck > HERMES_CHECK_INTERVAL) {
    lastHermesCheck = now;
    hermesAvailable = await isHermesAvailable();
    logger.debug(`🔍 Hermes status check: ${hermesAvailable ? 'online' : 'offline'}`);
  }
  return hermesAvailable;
}

// =============================================
// CLASSIFIER — deteksi pesan kompleks
// Return: 'hermes' atau 'groq'
// =============================================

// Kata kunci yang mengindikasikan pertanyaan kompleks / butuh reasoning
const COMPLEX_KEYWORDS = [
  // Analisis & reasoning
  'analisa', 'analisis', 'jelaskan secara detail', 'jelaskan dengan lengkap',
  'bandingkan', 'perbandingan', 'perbedaan antara', 'kelebihan dan kekurangan',
  'pro dan kontra', 'pros and cons', 'mengapa', 'kenapa sebenarnya',
  'bagaimana cara kerja', 'bagaimana mekanisme',

  // Teknis & kompleks
  'buatkan kode', 'buatkan program', 'buatkan script', 'debug', 'error ini',
  'cara membuat aplikasi', 'algoritma', 'arsitektur', 'implementasi',
  'strategi', 'rencana bisnis', 'business plan',

  // Penelitian & mendalam
  'riset', 'penelitian', 'komprehensif', 'mendalam', 'secara lengkap',
  'tuliskan essay', 'tulis artikel', 'buat laporan', 'resume',
  'rangkum', 'rangkuman panjang',

  // Multi-step / reasoning
  'langkah demi langkah', 'step by step', 'panduan lengkap',
  'tutorial lengkap', 'sebutkan semua', 'daftar lengkap',

  // Sains & matematika
  'hitung', 'kalkulasi', 'rumus', 'persamaan', 'integral', 'derivatif',
  'probabilitas', 'statistik',

  // Keputusan & rekomendasi kompleks
  'rekomendasi terbaik', 'mana yang lebih baik', 'pilih antara',
  'pertimbangan', 'saran mendalam',
];

// Pola regex untuk kompleksitas
const COMPLEX_PATTERNS = [
  /\b(code|kode|program|script|function|fungsi)\s+(untuk|yang|buat)\b/i,
  /jelaskan\s+(bagaimana|cara|mengapa|kenapa|apa)\b/i,
  /\b(buat|buatkan|write|tulis)\s+(essay|artikel|laporan|cerita panjang|ringkasan)\b/i,
  /\b(\d+\s*(cara|langkah|tips|poin))\b/i, // "5 cara...", "10 langkah..."
  /\?.*\?.*\?/,   // 3+ tanda tanya = multi-pertanyaan
];

// Panjang pesan sebagai sinyal kompleksitas
const COMPLEX_LENGTH_THRESHOLD = 120; // karakter

export function classifyMessage(text) {
  if (!config.hermesEnabled) return 'groq';

  const lower = text.toLowerCase();
  const trimmed = text.trim();

  // 1. Cek panjang pesan
  if (trimmed.length > COMPLEX_LENGTH_THRESHOLD) {
    logger.debug(`🔀 Router: HERMES (panjang ${trimmed.length} karakter)`);
    return 'hermes';
  }

  // 2. Cek keyword kompleks
  for (const keyword of COMPLEX_KEYWORDS) {
    if (lower.includes(keyword)) {
      logger.debug(`🔀 Router: HERMES (keyword: "${keyword}")`);
      return 'hermes';
    }
  }

  // 3. Cek pola regex
  for (const pattern of COMPLEX_PATTERNS) {
    if (pattern.test(trimmed)) {
      logger.debug(`🔀 Router: HERMES (pattern match)`);
      return 'hermes';
    }
  }

  logger.debug(`🔀 Router: GROQ (simple)`);
  return 'groq';
}

// =============================================
// MAIN ROUTER FUNCTION
// =============================================
export async function askAI(userId, userMessage, context = {}) {
  const route = classifyMessage(userMessage);

  // Jika Hermes tidak aktif di config, langsung pakai Groq
  if (route === 'groq' || !config.hermesEnabled) {
    return await askGroq(userId, userMessage, context);
  }

  // Cek apakah Hermes online
  const hermesOnline = await getHermesStatus();
  if (!hermesOnline) {
    logger.warn(`⚠️ Hermes offline, fallback ke Groq untuk ${userId}`);
    return await askGroq(userId, userMessage, context);
  }

  // Kirim ke Hermes, fallback ke Groq jika error
  try {
    return await askHermes(userId, userMessage, context);
  } catch (error) {
    logger.warn(`⚠️ Hermes error, fallback ke Groq: ${error.message}`);
    // Reset status cache agar next check lebih cepat
    hermesAvailable = false;
    lastHermesCheck = 0;
    return await askGroq(userId, userMessage, context);
  }
}

// =============================================
// FORCE ROUTE — untuk command khusus
// =============================================
export async function askAIForced(userId, userMessage, context = {}, forceRoute = null) {
  if (forceRoute === 'hermes') {
    const hermesOnline = await getHermesStatus();
    if (!hermesOnline) {
      return '❌ Hermes Agent sedang offline. Coba lagi nanti.';
    }
    return await askHermes(userId, userMessage, context);
  }

  if (forceRoute === 'groq') {
    return await askGroq(userId, userMessage, context);
  }

  return await askAI(userId, userMessage, context);
}

export function getRouterInfo() {
  return {
    hermesEnabled: !!config.hermesEnabled,
    hermesUrl: config.hermesUrl || null,
    hermesAvailable,
    lastChecked: lastHermesCheck ? new Date(lastHermesCheck).toISOString() : null,
  };
}