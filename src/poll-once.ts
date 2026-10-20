import { loadConfig } from './config.js';
import { Watcher } from './watcher.js';

/**
 * Jalankan SATU siklus polling lalu keluar. Berguna untuk menguji perilaku
 * tanpa membiarkan watcher berjalan terus.
 *
 * Jalankan: npx tsx src/poll-once.ts
 */
async function main(): Promise<void> {
  const cfg = loadConfig();
  const watcher = new Watcher(cfg);
  await watcher.pollOnce();
  console.log('Satu siklus polling selesai.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
