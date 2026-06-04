import config, { isOwnerNumber } from '../config.js';
import { muteUser, unmuteUser, resetUserSpam, getSpamStats } from '../services/spamDetector.js';
import { resetConversation, getActiveConversations, getQuotaStatus } from '../services/groqAI.js';
import { getAllSessions, getSessionCount, stopSession, resetSession, getState } from '../services/sessionManager.js';
import logger from '../utils/logger.js';

export async function handleCommand(sock, msg, command, args, isGroup, isAdmin, isOwner) {
  const jid = msg.key.remoteJid;
  const senderJid = msg.key.participant || jid;
  const sender = senderJid.split('@')[0];

  logger.info(`📌 Command: ${command} | By: ${sender}`);

  switch (command.toLowerCase()) {

    // =============================================
    // 📋 COMMAND UMUM
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
      return handleMute(sock, msg, jid, true);

    case 'unmute':
      if (!isGroup) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk grup!' });
      if (!isAdmin) return sock.sendMessage(jid, { text: '❌ Kamu bukan admin grup!' });
      return handleMute(sock, msg, jid, false);

    case 'kick':
      if (!isGroup) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk grup!' });
      if (!isAdmin) return sock.sendMessage(jid, { text: '❌ Kamu bukan admin grup!' });
      return handleKick(sock, msg, jid);

    case 'warn':
      if (!isGroup) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk grup!' });
      if (!isAdmin) return sock.sendMessage(jid, { text: '❌ Kamu bukan admin grup!' });
      return handleWarn(sock, msg, jid);

    case 'antispam':
      if (!isGroup) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk grup!' });
      if (!isAdmin) return sock.sendMessage(jid, { text: '❌ Kamu bukan admin grup!' });
      return sock.sendMessage(jid, {
        text: `🛡️ *Status Anti-Spam*\n\n${JSON.stringify(getSpamStats(), null, 2)}`
      });

    // =============================================
    // 👑 COMMAND OWNER
    // =============================================
    case 'restart':
      if (!isOwner) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk owner!' });
      await sock.sendMessage(jid, { text: '🔄 Bot sedang restart...' });
      setTimeout(() => process.exit(0), 2000);
      return;

    case 'status':
      if (!isOwner) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk owner!' });
      const stats = getSpamStats();
      const quota = getQuotaStatus();
      const sessions = getAllSessions();
      const byState = { BOT_ACTIVE: 0, LIVECHAT: 0, STOPPED: 0 };
      sessions.forEach(s => { if (byState[s.state] !== undefined) byState[s.state]++; });
      return sock.sendMessage(jid, {
        text: `📊 *Status Bot*\n\n` +
          `🤖 AI aktif: ${getActiveConversations()} user\n` +
          `💬 Total sesi: ${getSessionCount()} user\n` +
          `   🟢 BOT_ACTIVE: ${byState.BOT_ACTIVE}\n` +
          `   👤 LIVECHAT: ${byState.LIVECHAT}\n` +
          `   🛑 STOPPED: ${byState.STOPPED}\n` +
          `🔑 API Key: ${quota.activeKeys}/${quota.totalKeys} aktif\n` +
          `👥 Track spam: ${stats.trackedUsers} user\n` +
          `🔇 Muted: ${stats.mutedUsers} user\n` +
          `🧠 Model: ${config.groqModel}`
      });

    case 'sessions':
      if (!isOwner) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk owner!' });
      const allSessions = getAllSessions();
      if (allSessions.length === 0) {
        return sock.sendMessage(jid, { text: '📭 Belum ada sesi aktif.' });
      }
      const stateEmoji = { BOT_ACTIVE: '🤖', LIVECHAT: '👤', STOPPED: '🛑' };
      const list = allSessions.map((s, i) =>
        `${i + 1}. ${stateEmoji[s.state] || '❓'} ${s.userId} — ${s.state}`
      ).join('\n');
      return sock.sendMessage(jid, {
        text: `💬 *Semua Sesi (${allSessions.length})*\n\n${list}`
      });

    case 'kick-session':
      if (!isOwner) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk owner!' });
      if (!args[0]) return sock.sendMessage(jid, {
        text: `❌ Format: ${config.prefix}kick-session 628xxx`
      });
      stopSession(args[0]);
      return sock.sendMessage(jid, { text: `✅ Sesi user ${args[0]} dihentikan.` });

    case 'reset-session':
      if (!isOwner) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk owner!' });
      if (!args[0]) return sock.sendMessage(jid, {
        text: `❌ Format: ${config.prefix}reset-session 628xxx`
      });
      resetSession(args[0]);
      return sock.sendMessage(jid, { text: `✅ Sesi user ${args[0]} direset ke NEW.` });

    // Cek state user tertentu
    case 'state':
      if (!isOwner) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk owner!' });
      if (!args[0]) return sock.sendMessage(jid, {
        text: `❌ Format: ${config.prefix}state 628xxx`
      });
      const userState = getState(args[0]);
      return sock.sendMessage(jid, {
        text: `📊 State user ${args[0]}: *${userState}*`
      });

    default:
      return sock.sendMessage(jid, {
        text: `❓ Command *${config.prefix}${command}* tidak dikenal.\nKetik *${config.prefix}help* untuk daftar command.`
      }, { quoted: msg });
  }
}

