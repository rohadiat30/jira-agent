import { Agent, type Dispatcher } from 'undici';
import type { AppConfig } from './config.js';

export interface JiraIssueRef {
  key: string;
  summary: string;
}

export interface JiraSubtask {
  key: string;
  summary: string;
  status: string;
  issueType: string;
  parentKey: string | null;
  self: string;
}

export interface JiraStory {
  key: string;
  summary: string;
  description: string;
  acceptanceCriteria: string;
  status: string;
  issueType: string;
  components: string[];
  labels: string[];
  storyPoints: number | null;
  epicLink: string | null;
  sprint: string | null;
  siblingSubtasks: JiraIssueRef[];
}

/**
 * Client tipis untuk Jira Server / Data Center REST API v2.
 */
export class JiraClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly dispatcher?: Dispatcher;
  /** cache: id field -> nama field (mis. customfield_22301 -> "Acceptance Criteria") */
  private fieldNameCache: Map<string, string> | null = null;

  constructor(private readonly cfg: AppConfig) {
    this.baseUrl = cfg.jira.baseUrl;

    const authHeader =
      cfg.jira.authType === 'basic'
        ? `Basic ${Buffer.from(`${cfg.jira.username}:${cfg.jira.token}`).toString('base64')}`
        : `Bearer ${cfg.jira.token}`;

    this.headers = {
      Authorization: authHeader,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    if (cfg.jira.skipSsl) {
      // undici Agent memungkinkan menonaktifkan verifikasi TLS untuk fetch bawaan Node.
      this.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    }
  }

  private async request<T>(pathAndQuery: string): Promise<T> {
    const url = `${this.baseUrl}${pathAndQuery}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: this.headers,
      dispatcher: this.dispatcher,
    } as RequestInit & { dispatcher?: Dispatcher });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Jira API ${res.status} ${res.statusText} untuk ${pathAndQuery}\n${body.slice(0, 500)}`,
      );
    }
    return (await res.json()) as T;
  }

  /** Cek koneksi & auth: mengembalikan info user yang sedang login. */
  async whoAmI(): Promise<{ name?: string; displayName?: string; emailAddress?: string }> {
    return this.request('/rest/api/2/myself');
  }

  /** Ambil daftar subtask sesuai JQL. */
  async searchSubtasks(jql: string, maxResults = 100): Promise<JiraSubtask[]> {
    const fields = ['summary', 'status', 'issuetype', 'parent'].join(',');
    const query =
      `/rest/api/2/search?jql=${encodeURIComponent(jql)}` +
      `&maxResults=${maxResults}&fields=${encodeURIComponent(fields)}`;

    const data = await this.request<{ issues: RawIssue[] }>(query);
    return (data.issues ?? []).map((issue) => ({
      key: issue.key,
      summary: issue.fields.summary ?? '',
      status: issue.fields.status?.name ?? 'Unknown',
      issueType: issue.fields.issuetype?.name ?? 'Unknown',
      parentKey: issue.fields.parent?.key ?? null,
      self: issue.self,
    }));
  }

  /** Daftar project yang bisa diakses user (untuk diagnostik menemukan project key). */
  async listProjects(): Promise<{ key: string; name: string }[]> {
    const data = await this.request<{ key: string; name: string }[]>(
      '/rest/api/2/project',
    );
    return (data ?? []).map((p) => ({ key: p.key, name: p.name }));
  }

  /** Muat & cache peta id->nama field agar bisa cocokkan custom field by nama. */
  private async getFieldNames(): Promise<Map<string, string>> {
    if (this.fieldNameCache) return this.fieldNameCache;
    const map = new Map<string, string>();
    try {
      const fields = await this.request<{ id: string; name: string }[]>('/rest/api/2/field');
      for (const f of fields) map.set(f.id, f.name);
    } catch {
      // biarkan kosong; ekstraksi akan fallback ke heading di description
    }
    this.fieldNameCache = map;
    return map;
  }

  /** Ambil detail sebuah issue (biasanya parent story) lengkap dengan AC. */
  async getStory(key: string): Promise<JiraStory> {
    const [data, fieldNames] = await Promise.all([
      this.request<RawIssue>(`/rest/api/2/issue/${encodeURIComponent(key)}`),
      this.getFieldNames(),
    ]);
    const f = data.fields;
    return {
      key: data.key,
      summary: f.summary ?? '',
      description: normalizeText(f.description),
      acceptanceCriteria: extractAcceptanceCriteria(f, fieldNames),
      status: f.status?.name ?? 'Unknown',
      issueType: f.issuetype?.name ?? 'Unknown',
      components: (f.components ?? []).map((c) => c.name),
      labels: f.labels ?? [],
      storyPoints: extractStoryPoints(f, fieldNames),
      epicLink: extractEpicLink(f, fieldNames),
      sprint: extractSprintName(f, fieldNames),
      siblingSubtasks: extractSubtasks(f),
    };
  }

  /** Daftar status yang tersedia untuk sebuah issue (untuk diagnostik). */
  async getAvailableStatusesForProject(projectKeyOrIssue: string): Promise<string[]> {
    // Ambil satu issue lalu baca transisi yang mungkin + status saat ini.
    try {
      const data = await this.request<{ transitions: { to: { name: string } }[] }>(
        `/rest/api/2/issue/${encodeURIComponent(projectKeyOrIssue)}/transitions`,
      );
      const names = data.transitions.map((t) => t.to?.name).filter(Boolean) as string[];
      return Array.from(new Set(names));
    } catch {
      return [];
    }
  }
}

