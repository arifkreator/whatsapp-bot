import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import config from '../config.js';
import logger from '../utils/logger.js';

// =============================================
// FILE ANALYZER
// Download file dari WA, extract konten,
// lalu kirim ke AI untuk dianalisis
// =============================================

// Batas ukuran file (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Tipe file yang didukung
export const SUPPORTED_TYPES = {
  image:    ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  document: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
    'application/vnd.ms-excel',                                           // xls
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
    'application/msword',                                                 // doc
    'text/plain',
    'text/csv',
  ],
};

export function isSupportedFile(mimetype) {
  const all = [...SUPPORTED_TYPES.image, ...SUPPORTED_TYPES.document];
  return all.some(t => mimetype?.toLowerCase().includes(t.split('/')[1]));
}

export function getFileCategory(mimetype) {
  if (!mimetype) return null;
  const m = mimetype.toLowerCase();
  if (SUPPORTED_TYPES.image.some(t => m.includes(t.split('/')[1]))) return 'image';
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('sheet') || m.includes('excel') || m.includes('csv')) return 'spreadsheet';
  if (m.includes('word') || m.includes('document')) return 'word';
  if (m.includes('text')) return 'text';
  return 'unknown';
}

// =============================================
// DOWNLOAD FILE DARI WA
// =============================================
export async function downloadWAFile(sock, msg) {
  const msgContent = msg.message;
  if (!msgContent) return null;

  const msgType = Object.keys(msgContent)[0];
  const mediaMsg = msgContent[msgType];

  try {
    // Import Baileys download helper
    const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
    const buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
    return {
      buffer,
      mimetype: mediaMsg?.mimetype || '',
      filename: mediaMsg?.fileName || mediaMsg?.title || 'file',
      filesize: buffer?.length || 0,
      caption: mediaMsg?.caption || '',
    };
  } catch (err) {
    logger.error(`❌ Gagal download file WA: ${err.message}`);
    return null;
  }
}

// =============================================
// EXTRACT TEXT DARI FILE
// =============================================
async function extractFromPDF(buffer) {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(buffer);
    return data.text?.trim().substring(0, 8000) || '';
  } catch (err) {
    logger.error(`PDF parse error: ${err.message}`);
    return null;
  }
}

async function extractFromExcel(buffer) {
  try {
    const XLSX = (await import('xlsx')).default;
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    let text = '';
    for (const sheetName of workbook.SheetNames.slice(0, 3)) {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      text += `[Sheet: ${sheetName}]\n${csv}\n\n`;
    }
    return text.substring(0, 8000);
  } catch (err) {
    logger.error(`Excel parse error: ${err.message}`);
    return null;
  }
}

async function extractFromWord(buffer) {
  try {
    const mammoth = (await import('mammoth')).default;
    const result = await mammoth.extractRawText({ buffer });
    return result.value?.trim().substring(0, 8000) || '';
  } catch (err) {
    logger.error(`Word parse error: ${err.message}`);
    return null;
  }
}

function extractFromText(buffer) {
  return buffer.toString('utf-8').substring(0, 8000);
}

// =============================================
// OPENROUTER CLIENT — untuk semua analisis file
// Pakai model vision & text terbaik yang gratis
// =============================================

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Model untuk dokumen teks (PDF, Excel, Word, TXT)
const OPENROUTER_TEXT_MODEL  = 'google/gemini-2.0-flash-exp:free';
// Model untuk gambar (support vision)
const OPENROUTER_VISION_MODEL = 'google/gemini-2.0-flash-exp:free';

async function callOpenRouter(messages, model) {
  const apiKey = process.env.OPENROUTER_API_KEY || '';
  if (!apiKey) throw new Error('OPENROUTER_API_KEY belum diset!');

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://whatsapp-bot.railway.app',
      'X-Title': 'WhatsApp Bot File Analyzer',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 2048,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenRouter HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '(tidak ada respons)';
}

