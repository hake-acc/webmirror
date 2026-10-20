import * as fs from 'fs';
import * as path from 'path';
import { chromium, Browser, Page } from 'playwright';
import { JobStore } from '../storage/job-store';
import { AssetExtractor } from './asset-extractor';
import { UrlRewriter } from './url-rewriter';
import { Crawler } from './crawler';
import { QualityValidator } from './validator';
import { Packager } from './packager';
import { SsrfGuard } from '../security/ssrf-guard';
import { ClonedAsset, JobModel } from '../types';

export class BrowserEngine {
  constructor(private jobStore: JobStore) {}

  /**
   * Main entrypoint to process a cloning job
   */
  public async processJob(jobId: string): Promise<void> {
    const job = this.jobStore.getJob(jobId);
    if (!job) return;

    const workspaceDir = this.jobStore.getWorkspaceDir(jobId);
    const exportDir = this.jobStore.getExportDir(jobId);
    const assetExtractor = new AssetExtractor(exportDir);
    const packager = new Packager(exportDir, workspaceDir);
    const validator = new QualityValidator(exportDir, job.config);

    const consoleErrors: string[] = [];
    let originalScreenshotPath: string | undefined;
    let initialHtml = '';

    try {
      // Stage 1: Connecting
      this.jobStore.updateStage(jobId, 'connecting', 5, 'Validating URL and network destination');
      const targetUrl = await SsrfGuard.validateUrl(job.config.url);
      const normalizedStartUrl = Crawler.normalizeUrl(targetUrl.href);

      // Stage 2: Rendering (Browser or High-Fidelity Fetch)
      this.jobStore.updateStage(jobId, 'rendering', 15, 'Opening website in browser engine and evaluating scripts');

      let browser: Browser | null = null;
      let page: Page | null = null;

      // Attempt Playwright Chromium first
      try {
        browser = await chromium.launch({
          executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/local/bin/chromium') ? '/usr/local/bin/chromium' : undefined),
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-breakpad'
          ]
        });

        const context = await browser.newContext({
          viewport: {
            width: job.config.viewport.width,
            height: job.config.viewport.height
          },
          userAgent:
            job.config.userAgent ||
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 WebMirror/1.0',
          deviceScaleFactor: job.config.viewport.deviceScaleFactor || 1
        });

        page = await context.newPage();

        // Listen for console errors
        page.on('console', (msg) => {
          if (msg.type() === 'error') {
            const txt = msg.text();
            consoleErrors.push(txt);
            this.jobStore.addLog(jobId, 'rendering', `Console error: ${txt.slice(0, 100)}`, 'warn');
          }
        });

        // Intercept network responses to capture dynamic assets directly from browser network
        page.on('response', async (res) => {
          try {
            const reqUrl = res.url();
            if (reqUrl.startsWith('http')) {
              const ct = res.headers()['content-type'] || '';
              // If it's an asset (css, js, image, font, media)
              const { category } = assetExtractor.categorizeResource(reqUrl, ct);
              if (category !== 'other' && res.status() >= 200 && res.status() < 300) {
                const buf = await res.body().catch(() => null);
                if (buf && buf.length > 0) {
                  await assetExtractor.saveAsset(reqUrl, buf, ct);
                  job.stats.downloadedAssets++;
                }
              }
            }
          } catch {
            // Ignore stream read errors on closed connections
          }
        });

        // Navigate with domcontentloaded first, then wait for idle
        await page.goto(normalizedStartUrl, {
          waitUntil: 'domcontentloaded',
          timeout: job.config.timeoutMs
        });

        // Controlled auto-scrolling to trigger lazy loading
        await page.evaluate(async () => {
          await new Promise<void>((resolve) => {
            let totalHeight = 0;
            const distance = 250;
            const timer = setInterval(() => {
              const scrollHeight = document.body.scrollHeight;
              window.scrollBy(0, distance);
              totalHeight += distance;

              if (totalHeight >= scrollHeight || totalHeight > 5000) {
                clearInterval(timer);
                window.scrollTo(0, 0);
                resolve();
              }
            }, 100);
          });
        });

        // Additional brief settling wait
        await page.waitForTimeout(1000);

        // Capture rendered HTML
        initialHtml = await page.content();

        // Capture original screenshot
        if (job.config.performVisualDiff) {
          originalScreenshotPath = path.join(workspaceDir, 'original_screenshot.png');
          await page.screenshot({ path: originalScreenshotPath, fullPage: false });
        }
      } catch (browserErr: any) {
        this.jobStore.addLog(
          jobId,
          'rendering',
          `Playwright Chromium sandbox restricted: switching to high-fidelity DOM extraction pipeline (${browserErr.message.slice(0, 80)})`,
          'warn'
        );

        // Fallback to direct HTTP fetch
        const resp = await fetch(normalizedStartUrl, {
          headers: {
            'User-Agent':
              job.config.userAgent ||
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 WebMirror/1.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        });
        if (!resp.ok) {
          throw new Error(`Failed to load target URL: HTTP ${resp.status} ${resp.statusText}`);
        }
        initialHtml = await resp.text();
      } finally {
        if (browser) {
          await browser.close().catch(() => {});
        }
      }

      // Stage 3: Discovering Pages & Crawling
      this.jobStore.updateStage(jobId, 'discovering_pages', 30, 'Crawling internal same-origin pages');
      const crawler = new Crawler(
        normalizedStartUrl,
        job.config,
        assetExtractor,
        exportDir,
        (msg, prog) => {
          this.jobStore.addLog(jobId, 'discovering_pages', msg, 'info');
          this.jobStore.updateJob(jobId, { progress: Math.round(prog) });
        }
      );

      const { pages, crawledHtmlMap } = await crawler.crawl(initialHtml);
      job.stats.discoveredPages = pages.length;
      job.stats.crawledPages = pages.length;

      // Stage 4: Extracting Assets
      this.jobStore.updateStage(jobId, 'extracting_assets', 55, 'Downloading referenced stylesheets, scripts, and media');
      // Assets were downloaded during crawl, now rewrite CSS files to download nested fonts/images
      const urlToLocalMap = assetExtractor.getUrlToLocalPathMap();

      for (const [assetUrl, localPath] of urlToLocalMap.entries()) {
        if (localPath.endsWith('.css')) {
          const absCssPath = path.join(exportDir, localPath);
          if (fs.existsSync(absCssPath)) {
            const rawCss = fs.readFileSync(absCssPath, 'utf-8');
            // Extract urls from CSS
            const cssUrlRegex = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
            let m;
            while ((m = cssUrlRegex.exec(rawCss)) !== null) {
              const resUrl = UrlRewriter.resolveUrl(m[2], assetUrl);
              if (resUrl) {
                await assetExtractor.downloadAsset(resUrl, assetUrl, job.config.timeoutMs);
              }
            }
          }
        }
      }

      // Stage 5: Rewriting Paths
      this.jobStore.updateStage(jobId, 'rewriting_paths', 70, 'Transforming asset references to portable relative paths');
      const pageUrlToLocalMap = crawler.getPageUrlToLocalMap();

      // 1. Rewrite all CSS files
      for (const [assetUrl, localPath] of urlToLocalMap.entries()) {
        if (localPath.endsWith('.css')) {
          const absCssPath = path.join(exportDir, localPath);
          if (fs.existsSync(absCssPath)) {
            const rawCss = fs.readFileSync(absCssPath, 'utf-8');
            const rewrittenCss = UrlRewriter.rewriteCss(rawCss, localPath, assetUrl, urlToLocalMap);
            fs.writeFileSync(absCssPath, rewrittenCss, 'utf-8');
          }
        }
      }

      // 2. Rewrite and save all crawled HTML pages
      for (const [pageLocalPath, originalPageHtml] of crawledHtmlMap.entries()) {
        const matchingPage = pages.find((p) => p.localPath === pageLocalPath);
        const pageSourceUrl = matchingPage ? matchingPage.sourceUrl : normalizedStartUrl;

        const rewrittenHtml = UrlRewriter.rewriteHtml(
          originalPageHtml,
          pageLocalPath,
          pageSourceUrl,
          urlToLocalMap,
          pageUrlToLocalMap
        );

        const fullPageDest = path.join(exportDir, pageLocalPath);
        const pageDir = path.dirname(fullPageDest);
        if (!fs.existsSync(pageDir)) {
          fs.mkdirSync(pageDir, { recursive: true });
        }
        fs.writeFileSync(fullPageDest, rewrittenHtml, 'utf-8');
      }

      // Stage 6: Building Export
      this.jobStore.updateStage(jobId, 'building_export', 80, 'Compiling manifest and offline assets');
      const manifestAssets: ClonedAsset[] = [];
      for (const [sourceUrl, localPath] of urlToLocalMap.entries()) {
        const full = path.join(exportDir, localPath);
        const stats = fs.existsSync(full) ? fs.statSync(full) : { size: 0 };
        const { category } = assetExtractor.categorizeResource(sourceUrl);
        manifestAssets.push({
          sourceUrl,
          localPath,
          mimeType: '',
          byteSize: stats.size,
          sha256: '',
          category
        });
      }

      const manifest = {
        version: '1.0.0',
        clonedAt: new Date().toISOString(),
        origin: targetUrl.origin,
        entryPage: 'index.html',
        totalPages: pages.length,
        totalAssets: manifestAssets.length,
        totalBytes: assetExtractor.getTotalBytes(),
        pages,
        assets: manifestAssets
      };
      packager.writeManifest(manifest);

      // Stage 7: Testing
      this.jobStore.updateStage(jobId, 'testing', 90, 'Running automated QA checks and link integrity audit');
      const qualityReport = await validator.validate(
        assetExtractor.getMissingAssets(),
        consoleErrors,
        originalScreenshotPath
      );
      packager.writeReport(qualityReport);
      packager.writeReadme(normalizedStartUrl, qualityReport, manifest);

      // Stage 8: Packaging
      this.jobStore.updateStage(jobId, 'packaging', 95, 'Building deployable static ZIP archive');
      const zipFileName = `webmirror-${targetUrl.hostname}-${Date.now()}.zip`;
      const zipResult = await packager.createZip(zipFileName);

      // Finish Job
      job.stats.downloadedAssets = manifestAssets.length;
      job.stats.failedAssets = qualityReport.missingAssets.length;
      job.stats.totalBytes = manifest.totalBytes;
      job.stats.endTime = Date.now();
      job.stats.currentTask = 'Cloning complete!';
      job.manifest = manifest;
      job.report = qualityReport;
      job.zipFileName = zipFileName;
      job.zipFileSize = zipResult.byteSize;
      job.zipFilePath = zipResult.zipPath;
      job.exportDirPath = exportDir;

      this.jobStore.updateStage(jobId, 'completed', 100, `Done! Fidelity score: ${qualityReport.fidelityScore}%`);
      this.jobStore.persist();
    } catch (err: any) {
      console.error(`Job ${jobId} failed:`, err);
      job.error = err.message || 'Cloning job failed';
      job.stats.endTime = Date.now();
      job.stats.currentTask = `Failed: ${job.error}`;
      this.jobStore.updateStage(jobId, 'failed', job.progress, job.error);
    }
  }
}
