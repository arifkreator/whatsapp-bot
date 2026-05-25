import config, { isOwnerNumber } from '../config.js';
import { muteUser, unmuteUser, resetUserSpam, getSpamStats, isUserMuted } from '../services/spamDetector.js';
import { resetConversation, getActiveConversations, getQuotaStatus } from '../services/groqAI.js';
import { getAllSessions, getSessionCount, stopSession } from '../services/sessionManager.js';
import logger from '../utils/logger.js';

/**
 * Handler untuk semua command yang diawali prefix
 */
export async function handleCommand(sock, msg, command, args, isGroup, isAdmin, isOwner) {
  const jid = msg.key.remoteJid;
  const senderJid = msg.key.participant || jid;
  const sender = senderJid.split('@')[0];

  logger.info(`📌 Command: ${command} | Args: ${args.join(' ')} | By: ${sender}`);

  switch (command.toLowerCase()) {

    // =============================================
    // 📋 COMMAND UMUM (semua user)
    // =============================================
    case 'help':
    case 'menu':
      return sendHelp(sock, jid, isAdmin, isOwner);

    case 'ping':
      return sock.sendMessage(jid, {
        text: `🏓 *Pong!*\n⏱ Response: ${Date.now() - (msg.messageTimestamp * 1000)}ms`
      }, { quoted: msg });

    case 'reset':
    case 'clear':
      resetConversation(senderJid);
      return sock.sendMessage(jid, {
        text: '🔄 Riwayat percakapan AI kamu sudah direset!'
      }, { quoted: msg });

    // =============================================
    // 🛡️ COMMAND ADMIN GRUP
    // =============================================
    case 'mute':
      if (!isGroup) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk grup!' });
      if (!isAdmin) return sock.sendMessage(jid, { text: '❌ Kamu bukan admin grup!' });
      return handleMute(sock, msg, jid, args, true);

    case 'unmute':
      if (!isGroup) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk grup!' });
      if (!isAdmin) return sock.sendMessage(jid, { text: '❌ Kamu bukan admin grup!' });
      return handleMute(sock, msg, jid, args, false);

    case 'kick':
      if (!isGroup) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk grup!' });
      if (!isAdmin) return sock.sendMessage(jid, { text: '❌ Kamu bukan admin grup!' });
      return handleKick(sock, msg, jid);

    case 'warn':
      if (!isGroup) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk grup!' });
      if (!isAdmin) return sock.sendMessage(jid, { text: '❌ Kamu bukan admin grup!' });
      return handleWarn(sock, msg, jid, senderJid);

    case 'antispam':
      if (!isGroup) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk grup!' });
      if (!isAdmin) return sock.sendMessage(jid, { text: '❌ Kamu bukan admin grup!' });
      return sock.sendMessage(jid, {
        text: `🛡️ *Status Anti-Spam*\n\n${JSON.stringify(getSpamStats(), null, 2)}`
      });

    // =============================================
    // 👑 COMMAND OWNER
    // =============================================
    case 'status':
      if (!isOwner) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk owner!' });
      const stats = getSpamStats();
      const quota = getQuotaStatus();
      return sock.sendMessage(jid, {
        text: `📊 *Status Bot*\n\n` +
          `🤖 AI aktif: ${getActiveConversations()} user\n` +
          `💬 Session aktif: ${getSessionCount()} user\n` +
          `🔑 API Key: ${quota.activeKeys}/${quota.totalKeys} aktif (key-${quota.currentKey} dipakai)\n` +
          `😴 Key exhausted: ${quota.exhaustedKeys}\n` +
          `👥 Track spam: ${stats.trackedUsers} user\n` +
          `🔇 Muted: ${stats.mutedUsers} user\n` +
          `🧠 Model: ${config.groqModel}`
      });

    case 'sessions':
      if (!isOwner) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk owner!' });
      const sessions = getAllSessions();
      if (sessions.length === 0) {
        return sock.sendMessage(jid, { text: '📭 Belum ada user yang aktif (/start).' });
      }
      const sessionList = sessions.map((s, i) =>
        `${i + 1}. ${s.userId} — sejak ${new Date(s.startedAt).toLocaleString('id-ID')}`
      ).join('\n');
      return sock.sendMessage(jid, {
        text: `💬 *Session Aktif (${sessions.length})*\n\n${sessionList}`
      });

    case 'kick-session':
      if (!isOwner) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk owner!' });
      if (!args[0]) return sock.sendMessage(jid, { text: `❌ Masukkan nomor user!\nContoh: ${config.prefix}kick-session 628xxx` });
      stopSession(args[0]);
      return sock.sendMessage(jid, { text: `✅ Session user ${args[0]} berhasil dihentikan.` });

    default:
      return sock.sendMessage(jid, {
        text: `❓ Command *${config.prefix}${command}* tidak dikenal.\nKetik *${config.prefix}help* untuk daftar command.`
      }, { quoted: msg });
  }
}