// =============================================
// ANALISIS DOKUMEN (PDF, Excel, Word, TXT)
// =============================================
async function analyzeDocumentWithOpenRouter(content, question, fileType, filename) {
  const { getSystemPrompt } = await import('./configManager.js');
  const { buildSkillsContext } = await import('./skillsManager.js');

  const systemPrompt = getSystemPrompt() + buildSkillsContext();

  const defaultQuestion = {
    pdf:         'Ringkas isi dokumen ini secara singkat dan jelas.',
    spreadsheet: 'Analisis data di spreadsheet ini. Jelaskan isi, pola, dan insight penting.',
    word:        'Ringkas isi dokumen Word ini secara singkat.',
    text:        'Analisis dan ringkas teks ini.',
  }[fileType] || 'Analisis file ini.';

  const userPrompt = `File: ${filename}\nJenis: ${fileType}\n\n--- ISI FILE ---\n${content}\n--- AKHIR FILE ---\n\n${question || defaultQuestion}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  logger.info(`🤖 OpenRouter analisis dokumen: ${filename} (${OPENROUTER_TEXT_MODEL})`);
  return await callOpenRouter(messages, OPENROUTER_TEXT_MODEL);
}

// =============================================
// ANALISIS GAMBAR (Vision)
// =============================================
async function analyzeImageWithOpenRouter(buffer, mimetype, question, filename) {
  const { getSystemPrompt } = await import('./configManager.js');
  const { buildSkillsContext } = await import('./skillsManager.js');

  const systemPrompt = getSystemPrompt() + buildSkillsContext();
  const base64 = buffer.toString('base64');
  const imageUrl = `data:${mimetype};base64,${base64}`;
  const userPrompt = question || 'Jelaskan apa yang ada di gambar ini secara detail dalam Bahasa Indonesia.';

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageUrl } },
        { type: 'text', text: userPrompt },
      ],
    },
  ];

  logger.info(`🤖 OpenRouter analisis gambar: ${filename} (${OPENROUTER_VISION_MODEL})`);
  return await callOpenRouter(messages, OPENROUTER_VISION_MODEL);
}

// =============================================
// MAIN FUNCTION
// =============================================
export async function analyzeFile(sock, msg, question = '') {
  const fileData = await downloadWAFile(sock, msg);
  if (!fileData) return '❌ Gagal mengunduh file. Coba kirim ulang.';

  const { buffer, mimetype, filename, filesize } = fileData;

  // Cek ukuran file
  if (filesize > MAX_FILE_SIZE) {
    return `❌ File terlalu besar! Maksimal 5MB. File kamu: ${(filesize / 1024 / 1024).toFixed(1)}MB`;
  }

  const category = getFileCategory(mimetype);
  if (!category || category === 'unknown') {
    return `❌ Tipe file tidak didukung.\n\n✅ *Format yang bisa dianalisis:*\n• Gambar: JPG, PNG, WebP\n• Dokumen: PDF, Word, Excel\n• Teks: TXT, CSV`;
  }

  logger.info(`📎 Analisis file: ${filename} (${category}, ${(filesize / 1024).toFixed(0)}KB)`);

  try {
    // Gambar — pakai vision model OpenRouter
    if (category === 'image') {
      return await analyzeImageWithOpenRouter(buffer, mimetype, question, filename);
    }

    // Dokumen — extract teks dulu lalu analisis OpenRouter
    let text = null;
    if (category === 'pdf')              text = await extractFromPDF(buffer);
    else if (category === 'spreadsheet') text = await extractFromExcel(buffer);
    else if (category === 'word')        text = await extractFromWord(buffer);
    else if (category === 'text')        text = extractFromText(buffer);

    if (!text || text.trim().length === 0) {
      return `❌ Tidak bisa membaca isi file *${filename}*.\nFile mungkin kosong, terenkripsi, atau formatnya tidak didukung.`;
    }

    return await analyzeDocumentWithOpenRouter(text, question, category, filename);

  } catch (err) {
    logger.error(`❌ analyzeFile error: ${err.message}`);
    // Cek apakah error dari OpenRouter API key
    if (err.message.includes('OPENROUTER_API_KEY')) {
      return '❌ OpenRouter API key belum dikonfigurasi. Hubungi admin.';
    }
    return `❌ Terjadi error saat menganalisis file: ${err.message}`;
  }
}