import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config.js';
import type { JiraStory, JiraSubtask } from './jira.js';

export interface TaskContext {
  subtask: JiraSubtask;
  story: JiraStory | null;
  jiraBaseUrl: string;
}

/**
 * Menyusun konten file task (Markdown) yang berperan sebagai instruksi/prompt
 * untuk Kiro. Berisi judul subtask + deskripsi & acceptance criteria story.
 */
export function buildTaskContent(ctx: TaskContext): string {
  const { subtask, story, jiraBaseUrl } = ctx;
  const now = new Date().toISOString();

  const storyKey = story?.key ?? subtask.parentKey ?? '(tidak diketahui)';
  const storyUrl = story ? `${jiraBaseUrl}/browse/${story.key}` : '';
  const subtaskUrl = `${jiraBaseUrl}/browse/${subtask.key}`;

  const description =
    story?.description?.trim() ||
    '_(Story ini tidak memiliki field deskripsi terisi di Jira.)_';
  const ac =
    story?.acceptanceCriteria?.trim() ||
    '_(Story ini tidak memiliki Acceptance Criteria terisi di Jira. Kerjakan berdasarkan judul subtask & judul story.)_';

  const components = story?.components?.length ? story.components.join(', ') : '-';
  const labels = story?.labels?.length ? story.labels.join(', ') : '-';
  const storyPoints = story?.storyPoints != null ? String(story.storyPoints) : '-';
  const epicLink = story?.epicLink || '-';
  const sprint = story?.sprint || '-';

  const siblings =
    story?.siblingSubtasks?.length
      ? story.siblingSubtasks
          .map((s) => `- ${s.key === subtask.key ? '**' : ''}${s.key}: ${s.summary}${s.key === subtask.key ? ' (task ini)**' : ''}`)
          .join('\n')
      : '- (tidak ada)';

  return `# Task: ${subtask.summary}

> Dibuat otomatis oleh jira-kiro-watcher pada ${now}
> Kiro: baca file ini lalu implementasikan perubahan pada repo ini sesuai instruksi di bawah.
> JANGAN melakukan commit/push. Berhenti setelah perubahan kode selesai agar developer bisa review.

## Referensi Jira

| | |
|---|---|
| Subtask | [${subtask.key}](${subtaskUrl}) — ${subtask.summary} |
| Story (parent) | ${story ? `[${storyKey}](${storyUrl}) — ${story.summary}` : storyKey} |
| Status subtask | ${subtask.status} |
| Components | ${components} |
| Labels | ${labels} |
| Story Points | ${storyPoints} |
| Epic | ${epicLink} |
| Sprint | ${sprint} |

## Judul Subtask (fokus pekerjaan)

${subtask.summary}

## Deskripsi Story

${description}

## Acceptance Criteria

${ac}

## Subtask lain dalam story ini (konteks)

${siblings}

## Instruksi untuk Kiro

1. Pahami konteks repo ini terlebih dahulu (struktur, framework, konvensi yang ada).
2. Implementasikan perubahan yang diperlukan untuk menyelesaikan **judul subtask** di atas,
   dengan berpedoman pada **deskripsi story** dan **acceptance criteria**.
3. Ikuti gaya kode & pola yang sudah ada di repo. Jangan menambah dependency baru tanpa alasan.
4. Pastikan hasil memenuhi acceptance criteria. Jalankan build/test bila tersedia.
5. JANGAN commit atau push. Biarkan perubahan di working directory untuk direview developer.
`;
}

/** Path absolut file task untuk sebuah subtask key: <repo>/<taskOutputDir>/<KEY>.md */
export function taskFilePathFor(cfg: AppConfig, subtaskKey: string): string {
  return path.join(cfg.target.repoPath, cfg.target.taskOutputDir, `${subtaskKey}.md`);
}

/** True bila file task untuk subtask key tersebut ada di disk. */
export function taskFileExists(cfg: AppConfig, subtaskKey: string): boolean {
  return fs.existsSync(taskFilePathFor(cfg, subtaskKey));
}

/**
 * Menulis file task ke dalam repo target: <repo>/<taskOutputDir>/<KEY>.md
 * Mengembalikan path absolut file yang ditulis.
 */
export function writeTaskFile(cfg: AppConfig, ctx: TaskContext): string {
  const outDir = path.join(cfg.target.repoPath, cfg.target.taskOutputDir);
  fs.mkdirSync(outDir, { recursive: true });

  const filePath = taskFilePathFor(cfg, ctx.subtask.key);
  fs.writeFileSync(filePath, buildTaskContent(ctx), 'utf8');
  return filePath;
}
