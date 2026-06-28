import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_EXPORT_KINDS = ['csv', 'json', 'markdown', 'html', 'webhook'];

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

  async summarize() {
    const trackedTypes = new Set(['call_processed', 'export_clicked', 'deal_returned']);
    const events = (await this.listEvents())
      .filter((event) => trackedTypes.has(event?.type))
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

    const totals = {
      totalEvents: events.length,
      callProcessed: 0,
      exportClicked: 0,
      dealReturned: 0,
    };
    const exportsByKind = Object.fromEntries(DEFAULT_EXPORT_KINDS.map((kind) => [kind, 0]));
    const deals = new Map();

    for (const event of events) {
      if (event.type === 'call_processed') totals.callProcessed += 1;
      if (event.type === 'export_clicked') totals.exportClicked += 1;
      if (event.type === 'deal_returned') totals.dealReturned += 1;
      if (event.type === 'export_clicked') {
        const kind = String(event.exportKind || '').trim() || 'unknown';
        if (exportsByKind[kind] === undefined) exportsByKind[kind] = 0;
        exportsByKind[kind] += 1;
      }

      const dealId = String(event.dealId || '').trim();
      if (!dealId) continue;
      const current = deals.get(dealId) || {
        dealId,
        callProcessed: 0,
        exportClicked: 0,
        dealReturned: 0,
        callCount: 0,
        lastCallLabel: null,
        lastExportKind: null,
        lastEngine: null,
        lastEventAt: null,
      };
      if (event.type === 'call_processed') {
        current.callProcessed += 1;
        current.lastCallLabel = event.callLabel || current.lastCallLabel;
        current.lastEngine = event.engine || current.lastEngine;
      }
      if (event.type === 'export_clicked') {
        current.exportClicked += 1;
        current.lastExportKind = event.exportKind || current.lastExportKind;
      }
      if (event.type === 'deal_returned') current.dealReturned += 1;
      current.callCount = Math.max(current.callCount, Number(event.callCount) || 0);
      current.lastEventAt = event.createdAt || current.lastEventAt;
      deals.set(dealId, current);
    }

    const recentEvents = [...events]
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 8)
      .map((event) => ({
        type: event.type,
        createdAt: event.createdAt || null,
        dealId: event.dealId || null,
        callLabel: event.callLabel || null,
        exportKind: event.exportKind || null,
        callCount: Number(event.callCount) || 0,
        engine: event.engine || null,
      }));

    return {
      totals,
      exportsByKind,
      latestEventAt: recentEvents[0]?.createdAt || null,
      deals: [...deals.values()].sort((a, b) => String(b.lastEventAt || '').localeCompare(String(a.lastEventAt || ''))),
      recentEvents,
    };
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
