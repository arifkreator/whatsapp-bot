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
    'text/markdown',
    'text/x-markdown',
    'application/json',
    'text/javascript',
    'text/x-python',
    'text/html',
    'text/xml',
  ],
};

export function isSupportedFile(mimetype, filename = '') {
  const all = [...SUPPORTED_TYPES.image, ...SUPPORTED_TYPES.document];
  if (all.some(t => mimetype?.toLowerCase().includes(t.split('/')[1]))) return true;

  // Fallback: cek ekstensi filename jika mimetype tidak dikenal
  const ext = filename?.split('.').pop()?.toLowerCase();
  const supportedExts = ['jpg', 'jpeg', 'png', 'webp', 'gif',
    'pdf', 'docx', 'doc', 'xlsx', 'xls', 'csv',
    'txt', 'md', 'json', 'js', 'py', 'html', 'xml'];
  return supportedExts.includes(ext);
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
// GOOGLE AI STUDIO CLIENT (Gemini)
// Gratis, support vision, context window besar
// Daftar di: https://aistudio.google.com
// =============================================

const GEMINI_VISION_MODEL = 'gemini-2.0-flash';
const GEMINI_TEXT_MODEL   = 'gemini-2.0-flash';

async function callGemini(messages, model, retries = 2) {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
  if (!apiKey) throw new Error('GOOGLE_API_KEY belum diset! Daftar di https://aistudio.google.com');

  const GEMINI_NATIVE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Convert OpenAI message format ke Gemini format
  const contents = [];
  let systemInstruction = null;

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction = { parts: [{ text: msg.content }] };
      continue;
    }

    const role = msg.role === 'assistant' ? 'model' : 'user';

    // Handle content array (gambar + teks)
    if (Array.isArray(msg.content)) {
      const parts = [];
      for (const item of msg.content) {
        if (item.type === 'text') {
          parts.push({ text: item.text });
        } else if (item.type === 'image_url') {
          // Extract base64 dari data URL
          const dataUrl = item.image_url?.url || '';
          const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            parts.push({
              inline_data: {
                mime_type: match[1],
                data: match[2],
              }
            });
          }
        }
      }
      contents.push({ role, parts });
    } else {
      // Plain text
      contents.push({ role, parts: [{ text: msg.content }] });
    }
  }

  const body = {
    contents,
    generationConfig: {
      maxOutputTokens: 2048,
      temperature: 0.7,
    },
  };

  if (systemInstruction) {
    body.systemInstruction = systemInstruction;
  }

  const response = await fetch(GEMINI_NATIVE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const errMsg = err?.error?.message || `Gemini HTTP ${response.status}`;

    // Rate limit — coba model lain atau retry
    if (response.status === 429 && retries > 0) {
      // Coba model flash-lite yang lebih rendah limit-nya
      if (model === 'gemini-2.0-flash') {
        logger.warn(`⚠️ Gemini rate limit — fallback ke gemini-1.5-flash`);
        return await callGemini(messages, 'gemini-1.5-flash', retries - 1);
      }
      // Tunggu 5 detik lalu retry
      logger.warn(`⚠️ Gemini rate limit — retry dalam 5 detik...`);
      await new Promise(r => setTimeout(r, 5000));
      return await callGemini(messages, model, retries - 1);
    }

    throw new Error(errMsg);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '(tidak ada respons)';
}

// =============================================
// ANALISIS DOKUMEN (PDF, Excel, Word, TXT)
// =============================================
async function analyzeDocumentWithGemini(content, question, fileType, filename) {
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

  logger.info(`🤖 Gemini analisis dokumen: ${filename}`);
  return await callGemini(messages, GEMINI_TEXT_MODEL);
}

// =============================================
// ANALISIS GAMBAR (Vision)
// =============================================
async function analyzeImageWithGemini(buffer, mimetype, question, filename) {
  const { getSystemPrompt } = await import('./configManager.js');
  const { buildSkillsContext } = await import('./skillsManager.js');

  const systemPrompt = getSystemPrompt() + buildSkillsContext();
  const base64 = buffer.toString('base64');
  const userPrompt = question || 'Jelaskan apa yang ada di gambar ini secara detail dalam Bahasa Indonesia.';

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:${mimetype};base64,${base64}` },
        },
        { type: 'text', text: userPrompt },
      ],
    },
  ];

  logger.info(`🤖 Gemini analisis gambar: ${filename}`);
  return await callGemini(messages, GEMINI_VISION_MODEL);
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
    // Gambar — pakai Gemini Vision
    if (category === 'image') {
      return await analyzeImageWithGemini(buffer, mimetype, question, filename);
    }

    // Dokumen — extract teks dulu lalu analisis Gemini
    let text = null;
    if (category === 'pdf')              text = await extractFromPDF(buffer);
    else if (category === 'spreadsheet') text = await extractFromExcel(buffer);
    else if (category === 'word')        text = await extractFromWord(buffer);
    else if (category === 'text')        text = extractFromText(buffer);

    if (!text || text.trim().length === 0) {
      return `❌ Tidak bisa membaca isi file *${filename}*.\nFile mungkin kosong, terenkripsi, atau formatnya tidak didukung.`;
    }

    return await analyzeDocumentWithGemini(text, question, category, filename);

  } catch (err) {
    logger.error(`❌ analyzeFile error: ${err.message}`);
    if (err.message.includes('GOOGLE_API_KEY')) {
      return '❌ Google API key belum dikonfigurasi. Set GOOGLE_API_KEY di Railway.';
    }
    return `❌ Terjadi error saat menganalisis file: ${err.message}`;
  }
}