// Headless render check — loads the live app, clicks every tab, captures console/page
// errors, screenshots a few views. Run: node scripts/render-check.mjs
import { chromium } from 'playwright-core';

const URL = process.env.SLIP_URL || 'http://100.124.131.86:3210/';
const EXEC = process.env.CHROME || '/home/u911/.cache/ms-playwright/chromium-1148/chrome-linux/chrome';
const TABS = ['brief', 'mindmap', 'kanban', 'steps', 'scorecard', 'risks', 'stakeholders', 'battlecards'];

const errors = [];
const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 430, height: 920 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
const modalHidden = await page.evaluate(() => getComputedStyle(document.getElementById('modal')).display === 'none');
await page.click('#loadSample');
await page.waitForTimeout(300);
await page.click('#analyze');
await page.waitForSelector('#output:not([hidden])', { timeout: 20000 });
await page.waitForTimeout(400);

const report = {};
for (const t of TABS) {
  await page.click(`.tab[data-tab="${t}"]`);
  await page.waitForTimeout(250);
  report[t] = await page.evaluate(() => ({
    len: document.getElementById('view').innerHTML.length,
    svg: document.querySelectorAll('#view svg').length,
    items: document.querySelectorAll('#view .card,#view .kcard,#view .bc,#view .stk,#view .step,#view .item,#view .ev').length,
  }));
  if (['mindmap', 'scorecard', 'kanban', 'risks'].includes(t)) await page.screenshot({ path: `/tmp/slip-${t}.png`, fullPage: true });
}

console.log('modal hidden on load:', modalHidden);
for (const t of TABS) console.log('  ' + t.padEnd(13), JSON.stringify(report[t]));
console.log('errors:', errors.length);
errors.slice(0, 12).forEach((e) => console.log('  ! ' + e));
await browser.close();
process.exit(errors.length ? 1 : 0);
