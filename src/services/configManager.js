import fs from 'fs';
import path from 'path';
import config from '../config.js';
import logger from '../utils/logger.js';

// =============================================
// CONFIG MANAGER
// Menyimpan konfigurasi dinamis ke file JSON
// di dalam Railway Volume (/app/sessions/)
// sehingga persist saat redeploy
// =============================================

const CONFIG_FILE = path.join(config.sessionPath, 'bot-config.json');

// Default config
const DEFAULT_CONFIG = {
  systemPrompt: config.aiSystemPrompt,
  hermesSystemPrompt: config.hermesSystemPrompt || '',
  updatedAt: null,
  updatedBy: null,
};

// In-memory cache
let _cache = null;

// =============================================
// LOAD CONFIG
// =============================================
export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      _cache = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      logger.info(`📂 Bot config dimuat dari ${CONFIG_FILE}`);
    } else {
      _cache = { ...DEFAULT_CONFIG };
      logger.info('📂 Bot config: pakai default (belum ada file)');
    }
  } catch (err) {
    logger.error(`❌ Gagal load bot config: ${err.message}`);
    _cache = { ...DEFAULT_CONFIG };
  }
  return _cache;
}

// =============================================
// SAVE CONFIG
// =============================================
function saveConfig() {
  try {
    // Pastikan folder ada
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(_cache, null, 2), 'utf-8');
    logger.info(`💾 Bot config disimpan ke ${CONFIG_FILE}`);
    return true;
  } catch (err) {
    logger.error(`❌ Gagal simpan bot config: ${err.message}`);
    return false;
  }
}

// =============================================
// GETTERS
// =============================================
export function getSystemPrompt() {
  if (!_cache) loadConfig();
  return _cache.systemPrompt || config.aiSystemPrompt;
}

export function getHermesSystemPrompt() {
  if (!_cache) loadConfig();
  return _cache.hermesSystemPrompt || config.hermesSystemPrompt || config.aiSystemPrompt;
}

export function getBotConfig() {
  if (!_cache) loadConfig();
  return { ..._cache };
}

// =============================================
// SETTERS
// =============================================
export function setSystemPrompt(prompt, updatedBy = null) {
  if (!_cache) loadConfig();
  _cache.systemPrompt = prompt;
  _cache.updatedAt = new Date().toISOString();
  _cache.updatedBy = updatedBy;
  return saveConfig();
}

export function setHermesSystemPrompt(prompt, updatedBy = null) {
  if (!_cache) loadConfig();
  _cache.hermesSystemPrompt = prompt;
  _cache.updatedAt = new Date().toISOString();
  _cache.updatedBy = updatedBy;
  return saveConfig();
}

export function resetSystemPrompt(updatedBy = null) {
  if (!_cache) loadConfig();
  _cache.systemPrompt = config.aiSystemPrompt;
  _cache.updatedAt = new Date().toISOString();
  _cache.updatedBy = updatedBy;
  return saveConfig();
}

export function resetHermesSystemPrompt(updatedBy = null) {
  if (!_cache) loadConfig();
  _cache.hermesSystemPrompt = config.hermesSystemPrompt || '';
  _cache.updatedAt = new Date().toISOString();
  _cache.updatedBy = updatedBy;
  return saveConfig();
}

// Load saat module pertama kali di-import
loadConfig();