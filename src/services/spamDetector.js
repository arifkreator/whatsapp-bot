import NodeCache from 'node-cache';
import config from '../config.js';
import logger from '../utils/logger.js';

// Cache untuk tracking pesan per user
const messageTracker = new NodeCache({ stdTTL: config.spamTimeWindow, checkperiod: 5 });
// Cache untuk user yang sedang di-mute
const mutedUsers = new NodeCache({ stdTTL: config.spamMuteDuration, checkperiod: 10 });
// Cache untuk pesan duplikat
const recentMessages = new NodeCache({ stdTTL: 30, checkperiod: 10 });

/**
 * Cek apakah pesan termasuk spam
 * Return: { isSpam: bool, reason: string }
 */
export function checkSpam(jid, messageText) {
  const userId = jid.split('@')[0];

  // 1. Cek apakah user sedang di-mute
  if (mutedUsers.get(userId)) {
    return { isSpam: true, reason: 'muted' };
  }

  // 2. Cek pesan duplikat (flood sama persis)
  const msgKey = `${userId}:${messageText?.substring(0, 50)}`;
  const dupCount = (recentMessages.get(msgKey) || 0) + 1;
  recentMessages.set(msgKey, dupCount);
  if (dupCount >= 3) {
    return { isSpam: true, reason: 'duplicate' };
  }

  // 3. Cek frekuensi pesan (rate limiting)
  const countKey = `count:${userId}`;
  const count = (messageTracker.get(countKey) || 0) + 1;
  messageTracker.set(countKey, count);

  if (count >= config.spamMaxMessages) {
    muteUser(userId);
    return { isSpam: true, reason: 'rate_limit' };
  }

  // 4. Cek pola spam umum
  if (messageText && isSpamPattern(messageText)) {
    return { isSpam: true, reason: 'pattern' };
  }

  return { isSpam: false, reason: null };
}

/**
 * Mute user untuk durasi tertentu
 */
export function muteUser(userId, duration = config.spamMuteDuration) {
  mutedUsers.set(userId, true, duration);
  logger.info(`🔇 User ${userId} di-mute selama ${duration} detik`);
}

/**
 * Unmute user
 */
export function unmuteUser(userId) {
  mutedUsers.del(userId);
  logger.info(`🔊 User ${userId} di-unmute`);
}

/**
 * Cek apakah user sedang di-mute
 */
export function isUserMuted(userId) {
  return !!mutedUsers.get(userId);
}

/**
 * Deteksi pola spam umum
 */
function isSpamPattern(text) {
  const spamPatterns = [
    /join.*grup.*gratis/i,
    /menang.*hadiah/i,
    /klik.*link.*sekarang/i,
    /WA\/\d{10,}/,
    /bit\.ly|tinyurl\.com|t\.me\/joinchat/i,
    // Pesan yang terlalu panjang berulang (>500 karakter)
    /^(.{10,})\1{3,}/, // Karakter berulang
  ];

  return spamPatterns.some(pattern => pattern.test(text));
}

/**
 * Reset counter spam untuk user
 */
export function resetUserSpam(userId) {
  messageTracker.del(`count:${userId}`);
  mutedUsers.del(userId);
}

/**
 * Ambil statistik spam
 */
export function getSpamStats() {
  return {
    trackedUsers: messageTracker.keys().length,
    mutedUsers: mutedUsers.keys().length,
    mutedList: mutedUsers.keys(),
  };
}
