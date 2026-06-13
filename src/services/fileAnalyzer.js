import fetch from 'node-fetch';
import config from '../config.js';
import logger from '../utils/logger.js';

// =============================================
// FILE ANALYZER
// Download file dari WA, extract konten,
// lalu kirim ke AI untuk dianalisis
// Routing: Gambar → Groq Vision → Gemini fallback
//          Dokumen → Groq text (cepat, gratis)
// =============================================

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export const SUPPORTED_TYPES = {
  image:    ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  document: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
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
  const ext = filename?.split('.').pop()?.toLowerCase();
  const supportedExts = ['jpg','jpeg','png','webp','gif',
    'pdf','docx','doc','xlsx','xls','csv',
    'txt','md','json','js','py','html','xml'];
  return supportedExts.includes(ext);
}

export function getFileCategory(mimetype, filename = '') {
  const m = mimetype?.toLowerCase() || '';
  const ext = filename?.split('.').pop()?.toLowerCase();
  if (SUPPORTED_TYPES.image.some(t => m.includes(t.split('/')[1]))) return 'image';
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('sheet') || m.includes('excel') || m.includes('csv') || ext === 'csv') return 'spreadsheet';
  if (m.includes('word') || m.includes('document')) return 'word';
  if (m.includes('text') || m.includes('json') || m.includes('javascript') || m.includes('python')
    || ['txt','md','json','js','py','html','xml','csv'].includes(ext)) return 'text';
  return 'unknown';
}

// =============================================
// DOWNLOAD FILE DARI WA
// =============================================
export async function downloadWAFile(sock, msg) {
  const msgContent = msg.message;
  if (!msgContent) return null;

  try {
    const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
    const buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
    const mediaMsg = msgContent.imageMessage || msgContent.documentMessage;
    return {
      buffer,
      mimetype: mediaMsg?.mimetype || '',
      filename: mediaMsg?.fileName || mediaMsg?.title || 'file',
      filesize: buffer?.length || 0,
      caption:  mediaMsg?.caption || '',
    };
  } catch (err) {
    logger.error(`❌ Gagal download file WA: ${err.message}`);
    return null;
  }
}

// =============================================
// EXTRACT TEXT DARI DOKUMEN
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
// GROQ VISION (Primary untuk gambar)
// Model llama-4-scout — gratis, 14400 req/hari
// =============================================
const GROQ_API_URL      = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

