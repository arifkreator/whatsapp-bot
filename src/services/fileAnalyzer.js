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
// ANALISIS FILE VIA GROQ
// =============================================
async function analyzeWithGroq(content, question, fileType, filename) {
  const { getSystemPrompt } = await import('./configManager.js');
  const { buildSkillsContext } = await import('./skillsManager.js');

  const systemPrompt = getSystemPrompt() + buildSkillsContext();

  const defaultQuestion = {
    pdf:         'Ringkas isi dokumen ini secara singkat.',
    spreadsheet: 'Analisis data di spreadsheet ini. Jelaskan isi, pola, dan insight penting.',
    word:        'Ringkas isi dokumen Word ini secara singkat.',
    text:        'Analisis dan ringkas teks ini.',
  }[fileType] || 'Analisis file ini.';

  const userPrompt = `File: ${filename}\nJenis: ${fileType}\n\n--- ISI FILE ---\n${content}\n--- AKHIR FILE ---\n\n${question || defaultQuestion}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  // Coba semua Groq key (pakai logika dari groqAI)
  const { callGroqWithFallback } = await import('./groqAI.js');
  return await callGroqWithFallback(messages);
}

// =============================================
// ANALISIS GAMBAR VIA GROQ VISION
// =============================================
async function analyzeImageWithGroq(buffer, mimetype, question, filename) {
  const { getSystemPrompt } = await import('./configManager.js');
  const { buildSkillsContext } = await import('./skillsManager.js');

  const systemPrompt = getSystemPrompt() + buildSkillsContext();
  const base64 = buffer.toString('base64');
  const imageUrl = `data:${mimetype};base64,${base64}`;

  const userPrompt = question || 'Jelaskan apa yang ada di gambar ini secara detail.';

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

  // Gunakan model vision Groq
  const { callGroqWithFallback } = await import('./groqAI.js');
  return await callGroqWithFallback(messages, 'meta-llama/llama-4-scout-17b-16e-instruct');
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
    // Gambar — pakai vision model
    if (category === 'image') {
      return await analyzeImageWithGroq(buffer, mimetype, question, filename);
    }

    // Dokumen — extract teks dulu
    let text = null;
    if (category === 'pdf')         text = await extractFromPDF(buffer);
    else if (category === 'spreadsheet') text = await extractFromExcel(buffer);
    else if (category === 'word')    text = await extractFromWord(buffer);
    else if (category === 'text')    text = extractFromText(buffer);

    if (!text || text.trim().length === 0) {
      return `❌ Tidak bisa membaca isi file *${filename}*.\nFile mungkin kosong, terenkripsi, atau formatnya tidak didukung.`;
    }

    return await analyzeWithGroq(text, question, category, filename);

  } catch (err) {
    logger.error(`❌ analyzeFile error: ${err.message}`);
    return `❌ Terjadi error saat menganalisis file: ${err.message}`;
  }
}