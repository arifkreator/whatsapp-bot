import config, { isOwnerNumber } from '../config.js';
import { checkSpam, resetUserSpam } from '../services/spamDetector.js';
import { askGroq } from '../services/groqAI.js';
import { handleCommand } from './commandHandler.js';
import { hasSession, startSession, stopSession } from '../services/sessionManager.js';
import logger from '../utils/logger.js';

// Set untuk track message ID yang sudah diproses (anti-duplikat)
const processedMsgIds = new Set();
setInterval(() => processedMsgIds.clear(), 10 * 60 * 1000);

// Set untuk track user yang sudah dapat hint /start (agar tidak spam)
const hintedUsers = new Set();

export async function handleMessages(sock, { messages }) {
  for (const msg of messages) {
    try {
      await processMessage(sock, msg);
    } catch (error) {
      logger.error(`❌ Error processing message: ${error.message}`);
    }
  }
}

async function processMessage(sock, msg) {

  // ── GUARD 1: Tidak ada konten ──────────────────────────────────────
  if (!msg.message) return;

  // ── GUARD 2: Deduplikasi ───────────────────────────────────────────
  const msgId = msg.key.id;
  if (processedMsgIds.has(msgId)) return;
  processedMsgIds.add(msgId);

  // ── GUARD 3: Pesan dari diri sendiri ──────────────────────────────
  const botJid = await getBotJid(sock);
  const botNumber = botJid?.split('@')[0]?.split(':')[0];
  const jid = msg.key.remoteJid;
  const isGroup = jid.endsWith('@g.us');

  if (msg.key.fromMe === true) return;

  const senderJid = isGroup ? (msg.key.participant || '') : jid;
  const senderNumber = senderJid?.split('@')[0]?.split(':')[0];
  if (botNumber && senderNumber === botNumber) return;

  // ── GUARD 4: Pesan terlalu lama ───────────────────────────────────
  const msgAge = Math.floor(Date.now() / 1000) - Number(msg.messageTimestamp);
  if (msgAge > 180) return;

  // ── GUARD 5: Tipe pesan tidak relevan ─────────────────────────────
  const msgTypes = Object.keys(msg.message);
  const ignoredTypes = [
    'reactionMessage', 'protocolMessage', 'senderKeyDistributionMessage',
    'messageContextInfo', 'statusMentionMessage', 'pollCreationMessage',
    'pollUpdateMessage', 'keepInChatMessage', 'callLogMesssage',
  ];
  if (msgTypes.every(t => ignoredTypes.includes(t))) return;

  // ── Ambil teks pesan ───────────────────────────────────────────────
  const body = extractMessageText(msg);
  if (!body || body.trim().length === 0) return;

  const senderId = senderNumber || senderJid?.split('@')[0] || '';
  const isOwner = isOwnerNumber(senderId);

  logger.info(`📨 [${isGroup ? 'GROUP' : 'PRIVATE'}] ${senderId}: "${body.substring(0, 80)}"`);

  // ── HANDLE /start dan /stop (prioritas tertinggi, sebelum session check)
  const bodyLower = body.trim().toLowerCase();

  if (bodyLower === '/start') {
    if (isGroup) {
      // Di grup, /start tidak diperlukan — bot selalu aktif untuk kontrol grup
      return;
    }
    if (hasSession(senderId)) {
      await sock.sendMessage(jid, {
        text: `✅ Bot sudah aktif untuk kamu!\nKetik */stop* untuk menghentikan.`,
      }, { quoted: msg });
    } else {
      startSession(senderId);
      await sock.sendMessage(jid, {
        text: `🤖 *Bot Aktif!*\n\nHalo! Aku siap membantumu.\n\n` +
              `💬 Kirim pesan apapun untuk mulai ngobrol\n` +
              `❓ Ketik *${config.prefix}help* untuk melihat semua fitur\n` +
              `🛑 Ketik */stop* untuk menonaktifkan bot`,
      }, { quoted: msg });
    }
    return;
  }

  if (bodyLower === '/stop') {
    if (isGroup) return; // /stop tidak berlaku di grup
    if (!hasSession(senderId) && !isOwner) {
      await sock.sendMessage(jid, {
        text: `ℹ️ Bot memang belum aktif. Ketik */start* untuk mengaktifkan.`,
      }, { quoted: msg });
    } else {
      stopSession(senderId);
      await sock.sendMessage(jid, {
        text: `🛑 *Bot dinonaktifkan.*\n\nAku tidak akan membalas pesanmu lagi.\nKetik */start* kapanpun untuk mengaktifkan kembali.`,
      }, { quoted: msg });
    }
    return;
  }

  // ── SESSION CHECK (hanya untuk private chat) ──────────────────────
  // Owner selalu bisa chat tanpa /start
  // Grup tidak butuh /start — bot selalu aktif untuk kontrol grup
  if (!isGroup && !isOwner) {
    if (!hasSession(senderId)) {
      // User belum /start atau sudah /stop
      // Kirim petunjuk sekali saja pakai NodeCache di sessionManager
      const alreadyHinted = hintedUsers.has(senderId);
      if (!alreadyHinted) {
        hintedUsers.add(senderId);
        // Hapus hint setelah 1 jam agar bisa kirim lagi kalau balik
        setTimeout(() => hintedUsers.delete(senderId), 60 * 60 * 1000);
        await sock.sendMessage(jid, {
          text: `👋 Halo! Untuk mulai menggunakan bot, ketik:\n\n*/start*`,
        }, { quoted: msg });
      }
      // STOP DI SINI — jangan proses apapun lagi
      return;
    }
  }

  // ── ANTI-SPAM (khusus grup) ────────────────────────────────────────
  if (isGroup && !isOwner) {
    const spamResult = checkSpam(senderJid, body);
    if (spamResult.isSpam) {
      logger.warn(`🚨 SPAM dari ${senderId}: ${spamResult.reason}`);
      await handleSpam(sock, msg, jid, senderJid, spamResult.reason);
      return;
    }
  }

  // ── COMMAND HANDLER ───────────────────────────────────────────────
  if (body.startsWith(config.prefix)) {
    const [cmd, ...args] = body.slice(config.prefix.length).trim().split(/\s+/);
    const groupMetadata = isGroup ? await sock.groupMetadata(jid).catch(() => null) : null;
    const isAdmin = isGroup ? isGroupAdmin(groupMetadata, senderJid, botJid) : false;
    await handleCommand(sock, msg, cmd, args, isGroup, isAdmin, isOwner);
    return;
  }

  // ── AI AGENT ──────────────────────────────────────────────────────
  const shouldReplyWithAI = checkShouldAIReply(msg, jid, isGroup, senderJid, botJid, botNumber);

  if (shouldReplyWithAI) {
    await sock.sendPresenceUpdate('composing', jid);

    const groupMetadata = isGroup ? await sock.groupMetadata(jid).catch(() => null) : null;
    const context = {
      groupName: groupMetadata?.subject,
      senderName: senderId,
    };

    const reply = await askGroq(senderJid, body, context);

    await sock.sendPresenceUpdate('paused', jid);
    await sock.sendMessage(jid, { text: reply }, { quoted: msg });
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
    await sock.sendMessage(jid, {
      text: `@${userId} ${reasonText}`,
      mentions: [senderJid],
    });
  }

  try {
    await sock.sendMessage(jid, { delete: msg.key });
  } catch { /* bot bukan admin */ }
}

function isGroupAdmin(groupMetadata, userJid, botJid) {
  if (!groupMetadata) return false;
  const admins = groupMetadata.participants
    .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
    .map(p => p.id);
  return admins.includes(userJid);
}

let cachedBotJid = null;
async function getBotJid(sock) {
  if (!cachedBotJid) {
    cachedBotJid = sock.user?.id || '';
  }
  return cachedBotJid;
}
