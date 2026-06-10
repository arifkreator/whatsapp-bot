import config, { isOwnerNumber } from '../config.js';
import { checkSpam } from '../services/spamDetector.js';
import { askAI } from '../services/aiRouter.js';
import { handleCommand } from './commandHandler.js';
import { analyzeFile, isSupportedFile, getFileCategory } from '../services/fileAnalyzer.js';
import {
  getState, startSession, startLiveChat, stopSession,
  resetSession, refreshTimer, isBotActive, isLiveChat,
  isStopped, isNew, getSessionCount, getAllSessions,
} from '../services/sessionManager.js';
import logger from '../utils/logger.js';
import fetch from 'node-fetch';

// Anti-duplikat
const processedMsgIds = new Set();
setInterval(() => processedMsgIds.clear(), 10 * 60 * 1000);

// Track user yang sudah dapat pesan perkenalan (hindari spam)
const greetedUsers = new Set();

// =============================================
// PESAN PERKENALAN
// =============================================
function getWelcomeMessage(botName) {
  return (
    `👋 Halo! Saya *${botName}*.\n\n` +
    `Saya adalah bot otomatis yang siap membantu kamu 24/7.\n\n` +
    `Pilih salah satu opsi:\n\n` +
    `🤖 */start* — Chat dengan bot AI\n` +
    `   Bot akan membalas pesanmu secara otomatis\n\n` +
    `👤 */livechat* — Chat langsung dengan admin\n` +
    `   Bot akan diam, admin yang membalas\n\n` +
    `_Sesi aktif selama 24 jam sejak pesan terakhir._`
  );
}

export async function handleMessages(sock, { messages }) {
  for (const msg of messages) {
    try {
      await processMessage(sock, msg);
    } catch (error) {
      logger.error(`❌ Error: ${error.message}`);
    }
  }
}

