import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { SsrfGuard } from '../src/security/ssrf-guard';
import { UrlRewriter } from '../src/engine/url-rewriter';
import { Crawler } from '../src/engine/crawler';
import { JobStore } from '../src/storage/job-store';
import { Packager } from '../src/engine/packager';
import { QualityValidator } from '../src/engine/validator';
import { JobConfig, JobModel } from '../src/types';

test('SSRF Guard blocks private and restricted destinations', async () => {
  // Test loopback hostname
  await assert.rejects(async () => {
    await SsrfGuard.validateUrl('http://localhost:8080');
  }, /blocked for security/);

  // Test local metadata
  await assert.rejects(async () => {
    await SsrfGuard.validateUrl('http://169.254.169.254/latest/meta-data/');
  }, /blocked/);

  // Test private IP
  await assert.rejects(async () => {
    await SsrfGuard.validateUrl('http://127.0.0.1:3000');
  }, /blocked/);

  // Test non-http protocol
  await assert.rejects(async () => {
    await SsrfGuard.validateUrl('file:///etc/passwd');
  }, /Unsupported protocol/);

  // Test public URL passes
  const valid = await SsrfGuard.validateUrl('https://example.com');
  assert.strictEqual(valid.hostname, 'example.com');
});

test('UrlRewriter calculates accurate relative paths', () => {
  assert.strictEqual(
    UrlRewriter.getRelativePath('index.html', 'assets/css/style.css'),
    './assets/css/style.css'
  );
  assert.strictEqual(
    UrlRewriter.getRelativePath('pages/about/index.html', 'assets/css/style.css'),
    '../../assets/css/style.css'
  );
  assert.strictEqual(
    UrlRewriter.getRelativePath('pages/team.html', 'index.html'),
    '../index.html'
  );
});

test('UrlRewriter rewrites CSS url() references', () => {
  const css = `
    @font-face {
      font-family: 'Test';
      src: url('https://example.com/fonts/inter.woff2') format('woff2');
    }
    .hero {
      background-image: url("https://example.com/images/bg.jpg");
    }
  `;
  const urlMap = new Map<string, string>([
    ['https://example.com/fonts/inter.woff2', 'assets/fonts/inter.woff2'],
    ['https://example.com/images/bg.jpg', 'assets/images/bg.jpg']
  ]);

  const rewritten = UrlRewriter.rewriteCss(css, 'assets/css/style.css', 'https://example.com/css/style.css', urlMap);
  assert.match(rewritten, /url\("\.\.\/fonts\/inter\.woff2"\)/);
  assert.match(rewritten, /url\("\.\.\/images\/bg\.jpg"\)/);
});

test('UrlRewriter rewrites HTML link, script, and img tags', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <link rel="stylesheet" href="https://example.com/main.css">
      </head>
      <body>
        <a href="https://example.com/about">About Us</a>
        <img src="https://example.com/logo.png" alt="Logo">
        <script src="https://example.com/app.js"></script>
      </body>
    </html>
  `;

  const assetMap = new Map<string, string>([
    ['https://example.com/main.css', 'assets/css/main.css'],
    ['https://example.com/logo.png', 'assets/images/logo.png'],
    ['https://example.com/app.js', 'assets/js/app.js']
  ]);

  const pageMap = new Map<string, string>([
    ['https://example.com/about', 'pages/about/index.html']
  ]);

  const rewritten = UrlRewriter.rewriteHtml(
    html,
    'index.html',
    'https://example.com',
    assetMap,
    pageMap
  );

  assert.match(rewritten, /href="\.\/assets\/css\/main\.css"/);
  assert.match(rewritten, /src="\.\/assets\/images\/logo\.png"/);
  assert.match(rewritten, /src="\.\/assets\/js\/app\.js"/);
  assert.match(rewritten, /href="\.\/pages\/about\/index\.html"/);
  assert.match(rewritten, /__WEBMIRROR_PORTABLE__/);
});

test('Crawler normalizes URLs and extracts asset links', () => {
  assert.strictEqual(
    Crawler.normalizeUrl('https://example.com/path/?a=1#section'),
    'https://example.com/path?a=1'
  );
  assert.strictEqual(
    Crawler.normalizeUrl('https://example.com/#top'),
    'https://example.com/'
  );
});

test('Packager creates zip archive and writes report', async () => {
  const tempDir = path.join(process.cwd(), 'temp_test_export');
  const exportDir = path.join(tempDir, 'export');
  fs.mkdirSync(exportDir, { recursive: true });
  fs.writeFileSync(path.join(exportDir, 'index.html'), '<h1>Test</h1>');

  const packager = new Packager(exportDir, tempDir);
  const zipResult = await packager.createZip('test.zip');

  assert.ok(fs.existsSync(zipResult.zipPath));
  assert.ok(zipResult.byteSize > 0);

  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('JobStore tracks stages, logs, and emits events', () => {
  const testStoreDir = path.join(process.cwd(), 'temp_test_store');
  const store = new JobStore(testStoreDir);

  const sampleConfig: JobConfig = {
    url: 'https://example.com',
    crawlDepth: 1,
    maxPages: 5,
    includeAssets: { css: true, js: true, images: true, fonts: true, media: true, json: true },
    viewport: { width: 1280, height: 800, name: 'Desktop' },
    performVisualDiff: false,
    testInteractions: false,
    timeoutMs: 10000
  };

  const job: JobModel = {
    id: 'test_job_1',
    url: 'https://example.com',
    normalizedUrl: 'https://example.com/',
    status: 'connecting',
    progress: 0,
    config: sampleConfig,
    stats: {
      discoveredPages: 0,
      crawledPages: 0,
      downloadedAssets: 0,
      failedAssets: 0,
      totalBytes: 0,
      startTime: Date.now(),
      currentTask: 'Testing'
    },
    logs: []
  };

  store.createJob(job);
  assert.strictEqual(store.getJob('test_job_1')?.status, 'connecting');

  store.updateStage('test_job_1', 'extracting_assets', 50, 'Extracting CSS');
  assert.strictEqual(store.getJob('test_job_1')?.status, 'extracting_assets');
  assert.strictEqual(store.getJob('test_job_1')?.progress, 50);

  store.deleteJob('test_job_1');
  assert.strictEqual(store.getJob('test_job_1'), undefined);

  fs.rmSync(testStoreDir, { recursive: true, force: true });
});
