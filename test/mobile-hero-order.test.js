import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { chromium } from 'playwright-core';

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

test('mobile hero content leads the DOM and focus order at <=820px', async (t) => {
  const executablePath = resolveBrowserExecutable();
  assert.ok(executablePath, 'browser executable not found; set CHROME to a Chromium/Chrome binary');

  const root = await mkdtemp(join(tmpdir(), 'slipstream-mobile-hero-'));
  const dealsDir = join(root, 'deals');
  const telemetryDir = join(root, 'telemetry');
  const libraryDir = join(root, 'library');

  t.after(async () => rm(root, { recursive: true, force: true }));

  process.env.SLIPSTREAM_DEALS_DIR = dealsDir;
  process.env.SLIPSTREAM_TELEMETRY_DIR = telemetryDir;
  process.env.SLIPSTREAM_DATA_DIR = libraryDir;
  process.env.PORT = '0';
  process.env.HOST = '127.0.0.1';

  const { server } = await import('../src/server.js');
  t.after(async () => new Promise((resolve) => server.close(resolve)));
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));

  const browser = await launchBrowser(executablePath);
  t.after(async () => browser.close());

  const page = await browser.newPage({ viewport: { width: 430, height: 920 } });
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 });

  const layout = await page.evaluate(() => {
    const shell = document.querySelector('.workspace-shell');
    const heading = document.querySelector('.input-pane h1');
    const transcript = document.getElementById('transcript');
    const threadName = document.getElementById('threadName');
    const focusableSelector = [
      'input:not([disabled]):not([type="hidden"])',
      'textarea:not([disabled])',
      'button:not([disabled])',
      'select:not([disabled])',
      'a[href]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const focusables = [...document.querySelectorAll(focusableSelector)].map((element) => (
      element.id || element.getAttribute('aria-label') || element.tagName
    ));
    const isBefore = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    return {
      shellChildren: [...shell.children].map((element) => element.className),
      headingBeforeWorkspace: isBefore(heading, threadName),
      transcriptBeforeWorkspace: isBefore(transcript, threadName),
      focusables,
      inputTop: Math.round(document.querySelector('.input-pane').getBoundingClientRect().top),
      threadTop: Math.round(document.querySelector('.thread-pane').getBoundingClientRect().top),
    };
  });

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
