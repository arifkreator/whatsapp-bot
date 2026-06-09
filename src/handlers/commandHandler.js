import config, { isOwnerNumber } from '../config.js';
import { muteUser, unmuteUser, resetUserSpam, getSpamStats } from '../services/spamDetector.js';
import { resetConversation, getActiveConversations, getQuotaStatus } from '../services/groqAI.js';
import { resetHermesConversation, getHermesActiveConversations } from '../services/hermesAI.js';
import { askAIForced, getRouterInfo } from '../services/aiRouter.js';
import { getAllSessions, getSessionCount, stopSession, resetSession, getState } from '../services/sessionManager.js';
import { getSystemPrompt, getHermesSystemPrompt, setSystemPrompt, setHermesSystemPrompt, resetSystemPrompt, resetHermesSystemPrompt, getBotConfig } from '../services/configManager.js';
import { addSkill, removeSkill, getSkill, listSkills, getSkillCount } from '../services/skillsManager.js';
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
      resetHermesConversation(senderJid);
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

    // =============================================
    // 🎨 PROMPT MANAGEMENT
    // =============================================
    case 'showprompt':
      if (!isOwner) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk owner!' });
      const currentPrompt = getSystemPrompt();
      const cfg = getBotConfig();
      return sock.sendMessage(jid, {
        text: `📝 *System Prompt Saat Ini (Groq):*\n\n${currentPrompt}\n\n` +
          `_Terakhir diubah: ${cfg.updatedAt ? new Date(cfg.updatedAt).toLocaleString('id-ID') : 'belum pernah'}_`
      });

    case 'setprompt':
      if (!isOwner) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk owner!' });
      if (!args.length) return sock.sendMessage(jid, {
        text: `❌ Format: ${config.prefix}setprompt [prompt baru]\n\nContoh:\n${config.prefix}setprompt Kamu adalah asisten bernama Aria, ramah dan membantu.`
      });
      const newPrompt = args.join(' ');
      if (newPrompt.length > 2000) return sock.sendMessage(jid, {
        text: '❌ Prompt terlalu panjang! Maksimal 2000 karakter.'
      });
      setSystemPrompt(newPrompt, sender);
      return sock.sendMessage(jid, {
        text: `✅ *System prompt Groq berhasil diupdate!*\n\n📝 Prompt baru:\n_${newPrompt}_\n\n💡 Berlaku untuk semua user mulai sekarang.`
      });

    case 'resetprompt':
      if (!isOwner) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk owner!' });
      resetSystemPrompt(sender);
      return sock.sendMessage(jid, {
        text: `✅ System prompt Groq direset ke default!\n\n📝 Prompt default:\n_${getSystemPrompt()}_`
      });

    case 'showprompt-hermes':
      if (!isOwner) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk owner!' });
      if (!config.hermesEnabled) return sock.sendMessage(jid, { text: '❌ Hermes belum aktif.' });
      const hPrompt = getHermesSystemPrompt();
      return sock.sendMessage(jid, {
        text: `🧠 *System Prompt Hermes:*\n\n${hPrompt || '_(menggunakan prompt default)_'}`
      });

    case 'setprompt-hermes':
      if (!isOwner) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk owner!' });
      if (!config.hermesEnabled) return sock.sendMessage(jid, { text: '❌ Hermes belum aktif.' });
      if (!args.length) return sock.sendMessage(jid, {
        text: `❌ Format: ${config.prefix}setprompt-hermes [prompt baru]`
      });
      const newHPrompt = args.join(' ');
      if (newHPrompt.length > 2000) return sock.sendMessage(jid, {
        text: '❌ Prompt terlalu panjang! Maksimal 2000 karakter.'
      });
      setHermesSystemPrompt(newHPrompt, sender);
      return sock.sendMessage(jid, {
        text: `✅ *System prompt Hermes berhasil diupdate!*\n\n🧠 Prompt baru:\n_${newHPrompt}_`
      });

    case 'resetprompt-hermes':
      if (!isOwner) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk owner!' });
      if (!config.hermesEnabled) return sock.sendMessage(jid, { text: '❌ Hermes belum aktif.' });
      resetHermesSystemPrompt(sender);
      return sock.sendMessage(jid, { text: '✅ System prompt Hermes direset ke default!' });

    case 'aiinfo':
      if (!isOwner) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk owner!' });
      const routerInfo = getRouterInfo();
      const quota2 = getQuotaStatus();
      return sock.sendMessage(jid, {
        text: `🧠 *AI Router Info*\n\n` +
          `*Groq:*\n` +
          `  🔑 Key aktif: ${quota2.activeKeys}/${quota2.totalKeys}\n` +
          `  💬 Sesi aktif: ${getActiveConversations()}\n` +
          `  🤖 Model: ${config.groqModel}\n\n` +
          `*Hermes Agent:*\n` +
          `  📡 Status: ${routerInfo.hermesEnabled ? '✅ Enabled' : '❌ Disabled'}\n` +
          `  🔗 URL: ${routerInfo.hermesUrl || 'belum diset'}\n` +
          `  🟢 Online: ${routerInfo.hermesAvailable === null ? 'belum dicek' : routerInfo.hermesAvailable ? 'ya' : 'tidak'}\n` +
          `  💬 Sesi aktif: ${getHermesActiveConversations()}\n` +
          `  🕐 Last check: ${routerInfo.lastChecked || '-'}`
      });

    case 'hermes':
      if (!isOwner) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk owner!' });
      if (!args.length) return sock.sendMessage(jid, {
        text: `❌ Format: ${config.prefix}hermes [pertanyaan]`
      });
      const hermesQuery = args.join(' ');
      await sock.sendPresenceUpdate('composing', jid);
      try {
        const hermesReply = await askAIForced(senderJid, hermesQuery, { senderName: sender }, 'hermes');
        await sock.sendPresenceUpdate('paused', jid);
        return sock.sendMessage(jid, { text: `🧠 *Hermes:*\n\n${hermesReply}` }, { quoted: msg });
      } catch (e) {
        await sock.sendPresenceUpdate('paused', jid);
        return sock.sendMessage(jid, { text: `❌ Hermes error: ${e.message}` });
      }

    // =============================================
    // 📚 SKILLS MANAGEMENT
    // =============================================
    case 'listskill':
    case 'listskills': {
      if (!isOwner) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk owner!' });
      const skills = listSkills();
      if (skills.length === 0) {
        return sock.sendMessage(jid, {
          text: `📚 *Belum ada skill terdaftar.*\n\nTambah skill dengan:\n${config.prefix}addskill nama | isi konten`
        });
      }
      const list = skills.map((s, i) =>
        `${i + 1}. *${s.name}*\n   _${s.content.substring(0, 60)}${s.content.length > 60 ? '...' : ''}_`
      ).join('\n\n');
      return sock.sendMessage(jid, {
        text: `📚 *Daftar Skills (${skills.length}):*\n\n${list}\n\n💡 Ketik *${config.prefix}viewskill [nama]* untuk lihat isi lengkap.`
      });
    }

    case 'addskill': {
      if (!isOwner) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk owner!' });
      const fullText = args.join(' ');
      const separatorIdx = fullText.indexOf('|');
      if (separatorIdx === -1) {
        return sock.sendMessage(jid, {
          text: `❌ Format: ${config.prefix}addskill [nama] | [isi konten]\n\n*Contoh:*\n${config.prefix}addskill FAQ Harga | Harga produk kami:\n- Paket Basic: Rp 75.000/bulan\n- Paket Pro: Rp 150.000/bulan\n- Paket Ultimate: Rp 300.000/bulan`
        });
      }
      const skillName = fullText.substring(0, separatorIdx).trim();
      const skillContent = fullText.substring(separatorIdx + 1).trim();
      if (!skillName) return sock.sendMessage(jid, { text: '❌ Nama skill tidak boleh kosong!' });
      if (!skillContent) return sock.sendMessage(jid, { text: '❌ Isi konten skill tidak boleh kosong!' });
      if (skillContent.length > 3000) return sock.sendMessage(jid, {
        text: '❌ Konten terlalu panjang! Maksimal 3000 karakter per skill.'
      });
      const key = addSkill(skillName, skillContent, sender);
      if (!key) return sock.sendMessage(jid, { text: '❌ Gagal menyimpan skill. Coba lagi.' });
      return sock.sendMessage(jid, {
        text: `✅ *Skill berhasil disimpan!*\n\n📚 Nama: *${skillName}*\n🔑 Key: \`${key}\`\n📝 Konten:\n${skillContent}\n\n💡 Skill ini akan otomatis digunakan AI saat menjawab pertanyaan.`
      });
    }

    case 'viewskill': {
      if (!isOwner) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk owner!' });
      if (!args.length) return sock.sendMessage(jid, {
        text: `❌ Format: ${config.prefix}viewskill [nama]`
      });
      const skillKey = args.join(' ');
      const skill = getSkill(skillKey);
      if (!skill) return sock.sendMessage(jid, {
        text: `❌ Skill "${skillKey}" tidak ditemukan.\n\nKetik *${config.prefix}listskills* untuk melihat daftar skill.`
      });
      return sock.sendMessage(jid, {
        text: `📚 *${skill.name}*\n\n${skill.content}\n\n_Terakhir diupdate: ${new Date(skill.updatedAt).toLocaleString('id-ID')}_`
      });
    }

    case 'removeskill':
    case 'deleteskill': {
      if (!isOwner) return sock.sendMessage(jid, { text: '❌ Command ini hanya untuk owner!' });
      if (!args.length) return sock.sendMessage(jid, {
        text: `❌ Format: ${config.prefix}removeskill [nama]`
      });
      const removeKey = args.join(' ');
      const removed = removeSkill(removeKey);
      if (!removed) return sock.sendMessage(jid, {
        text: `❌ Skill "${removeKey}" tidak ditemukan.\n\nKetik *${config.prefix}listskills* untuk melihat daftar skill.`
      });
      return sock.sendMessage(jid, {
        text: `🗑️ Skill *${removeKey}* berhasil dihapus.`
      });
    }

    case 'default':
      return sock.sendMessage(jid, {
        text: `❓ Command *${config.prefix}default* tidak dikenal.\nKetik *${config.prefix}help* untuk daftar command.`
      }, { quoted: msg });

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
    text += `  ${config.prefix}aiinfo — Info status AI router & Hermes\n`;
    text += `  ${config.prefix}hermes [pesan] — Force kirim ke Hermes Agent\n`;
    text += `\n📚 *Skills Management:*\n`;
    text += `  ${config.prefix}listskills — Daftar semua skill\n`;
    text += `  ${config.prefix}addskill [nama] | [konten] — Tambah/update skill\n`;
    text += `  ${config.prefix}viewskill [nama] — Lihat isi skill\n`;
    text += `  ${config.prefix}removeskill [nama] — Hapus skill\n`;
    text += `  ${config.prefix}showprompt — Lihat system prompt Groq\n`;
    text += `  ${config.prefix}setprompt [teks] — Set system prompt Groq\n`;
    text += `  ${config.prefix}resetprompt — Reset prompt Groq ke default\n`;
    if (config.hermesEnabled) {
      text += `  ${config.prefix}showprompt-hermes — Lihat system prompt Hermes\n`;
      text += `  ${config.prefix}setprompt-hermes [teks] — Set system prompt Hermes\n`;
      text += `  ${config.prefix}resetprompt-hermes — Reset prompt Hermes ke default\n`;
    }
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