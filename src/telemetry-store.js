import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

export class TelemetryStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.eventsPath = join(rootDir, 'events.ndjson');
    this.queue = Promise.resolve();
  }

  async init() {
    await mkdir(this.rootDir, { recursive: true });
    return this;
  }

  async record(type, fields = {}) {
    return this.#serialize(async () => {
      const event = {
        id: randomUUID(),
        type,
        createdAt: new Date().toISOString(),
        ...fields,
      };
      await appendFile(this.eventsPath, `${JSON.stringify(event)}\n`);
      return event;
    });
  }

  async listEvents() {
    try {
      const raw = await readFile(this.eventsPath, 'utf8');
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }

  async #serialize(task) {
    const run = this.queue.then(task, task);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}

export async function resetTelemetryStore(rootDir) {
  await rm(rootDir, { recursive: true, force: true });
}
