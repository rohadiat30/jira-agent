import { loadConfig } from './config.js';
import { JiraClient } from './jira.js';
import { writeTaskFile } from './taskFile.js';

/**
 * Proses SATU subtask secara manual (tanpa menunggu polling / geser status).
 * Berguna untuk menguji pembuatan file task.
 *
 * Jalankan: npx tsx src/process-one.ts <SUBTASK-KEY>
 */
async function main(): Promise<void> {
  const key = process.argv[2];
  if (!key) {
    console.error('Pakai: npx tsx src/process-one.ts <SUBTASK-KEY>  (mis. NQLA-70940)');
    process.exit(1);
  }

  const cfg = loadConfig();
  const jira = new JiraClient(cfg);

  // Ambil subtask lewat JQL by key agar dapat parent-nya.
  const subs = await jira.searchSubtasks(`key = ${key}`, 1);
  const subtask = subs[0];
  if (!subtask) {
    console.error(`Subtask ${key} tidak ditemukan.`);
    process.exit(1);
  }

  const story = subtask.parentKey ? await jira.getStory(subtask.parentKey) : null;

  const filePath = writeTaskFile(cfg, {
    subtask,
    story,
    jiraBaseUrl: cfg.jira.baseUrl,
  });

  console.log(`✓ File task ditulis: ${filePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
