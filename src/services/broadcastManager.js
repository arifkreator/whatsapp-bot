import fs from 'fs';
import path from 'path';
import config from '../config.js';
import logger from '../utils/logger.js';

// =============================================
// BROADCAST MANAGER
// Kelola daftar nomor & kirim blast WA
// dengan rate limiting untuk menghindari banned
// =============================================

const BROADCAST_FILE = path.join(config.sessionPath, 'broadcast-contacts.json');

// Batasan keamanan
export const BROADCAST_LIMITS = {
  MAX_PER_BLAST: 50,        // maks penerima per sekali blast
  INTERVAL_MS: 5000,        // jeda antar pesan (5 detik)
  DAILY_MAX: 200,           // maks pesan per hari (safety cap)
};

// In-memory
let _contacts = null;
let _activeBroadcast = false; // cegah double blast bersamaan
let _dailyCount = 0;
let _dailyDate = null;

// =============================================
// LOAD / SAVE
// =============================================
export function loadContacts() {
  try {
    if (fs.existsSync(BROADCAST_FILE)) {
      const raw = fs.readFileSync(BROADCAST_FILE, 'utf-8');
      _contacts = JSON.parse(raw);
      logger.info(`📋 Broadcast contacts dimuat: ${Object.keys(_contacts).length} nomor`);
    } else {
      _contacts = {};
    }
  } catch (err) {
    logger.error(`❌ Gagal load broadcast contacts: ${err.message}`);
    _contacts = {};
  }
  return _contacts;
}

function saveContacts() {
  try {
    const dir = path.dirname(BROADCAST_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BROADCAST_FILE, JSON.stringify(_contacts, null, 2), 'utf-8');
    return true;
  } catch (err) {
    logger.error(`❌ Gagal simpan broadcast contacts: ${err.message}`);
    return false;
  }
}

// =============================================
// DAILY COUNTER
// =============================================
function checkDailyLimit() {
  const today = new Date().toDateString();
  if (_dailyDate !== today) {
    _dailyDate = today;
    _dailyCount = 0;
  }
  return _dailyCount;
}

function incrementDaily(count) {
  checkDailyLimit();
  _dailyCount += count;
}

// =============================================
// CRUD CONTACTS
// =============================================
export function addContact(number, label = '') {
  if (!_contacts) loadContacts();
  const clean = number.replace(/[^0-9]/g, '');
  if (!clean || clean.length < 8) return false;

  // Pastikan format internasional (62xxx untuk Indonesia)
  const normalized = clean.startsWith('0') ? '62' + clean.slice(1) : clean;

  _contacts[normalized] = {
    number: normalized,
    label: label.trim() || normalized,
    addedAt: _contacts[normalized]?.addedAt || new Date().toISOString(),
  };
  return saveContacts() ? normalized : false;
}

export function addContactsBulk(text) {
  // Parse nomor dari teks — pisahkan dengan koma, newline, atau spasi
  const numbers = text.split(/[\n,;\s]+/).map(n => n.trim()).filter(Boolean);
  let added = 0;
  let failed = 0;
  for (const num of numbers) {
    const result = addContact(num);
    if (result) added++;
    else failed++;
  }
  saveContacts();
  return { added, failed, total: numbers.length };
}

export function removeContact(number) {
  if (!_contacts) loadContacts();
  const clean = number.replace(/[^0-9]/g, '');
  const normalized = clean.startsWith('0') ? '62' + clean.slice(1) : clean;
  if (!_contacts[normalized]) return false;
  delete _contacts[normalized];
  return saveContacts();
}

export function clearAllContacts() {
  _contacts = {};
  return saveContacts();
}

export function listContacts() {
  if (!_contacts) loadContacts();
  return Object.values(_contacts);
}

export function getContactCount() {
  if (!_contacts) loadContacts();
  return Object.keys(_contacts).length;
}

export function isBroadcastActive() {
  return _activeBroadcast;
}

// =============================================
// BROADCAST ENGINE
// =============================================
export async function runBroadcast(sock, message, onProgress = null) {
  if (!_contacts) loadContacts();

  if (_activeBroadcast) {
    return { success: false, reason: 'Broadcast sedang berjalan! Tunggu selesai dulu.' };
  }

  const contacts = Object.values(_contacts);
  if (contacts.length === 0) {
    return { success: false, reason: 'Belum ada kontak di daftar broadcast.' };
  }

  // Cek daily limit
  const todayCount = checkDailyLimit();
  if (todayCount >= BROADCAST_LIMITS.DAILY_MAX) {
    return {
      success: false,
      reason: `Sudah mencapai batas harian (${BROADCAST_LIMITS.DAILY_MAX} pesan). Coba lagi besok.`
    };
  }

  // Batasi jumlah penerima
  const remaining = BROADCAST_LIMITS.DAILY_MAX - todayCount;
  const target = contacts.slice(0, Math.min(BROADCAST_LIMITS.MAX_PER_BLAST, remaining));

  if (target.length === 0) {
    return { success: false, reason: 'Tidak ada kontak yang bisa dikirim.' };
  }

  _activeBroadcast = true;
  let sent = 0;
  let failed = 0;
  const failedNumbers = [];

  logger.info(`📢 Broadcast dimulai: ${target.length} penerima, interval ${BROADCAST_LIMITS.INTERVAL_MS / 1000}s`);

  for (let i = 0; i < target.length; i++) {
    const contact = target[i];
    const jid = `${contact.number}@s.whatsapp.net`;

    try {
      await sock.sendMessage(jid, { text: message });
      sent++;
      incrementDaily(1);
      logger.info(`📢 [${i + 1}/${target.length}] Terkirim ke ${contact.number}`);

      // Callback progress ke owner
      if (onProgress) {
        await onProgress(i + 1, target.length, contact.number, true);
      }
    } catch (err) {
      failed++;
      failedNumbers.push(contact.number);
      logger.warn(`📢 [${i + 1}/${target.length}] Gagal ke ${contact.number}: ${err.message}`);

      if (onProgress) {
        await onProgress(i + 1, target.length, contact.number, false);
      }
    }

    // Jeda antar pesan (kecuali pesan terakhir)
    if (i < target.length - 1) {
      await new Promise(resolve => setTimeout(resolve, BROADCAST_LIMITS.INTERVAL_MS));
    }
  }

  _activeBroadcast = false;

  logger.info(`📢 Broadcast selesai: ${sent} berhasil, ${failed} gagal`);

  return {
    success: true,
    sent,
    failed,
    failedNumbers,
    total: target.length,
    dailyRemaining: BROADCAST_LIMITS.DAILY_MAX - checkDailyLimit(),
  };
}

// Load saat module pertama kali di-import
loadContacts();