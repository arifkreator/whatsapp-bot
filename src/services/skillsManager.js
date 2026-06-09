import fs from 'fs';
import path from 'path';
import config from '../config.js';
import logger from '../utils/logger.js';

// =============================================
// SKILLS MANAGER
// Menyimpan knowledge base & prosedur sebagai
// "skills" yang di-inject ke system prompt AI
// saat percakapan berlangsung
// =============================================

const SKILLS_FILE = path.join(config.sessionPath, 'bot-skills.json');

// In-memory cache
let _skills = null;

// =============================================
// LOAD SKILLS
// =============================================
export function loadSkills() {
  try {
    if (fs.existsSync(SKILLS_FILE)) {
      const raw = fs.readFileSync(SKILLS_FILE, 'utf-8');
      _skills = JSON.parse(raw);
      logger.info(`📚 Skills dimuat: ${Object.keys(_skills).length} skill`);
    } else {
      _skills = {};
      logger.info('📚 Skills: belum ada skill terdaftar');
    }
  } catch (err) {
    logger.error(`❌ Gagal load skills: ${err.message}`);
    _skills = {};
  }
  return _skills;
}

// =============================================
// SAVE SKILLS
// =============================================
function saveSkills() {
  try {
    const dir = path.dirname(SKILLS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SKILLS_FILE, JSON.stringify(_skills, null, 2), 'utf-8');
    return true;
  } catch (err) {
    logger.error(`❌ Gagal simpan skills: ${err.message}`);
    return false;
  }
}

// =============================================
// CRUD OPERATIONS
// =============================================

export function addSkill(name, content, updatedBy = null) {
  if (!_skills) loadSkills();
  const key = name.toLowerCase().trim().replace(/\s+/g, '-');
  _skills[key] = {
    name: name.trim(),
    content: content.trim(),
    createdAt: _skills[key]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  logger.info(`📚 Skill ditambah/diupdate: "${key}"`);
  return saveSkills() ? key : null;
}

export function removeSkill(name) {
  if (!_skills) loadSkills();
  const key = name.toLowerCase().trim().replace(/\s+/g, '-');
  if (!_skills[key]) return false;
  delete _skills[key];
  logger.info(`🗑️ Skill dihapus: "${key}"`);
  return saveSkills();
}

export function getSkill(name) {
  if (!_skills) loadSkills();
  const key = name.toLowerCase().trim().replace(/\s+/g, '-');
  return _skills[key] || null;
}

export function listSkills() {
  if (!_skills) loadSkills();
  return Object.values(_skills);
}

export function getSkillCount() {
  if (!_skills) loadSkills();
  return Object.keys(_skills).length;
}

// =============================================
// INJECT KE SYSTEM PROMPT
// Gabungkan semua skill menjadi konteks tambahan
// yang di-append ke system prompt AI
// =============================================
export function buildSkillsContext() {
  if (!_skills) loadSkills();
  const skills = Object.values(_skills);
  if (skills.length === 0) return '';

  let context = '\n\n---\n📚 KNOWLEDGE BASE & PROSEDUR:\n';
  for (const skill of skills) {
    context += `\n## ${skill.name}\n${skill.content}\n`;
  }
  context += '---\n';
  return context;
}

// Load saat module pertama kali di-import
loadSkills();