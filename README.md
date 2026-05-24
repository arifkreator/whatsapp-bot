# 🤖 WhatsApp Bot — Baileys + Google Gemini AI (GRATIS)

Bot WhatsApp lengkap dengan fitur anti-spam grup dan AI Agent berbasis **Google Gemini** (free tier).

---

## ✨ Fitur

| Fitur | Keterangan |
|-------|------------|
| 🤖 AI Agent | Jawab pertanyaan otomatis via Google Gemini (GRATIS) |
| 🛡️ Anti-Spam | Deteksi flood, duplikat pesan, pola spam |
| 🔇 Auto-Mute | Otomatis mute spammer di grup |
| 👢 Kick Member | Kick member via command |
| 👋 Welcome/Leave | Sambut member baru & ucapkan selamat tinggal |
| 💬 Multi-turn AI | AI ingat konteks percakapan per user (30 menit) |
| 📌 Command System | Sistem command dengan prefix |

---

## 🔑 Cara Dapat API Key Gemini (GRATIS)

1. Buka https://aistudio.google.com/apikey
2. Login dengan akun Google
3. Klik **"Create API Key"**
4. Copy API key-nya → paste ke `.env`

✅ **100% gratis**, tidak perlu kartu kredit!
Free tier: 1.000 request/hari dengan model `gemini-2.0-flash`

---

## 🚀 Setup Lokal (Development)

### 1. Clone & Install

```bash
git clone <repo-kamu>
cd whatsapp-bot
npm install
```

### 2. Konfigurasi `.env`

```bash
cp .env.example .env
```

Edit `.env` dan isi:

```env
GEMINI_API_KEY=AIzaSyXXXXXXXXXX   # Dari https://aistudio.google.com/apikey
OWNER_NUMBER=6281234567890         # Nomor HP kamu (tanpa +)
BOT_NAME=BotKu
BOT_PREFIX=!
```

### 3. Jalankan Bot

```bash
npm start
```

Scan QR code yang muncul di terminal dengan WhatsApp.

---

## ☁️ Deploy ke Railway

1. **Push ke GitHub**:
   ```bash
   git init && git add . && git commit -m "init"
   git remote add origin https://github.com/USERNAME/REPO.git
   git push -u origin main
   ```

2. **Buat project di Railway** → https://railway.app → `New Project` → `Deploy from GitHub`

3. **Set Environment Variables** di Railway:
   - `GEMINI_API_KEY` ← wajib
   - `OWNER_NUMBER` ← wajib
   - `BOT_NAME`, `BOT_PREFIX` ← opsional

4. Deploy → buka tab **Logs** → scan QR yang muncul.

### Persistent Session (agar tidak scan ulang saat restart):
- Tambah **Volume** di Railway → mount ke `/app/sessions`
- Set env: `SESSION_PATH=/app/sessions`

---

## ☁️ Deploy ke Render

1. Push ke GitHub
2. Buka https://render.com → `New` → **Background Worker**
3. Pilih repo, set env vars, deploy
4. Lihat logs → scan QR

---

## 📌 Daftar Command

### Umum
| Command | Keterangan |
|---------|------------|
| `!help` | Tampilkan menu |
| `!ping` | Cek status bot |
| `!reset` | Reset riwayat AI kamu |

### Admin Grup
| Command | Keterangan |
|---------|------------|
| `!mute @user` | Mute member dari bot |
| `!unmute @user` | Unmute member |
| `!kick @user` | Keluarkan dari grup |
| `!warn @user` | Peringatkan member |
| `!antispam` | Statistik spam |

### Owner
| Command | Keterangan |
|---------|------------|
| `!status` | Status bot keseluruhan |

---

## 🤖 Cara Pakai AI Agent

- **Private chat**: langsung kirim pesan ke bot
- **Di grup**: mention bot (`@namabot`) atau reply pesan bot
- Reset konteks: ketik `!reset`

---

## 🛡️ Cara Kerja Anti-Spam

1. **Rate limiting** — >5 pesan dalam 10 detik → auto mute 5 menit
2. **Duplikat** — pesan sama 3x berturut → warning + hapus
3. **Pattern** — link mencurigakan, karakter berulang

---

## ⚙️ Model Gemini yang Tersedia (Gratis)

| Model | Kecepatan | Kualitas | RPD |
|-------|-----------|----------|-----|
| `gemini-2.0-flash` ⭐ | Sangat cepat | Bagus | 1.000/hari |
| `gemini-2.5-flash` | Cepat | Lebih bagus | 250/hari |
| `gemini-2.5-pro` | Lambat | Terbaik | 100/hari |

Default: `gemini-2.0-flash` — paling cocok untuk bot chat.