// ── HELPER FUNCTIONS ──────────────────────────────────────────────────

async function sendHelp(sock, jid, isAdmin, isOwner) {
  let text = `🤖 *${config.botName} — Menu*\n\n`;

  text += `💬 *Memulai Chat:*\n`;
  text += `  /start — Aktifkan bot AI\n`;
  text += `  /livechat — Chat dengan admin\n`;
  text += `  /stop — Hentikan sesi\n\n`;

  text += `📋 *Command Umum:*\n`;
  text += `  ${config.prefix}help — Tampilkan menu ini\n`;
  text += `  ${config.prefix}ping — Cek status bot\n`;
  text += `  ${config.prefix}reset — Reset riwayat AI\n\n`;

  if (isAdmin) {
    text += `🛡️ *Admin Grup:*\n`;
    text += `  ${config.prefix}mute @user — Mute member\n`;
    text += `  ${config.prefix}unmute @user — Unmute member\n`;
    text += `  ${config.prefix}kick @user — Kick member\n`;
    text += `  ${config.prefix}warn @user — Peringatkan member\n`;
    text += `  ${config.prefix}antispam — Status spam\n\n`;
  }

  if (isOwner) {
    text += `👑 *Owner Only:*\n`;
    text += `  ${config.prefix}status — Status bot\n`;
    text += `  ${config.prefix}restart — Restart bot\n`;
    text += `  ${config.prefix}sessions — Lihat semua sesi\n`;
    text += `  ${config.prefix}state 628xxx — Cek state user\n`;
    text += `  ${config.prefix}kick-session 628xxx — Stop sesi user\n`;
    text += `  ${config.prefix}reset-session 628xxx — Reset sesi user ke NEW\n`;
  }

  return sock.sendMessage(jid, { text });
}

async function handleMute(sock, msg, jid, shouldMute) {
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  if (!mentioned.length) {
    return sock.sendMessage(jid, {
      text: `❌ Tag user yang ingin di-${shouldMute ? 'mute' : 'unmute'}!`
    });
  }
  for (const userJid of mentioned) {
    const userId = userJid.split('@')[0];
    if (shouldMute) {
      muteUser(userId);
      await sock.sendMessage(jid, { text: `🔇 @${userId} di-mute.`, mentions: [userJid] });
    } else {
      unmuteUser(userId);
      resetUserSpam(userId);
      await sock.sendMessage(jid, { text: `🔊 @${userId} di-unmute.`, mentions: [userJid] });
    }
  }
}

async function handleKick(sock, msg, jid) {
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  if (!mentioned.length) {
    return sock.sendMessage(jid, { text: `❌ Tag user yang ingin dikeluarkan!` });
  }
  try {
    await sock.groupParticipantsUpdate(jid, mentioned, 'remove');
    const names = mentioned.map(j => `@${j.split('@')[0]}`).join(', ');
    await sock.sendMessage(jid, { text: `👢 ${names} dikeluarkan.`, mentions: mentioned });
  } catch (e) {
    await sock.sendMessage(jid, { text: `❌ Gagal kick: ${e.message}` });
  }
}

async function handleWarn(sock, msg, jid) {
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  if (!mentioned.length) {
    return sock.sendMessage(jid, { text: `❌ Tag user yang ingin diperingatkan!` });
  }
  for (const userJid of mentioned) {
    await sock.sendMessage(jid, {
      text: `⚠️ *PERINGATAN*\n\n@${userJid.split('@')[0]}, kamu mendapat peringatan dari admin!\nHarap patuhi peraturan grup.`,
      mentions: [userJid]
    });
  }
}
