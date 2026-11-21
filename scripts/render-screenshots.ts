// Headless Screenshot Generation Pipeline (Node 22, ESM)
// Captures pixel-perfect screenshots of Token Launch Radar dashboard using Playwright

import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { buildDossier } from '../vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'out');
const shotsDir = join(root, 'screenshots');
const outShotsDir = join(outDir, 'screenshots');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

// 1. Ephemeral Local Static File Server
function startServer(port: number): Promise<{ close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let reqPath = req.url?.split('?')[0]?.split('#')[0] || '/';
      if (reqPath === '/' || reqPath === '/dashboard' || reqPath === '/dashboard/') {
        reqPath = '/dashboard/index.html';
      }

      const filePath = join(outDir, reqPath.replace(/^\//, ''));
      if (existsSync(filePath) && statSync(filePath).isFile()) {
        const ext = extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(readFileSync(filePath));
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      }
    });

    server.listen(port, '127.0.0.1', () => {
      resolve({
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

// 2. Launch Browser with automatic fallback
async function launchBrowser(): Promise<Browser> {
  const options = [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  for (const opt of options) {
    try {
      return await chromium.launch({ ...opt, headless: true });
    } catch {
      continue;
    }
  }
  throw new Error('Unable to launch browser: no Chromium, Edge, or Chrome executable located');
}

async function render() {
  console.log('\n[screenshots] Starting automated headless capture pipeline...');
  mkdirSync(shotsDir, { recursive: true });
  mkdirSync(outShotsDir, { recursive: true });

  const port = 4567;
  const server = await startServer(port);
  console.log(`[screenshots] Local server running at http://127.0.0.1:${port}`);

  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();
  const url = `http://127.0.0.1:${port}/dashboard/index.html`;

  try {
    // Shot 1: Board Overview
    console.log('[screenshots] Navigating to board overview...');
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('table tbody tr');

    const shot1Path = join(shotsDir, '1-board.png');
    const outShot1Path = join(outShotsDir, '1-board.png');
    await page.screenshot({ path: shot1Path, fullPage: false });
    writeFileSync(outShot1Path, readFileSync(shot1Path));
    console.log(`[screenshots] Captured 1-board.png (${statSync(shot1Path).size} bytes)`);

    // Shot 2: Protocol Detail Modal
    console.log('[screenshots] Opening protocol detail modal...');
    await page.click('tbody tr:first-child');
    await page.waitForSelector('dialog.detail[open]');
    await page.waitForTimeout(300); // Allow smooth CSS fade-in

    const shot2Path = join(shotsDir, '2-detail.png');
    const outShot2Path = join(outShotsDir, '2-detail.png');
    await page.screenshot({ path: shot2Path, fullPage: false });
    writeFileSync(outShot2Path, readFileSync(shot2Path));
    console.log(`[screenshots] Captured 2-detail.png (${statSync(shot2Path).size} bytes)`);

    // Shot 3: Filtered Category View
    console.log('[screenshots] Applying sector filter...');
    await page.click('.close-btn');
    await page.waitForTimeout(200);

    // Click 'Risk Curators' chip
    const chipBtn = page.locator('.chip-btn:has-text("Risk Curators")').first();
    if (await chipBtn.isVisible()) {
      await chipBtn.click();
    } else {
      await page.goto(`${url}#category=Risk Curators`, { waitUntil: 'networkidle' });
    }
    await page.waitForTimeout(300);

    const shot3Path = join(shotsDir, '3-filtered.png');
    const outShot3Path = join(outShotsDir, '3-filtered.png');
    await page.screenshot({ path: shot3Path, fullPage: false });
    writeFileSync(outShot3Path, readFileSync(shot3Path));
    console.log(`[screenshots] Captured 3-filtered.png (${statSync(shot3Path).size} bytes)`);

  } finally {
    await browser.close();
    await server.close();
  }

  // 3. Rebuild dossier with fresh screenshots
  console.log('[screenshots] Rebuilding out/dossier.json with updated captures...');
  writeFileSync(
    join(outDir, 'dossier.json'),
    buildDossier(outDir, {
      text_max_bytes: 65536,
      screenshots: { max: 4, max_bytes: 524_288 },
      dashboard: { max_files: 400, max_bytes: 4_194_304 },
    }),
  );

  console.log('[screenshots] Pipeline complete: 3 screenshots captured and dossier refreshed.\n');
}

render().catch((err) => {
  console.error('[screenshots] Error during render:', err);
  process.exit(1);
});
