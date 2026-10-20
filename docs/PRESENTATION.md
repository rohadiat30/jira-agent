---
marp: true
title: Jira → Kiro Watcher
paginate: true
theme: default
---

<!-- _class: lead -->

# Jira → Kiro Watcher

### Otomatisasi konteks dari Jira ke asisten coding

Mengubah "geser subtask" menjadi instruksi kerja siap-pakai untuk Kiro

<br/>

Ramdan Rohadiat · Tim Qlola

---

## Agenda

1. Latar belakang & masalah
2. Ide solusi
3. Cara kerja (alur end-to-end)
4. Arsitektur teknis
5. Demo
6. Keputusan desain penting
7. Keterbatasan & jujur soal trade-off
8. Roadmap
9. Tanya jawab

---

<!-- _class: lead -->

## 1. Latar Belakang & Masalah

---

## Rutinitas yang berulang setiap subtask

Setiap kali mulai mengerjakan subtask, developer melakukan hal yang sama:

- Buka Jira, baca **deskripsi story** & **acceptance criteria**
- Terjemahkan jadi konteks untuk asisten AI
- Salin-tempel manual ke prompt

**Masalahnya:**

- Berulang dan memakan waktu
- Rawan konteks tidak lengkap / terlewat
- Tidak konsisten antar developer

> Semakin banyak subtask, semakin besar "pajak" manual ini.

---

<!-- _class: lead -->

## 2. Ide Solusi

---

## Jembatan otomatis Jira → Kiro

> Ketika subtask **digeser ke "In Progress"**, konteks Jira otomatis tersedia
> sebagai file task terstruktur di dalam repo — siap dikerjakan Kiro.

Developer cukup:

1. Geser status subtask (yang memang sudah biasa dilakukan)
2. Buka file task, minta Kiro kerjakan

Tidak ada lagi salin-tempel manual. Konteks selalu lengkap & konsisten.

---

## Prinsip

- **Pemicu = aksi yang sudah ada** (geser status), bukan langkah baru
- **Konteks terstruktur**: judul subtask + deskripsi + AC + metadata
- **Developer tetap pegang kendali**: tidak ada commit otomatis
- **Sederhana & dapat diinspeksi**: kontraknya cuma sebuah file `.md`

---

<!-- _class: lead -->

## 3. Cara Kerja

---

## Alur end-to-end

```
Geser subtask ke "In Progress"
        │
        ▼
Watcher (polling tiap 30s) mendeteksi
        │
        ▼
Ambil konteks story dari Jira
(deskripsi, acceptance criteria, dll.)
        │
        ▼
Tulis  .kiro/tasks/<KEY>.md  di repo target
        │
        ▼
Kiro baca file  →  implementasi kode (tanpa commit)
        │
        ▼
Developer review & commit sendiri
```

---

## Isi file task (contoh)

```markdown
# Task: [FE] Added filter suspend on table history ift

## Referensi Jira
| Subtask | NQLA-70940 — [FE] Added filter suspend... |
| Story   | NQLA-68834 — Sebagai Qlola, saya ingin... |
| Sprint  | 15 - Gladiator Sprint 29 | Story Points | 3 |

## Judul Subtask (fokus pekerjaan)
[FE] Added filter suspend on table history ift

## Deskripsi Story        ## Acceptance Criteria
...                       ...

## Instruksi untuk Kiro
1. Pahami konteks repo...  5. JANGAN commit/push.
```

Satu file = satu prompt lengkap & konsisten.

---

<!-- _class: lead -->

## 4. Arsitektur Teknis

---

## Komponen

| Modul | Tanggung jawab |
|-------|----------------|
| `watcher.ts` | Loop polling + orkestrasi |
| `jira.ts` | Client Jira REST v2 + ekstraksi field |
| `state.ts` | Anti-dobel (lacak status yang sudah diproses) |
| `taskFile.ts` | Susun & tulis file task `.md` |
| `executor.ts` | Panggil Kiro CLI (mode otomatis, opsional) |
| `config.ts` | Muat & validasi `.env` |

