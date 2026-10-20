import 'dotenv/config';
import path from 'node:path';

export type AuthType = 'bearer' | 'basic';

export interface AppConfig {
  port: number;
  jira: {
    baseUrl: string;
    token: string;
    username: string;
    authType: AuthType;
    skipSsl: boolean;
  };
  watch: {
    jql: string;
    triggerStatus: string;
    pollIntervalSeconds: number;
  };
  target: {
    repoPath: string;
    taskOutputDir: string;
  };
  executor: {
    /** Jalankan Kiro CLI otomatis setelah file task ditulis. */
    autoExecute: boolean;
    /** Path/command Kiro CLI (default "kiro-cli"). */
    kiroCliCommand: string;
    /** Argumen trust: "all" -> --trust-all-tools, atau daftar kategori dipisah koma. */
    trustTools: string;
    /** Agent engine: v1|v2|v3 (kosong = default CLI). */
    agentEngine: string;
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `Env "${name}" belum di-set. Salin .env.example menjadi .env lalu isi nilainya.`,
    );
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function parseBool(value: string): boolean {
  return ['1', 'true', 'yes', 'y'].includes(value.toLowerCase());
}

function parseIntSafe(value: string, fallback: number): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(): AppConfig {
  const authTypeRaw = optional('JIRA_AUTH_TYPE', 'bearer').toLowerCase();
  const authType: AuthType = authTypeRaw === 'basic' ? 'basic' : 'bearer';

  const baseUrl = required('JIRA_BASE_URL').replace(/\/+$/, '');
  const token = required('JIRA_TOKEN');
  const username = authType === 'basic' ? required('JIRA_USERNAME') : optional('JIRA_USERNAME', '');

  const repoPath = path.resolve(required('TARGET_REPO_PATH'));

  return {
    port: parseIntSafe(optional('PORT', '3000'), 3000),
    jira: {
      baseUrl,
      token,
      username,
      authType,
      skipSsl: parseBool(optional('JIRA_SKIP_SSL', 'false')),
    },
    watch: {
      jql: required('JIRA_JQL'),
      triggerStatus: required('TRIGGER_STATUS'),
      pollIntervalSeconds: parseIntSafe(optional('POLL_INTERVAL_SECONDS', '30'), 30),
    },
    target: {
      repoPath,
      taskOutputDir: optional('TASK_OUTPUT_DIR', '.kiro/tasks'),
    },
    executor: {
      autoExecute: parseBool(optional('AUTO_EXECUTE', 'false')),
      kiroCliCommand: optional('KIRO_CLI_COMMAND', 'kiro-cli'),
      trustTools: optional('KIRO_TRUST_TOOLS', 'all'),
      agentEngine: optional('KIRO_AGENT_ENGINE', ''),
    },
  };
}

/** Redaksi token untuk logging aman. */
export function redact(secret: string): string {
  if (!secret) return '(kosong)';
  if (secret.length <= 6) return '***';
  return `${secret.slice(0, 3)}***${secret.slice(-2)}`;
}