async function processMessage(sock, msg) {
  if (!msg.message) return;

  const msgId = msg.key.id;
  if (processedMsgIds.has(msgId)) return;
  processedMsgIds.add(msgId);

  const botJid = await getBotJid(sock);
  const botNumber = botJid?.split('@')[0]?.split(':')[0];
  const jid = msg.key.remoteJid;
  const isGroup = jid.endsWith('@g.us');

  if (msg.key.fromMe === true) return;

  const senderJid = isGroup ? (msg.key.participant || '') : jid;
  const senderNumber = senderJid?.split('@')[0]?.split(':')[0];
  if (botNumber && senderNumber === botNumber) return;

  const msgAge = Math.floor(Date.now() / 1000) - Number(msg.messageTimestamp);
  if (msgAge > 180) return;

  const msgTypes = Object.keys(msg.message);
  const ignoredTypes = [
    'reactionMessage','protocolMessage','senderKeyDistributionMessage',
    'messageContextInfo','statusMentionMessage','pollCreationMessage',
    'pollUpdateMessage','keepInChatMessage',
  ];
  if (msgTypes.every(t => ignoredTypes.includes(t))) return;

  const body = extractMessageText(msg);

  // ── Deteksi file/media yang dikirim ──────────────────────────────
  const hasMedia = msgTypes.some(t =>
    ['imageMessage', 'documentMessage', 'audioMessage'].includes(t)
  );
  const mediaMsg = msg.message?.imageMessage ||
                   msg.message?.documentMessage;
  const mediaMimetype = mediaMsg?.mimetype || '';
  const isAnalyzableFile = hasMedia && isSupportedFile(mediaMimetype);

  // Handle file analisis — caption sebagai pertanyaan (opsional)
  if (isAnalyzableFile) {
    const question = mediaMsg?.caption?.trim() || '';
    const fileCategory = getFileCategory(mediaMimetype);
    const filename = mediaMsg?.fileName || mediaMsg?.title || 'file';

    logger.info(`📎 File diterima: ${filename} (${fileCategory}) dari ${senderId}`);

    await sock.sendPresenceUpdate('composing', jid);
    try {
      const analysis = await analyzeFile(sock, msg, question);
      await sock.sendPresenceUpdate('paused', jid);
      return sock.sendMessage(jid, {
        text: `📎 *Analisis File:* _${filename}_\n\n${analysis}`
      }, { quoted: msg });
    } catch (err) {
      await sock.sendPresenceUpdate('paused', jid);
      logger.error(`❌ File analysis error: ${err.message}`);
      return sock.sendMessage(jid, {
        text: '❌ Gagal menganalisis file. Coba lagi.'
      }, { quoted: msg });
    }
  }

  if (!body || body.trim().length === 0) return;

  const senderId = senderNumber || senderJid?.split('@')[0] || '';
  const isOwner = isOwnerNumber(senderId);

  logger.info(`📨 [${isGroup ? 'GROUP' : 'PRIVATE'}] ${senderId}: "${body.substring(0, 80)}"`);

  // ── GRUP — tidak butuh state management ──────────────────────────
  if (isGroup) {
    if (!isOwner) {
      const spamResult = checkSpam(senderJid, body);
      if (spamResult.isSpam) {
        await handleSpam(sock, msg, jid, senderJid, spamResult.reason);
        return;
      }
    }
    if (body.startsWith(config.prefix)) {
      const [cmd, ...args] = body.slice(config.prefix.length).trim().split(/\s+/);
      const groupMetadata = await sock.groupMetadata(jid).catch(() => null);
      const isAdmin = isGroup ? isGroupAdmin(groupMetadata, senderJid, botJid) : false;
      await handleCommand(sock, msg, cmd, args, true, isAdmin, isOwner);
      return;
    }
    const shouldAI = checkShouldAIReply(msg, jid, true, senderJid, botJid, botNumber);
    if (shouldAI) {
      await sock.sendPresenceUpdate('composing', jid);
      const groupMetadata = await sock.groupMetadata(jid).catch(() => null);
      const reply = await askAI(senderJid, body, { groupName: groupMetadata?.subject, senderName: senderId });
      await sock.sendPresenceUpdate('paused', jid);
      await sock.sendMessage(jid, { text: reply }, { quoted: msg });
    }
    return;
  }

  // ── PRIVATE CHAT ──────────────────────────────────────────────────

  // Owner: bypass semua state, langsung proses
  if (isOwner) {
    if (body.startsWith(config.prefix) && config.managerUrl) {
      const reply = await forwardToManager(body, senderId);
      if (reply) {
        await sock.sendMessage(jid, { text: reply }, { quoted: msg });
        return;
      }
    }
    if (body.startsWith(config.prefix)) {
      const [cmd, ...args] = body.slice(config.prefix.length).trim().split(/\s+/);
      await handleCommand(sock, msg, cmd, args, false, false, true);
      return;
    }
    await sock.sendPresenceUpdate('composing', jid);
    const reply = await askAI(senderJid, body, { senderName: senderId });
    await sock.sendPresenceUpdate('paused', jid);
    await sock.sendMessage(jid, { text: reply }, { quoted: msg });
    return;
  }

  // ── STATE MACHINE untuk user biasa ────────────────────────────────
  const bodyLower = body.trim().toLowerCase();
  const state = getState(senderId);

  // Handle /start
  if (bodyLower === '/start') {
    startSession(senderId);
    greetedUsers.delete(senderId); // reset greeting
    await sock.sendMessage(jid, {
      text: `🤖 *Mode Bot Aktif!*\n\nHalo! Aku siap membantu kamu.\n\nKirim pesan apapun dan aku akan membalas.\nSesi aktif selama 24 jam sejak pesan terakhir.\n\n_Ketik */stop* untuk menghentikan bot._`,
    }, { quoted: msg });
    return;
  }

  // Handle /livechat
  if (bodyLower === '/livechat') {
    startLiveChat(senderId);
    greetedUsers.delete(senderId);
    await sock.sendMessage(jid, {
      text: `👤 *Mode Live Chat Aktif!*\n\nKamu akan terhubung langsung dengan admin.\nBot tidak akan membalas selama 24 jam.\n\nTunggu sebentar, admin akan segera membalas! 😊\n\n_Sesi berakhir otomatis jika tidak ada pesan 24 jam._`,
    }, { quoted: msg });
    return;
  }

  // Handle /stop
  if (bodyLower === '/stop') {
    if (state === 'NEW') {
      await sock.sendMessage(jid, {
        text: `ℹ️ Tidak ada sesi aktif. Ketik */start* untuk memulai.`,
      }, { quoted: msg });
    } else {
      stopSession(senderId);
      await sock.sendMessage(jid, {
        text: `🛑 *Bot dihentikan.*\n\nBot tidak akan membalas lagi.\nKetik */start* kapanpun untuk mengaktifkan kembali.`,
      }, { quoted: msg });
    }
    return;
  }

  // ── STATE: NEW ────────────────────────────────────────────────────
  if (state === 'NEW') {
    // Kirim perkenalan hanya sekali per "sesi baru"
    if (!greetedUsers.has(senderId)) {
      greetedUsers.add(senderId);
      // Hapus greeting setelah 1 jam agar bisa greet lagi kalau balik
      setTimeout(() => greetedUsers.delete(senderId), 60 * 60 * 1000);
      await sock.sendMessage(jid, {
        text: getWelcomeMessage(config.botName),
      }, { quoted: msg });
    }
    return;
  }

  // ── STATE: STOPPED ────────────────────────────────────────────────
  if (state === 'STOPPED') {
    // Bot diam total — tidak balas apapun
    // Tapi kalau user chat lagi setelah STOPPED expired (24 jam)
    // state sudah jadi NEW karena TTL
    return;
  }

  // ── STATE: LIVECHAT ───────────────────────────────────────────────
  if (state === 'LIVECHAT') {
    // Bot diam — reset timer 24 jam setiap ada pesan
    refreshTimer(senderId);
    // Tidak balas apapun — kamu yang balas manual
    return;
  }

  // ── STATE: BOT_ACTIVE ─────────────────────────────────────────────
  if (state === 'BOT_ACTIVE') {
    // Reset timer 24 jam setiap ada pesan
    refreshTimer(senderId);

    // Command handler
    if (body.startsWith(config.prefix)) {
      const [cmd, ...args] = body.slice(config.prefix.length).trim().split(/\s+/);
      await handleCommand(sock, msg, cmd, args, false, false, false);
      return;
    }

    // AI reply
    if (config.aiAutoReplyPrivate) {
      await sock.sendPresenceUpdate('composing', jid);
      const reply = await askAI(senderJid, body, { senderName: senderId });
      await sock.sendPresenceUpdate('paused', jid);
      await sock.sendMessage(jid, { text: reply }, { quoted: msg });
    }
    return;
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────

function extractMessageText(msg) {
  const m = msg.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ''
  );
}

function checkShouldAIReply(msg, jid, isGroup, senderJid, botJid, botNumber) {
  if (!isGroup) return config.aiAutoReplyPrivate;
  if (!config.aiAutoReplyGroup) return false;
  const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  if (mentionedJids.some(m => m.includes(botNumber))) return true;
  const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (quotedParticipant === botJid) return true;
  return false;
}

async function handleSpam(sock, msg, jid, senderJid, reason) {
  const userId = senderJid.split('@')[0];
  const reasonText = {
    muted: '🔇 Kamu sedang di-mute.',
    duplicate: '🚫 Jangan kirim pesan berulang!',
    rate_limit: `⚠️ Terlalu banyak pesan! Kamu di-mute ${config.spamMuteDuration} detik.`,
    pattern: '🚫 Pesan terdeteksi sebagai spam!',
  }[reason] || '🚫 Spam terdeteksi!';
  if (reason !== 'muted') {
    await sock.sendMessage(jid, { text: `@${userId} ${reasonText}`, mentions: [senderJid] });
  }
  try { await sock.sendMessage(jid, { delete: msg.key }); } catch {}
}

function isGroupAdmin(groupMetadata, userJid) {
  if (!groupMetadata) return false;
  return groupMetadata.participants
    .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
    .map(p => p.id)
    .includes(userJid);
}

async function forwardToManager(message, senderNumber) {
  try {
    const response = await fetch(`${config.managerUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: config.managerSecret,
        senderNumber,
        message,
        botId: config.botId,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.reply || null;
  } catch {
    return null;
  }
}

let cachedBotJid = null;
async function getBotJid(sock) {
  if (!cachedBotJid) cachedBotJid = sock.user?.id || '';
  return cachedBotJid;
}