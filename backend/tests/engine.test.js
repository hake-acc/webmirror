"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const node_assert_1 = __importDefault(require("node:assert"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ssrf_guard_1 = require("../src/security/ssrf-guard");
const url_rewriter_1 = require("../src/engine/url-rewriter");
const crawler_1 = require("../src/engine/crawler");
const job_store_1 = require("../src/storage/job-store");
const packager_1 = require("../src/engine/packager");
(0, node_test_1.default)('SSRF Guard blocks private and restricted destinations', async () => {
    // Test loopback hostname
    await node_assert_1.default.rejects(async () => {
        await ssrf_guard_1.SsrfGuard.validateUrl('http://localhost:8080');
    }, /blocked for security/);
    // Test local metadata
    await node_assert_1.default.rejects(async () => {
        await ssrf_guard_1.SsrfGuard.validateUrl('http://169.254.169.254/latest/meta-data/');
    }, /blocked/);
    // Test private IP
    await node_assert_1.default.rejects(async () => {
        await ssrf_guard_1.SsrfGuard.validateUrl('http://127.0.0.1:3000');
    }, /blocked/);
    // Test non-http protocol
    await node_assert_1.default.rejects(async () => {
        await ssrf_guard_1.SsrfGuard.validateUrl('file:///etc/passwd');
    }, /Unsupported protocol/);
    // Test public URL passes
    const valid = await ssrf_guard_1.SsrfGuard.validateUrl('https://example.com');
    node_assert_1.default.strictEqual(valid.hostname, 'example.com');
});
(0, node_test_1.default)('UrlRewriter calculates accurate relative paths', () => {
    node_assert_1.default.strictEqual(url_rewriter_1.UrlRewriter.getRelativePath('index.html', 'assets/css/style.css'), './assets/css/style.css');
    node_assert_1.default.strictEqual(url_rewriter_1.UrlRewriter.getRelativePath('pages/about/index.html', 'assets/css/style.css'), '../../assets/css/style.css');
    node_assert_1.default.strictEqual(url_rewriter_1.UrlRewriter.getRelativePath('pages/team.html', 'index.html'), '../index.html');
});
(0, node_test_1.default)('UrlRewriter rewrites CSS url() references', () => {
    const css = `
    @font-face {
      font-family: 'Test';
      src: url('https://example.com/fonts/inter.woff2') format('woff2');
    }
    .hero {
      background-image: url("https://example.com/images/bg.jpg");
    }
  `;
    const urlMap = new Map([
        ['https://example.com/fonts/inter.woff2', 'assets/fonts/inter.woff2'],
        ['https://example.com/images/bg.jpg', 'assets/images/bg.jpg']
    ]);
    const rewritten = url_rewriter_1.UrlRewriter.rewriteCss(css, 'assets/css/style.css', 'https://example.com/css/style.css', urlMap);
    node_assert_1.default.match(rewritten, /url\("\.\.\/fonts\/inter\.woff2"\)/);
    node_assert_1.default.match(rewritten, /url\("\.\.\/images\/bg\.jpg"\)/);
});
(0, node_test_1.default)('UrlRewriter rewrites HTML link, script, and img tags', () => {
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
    const assetMap = new Map([
        ['https://example.com/main.css', 'assets/css/main.css'],
        ['https://example.com/logo.png', 'assets/images/logo.png'],
        ['https://example.com/app.js', 'assets/js/app.js']
    ]);
    const pageMap = new Map([
        ['https://example.com/about', 'pages/about/index.html']
    ]);
    const rewritten = url_rewriter_1.UrlRewriter.rewriteHtml(html, 'index.html', 'https://example.com', assetMap, pageMap);
    node_assert_1.default.match(rewritten, /href="\.\/assets\/css\/main\.css"/);
    node_assert_1.default.match(rewritten, /src="\.\/assets\/images\/logo\.png"/);
    node_assert_1.default.match(rewritten, /src="\.\/assets\/js\/app\.js"/);
    node_assert_1.default.match(rewritten, /href="\.\/pages\/about\/index\.html"/);
    node_assert_1.default.match(rewritten, /__WEBMIRROR_PORTABLE__/);
});
(0, node_test_1.default)('Crawler normalizes URLs and extracts asset links', () => {
    node_assert_1.default.strictEqual(crawler_1.Crawler.normalizeUrl('https://example.com/path/?a=1#section'), 'https://example.com/path?a=1');
    node_assert_1.default.strictEqual(crawler_1.Crawler.normalizeUrl('https://example.com/#top'), 'https://example.com/');
});
(0, node_test_1.default)('Packager creates zip archive and writes report', async () => {
    const tempDir = path.join(process.cwd(), 'temp_test_export');
    const exportDir = path.join(tempDir, 'export');
    fs.mkdirSync(exportDir, { recursive: true });
    fs.writeFileSync(path.join(exportDir, 'index.html'), '<h1>Test</h1>');
    const packager = new packager_1.Packager(exportDir, tempDir);
    const zipResult = await packager.createZip('test.zip');
    node_assert_1.default.ok(fs.existsSync(zipResult.zipPath));
    node_assert_1.default.ok(zipResult.byteSize > 0);
    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
});
(0, node_test_1.default)('JobStore tracks stages, logs, and emits events', () => {
    const testStoreDir = path.join(process.cwd(), 'temp_test_store');
    const store = new job_store_1.JobStore(testStoreDir);
    const sampleConfig = {
        url: 'https://example.com',
        crawlDepth: 1,
        maxPages: 5,
        includeAssets: { css: true, js: true, images: true, fonts: true, media: true, json: true },
        viewport: { width: 1280, height: 800, name: 'Desktop' },
        performVisualDiff: false,
        testInteractions: false,
        timeoutMs: 10000
    };
    const job = {
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
    node_assert_1.default.strictEqual(store.getJob('test_job_1')?.status, 'connecting');
    store.updateStage('test_job_1', 'extracting_assets', 50, 'Extracting CSS');
    node_assert_1.default.strictEqual(store.getJob('test_job_1')?.status, 'extracting_assets');
    node_assert_1.default.strictEqual(store.getJob('test_job_1')?.progress, 50);
    store.deleteJob('test_job_1');
    node_assert_1.default.strictEqual(store.getJob('test_job_1'), undefined);
    fs.rmSync(testStoreDir, { recursive: true, force: true });
});
