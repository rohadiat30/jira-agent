import { loadConfig } from './config.js';
import { Agent, type Dispatcher } from 'undici';

/**
 * Diagnostik: tampilkan SEMUA field (termasuk customfield_*) dari sebuah issue,
 * beserta nama field-nya, agar kita tahu di mana Description & Acceptance Criteria
 * sebenarnya disimpan di instance Jira BRI.
 *
 * Jalankan: npx tsx src/inspect.ts <ISSUE-KEY>
 */
async function main(): Promise<void> {
  const key = process.argv[2];
  if (!key) {
    console.error('Pakai: npx tsx src/inspect.ts <ISSUE-KEY>  (mis. NQLA-68834)');
    process.exit(1);
  }

  const cfg = loadConfig();
  const authHeader =
    cfg.jira.authType === 'basic'
      ? `Basic ${Buffer.from(`${cfg.jira.username}:${cfg.jira.token}`).toString('base64')}`
      : `Bearer ${cfg.jira.token}`;

  let dispatcher: Dispatcher | undefined;
  if (cfg.jira.skipSsl) {
    dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  }

  // 1) Ambil peta nama field (id -> nama yang mudah dibaca).
  const fieldMap = new Map<string, string>();
  try {
    const fieldsRes = await fetch(`${cfg.jira.baseUrl}/rest/api/2/field`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      dispatcher,
    } as RequestInit & { dispatcher?: Dispatcher });
    const fields = (await fieldsRes.json()) as { id: string; name: string }[];
    for (const f of fields) fieldMap.set(f.id, f.name);
  } catch (e) {
    console.warn(`(gagal ambil daftar field: ${(e as Error).message})`);
  }

  // 2) Ambil issue dengan semua field.
  const res = await fetch(
    `${cfg.jira.baseUrl}/rest/api/2/issue/${encodeURIComponent(key)}`,
    {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      dispatcher,
    } as RequestInit & { dispatcher?: Dispatcher },
  );

  if (!res.ok) {
    console.error(`Gagal: ${res.status} ${res.statusText}`);
    console.error(await res.text());
    process.exit(1);
  }

  const data = (await res.json()) as { fields: Record<string, unknown> };

  console.log(`=== Field non-kosong untuk ${key} ===\n`);
  for (const [id, value] of Object.entries(data.fields)) {
    if (value == null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'object' && Object.keys(value as object).length === 0) continue;

    const name = fieldMap.get(id) ?? id;
    let preview = '';
    if (typeof value === 'string') {
      preview = value.length > 200 ? `${value.slice(0, 200)}...` : value;
    } else {
      preview = JSON.stringify(value);
      if (preview.length > 200) preview = `${preview.slice(0, 200)}...`;
    }
    console.log(`• ${name}  [${id}]`);
    console.log(`    ${preview}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
