import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

import { buildIndex, parseDoc } from './library.js';

const ALLOWED_TEXT_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
]);
const ALLOWED_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.yaml', '.yml', '.xml']);

export const MAX_LIBRARY_DOCS = 24;
export const MAX_LIBRARY_DOC_BYTES = 200_000;

export class LibraryStoreError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'LibraryStoreError';
    this.status = status;
  }
}

function ensureTextUpload({ name, text, contentType }) {
  if (!String(name || '').trim()) throw new LibraryStoreError(400, 'document name is required');
  if (!String(text || '').trim()) throw new LibraryStoreError(400, 'document text is empty');
  const bytes = Buffer.byteLength(String(text), 'utf8');
  if (bytes > MAX_LIBRARY_DOC_BYTES) throw new LibraryStoreError(413, `document exceeds ${MAX_LIBRARY_DOC_BYTES} bytes`);

  const type = String(contentType || '').toLowerCase();
  const ext = extname(String(name || '')).toLowerCase();
  const typeAllowed = !type || type.startsWith('text/') || ALLOWED_TEXT_TYPES.has(type);
  const extAllowed = !ext || ALLOWED_EXTENSIONS.has(ext);
  if (!typeAllowed && !extAllowed) throw new LibraryStoreError(415, `unsupported upload type: ${contentType || ext || 'unknown'}`);
}

async function safeUnlink(filePath) {
  try {
    await unlink(filePath);
  } catch {
    // best-effort cleanup
  }
}

export class LibraryStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.manifestPath = join(rootDir, 'manifest.json');
    this.docs = [];
    this.index = buildIndex([]);
    this.queue = Promise.resolve();
  }

  async init() {
    try {
      await mkdir(this.rootDir, { recursive: true });
      this.docs = await this.#loadDocs();
      this.index = buildIndex(this.docs);
    } catch {
      this.docs = [];
      this.index = buildIndex([]);
    }
    return this;
  }

  listDocuments() {
    return this.docs.map(({ docId, docName, createdAt, passageCount }) => ({ docId, docName, createdAt, passageCount }));
  }

  getIndex() {
    return this.index;
  }

  async addDocument({ name, text, contentType }) {
    ensureTextUpload({ name, text, contentType });
    return this.#serialize(async () => {
      if (this.docs.length >= MAX_LIBRARY_DOCS) throw new LibraryStoreError(409, `library is capped at ${MAX_LIBRARY_DOCS} documents`);
      const docId = randomUUID();
      const docName = String(name).trim();
      const createdAt = new Date().toISOString();
      const parsed = parseDoc(docName, text, { docId });
      const record = {
        docId,
        docName,
        createdAt,
        text: String(text).replace(/\r\n?/g, '\n'),
        passageCount: parsed.passages.length,
      };
      await writeFile(this.#docPath(docId), JSON.stringify(record, null, 2));
      this.docs = [...this.docs, record];
      this.index = buildIndex(this.docs);
      await this.#writeManifest();
      return { docId, docName, createdAt, passageCount: record.passageCount };
    });
  }

  async deleteDocument(docId) {
    return this.#serialize(async () => {
      const next = this.docs.filter((doc) => doc.docId !== docId);
      if (next.length === this.docs.length) return false;
      await safeUnlink(this.#docPath(docId));
      this.docs = next;
      this.index = buildIndex(this.docs);
      await this.#writeManifest();
      return true;
    });
  }

  async #serialize(task) {
    const run = this.queue.then(task, task);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async #loadDocs() {
    let manifest = null;
    try {
      manifest = JSON.parse(await readFile(this.manifestPath, 'utf8'));
      if (!Array.isArray(manifest?.docs)) manifest = null;
    } catch {
      manifest = null;
    }

    const docs = manifest ? await this.#loadFromManifest(manifest.docs) : await this.#scanDocFiles();
    if (!manifest) await this.#writeManifest(docs);
    return docs;
  }

  async #loadFromManifest(entries) {
    const docs = [];
    for (const entry of entries) {
      try {
        const raw = JSON.parse(await readFile(this.#docPath(entry.docId), 'utf8'));
        const parsed = parseDoc(raw.docName || entry.docName, raw.text || '', { docId: raw.docId || entry.docId });
        docs.push({
          docId: parsed.docId,
          docName: parsed.docName,
          createdAt: raw.createdAt || entry.createdAt || new Date().toISOString(),
          text: String(raw.text || ''),
          passageCount: parsed.passages.length,
        });
      } catch {
        // skip unreadable entries
      }
    }
    return docs;
  }

  async #scanDocFiles() {
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name !== 'manifest.json' && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();

    const docs = [];
    for (const file of files) {
      try {
        const raw = JSON.parse(await readFile(join(this.rootDir, file), 'utf8'));
        const parsed = parseDoc(raw.docName, raw.text || '', { docId: raw.docId || file.replace(/\.json$/, '') });
        docs.push({
          docId: parsed.docId,
          docName: parsed.docName,
          createdAt: raw.createdAt || new Date().toISOString(),
          text: String(raw.text || ''),
          passageCount: parsed.passages.length,
        });
      } catch {
        // skip unreadable files
      }
    }
    return docs;
  }

  async #writeManifest(nextDocs = this.docs) {
    await writeFile(
      this.manifestPath,
      JSON.stringify({
        docs: nextDocs.map(({ docId, docName, createdAt, passageCount }) => ({ docId, docName, createdAt, passageCount })),
      }, null, 2),
    );
  }

  #docPath(docId) {
    return join(this.rootDir, `${docId}.json`);
  }
}

export async function resetLibraryStore(rootDir) {
  await rm(rootDir, { recursive: true, force: true });
}
