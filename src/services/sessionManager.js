import NodeCache from 'node-cache';
import logger from '../utils/logger.js';

// =============================================
// SESSION MANAGER
// Menyimpan daftar user yang sudah /start
// In-memory untuk sekarang, nanti bisa migrasi ke SQLite
// =============================================

// Persistent: tidak ada TTL, data tetap sampai /stop atau restart
const activeSessions = new NodeCache({ stdTTL: 0, checkperiod: 0 });

/**
 * Aktifkan session untuk user (setelah /start)
 */
export function startSession(userId) {
  activeSessions.set(userId, {
    startedAt: new Date().toISOString(),
    userId,
  });
  logger.info(`✅ Session dimulai: ${userId}`);
}

/**
 * Nonaktifkan session untuk user (setelah /stop)
 */
export function stopSession(userId) {
  activeSessions.del(userId);
  logger.info(`🛑 Session dihentikan: ${userId}`);
}

/**
 * Cek apakah user sudah /start
 */
export function hasSession(userId) {
  return activeSessions.has(userId);
}

/**
 * Ambil semua session aktif
 */
export function getAllSessions() {
  const keys = activeSessions.keys();
  return keys.map(k => activeSessions.get(k));
}

/**
 * Total session aktif
 */
export function getSessionCount() {
  return activeSessions.keys().length;
}