// =============================================
// HELPER FUNCTIONS
// =============================================

async function sendHelp(sock, jid, isAdmin, isOwner) {
  let text = `🤖 *${config.botName} - Menu Bantuan*\n\n`;

  text += `📋 *Command Umum:*\n`;
  text += `  ${config.prefix}help - Tampilkan menu ini\n`;
  text += `  ${config.prefix}ping - Cek status bot\n`;
  text += `  ${config.prefix}reset - Reset riwayat AI\n\n`;

  text += `💬 *AI Agent:*\n`;
  text += `  Mention/reply bot di grup untuk tanya AI\n`;
  text += `  Atau chat langsung di private\n\n`;

  if (isAdmin) {
    text += `🛡️ *Admin Grup:*\n`;
    text += `  ${config.prefix}mute @user - Mute member\n`;
    text += `  ${config.prefix}unmute @user - Unmute member\n`;
    text += `  ${config.prefix}kick @user - Keluarkan member\n`;
    text += `  ${config.prefix}warn @user - Peringatkan member\n`;
    text += `  ${config.prefix}antispam - Status anti-spam\n\n`;
  }

  if (isOwner) {
    text += `👑 *Owner Only:*\n`;
    text += `  ${config.prefix}status - Status bot keseluruhan\n`;
    text += `  ${config.prefix}sessions - Lihat semua user aktif\n`;
    text += `  ${config.prefix}kick-session 628xxx - Hentikan session user\n`;
  }

  text += `\n_Prefix: ${config.prefix} | Bot by ${config.botName}_`;

  return sock.sendMessage(jid, { text });
}

async function handleMute(sock, msg, jid, args, shouldMute) {
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
    msg.message?.groupMentionedMessage?.contextInfo?.mentionedJid || [];

  if (!mentioned.length) {
    return sock.sendMessage(jid, {
      text: `❌ Tag user yang ingin di-${shouldMute ? 'mute' : 'unmute'}!\nContoh: ${config.prefix}${shouldMute ? 'mute' : 'unmute'} @user`
    });
  }

  for (const userJid of mentioned) {
    const userId = userJid.split('@')[0];
    if (shouldMute) {
      muteUser(userId);
      await sock.sendMessage(jid, { text: `🔇 @${userId} telah di-mute dari bot.`, mentions: [userJid] });
    } else {
      unmuteUser(userId);
      resetUserSpam(userId);
      await sock.sendMessage(jid, { text: `🔊 @${userId} telah di-unmute.`, mentions: [userJid] });
    }
  }
}

async function handleKick(sock, msg, jid) {
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

  if (!mentioned.length) {
    return sock.sendMessage(jid, { text: `❌ Tag user yang ingin dikeluarkan!\nContoh: ${config.prefix}kick @user` });
  }

  try {
    await sock.groupParticipantsUpdate(jid, mentioned, 'remove');
    const names = mentioned.map(j => `@${j.split('@')[0]}`).join(', ');
    await sock.sendMessage(jid, { text: `👢 ${names} telah dikeluarkan dari grup.`, mentions: mentioned });
  } catch (e) {
    await sock.sendMessage(jid, { text: `❌ Gagal kick: ${e.message}` });
  }
}

async function handleWarn(sock, msg, jid, adminJid) {
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

  if (!mentioned.length) {
    return sock.sendMessage(jid, { text: `❌ Tag user yang ingin diperingatkan!` });
  }

  for (const userJid of mentioned) {
    await sock.sendMessage(jid, {
      text: `⚠️ *PERINGATAN*\n\n@${userJid.split('@')[0]}, kamu mendapat peringatan dari admin.\nHarap patuhi peraturan grup!`,
      mentions: [userJid]
    });
  }
}
