import NodeCache from 'node-cache';
import logger from '../utils/logger.js';

// =============================================
// STATE MANAGEMENT PER USER
// =============================================
// States:
//   NEW         → belum pernah chat / session expired
//   BOT_ACTIVE  → bot aktif, balas pesan, timer 24 jam
//   LIVECHAT    → bot diam, kamu yang balas, timer 24 jam reset tiap pesan
//   STOPPED     → user paksa /stop, bot diam sampai /start lagi

const TTL_24H = 24 * 60 * 60; // 24 jam dalam detik

// Cache session — nilai: { state, startedAt }
// TTL diset per entry, bukan global
const sessions = new NodeCache({ stdTTL: 0, checkperiod: 60 });

// =============================================
// GETTERS
// =============================================

export function getSession(userId) {
  return sessions.get(userId) || null;
}

export function getState(userId) {
  const session = sessions.get(userId);
  return session?.state || 'NEW';
}

export function isBotActive(userId) {
  return getState(userId) === 'BOT_ACTIVE';
}

export function isLiveChat(userId) {
  return getState(userId) === 'LIVECHAT';
}

export function isStopped(userId) {
  return getState(userId) === 'STOPPED';
}

export function isNew(userId) {
  const state = getState(userId);
  return state === 'NEW' || !sessions.has(userId);
}

// =============================================
// SETTERS
// =============================================

export function startSession(userId) {
  sessions.set(userId, {
    state: 'BOT_ACTIVE',
    startedAt: new Date().toISOString(),
  }, TTL_24H);
  logger.info(`✅ BOT_ACTIVE: ${userId}`);
}

export function startLiveChat(userId) {
  sessions.set(userId, {
    state: 'LIVECHAT',
    startedAt: new Date().toISOString(),
  }, TTL_24H);
  logger.info(`💬 LIVECHAT: ${userId}`);
}

export function stopSession(userId) {
  // STOPPED tidak punya TTL — permanen sampai /start lagi
  sessions.set(userId, {
    state: 'STOPPED',
    stoppedAt: new Date().toISOString(),
  }, 0); // TTL 0 = tidak expire
  logger.info(`🛑 STOPPED: ${userId}`);
}

export function resetSession(userId) {
  sessions.del(userId);
  logger.info(`🔄 RESET to NEW: ${userId}`);
}

// =============================================
// ACTIVITY TRACKER
// Reset timer 24 jam setiap ada pesan masuk
// Berlaku untuk BOT_ACTIVE dan LIVECHAT
// =============================================

export function refreshTimer(userId) {
  const session = sessions.get(userId);
  if (!session) return;
  if (session.state === 'STOPPED') return; // STOPPED tidak bisa di-reset

  // Update TTL ke 24 jam lagi dari sekarang
  sessions.set(userId, {
    ...session,
    lastActivity: new Date().toISOString(),
  }, TTL_24H);
}

// =============================================
// STATS
// =============================================

export function getSessionCount() {
  return sessions.keys().length;
}

export function getAllSessions() {
  return sessions.keys().map(k => ({
    userId: k,
    ...sessions.get(k),
  }));
}

// Backward compat
export function hasSession(userId) {
  return isBotActive(userId);
}
