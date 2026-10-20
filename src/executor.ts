import { spawn } from 'node:child_process';
import path from 'node:path';
import type { AppConfig } from './config.js';

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

/**
 * Menjalankan Kiro CLI dalam mode headless untuk mengeksekusi sebuah file task.
 *
 * Mengikuti dokumentasi Kiro CLI headless:
 *   kiro-cli chat --no-interactive --trust-all-tools "<prompt>"
 * dijalankan dengan cwd = repo target, sehingga Kiro bekerja di repo tersebut.
 *
 * Autentikasi (urutan prioritas Kiro CLI):
 *   1) Sesi browser aktif dari `kiro-cli login`  <-- dipakai untuk pemakaian lokal
 *   2) Environment variable KIRO_API_KEY         <-- untuk CI/CD tanpa browser
 * Jadi KIRO_API_KEY TIDAK wajib bila Anda sudah `kiro-cli login` di mesin ini.
 */
export function executeTaskWithKiro(
  cfg: AppConfig,
  taskFilePath: string,
): Promise<{ code: number; ok: boolean }> {
  const relTaskPath = path.relative(cfg.target.repoPath, taskFilePath).replace(/\\/g, '/');

  const prompt =
    `Baca file task "${relTaskPath}" di repo ini, lalu implementasikan perubahan kode ` +
    `sesuai judul subtask, deskripsi story, dan acceptance criteria di dalamnya. ` +
    `Ikuti konvensi & pola kode yang sudah ada. Jalankan build/test bila tersedia. ` +
    `JANGAN commit atau push — hentikan setelah perubahan kode selesai agar developer bisa review.`;

  const args = ['chat', '--no-interactive'];

  if (cfg.executor.agentEngine) {
    args.push(`--agent-engine`, cfg.executor.agentEngine);
  }

  if (cfg.executor.trustTools.toLowerCase() === 'all') {
    args.push('--trust-all-tools');
  } else {
    args.push(`--trust-tools=${cfg.executor.trustTools}`);
  }

  args.push(prompt);

  return new Promise((resolve) => {
    const authMode = process.env.KIRO_API_KEY
      ? 'API key (KIRO_API_KEY)'
      : 'sesi login browser (kiro-cli login)';
    log(`  → Menjalankan Kiro CLI headless di ${cfg.target.repoPath} [auth: ${authMode}] ...`);

    const child = spawn(cfg.executor.kiroCliCommand, args, {
      cwd: cfg.target.repoPath,
      env: process.env,
      shell: true, // agar "kiro-cli" pada PATH terdeteksi di Windows
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (d) => process.stdout.write(`    [kiro] ${d}`));
    child.stderr.on('data', (d) => process.stderr.write(`    [kiro:err] ${d}`));

    child.on('error', (err) => {
      log(`  ! Gagal menjalankan Kiro CLI: ${err.message}`);
      log(
        `    Pastikan Kiro CLI terinstall & ada di PATH (uji: "${cfg.executor.kiroCliCommand} --version").`,
      );
      resolve({ code: -1, ok: false });
    });

    child.on('close', (code) => {
      const ok = code === 0;
      log(`  ${ok ? '✓' : '!'} Kiro CLI selesai dengan exit code ${code}.`);
      if (!ok && !process.env.KIRO_API_KEY) {
        log(
          '    Bila gagal karena autentikasi: jalankan "kiro-cli login" sekali di mesin ini, ' +
            'lalu cek "kiro-cli whoami".',
        );
      }
      resolve({ code: code ?? -1, ok });
    });
  });
}
