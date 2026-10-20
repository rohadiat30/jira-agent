import fs from 'node:fs';
import type { AppConfig } from './config.js';
import { JiraClient, type JiraStory } from './jira.js';
import { StateStore } from './state.js';
import { writeTaskFile, taskFileExists } from './taskFile.js';
import { executeTaskWithKiro } from './executor.js';

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

export class Watcher {
  private readonly jira: JiraClient;
  private readonly state: StateStore;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly cfg: AppConfig) {
    this.jira = new JiraClient(cfg);
    this.state = new StateStore();
  }

  /** Satu siklus polling. Dipisah agar mudah dipanggil manual/di-test. */
  async pollOnce(): Promise<void> {
    const { jql, triggerStatus } = this.cfg.watch;
    const subtasks = await this.jira.searchSubtasks(jql);
    log(`Ditemukan ${subtasks.length} subtask dari JQL.`);

    for (const st of subtasks) {
      const changed = this.state.updateStatus(st.key, st.status);
      const isTrigger = st.status === triggerStatus;

      if (!isTrigger) continue;

      // Proses bila salah satu benar:
      //  - status BARU berubah ke trigger, ATAU
      //  - belum pernah diproses sama sekali, ATAU
      //  - sudah pernah diproses TAPI file task-nya hilang (dihapus) -> regenerate.
      const fileMissing = !taskFileExists(this.cfg, st.key);
      const alreadyDone = !changed && this.state.wasProcessed(st.key);
      if (alreadyDone && !fileMissing) {
        continue;
      }

      if (alreadyDone && fileMissing) {
        log(`Subtask ${st.key} masih "${triggerStatus}" tapi file task hilang. Regenerate...`);
      } else {
        log(`Subtask ${st.key} masuk status "${triggerStatus}". Memproses...`);
      }

      let story: JiraStory | null = null;
      if (st.parentKey) {
        try {
          story = await this.jira.getStory(st.parentKey);
        } catch (err) {
          log(`  ! Gagal ambil story parent ${st.parentKey}: ${(err as Error).message}`);
        }
      } else {
        log(`  ! Subtask ${st.key} tidak punya parent; menulis tanpa konteks story.`);
      }

      let filePath: string | null = null;
      try {
        filePath = writeTaskFile(this.cfg, {
          subtask: st,
          story,
          jiraBaseUrl: this.cfg.jira.baseUrl,
        });
        this.state.markProcessed(st.key);
        log(`  ✓ File task ditulis: ${filePath}`);
      } catch (err) {
        log(`  ! Gagal menulis file task untuk ${st.key}: ${(err as Error).message}`);
        continue;
      }

      // Eksekusi otomatis via Kiro CLI headless (bila diaktifkan).
      if (this.cfg.executor.autoExecute) {
        try {
          await executeTaskWithKiro(this.cfg, filePath);
        } catch (err) {
          log(`  ! Error saat memanggil Kiro CLI untuk ${st.key}: ${(err as Error).message}`);
        }
      } else {
        log(`  i AUTO_EXECUTE=false. File task siap; jalankan Kiro manual atau set AUTO_EXECUTE=true.`);
      }
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    if (!fs.existsSync(this.cfg.target.repoPath)) {
      throw new Error(
        `TARGET_REPO_PATH tidak ditemukan: ${this.cfg.target.repoPath}. ` +
          `Pastikan path repo target benar.`,
      );
    }

    const intervalMs = this.cfg.watch.pollIntervalSeconds * 1000;
    log(
      `Watcher mulai. JQL="${this.cfg.watch.jql}" | trigger="${this.cfg.watch.triggerStatus}" | ` +
        `interval=${this.cfg.watch.pollIntervalSeconds}s | repo=${this.cfg.target.repoPath}`,
    );

    const tick = async () => {
      try {
        await this.pollOnce();
      } catch (err) {
        log(`! Error saat polling: ${(err as Error).message}`);
      }
    };

    // Jalankan sekali langsung, lalu berkala.
    void tick();
    this.timer = setInterval(tick, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    log('Watcher dihentikan.');
  }
}
