import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { chromium } from 'playwright-core';

const focusableSelector = [
  'input:not([disabled]):not([type="hidden"])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'select:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

let browser;
let root;
let server;
let base;

function resolveBrowserExecutable() {
  const candidates = [
    process.env.CHROME,
    '/home/u911/.cache/ms-playwright/chromium-1148/chrome-linux/chrome',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  for (const command of ['chromium-browser', 'chromium', 'google-chrome', 'google-chrome-stable', 'chrome']) {
    const result = spawnSync('which', [command], { encoding: 'utf8' });
    if (result.status === 0) return result.stdout.trim();
  }

  return null;
}

async function launchBrowser(executablePath) {
  try {
    return await chromium.launch({
      executablePath,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
  } catch (error) {
    const message = String(error?.message || error);
    throw new Error(
      `failed to launch Chromium for the mobile hero regression test; set CHROME to a working browser binary or install the required shared libraries. ${message}`,
    );
  }
}

async function inspectWorkspace(page) {
  return page.evaluate((selector) => {
    const shell = document.querySelector('.workspace-shell');
    const heading = document.querySelector('.input-pane h1');
    const transcript = document.getElementById('transcript');
    const threadName = document.getElementById('threadName');
    const isBefore = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    return {
      shellChildren: [...shell.children].map((element) => element.className),
      headingBeforeWorkspace: isBefore(heading, threadName),
      transcriptBeforeWorkspace: isBefore(transcript, threadName),
      focusables: [...document.querySelectorAll(selector)].map((element) => (
        element.id || element.getAttribute('aria-label') || element.tagName
      )),
      inputTop: Math.round(document.querySelector('.input-pane').getBoundingClientRect().top),
      threadTop: Math.round(document.querySelector('.thread-pane').getBoundingClientRect().top),
      inputLeft: Math.round(document.querySelector('.input-pane').getBoundingClientRect().left),
      threadLeft: Math.round(document.querySelector('.thread-pane').getBoundingClientRect().left),
      transcriptLeft: Math.round(transcript.getBoundingClientRect().left),
      threadNameLeft: Math.round(threadName.getBoundingClientRect().left),
    };
  }, focusableSelector);
}

async function openAppPage(t, viewport) {
  const executablePath = resolveBrowserExecutable();
  assert.ok(executablePath, 'browser executable not found; set CHROME to a Chromium/Chrome binary');
  if (!browser) browser = await launchBrowser(executablePath);
  const page = await browser.newPage({ viewport });
  t.after(async () => page.close());
  await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 });
  return page;
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'slipstream-hero-order-'));
  process.env.SLIPSTREAM_DEALS_DIR = join(root, 'deals');
  process.env.SLIPSTREAM_TELEMETRY_DIR = join(root, 'telemetry');
  process.env.SLIPSTREAM_DATA_DIR = join(root, 'library');
  process.env.PORT = '0';
  process.env.HOST = '127.0.0.1';
  ({ server } = await import('../src/server.js'));
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

test('mobile hero content leads the DOM and focus order at <=820px', async (t) => {
  const page = await openAppPage(t, { width: 430, height: 920 });
  const layout = await inspectWorkspace(page);

  assert.deepEqual(layout.shellChildren, ['input-pane', 'thread-pane']);
  assert.ok(layout.headingBeforeWorkspace, 'hero heading should come before workspace controls in DOM order');
  assert.ok(layout.transcriptBeforeWorkspace, 'transcript textarea should come before workspace controls in DOM order');
  assert.ok(layout.inputTop < layout.threadTop, 'hero pane should render above the workspace sidebar on mobile');

  const transcriptIndex = layout.focusables.indexOf('transcript');
  const threadNameIndex = layout.focusables.indexOf('threadName');
  assert.notEqual(transcriptIndex, -1, 'transcript should be keyboard focusable');
  assert.notEqual(threadNameIndex, -1, 'workspace name input should be keyboard focusable');
  assert.ok(
    transcriptIndex < threadNameIndex,
    `mobile keyboard order should reach transcript before workspace input: ${layout.focusables.join(' -> ')}`,
  );
});

test('desktop hero and keyboard order stay aligned above 820px', async (t) => {
  const page = await openAppPage(t, { width: 1280, height: 920 });
  const layout = await inspectWorkspace(page);

  assert.deepEqual(layout.shellChildren, ['input-pane', 'thread-pane']);
  assert.ok(layout.transcriptBeforeWorkspace, 'desktop DOM order should still reach transcript before workspace controls');
  assert.ok(layout.inputLeft < layout.threadLeft, 'desktop hero pane should render before the workspace sidebar');
  assert.ok(
    layout.transcriptLeft < layout.threadNameLeft,
    `desktop visual order should place the transcript before the workspace input: transcript x=${layout.transcriptLeft}, threadName x=${layout.threadNameLeft}`,
  );

  const transcriptIndex = layout.focusables.indexOf('transcript');
  const threadNameIndex = layout.focusables.indexOf('threadName');
  assert.notEqual(transcriptIndex, -1, 'transcript should be keyboard focusable on desktop');
  assert.notEqual(threadNameIndex, -1, 'workspace name input should be keyboard focusable on desktop');
  assert.ok(
    transcriptIndex < threadNameIndex,
    `desktop keyboard order should reach transcript before workspace input: ${layout.focusables.join(' -> ')}`,
  );

  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    'transcript',
    'first desktop Tab stop should land on the visually first hero input',
  );
});
