# Jira → Kiro Watcher
# Jira → Kiro Watcher

Memantau **subtask** di Jira (`jira.bri.co.id`) lewat polling. Saat sebuah subtask
digeser ke status pemicu (default `In Development`), program menuliskan sebuah
**file task** ke repo target di `.kiro/tasks/<SUBTASK-KEY>.md`. File tersebut berisi
judul subtask, deskripsi story parent, dan acceptance criteria — diformat sebagai
instruksi untuk **Kiro**.

Bila `AUTO_EXECUTE=true`, watcher lalu **memanggil Kiro CLI (headless)** untuk membaca
file task itu dan mengeksekusi perubahan kode di repo target. Program **tidak** melakukan
commit/push — perubahan dibiarkan di working directory untuk direview developer.

```
Jira (subtask digeser manual)
      |
      v
Watcher (polling)  --> tulis .kiro/tasks/<KEY>.md
      |
      v  (bila AUTO_EXECUTE=true)
kiro-cli chat --no-interactive ...  --> Kiro eksekusi kode di repo target
```

> **Catatan penting soal hook:** versi awal memakai Kiro Hook `PostFileCreate`.
> Itu **tidak bekerja** untuk kasus ini: menurut dokumentasi resmi Kiro, hook file hanya
> menyala untuk file yang dibuat oleh agen Kiro sendiri — bukan file dari proses eksternal
> (bahkan bukan dari edit manual di editor). Karena itu pendekatan diubah ke **Kiro CLI
> headless**, di mana watcher yang memanggil Kiro (arah yang benar & didukung).

## Prasyarat

- Node.js 18+ (butuh `fetch` bawaan; disarankan Node 20+).
- Akses ke `https://jira.bri.co.id` (biasanya via jaringan internal / VPN kantor).
- Personal Access Token (PAT) Jira.
- Repo target sudah di-clone secara lokal dan dibuka di Kiro IDE.

## Setup

1. Install dependency:

   ```bash
   npm install
   ```

2. Salin `.env.example` menjadi `.env` lalu isi nilainya:

   ```env
   JIRA_BASE_URL=https://jira.bri.co.id
   JIRA_TOKEN=<PAT_ANDA>
   JIRA_USERNAME=<USERNAME_ANDA>
   JIRA_AUTH_TYPE=bearer
   JIRA_SKIP_SSL=false

   JIRA_JQL=project = QCASH AND issuetype = Sub-task
   TRIGGER_STATUS=In Development
   POLL_INTERVAL_SECONDS=30

   TARGET_REPO_PATH=C:\Users\rohad\Documents\work\qcash-ui-fund-transfer
   TASK_OUTPUT_DIR=.kiro/tasks
   ```

   > **Keamanan:** jangan commit `.env`. Sudah masuk `.gitignore`.
   > Bila token pernah bocor (mis. tertempel di chat), **cabut dan buat token baru** di Jira.

## Cek koneksi dulu (disarankan)

Sebelum menjalankan watcher, verifikasi koneksi, JQL, dan nama status:

```bash
npm run check
```

Perintah ini akan:
- memverifikasi autentikasi ke Jira (`/myself`),
- menampilkan daftar subtask hasil JQL beserta **status persisnya**,
- memberi tahu apakah `TRIGGER_STATUS` cocok dengan salah satu status yang muncul.

Jika `TRIGGER_STATUS` tidak cocok, salin nama status yang benar (persis, case-sensitive)
dari output ke `.env`.

## Menjalankan watcher

Mode development (tanpa build):

```bash
npm run dev
```

Mode produksi (setelah build):

```bash
npm run build
npm start
```

Watcher akan polling setiap `POLL_INTERVAL_SECONDS`. Saat subtask masuk status pemicu,
file task ditulis ke `TARGET_REPO_PATH/.kiro/tasks/<KEY>.md`. Hentikan dengan `Ctrl+C`.

## Eksekusi otomatis via Kiro CLI (headless)

Agar Kiro otomatis mengeksekusi task setelah file dibuat, aktifkan `AUTO_EXECUTE=true`
di `.env`. Prasyarat:

1. **Install Kiro CLI** dan pastikan ada di PATH:

   ```bash
   curl -fsSL https://cli.kiro.dev/install | bash
   kiro-cli --version
   ```

2. **API key** — headless mode butuh `KIRO_API_KEY`. Buat di portal Kiro
   (fitur ini untuk subscriber Kiro Pro/Pro+/Max/Power; bila akun dikelola admin,
   admin harus mengaktifkan pembuatan API key lebih dulu). Set di `.env`:

   ```env
   AUTO_EXECUTE=true
   KIRO_API_KEY=<API_KEY_ANDA>
   KIRO_TRUST_TOOLS=all
   ```

Saat sebuah subtask masuk status trigger, watcher menulis file task lalu menjalankan:

```bash
kiro-cli chat --no-interactive --trust-all-tools "<prompt baca & kerjakan file task>"
```

dengan working directory di `TARGET_REPO_PATH`. Output Kiro diteruskan ke log watcher.

Bila `AUTO_EXECUTE=false` (default), watcher hanya menulis file task; Anda mengeksekusinya
manual dengan membuka repo target di Kiro dan meminta "kerjakan task di file ini".

Satu watcher = satu repo target. Untuk repo microfrontend lain, jalankan instance watcher
terpisah dengan `TARGET_REPO_PATH` yang berbeda.

## Cara kerja anti-dobel

State disimpan di `.state/watcher-state.json`. File task ditulis hanya saat subtask
**baru** bertransisi ke status pemicu, bukan tiap siklus polling. Menggeser subtask
keluar lalu masuk lagi ke status pemicu akan memicu penulisan ulang.

## Struktur proyek

```
src/
  config.ts     # muat & validasi .env
  jira.ts       # client Jira REST v2 (auth bearer/basic, search, get story, AC)
  state.ts      # penyimpan status agar tidak proses dobel
  taskFile.ts   # susun & tulis file task .md ke repo target
  executor.ts   # panggil Kiro CLI headless untuk eksekusi task
  watcher.ts    # loop polling + orkestrasi
  index.ts      # entrypoint watcher
  check.ts      # utilitas diagnostik (npm run check)
  inspect.ts    # bedah semua field mentah sebuah issue (npx tsx src/inspect.ts <KEY>)
  process-one.ts# proses 1 subtask manual (npx tsx src/process-one.ts <KEY>)
```

## Catatan tentang Acceptance Criteria

AC diambil best-effort: pertama dari custom field yang namanya mengandung `acceptance`,
lalu fallback ke bagian di dalam deskripsi story dengan heading "Acceptance Criteria".
Bila instance Jira BRI memakai custom field khusus dengan ID tertentu, beri tahu ID-nya
agar ekstraksi bisa dibuat lebih presisi di `src/jira.ts`.
```

## Dokumentasi

- **Dokumentasi teknis lengkap**: [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) — arsitektur, alur data, penjelasan modul, konfigurasi, troubleshooting, keputusan desain.
- **Materi presentasi (Markdown/Marp)**: [`docs/PRESENTATION.md`](docs/PRESENTATION.md).
- **Deck presentasi (HTML/reveal.js)**: [`docs/slides.html`](docs/slides.html) — buka di browser untuk mempresentasikan (panah kiri/kanan untuk navigasi, tekan `S` untuk speaker notes).
