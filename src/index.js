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
import { loadConfig } from './services/configManager.js';
import { loadSkills } from './services/skillsManager.js';
import { loadContacts } from './services/broadcastManager.js';
import { handleManagerRequest } from './handlers/managerHandler.js';
import logger from './utils/logger.js';
import config from './config.js';
import { promises as fs } from 'fs';
import http from 'http';
import { isOwnerNumber } from './config.js';
import fetch from 'node-fetch';

// =============================================
// QR CODE WEB SERVER
// Tampilkan QR sebagai halaman web agar mudah di-scan
// =============================================
let currentQR = null;

let sockRef = null; // referensi socket untuk manager handler

const qrServer = http.createServer(async (req, res) => {
  // ── Manager endpoint ─────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/manager') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        req.body = JSON.parse(body);
        await handleManagerRequest(req, res, sockRef);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // ── Health check ─────────────────────────────────────────────────
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', botId: config.botId }));
    return;
  }

  // ── QR Code page ─────────────────────────────────────────────────
  if (req.url === '/qr') {
    if (!currentQR) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#f0f0f0">
          <h2>✅ Bot sudah terhubung!</h2>
          <p>Tidak perlu scan QR lagi.</p>
        </body></html>
      `);
      return;
    }
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(currentQR)}`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <html><head>
        <meta http-equiv="refresh" content="30">
        <style>body{font-family:sans-serif;text-align:center;padding:40px;background:#f0f0f0}</style>
      </head><body>
        <h2>📱 Scan QR Code WhatsApp</h2>
        <p>Buka WhatsApp → <b>Perangkat Tertaut</b> → <b>Tautkan Perangkat</b></p>
        <img src="${qrUrl}" style="border:8px solid white;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.15)" />
        <p style="color:#888;font-size:13px">Halaman otomatis refresh tiap 30 detik. QR expired dalam ~60 detik.</p>
      </body></html>
    `);
    return;
  }

  // Root redirect ke /qr
  res.writeHead(302, { Location: '/qr' });
  res.end();
});

const PORT = process.env.PORT || 3000;
qrServer.listen(PORT, () => {
  logger.info(`🌐 QR Server jalan di port ${PORT} — buka /qr untuk scan`);
});

// =============================================
// INISIALISASI BOT
// =============================================

let sock = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;

async function startBot() {
  loadConfig();
  loadSkills();
  loadContacts();
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

  // Simpan referensi socket untuk manager handler
  sockRef = sock;

  // =============================================
  // EVENT HANDLERS
  // =============================================

  // QR Code untuk login
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      // Tetap tampilkan di terminal (kecil)
      qrcode.generate(qr, { small: true });
      logger.info('─'.repeat(50));
      logger.info('📱 QR CODE TERSEDIA — Buka URL ini di browser:');
      logger.info(`🔗 https://<railway-domain>/qr`);
      logger.info('💡 Atau cek tab "Settings > Domains" di Railway untuk URL kamu');
      logger.info('─'.repeat(50));
    }

    if (connection === 'open') {
      currentQR = null; // Reset QR setelah login
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