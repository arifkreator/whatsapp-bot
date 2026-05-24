import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import { handleMessages } from './handlers/messageHandler.js';
import logger from './utils/logger.js';
import config from './config.js';
import { promises as fs } from 'fs';

// =============================================
// INISIALISASI BOT
// =============================================

let sock = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;

async function startBot() {
  logger.info(`🚀 Menjalankan ${config.botName}...`);

  // Pastikan folder sesi ada
  await fs.mkdir(config.sessionPath, { recursive: true });

  // Load atau buat state autentikasi
  const { state, saveCreds } = await useMultiFileAuthState(config.sessionPath);

  // Ambil versi Baileys terbaru
  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info(`📦 Baileys v${version} ${isLatest ? '(latest)' : '(outdated)'}`);

  // Buat koneksi WhatsApp
  sock = makeWASocket({
    version,
    logger: logger.child({ level: 'silent' }), // Suppress Baileys internal logs
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger.child({ level: 'silent' })),
    },
    browser: [config.botName, 'Chrome', '120.0.0'],
    printQRInTerminal: false, // Kita handle manual di bawah
    syncFullHistory: false,
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: false,
  });

  // =============================================
  // EVENT HANDLERS
  // =============================================

  // QR Code untuk login
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info('📱 Scan QR code ini untuk login WhatsApp:');
      console.log('\n');
      qrcode.generate(qr, { small: true });
      console.log('\n💡 Buka WhatsApp > Perangkat Tertaut > Tautkan Perangkat\n');
    }

    if (connection === 'open') {
      reconnectAttempts = 0;
      logger.info(`✅ ${config.botName} berhasil terhubung sebagai ${sock.user?.id?.split(':')[0]}`);
      logger.info(`🤖 AI: Groq (${config.groqModel}) — FREE tier`);
      logger.info(`🛡️ Anti-spam: aktif (max ${config.spamMaxMessages} msg/${config.spamTimeWindow}s)`);
      logger.info(`📌 Prefix: "${config.prefix}"`);
    }

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;

      logger.warn(`⚠️ Koneksi terputus. Reason: ${reason}`);

      if (shouldReconnect && reconnectAttempts < MAX_RECONNECT) {
        reconnectAttempts++;
        const delay = Math.min(5000 * reconnectAttempts, 30000);
        logger.info(`🔄 Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT} dalam ${delay / 1000}s...`);
        setTimeout(startBot, delay);
      } else if (reason === DisconnectReason.loggedOut) {
        logger.error('🚫 Bot ter-logout! Hapus folder sessions/ dan scan QR ulang.');
        // Hapus sesi lama
        await fs.rm(config.sessionPath, { recursive: true, force: true });
        process.exit(1);
      } else {
        logger.error('❌ Max reconnect tercapai. Restart manual diperlukan.');
        process.exit(1);
      }
    }
  });

  // Simpan credentials
  sock.ev.on('creds.update', saveCreds);

  // Handle pesan masuk
  sock.ev.on('messages.upsert', async (m) => {
    if (m.type === 'notify') {
      await handleMessages(sock, m);
    }
  });

  // Handle update grup (member join/leave)
  sock.ev.on('group-participants.update', async (update) => {
    const { id, participants, action } = update;

    if (action === 'add') {
      for (const participant of participants) {
        const username = participant.split('@')[0];
        await sock.sendMessage(id, {
          text: `👋 Selamat datang @${username}! Semoga betah di grup ini 😊`,
          mentions: [participant],
        });
      }
    }

    if (action === 'remove') {
      for (const participant of participants) {
        const username = participant.split('@')[0];
        await sock.sendMessage(id, {
          text: `👋 @${username} telah meninggalkan grup.`,
          mentions: [participant],
        });
      }
    }
  });

  return sock;
}

// =============================================
// GRACEFUL SHUTDOWN
// =============================================

process.on('SIGINT', async () => {
  logger.info('\n👋 Bot dihentikan (SIGINT)');
  if (sock) await sock.logout().catch(() => {});
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('\n👋 Bot dihentikan (SIGTERM)');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', reason);
});

// =============================================
// START
// =============================================

startBot().catch(err => {
  logger.error('❌ Fatal error:', err);
  process.exit(1);
});
