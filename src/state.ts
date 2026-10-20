import fs from 'node:fs';
import path from 'node:path';

interface StateShape {
  /** map: subtaskKey -> status terakhir yang sudah diketahui watcher */
  lastKnownStatus: Record<string, string>;
  /** map: subtaskKey -> ISO timestamp kapan terakhir diproses (ditulis file task) */
  lastProcessedAt: Record<string, string>;
}

const DEFAULT_STATE: StateShape = {
  lastKnownStatus: {},
  lastProcessedAt: {},
};

/**
 * Menyimpan status yang sudah dilihat agar file task hanya ditulis SEKALI
 * pada transisi masuk ke status pemicu (bukan setiap polling).
 */
export class StateStore {
  private readonly file: string;
  private state: StateShape;

  constructor(stateDir = '.state', fileName = 'watcher-state.json') {
    const dir = path.resolve(stateDir);
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, fileName);
    this.state = this.read();
  }

  private read(): StateShape {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StateShape>;
      return {
        lastKnownStatus: parsed.lastKnownStatus ?? {},
        lastProcessedAt: parsed.lastProcessedAt ?? {},
      };
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
  }

  private persist(): void {
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2), 'utf8');
  }

  getLastStatus(key: string): string | undefined {
    return this.state.lastKnownStatus[key];
  }

  /**
   * Tandai status terbaru untuk sebuah subtask.
   * Mengembalikan true bila status BERUBAH dibanding yang tersimpan.
   */
  updateStatus(key: string, status: string): boolean {
    const changed = this.state.lastKnownStatus[key] !== status;
    this.state.lastKnownStatus[key] = status;
    if (changed) this.persist();
    return changed;
  }

  markProcessed(key: string): void {
    this.state.lastProcessedAt[key] = new Date().toISOString();
    this.persist();
  }

  wasProcessed(key: string): boolean {
    return Boolean(this.state.lastProcessedAt[key]);
  }
}
