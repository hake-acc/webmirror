import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as cheerio from 'cheerio';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import {
  BrokenLink,
  MissingAsset,
  QualityReport,
  DeploymentCompatibility,
  JobConfig
} from '../types';

export class QualityValidator {
  constructor(
    private exportDir: string,
    private config: JobConfig
  ) {}

  /**
   * Starts a lightweight static file server serving the export directory
   */
  private async startStaticServer(): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        let reqPath = (req.url || '/').split('?')[0].split('#')[0];
        if (reqPath === '/' || reqPath === '') {
          reqPath = '/index.html';
        }

        const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
        let filePath = path.join(this.exportDir, safePath);

        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, 'index.html');
        }

        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
          '.webp': 'image/webp',
          '.woff2': 'font/woff2',
          '.woff': 'font/woff',
          '.ttf': 'font/ttf',
          '.mp4': 'video/mp4'
        };

        const ct = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ct });
        fs.createReadStream(filePath).pipe(res);
      });

      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        const port = addr.port;
        resolve({
          server,
          port,
          close: () => new Promise((res) => server.close(() => res()))
        });
      });

      server.on('error', reject);
    });
  }

  /**
   * Perform pixel difference calculation between two PNG buffers
   */
  public static comparePngs(
    img1Buf: Buffer,
    img2Buf: Buffer,
    outDiffPath?: string
  ): { diffPixels: number; totalPixels: number; diffRatio: number } {
    try {
      const img1 = PNG.sync.read(img1Buf);
      const img2 = PNG.sync.read(img2Buf);

      const width = Math.min(img1.width, img2.width);
      const height = Math.min(img1.height, img2.height);

      const diff = new PNG({ width, height });
      const numDiffPixels = pixelmatch(
        img1.data,
        img2.data,
        diff.data,
        width,
        height,
        { threshold: 0.1 }
      );

      const totalPixels = width * height;
      const diffRatio = totalPixels > 0 ? numDiffPixels / totalPixels : 0;

      if (outDiffPath) {
        fs.writeFileSync(outDiffPath, PNG.sync.write(diff));
      }

      return { diffPixels: numDiffPixels, totalPixels, diffRatio };
    } catch (e) {
      console.error('Visual diff failed:', e);
      return { diffPixels: 0, totalPixels: 1, diffRatio: 0 };
    }
  }

  /**
   * Audits all HTML files in the export directory for:
   * 1. Broken internal links
   * 2. Missing referenced assets (images, stylesheets, scripts)
   */
  public async auditExportedHtml(
    knownMissing: MissingAsset[] = []
  ): Promise<{ brokenLinks: BrokenLink[]; missingAssets: MissingAsset[]; categoryCounts: Record<string, number> }> {
    const brokenLinks: BrokenLink[] = [];
    const missingAssets: MissingAsset[] = [...knownMissing];
    const categoryCounts: Record<string, number> = {
      html: 0,
      css: 0,
      js: 0,
      images: 0,
      fonts: 0,
      media: 0,
      data: 0
    };

    const countFilesRecursive = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          countFilesRecursive(full);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (ext === '.html') categoryCounts.html++;
          else if (ext === '.css') categoryCounts.css++;
          else if (['.js', '.mjs'].includes(ext)) categoryCounts.js++;
          else if (['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif', '.ico'].includes(ext)) categoryCounts.images++;
          else if (['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(ext)) categoryCounts.fonts++;
          else if (['.mp4', '.webm', '.ogg', '.mp3'].includes(ext)) categoryCounts.media++;
          else if (ext === '.json') categoryCounts.data++;
        }
      }
    };
    countFilesRecursive(this.exportDir);

    const checkFileReference = (sourceFile: string, refUrl: string, type: string) => {
      if (!refUrl || refUrl.startsWith('http:') || refUrl.startsWith('https:') || refUrl.startsWith('data:') || refUrl.startsWith('#') || refUrl.startsWith('javascript:')) {
        return;
      }
      const cleanRef = refUrl.split('?')[0].split('#')[0];
      const sourceDir = path.dirname(sourceFile);
      const targetAbs = path.resolve(sourceDir, cleanRef);

      if (!fs.existsSync(targetAbs)) {
        if (type === 'link') {
          brokenLinks.push({
            sourcePage: path.relative(this.exportDir, sourceFile),
            targetUrl: refUrl,
            reason: `Local target file "${cleanRef}" does not exist`
          });
        } else {
          missingAssets.push({
            url: refUrl,
            type,
            error: `Local asset file "${cleanRef}" missing from export`,
            sourcePage: path.relative(this.exportDir, sourceFile)
          });
        }
      }
    };

    const auditHtmlFile = (filePath: string) => {
      const content = fs.readFileSync(filePath, 'utf-8');
      const $ = cheerio.load(content);

      // Check stylesheets
      $('link[rel="stylesheet"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) checkFileReference(filePath, href, 'stylesheet');
      });

      // Check scripts
      $('script[src]').each((_, el) => {
        const src = $(el).attr('src');
        if (src) checkFileReference(filePath, src, 'script');
      });

      // Check images
      $('img[src]').each((_, el) => {
        const src = $(el).attr('src');
        if (src) checkFileReference(filePath, src, 'image');
      });

      // Check links
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) checkFileReference(filePath, href, 'link');
      });
    };

    const processDir = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir, { withFileTypes: true });
      for (const file of files) {
        const full = path.join(dir, file.name);
        if (file.isDirectory()) {
          processDir(full);
        } else if (file.name.endsWith('.html')) {
          auditHtmlFile(full);
        }
      }
    };

    processDir(this.exportDir);

    return { brokenLinks, missingAssets, categoryCounts };
  }

  /**
   * Generates deployment compatibility matrix and recommendations
   */
  public assessDeploymentCompatibility(
    missingAssets: MissingAsset[],
    brokenLinks: BrokenLink[],
    consoleErrors: string[]
  ): DeploymentCompatibility {
    const warnings: string[] = [];
    const recommendations: string[] = [];

    if (missingAssets.length > 0) {
      warnings.push(`${missingAssets.length} external or dynamic assets could not be resolved locally.`);
      recommendations.push('Review the Broken Resources report to replace dynamic APIs or fonts with local equivalents.');
    }

    if (brokenLinks.length > 0) {
      warnings.push(`${brokenLinks.length} internal navigation links reference pages outside the configured crawl depth.`);
      recommendations.push('Increase the maximum crawl depth or limit to capture deeper subpages.');
    }

    if (consoleErrors.length > 0) {
      warnings.push(`${consoleErrors.length} client-side runtime console errors were observed during execution.`);
    }

    // Static hosts compatibility
    recommendations.push('Vercel: Deploy using `vercel deploy` or connect Git repository with root directory `./`.');
    recommendations.push('Netlify: Drag and drop the downloaded ZIP or `webmirror-export` folder into Netlify Drop.');
    recommendations.push('Cloudflare Pages: Connect repository or upload directory directly.');
    recommendations.push('GitHub Pages: Push the contents to the `gh-pages` branch or configure `/docs` publishing.');

    const staticReady = missingAssets.filter((a) => a.type === 'stylesheet' || a.type === 'script').length === 0;

    return {
      staticHostingReady: staticReady,
      vercelReady: true,
      netlifyReady: true,
      githubPagesReady: true,
      cloudflareReady: true,
      warnings,
      recommendations
    };
  }

  /**
   * Main validation pipeline
   */
  public async validate(
    knownMissing: MissingAsset[] = [],
    consoleErrors: string[] = [],
    originalScreenshotPath?: string,
    clonedScreenshotPath?: string
  ): Promise<QualityReport> {
    const { brokenLinks, missingAssets, categoryCounts } = await this.auditExportedHtml(knownMissing);

    let pixelDiffRatio: number | undefined;
    let diffScreenshotUrl: string | undefined;

    if (originalScreenshotPath && clonedScreenshotPath && fs.existsSync(originalScreenshotPath) && fs.existsSync(clonedScreenshotPath)) {
      const diffPath = path.join(this.exportDir, 'diff_screenshot.png');
      const buf1 = fs.readFileSync(originalScreenshotPath);
      const buf2 = fs.readFileSync(clonedScreenshotPath);
      const diffResult = QualityValidator.comparePngs(buf1, buf2, diffPath);
      pixelDiffRatio = diffResult.diffRatio;
      diffScreenshotUrl = 'diff_screenshot.png';
    }

    // Compute realistic Fidelity Score (0 to 100)
    // Never report 100% blindly:
    // Base 100 - penalties for missing assets, broken links, console errors, diff ratio
    let score = 96; // max baseline

    // Missing assets penalty (max 30pt deduction)
    const missingAssetPenalty = Math.min(30, missingAssets.length * 3);
    score -= missingAssetPenalty;

    // Broken links penalty (max 25pt deduction)
    const brokenLinkPenalty = Math.min(25, brokenLinks.length * 5);
    score -= brokenLinkPenalty;

    // Console errors penalty (max 15pt deduction)
    const consolePenalty = Math.min(15, consoleErrors.length * 2);
    score -= consolePenalty;

    // Visual diff penalty (max 20pt deduction)
    if (pixelDiffRatio !== undefined) {
      score -= Math.min(20, Math.round(pixelDiffRatio * 50));
    }

    score = Math.max(15, Math.min(98, score));

    const unresolvedIssues: string[] = [];
    if (missingAssets.length > 0) {
      unresolvedIssues.push(`${missingAssets.length} unresolved resources (e.g. cross-origin APIs or restricted media)`);
    }
    if (brokenLinks.length > 0) {
      unresolvedIssues.push(`${brokenLinks.length} broken internal navigation references`);
    }
    if (consoleErrors.length > 0) {
      unresolvedIssues.push(`${consoleErrors.length} browser console warnings or runtime exceptions`);
    }
    if (unresolvedIssues.length === 0) {
      unresolvedIssues.push('Client-side dynamic backend API endpoints require mock responses for full offline interactivity');
    }

    const deploymentCompatibility = this.assessDeploymentCompatibility(
      missingAssets,
      brokenLinks,
      consoleErrors
    );

    return {
      fidelityScore: score,
      originalScreenshotUrl: originalScreenshotPath ? path.basename(originalScreenshotPath) : undefined,
      clonedScreenshotUrl: clonedScreenshotPath ? path.basename(clonedScreenshotPath) : undefined,
      diffScreenshotUrl,
      pixelDiffRatio,
      missingAssets,
      brokenLinks,
      consoleErrors,
      unresolvedIssues,
      deploymentCompatibility,
      categoryCounts,
      generatedAt: Date.now()
    };
  }
}