Stack: **Node.js + TypeScript**, polling via **Jira REST API v2**.

---

## Diagram arsitektur

```
   Jira DC                Watcher (Node.js)            Repo target
 ┌─────────┐   REST    ┌────────────────────┐      ┌──────────────┐
 │ Subtask │ ◀────────▶│ poll → jira → state│      │ .kiro/tasks/ │
 │ + Story │           │   → taskFile       │─────▶│   <KEY>.md   │
 └─────────┘           └─────────┬──────────┘      └──────┬───────┘
                                 ┊ (AUTO_EXECUTE)         │ dibaca
                                 ▼                        ▼
                            kiro-cli  ··············▶   Kiro
                                                    ubah kode (no commit)
```

---

## Kenapa polling, bukan webhook?

| | Webhook | Polling (dipilih) |
|---|---------|-------------------|
| Butuh admin Jira | Ya | **Tidak** |
| Butuh endpoint publik | Ya | **Tidak** |
| Jalan dari laptop | Susah | **Bisa** |
| Kecepatan | Instan | Delay ≤ interval |

Untuk lingkungan korporat tanpa akses admin, **polling menang** dari sisi kepraktisan.

---

<!-- _class: lead -->

## 5. Demo

---

## Skenario demo

1. `npm run check` → verifikasi koneksi Jira & lihat status subtask
2. `npm run dev` → watcher mulai polling
3. Geser subtask ke **In Progress** di Jira
4. Tunggu ≤ 30 detik → file `.kiro/tasks/<KEY>.md` muncul
5. Buka repo target di Kiro → "kerjakan task di file ini"
6. Review perubahan → commit

> Bonus: hapus file `.md` → watcher otomatis membuatnya lagi (regenerasi).

---

<!-- _class: lead -->

## 6. Keputusan Desain Penting

---

## Empat keputusan kunci

- **Tidak commit otomatis** — developer selalu pengambil keputusan akhir
- **File task sebagai kontrak** — sederhana, dapat dibaca manusia, versionable
- **Anti-dobel + regenerasi** — tulis sekali per transisi; hapus file = picu ulang
- **1 watcher = 1 repo** — sesuai pola "1 feature = 1 repo microfrontend"

---

## Pelajaran: Kiro Hook tidak cocok di sini

Pendekatan awal memakai hook `PostFileCreate`.

**Ternyata tidak bekerja** — dokumentasi resmi Kiro menyatakan hook file hanya menyala
untuk file yang dibuat **agen Kiro sendiri**, bukan proses eksternal.

**Solusi:** balik arahnya — watcher yang **memanggil Kiro** (via CLI headless), bukan
menunggu Kiro mendeteksi file.

> Verifikasi asumsi ke dokumentasi resmi menghemat waktu debugging.

---

<!-- _class: lead -->

## 7. Keterbatasan & Trade-off

---

## Jujur soal batasan

- **Delay polling**: deteksi maksimal setelah 1 interval (default 30s)
- **Batas 100 subtask** per query → persempit JQL bila perlu
- **Ekstraksi AC best-effort** → tergantung penamaan field di Jira
- **Mode otomatis** butuh Kiro CLI + auth (bisa terbatas di korporat)
  - → mode **semi-otomatis** tetap andal tanpa syarat itu
- **1 instance = 1 repo** → banyak repo butuh banyak instance

---

<!-- _class: lead -->

## 8. Roadmap

---

## Pengembangan lanjutan

- **Filter status di JQL** agar query lebih ringan & tepat sasaran
- **Multi-repo** dari satu instance (mapping subtask → repo via label/component)
- **Ekstraksi AC presisi** setelah field AC di Jira BRI teridentifikasi
- **Notifikasi** (mis. ke chat) saat file task dibuat
- **Mode otomatis penuh** bila akses Kiro CLI tersedia di lingkungan kerja

---

<!-- _class: lead -->

## Terima kasih

### Tanya jawab

Repo & dokumentasi lengkap: `docs/DOCUMENTATION.md`
