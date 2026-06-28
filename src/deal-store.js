import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  appendCallToThread,
  buildThreadView,
  createThreadRecord,
  getThreadById,
  listThreadSummaries,
} from '../web/threads.js';

export const MAX_DEALS = 40;

export class DealStoreError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'DealStoreError';
    this.status = status;
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function ensureDealInput({ title, account = '' }) {
  const safeTitle = String(title || account || '').trim();
  if (!safeTitle) throw new DealStoreError(400, 'deal title is required');
  return {
    title: safeTitle,
    account: String(account || '').trim(),
  };
}

export class DealStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.manifestPath = join(rootDir, 'manifest.json');
    this.deals = [];
    this.queue = Promise.resolve();
  }

  async init() {
    try {
      await mkdir(this.rootDir, { recursive: true });
      this.deals = await this.#loadDeals();
    } catch {
      this.deals = [];
    }
    return this;
  }

  listDeals() {
    return this.deals.map((deal) => clone(deal));
  }

  listDealSummaries() {
    return listThreadSummaries(this.deals);
  }

  getDeal(dealId) {
    return clone(getThreadById(this.deals, dealId));
  }

  buildView(dealId) {
    const deal = getThreadById(this.deals, dealId);
    return deal ? buildThreadView(deal) : null;
  }

  async createDeal(input, options = {}) {
    const safe = ensureDealInput(input || {});
    return this.#serialize(async () => {
      if (this.deals.length >= MAX_DEALS) throw new DealStoreError(409, `saved deals are capped at ${MAX_DEALS}`);
      const deal = createThreadRecord(safe, options);
      this.deals = [...this.deals, deal];
      await writeFile(this.#dealPath(deal.id), JSON.stringify(deal, null, 2));
      await this.#writeManifest();
      return clone(deal);
    });
  }

  async addCall(dealId, callInput, options = {}) {
    return this.#serialize(async () => {
      const index = this.deals.findIndex((deal) => deal.id === dealId);
      if (index === -1) throw new DealStoreError(404, 'deal not found');
      const deal = appendCallToThread(this.deals[index], callInput, options);
      this.deals = this.deals.map((entry, entryIndex) => (entryIndex === index ? deal : entry));
      await writeFile(this.#dealPath(deal.id), JSON.stringify(deal, null, 2));
      await this.#writeManifest();
      return clone(deal);
    });
  }

  async #serialize(task) {
    const run = this.queue.then(task, task);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async #loadDeals() {
    let manifest = null;
    try {
      manifest = JSON.parse(await readFile(this.manifestPath, 'utf8'));
      if (!Array.isArray(manifest?.deals)) manifest = null;
    } catch {
      manifest = null;
    }

    const deals = manifest ? await this.#loadFromManifest(manifest.deals) : await this.#scanDealFiles();
    if (!manifest) await this.#writeManifest(deals);
    return deals.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async #loadFromManifest(entries) {
    const deals = [];
    for (const entry of entries) {
      try {
        const raw = JSON.parse(await readFile(this.#dealPath(entry.dealId), 'utf8'));
        deals.push({
          id: raw.id || entry.dealId,
          title: String(raw.title || entry.title || 'Untitled deal'),
          account: String(raw.account || entry.account || ''),
          createdAt: raw.createdAt || entry.createdAt || new Date().toISOString(),
          updatedAt: raw.updatedAt || entry.updatedAt || raw.createdAt || new Date().toISOString(),
          calls: Array.isArray(raw.calls) ? raw.calls : [],
        });
      } catch {
        // Skip unreadable deal files.
      }
    }
    return deals;
  }

  async #scanDealFiles() {
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name !== 'manifest.json' && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();

    const deals = [];
    for (const file of files) {
      try {
        const raw = JSON.parse(await readFile(join(this.rootDir, file), 'utf8'));
        deals.push({
          id: raw.id || file.replace(/\.json$/, ''),
          title: String(raw.title || 'Untitled deal'),
          account: String(raw.account || ''),
          createdAt: raw.createdAt || new Date().toISOString(),
          updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
          calls: Array.isArray(raw.calls) ? raw.calls : [],
        });
      } catch {
        // Skip unreadable deal files.
      }
    }
    return deals;
  }

  async #writeManifest(nextDeals = this.deals) {
    await writeFile(
      this.manifestPath,
      JSON.stringify({
        deals: nextDeals.map(({ id, title, account, createdAt, updatedAt, calls }) => ({
          dealId: id,
          title,
          account,
          createdAt,
          updatedAt,
          callCount: Array.isArray(calls) ? calls.length : 0,
        })),
      }, null, 2),
    );
  }

  #dealPath(dealId) {
    return join(this.rootDir, `${dealId}.json`);
  }
}

export async function resetDealStore(rootDir) {
  await rm(rootDir, { recursive: true, force: true });
}