interface RawIssue {
  key: string;
  self: string;
  fields: {
    summary?: string;
    description?: unknown;
    status?: { name?: string };
    issuetype?: { name?: string };
    parent?: { key?: string };
    components?: { name: string }[];
    labels?: string[];
    [customField: string]: unknown;
  };
}

/**
 * Jira DC dengan REST v2 mengembalikan description sebagai string (wiki markup)
 * atau kadang objek ADF (bila Cloud). Fungsi ini menormalkannya menjadi teks.
 */
function normalizeText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  // ADF (Atlassian Document Format) fallback: kumpulkan node teks.
  try {
    const parts: string[] = [];
    const walk = (node: any) => {
      if (!node) return;
      if (typeof node.text === 'string') parts.push(node.text);
      if (Array.isArray(node.content)) node.content.forEach(walk);
    };
    walk(value);
    return parts.join(' ').trim();
  } catch {
    return '';
  }
}

/**
 * Acceptance Criteria di Jira bisa berupa:
 *  - custom field terpisah yang NAMANYA mengandung "acceptance"
 *    (id-nya spesifik per instance, mis. customfield_22301), atau
 *  - bagian di dalam description dengan heading "Acceptance Criteria".
 * Fungsi ini mencoba keduanya secara best-effort.
 */
function extractAcceptanceCriteria(
  fields: RawIssue['fields'],
  fieldNames: Map<string, string>,
): string {
  // 1) Cari custom field yang NAMANYA (bukan id) mengandung "acceptance".
  for (const [id, v] of Object.entries(fields)) {
    if (!id.startsWith('customfield_')) continue;
    const name = fieldNames.get(id) ?? '';
    if (!/acceptance/i.test(name)) continue;
    const text = normalizeText(v);
    if (text) return text;
  }

  // 2) Fallback: ekstrak dari description berdasarkan heading.
  const desc = normalizeText(fields.description);
  const match = desc.match(
    /acceptance\s*criteria\s*[:\-]?\s*([\s\S]*?)(?:\n\s*\n|$)/i,
  );
  if (match && match[1].trim()) return match[1].trim();

  return '';
}

/** Story Points: cari field bernama "Story Points". */
function extractStoryPoints(
  fields: RawIssue['fields'],
  fieldNames: Map<string, string>,
): number | null {
  for (const [id, v] of Object.entries(fields)) {
    if (!id.startsWith('customfield_')) continue;
    if (!/story\s*points?/i.test(fieldNames.get(id) ?? '')) continue;
    if (typeof v === 'number') return v;
  }
  return null;
}

/** Epic Link: cari field bernama "Epic Link". */
function extractEpicLink(
  fields: RawIssue['fields'],
  fieldNames: Map<string, string>,
): string | null {
  for (const [id, v] of Object.entries(fields)) {
    if (!id.startsWith('customfield_')) continue;
    if (!/epic\s*link/i.test(fieldNames.get(id) ?? '')) continue;
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** Sprint: field "Sprint" berisi array string aneh; ambil name= terakhir. */
function extractSprintName(
  fields: RawIssue['fields'],
  fieldNames: Map<string, string>,
): string | null {
  for (const [id, v] of Object.entries(fields)) {
    if (!id.startsWith('customfield_')) continue;
    if (!/sprint/i.test(fieldNames.get(id) ?? '')) continue;
    const raw = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : [];
    const names = raw
      .map((s) => s.match(/name=([^,\]]+)/)?.[1]?.trim())
      .filter((x): x is string => Boolean(x));
    if (names.length) return names[names.length - 1];
  }
  return null;
}

/** Daftar subtask (sibling) dari sebuah story, untuk konteks. */
function extractSubtasks(fields: RawIssue['fields']): JiraIssueRef[] {
  const subs = fields.subtasks;
  if (!Array.isArray(subs)) return [];
  return subs
    .map((s: any) => ({
      key: String(s?.key ?? ''),
      summary: String(s?.fields?.summary ?? ''),
    }))
    .filter((r) => r.key);
}
