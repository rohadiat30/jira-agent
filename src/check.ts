import { loadConfig, redact } from './config.js';
import { JiraClient } from './jira.js';

/**
 * Utilitas diagnostik. Jalankan: `npm run check`
 * - Verifikasi koneksi & auth ke Jira
 * - Menampilkan subtask hasil JQL beserta status persisnya
 * - Menampilkan apakah TRIGGER_STATUS cocok dengan salah satu status yang ada
 */
async function main(): Promise<void> {
  const cfg = loadConfig();
  const jira = new JiraClient(cfg);

  console.log('=== Cek Koneksi Jira ===');
  console.log(`URL   : ${cfg.jira.baseUrl}`);
  console.log(`Auth  : ${cfg.jira.authType} (token=${redact(cfg.jira.token)})`);
  console.log(`SSL   : ${cfg.jira.skipSsl ? 'skip verify' : 'verify'}`);

  try {
    const me = await jira.whoAmI();
    console.log(`✓ Terautentikasi sebagai: ${me.displayName ?? me.name ?? '(tidak diketahui)'}`);
  } catch (err) {
    console.error(`✗ Gagal autentikasi/koneksi: ${(err as Error).message}`);
    console.error('  Tips: cek token, JIRA_AUTH_TYPE, VPN/jaringan internal, dan JIRA_SKIP_SSL.');
    process.exit(1);
  }

  console.log('\n=== Cek JQL ===');
  console.log(`JQL: ${cfg.watch.jql}`);
  let subtasks;
  try {
    subtasks = await jira.searchSubtasks(cfg.watch.jql, 50);
  } catch (err) {
    console.error(`✗ JQL gagal: ${(err as Error).message}`);

    // Bantu temukan project key yang benar bila JQL gagal.
    console.log('\n=== Project yang bisa Anda akses ===');
    try {
      const projects = await jira.listProjects();
      if (projects.length === 0) {
        console.log('  (tidak ada project terlihat)');
      } else {
        for (const p of projects) {
          console.log(`  ${p.key.padEnd(12)} :: ${p.name}`);
        }
        console.log(
          '\n  Salin salah satu KEY di atas ke JIRA_JQL di .env, contoh:',
        );
        console.log('  JIRA_JQL=project = <KEY> AND issuetype = Sub-task');
      }
    } catch (e) {
      console.log(`  (gagal mengambil daftar project: ${(e as Error).message})`);
    }
    process.exit(1);
  }

  if (subtasks.length === 0) {
    console.log('  (tidak ada subtask cocok — cek project key / issuetype di JQL)');
  } else {
    console.log(`Ditemukan ${subtasks.length} subtask:`);
    const statuses = new Set<string>();
    for (const st of subtasks) {
      statuses.add(st.status);
      console.log(`  - ${st.key} [${st.status}] parent=${st.parentKey ?? '-'} :: ${st.summary}`);
    }

    console.log('\n=== Status unik yang muncul ===');
    for (const s of statuses) {
      const mark = s === cfg.watch.triggerStatus ? '  <-- TRIGGER_STATUS cocok' : '';
      console.log(`  "${s}"${mark}`);
    }

    if (!statuses.has(cfg.watch.triggerStatus)) {
      console.log(
        `\n⚠ TRIGGER_STATUS="${cfg.watch.triggerStatus}" TIDAK cocok dengan status manapun di atas.`,
      );
      console.log('  Salin salah satu nama status di atas (persis) ke TRIGGER_STATUS di .env.');
    }
  }

  console.log('\nSelesai.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