async function callGroqVision(messages) {
  const apiKey = process.env.GROQ_API_KEY || '';
  if (!apiKey) throw new Error('GROQ_API_KEY tidak tersedia');

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_VISION_MODEL,
      messages,
      max_tokens: 2048,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const error = new Error(err?.error?.message || `Groq HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '(tidak ada respons)';
}

// =============================================
// GEMINI (Fallback untuk gambar)
// =============================================
async function callGemini(messages, retries = 1) {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
  if (!apiKey) throw new Error('GOOGLE_API_KEY belum diset!');

  const model = 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const contents = [];
  let systemInstruction = null;

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction = { parts: [{ text: msg.content }] };
      continue;
    }
    const role = msg.role === 'assistant' ? 'model' : 'user';
    if (Array.isArray(msg.content)) {
      const parts = [];
      for (const item of msg.content) {
        if (item.type === 'text') {
          parts.push({ text: item.text });
        } else if (item.type === 'image_url') {
          const dataUrl = item.image_url?.url || '';
          const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (match) parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
        }
      }
      contents.push({ role, parts });
    } else {
      contents.push({ role, parts: [{ text: msg.content }] });
    }
  }

  const body = { contents, generationConfig: { maxOutputTokens: 2048, temperature: 0.7 } };
  if (systemInstruction) body.systemInstruction = systemInstruction;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const errMsg = err?.error?.message || `Gemini HTTP ${response.status}`;
    if (response.status === 429 && retries > 0) {
      logger.warn(`⚠️ Gemini rate limit — retry 5 detik...`);
      await new Promise(r => setTimeout(r, 5000));
      return callGemini(messages, retries - 1);
    }
    throw new Error(errMsg);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '(tidak ada respons)';
}

// =============================================
// ANALISIS GAMBAR: Groq Vision → Gemini fallback
// =============================================
async function analyzeImage(buffer, mimetype, question, filename) {
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
        { type: 'image_url', image_url: { url: `data:${mimetype};base64,${base64}` } },
        { type: 'text', text: userPrompt },
      ],
    },
  ];

  // Primary: Groq Vision
  try {
    logger.info(`🤖 Groq Vision: ${filename}`);
    return await callGroqVision(messages);
  } catch (err) {
    logger.warn(`⚠️ Groq Vision gagal (${err.message}) — fallback Gemini`);
  }

  // Fallback: Gemini
  logger.info(`🤖 Gemini Vision fallback: ${filename}`);
  return await callGemini(messages);
}

// =============================================
// ANALISIS DOKUMEN: Groq text (tidak butuh vision)
// =============================================
async function analyzeDocument(content, question, fileType, filename) {
  const { getSystemPrompt } = await import('./configManager.js');
  const { buildSkillsContext } = await import('./skillsManager.js');
  const { callGroqWithFallback } = await import('./groqAI.js');

  const systemPrompt = getSystemPrompt() + buildSkillsContext();
  const defaultQuestion = {
    pdf:         'Ringkas isi dokumen ini secara singkat dan jelas.',
    spreadsheet: 'Analisis data di spreadsheet ini. Jelaskan isi, pola, dan insight penting.',
    word:        'Ringkas isi dokumen Word ini secara singkat.',
    text:        'Analisis dan ringkas teks ini.',
  }[fileType] || 'Analisis file ini.';

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `File: ${filename}\nJenis: ${fileType}\n\n--- ISI FILE ---\n${content}\n--- AKHIR FILE ---\n\n${question || defaultQuestion}` },
  ];

  logger.info(`🤖 Groq analisis dokumen: ${filename}`);
  return await callGroqWithFallback(messages);
}

// =============================================
// MAIN FUNCTION
// =============================================
export async function analyzeFile(sock, msg, question = '') {
  const fileData = await downloadWAFile(sock, msg);
  if (!fileData) return '❌ Gagal mengunduh file. Coba kirim ulang.';

  const { buffer, mimetype, filename, filesize } = fileData;

  if (filesize > MAX_FILE_SIZE) {
    return `❌ File terlalu besar! Maksimal 5MB. File kamu: ${(filesize / 1024 / 1024).toFixed(1)}MB`;
  }

  const category = getFileCategory(mimetype, filename);
  if (!category || category === 'unknown') {
    return `❌ Tipe file tidak didukung.\n\n✅ *Format yang bisa dianalisis:*\n• Gambar: JPG, PNG, WebP, GIF\n• Dokumen: PDF, Word, Excel\n• Teks: TXT, CSV, MD, JSON, JS, Python`;
  }

  logger.info(`📎 Analisis file: ${filename} (${category}, ${(filesize / 1024).toFixed(0)}KB)`);

  try {
    if (category === 'image') {
      return await analyzeImage(buffer, mimetype, question, filename);
    }

    let text = null;
    if (category === 'pdf')              text = await extractFromPDF(buffer);
    else if (category === 'spreadsheet') text = await extractFromExcel(buffer);
    else if (category === 'word')        text = await extractFromWord(buffer);
    else if (category === 'text')        text = extractFromText(buffer);

    if (!text || text.trim().length === 0) {
      return `❌ Tidak bisa membaca isi file *${filename}*.\nFile mungkin kosong atau terenkripsi.`;
    }

    return await analyzeDocument(text, question, category, filename);

  } catch (err) {
    logger.error(`❌ analyzeFile error: ${err.message}`);
    if (err.message.includes('GOOGLE_API_KEY')) return '❌ Google API key belum dikonfigurasi.';
    if (err.message.includes('GROQ_API_KEY'))   return '❌ Groq API key belum dikonfigurasi.';
    return `❌ Terjadi error saat menganalisis file: ${err.message}`;
  }
}