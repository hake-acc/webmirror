import * as cheerio from 'cheerio';
import * as path from 'path';
import * as fs from 'fs';
import { AssetExtractor } from './asset-extractor';
import { UrlRewriter } from './url-rewriter';
import { SsrfGuard } from '../security/ssrf-guard';
import { ClonedPage, JobConfig } from '../types';

export class Crawler {
  private visitedPages = new Set<string>();
  private pageQueue: Array<{ url: string; depth: number }> = [];
  private pageUrlToLocalMap = new Map<string, string>(); // url -> localPath
  private pages: ClonedPage[] = [];
  private origin: string;
  private allowedOrigins: Set<string>;

  constructor(
    private startUrl: string,
    private config: JobConfig,
    private assetExtractor: AssetExtractor,
    private exportDir: string,
    private onProgress?: (msg: string, progress: number) => void
  ) {
    const parsed = new URL(startUrl);
    this.origin = parsed.origin;
    this.allowedOrigins = new Set([this.origin]);
  }

  public getPageUrlToLocalMap(): Map<string, string> {
    return this.pageUrlToLocalMap;
  }

  public getPages(): ClonedPage[] {
    return this.pages;
  }

  public static normalizeUrl(urlStr: string): string {
    try {
      const u = new URL(urlStr);
      u.hash = ''; // Remove fragment
      // Remove trailing slash for root normalization consistency except pure origin
      let norm = u.origin + u.pathname;
      if (norm.endsWith('/') && norm.length > u.origin.length + 1) {
        norm = norm.slice(0, -1);
      }
      if (u.search) {
        norm += u.search;
      }
      return norm;
    } catch {
      return urlStr;
    }
  }

  private getLocalPathForPage(pageUrl: string, isEntry: boolean): string {
    if (isEntry) {
      return 'index.html';
    }

    try {
      const u = new URL(pageUrl);
      let p = u.pathname.replace(/^\/+/, '');
      if (!p) return 'index.html';

      // Remove extensions if .html, or sanitize
      if (p.endsWith('.html') || p.endsWith('.htm')) {
        return `pages/${p}`;
      }

      // Convert folder path e.g. "about/team" -> "pages/about/team/index.html"
      return `pages/${p}/index.html`;
    } catch {
      const safe = pageUrl.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
      return `pages/${safe}.html`;
    }
  }

  /**
   * Discovers all asset URLs mentioned in an HTML string
   */
  public extractAssetUrlsFromHtml(html: string, pageUrl: string): string[] {
    const $ = cheerio.load(html);
    const assetUrls = new Set<string>();

    // 1. Stylesheets & icons
    $('link[href]').each((_, el) => {
      const href = $(el).attr('href');
      const rel = $(el).attr('rel') || '';
      if (href) {
        const resolved = UrlRewriter.resolveUrl(href, pageUrl);
        if (resolved) assetUrls.add(resolved);
      }
    });

    // 2. Scripts
    $('script[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (src) {
        const resolved = UrlRewriter.resolveUrl(src, pageUrl);
        if (resolved) assetUrls.add(resolved);
      }
    });

    // 3. Images and responsive images
    $('img').each((_, el) => {
      const src = $(el).attr('src');
      if (src) {
        const resolved = UrlRewriter.resolveUrl(src, pageUrl);
        if (resolved) assetUrls.add(resolved);
      }
      const srcset = $(el).attr('srcset');
      if (srcset) {
        srcset.split(',').forEach((part) => {
          const item = part.trim().split(/\s+/)[0];
          const resolved = UrlRewriter.resolveUrl(item, pageUrl);
          if (resolved) assetUrls.add(resolved);
        });
      }
    });

    // 4. Source & Picture
    $('source').each((_, el) => {
      const src = $(el).attr('src');
      if (src) {
        const resolved = UrlRewriter.resolveUrl(src, pageUrl);
        if (resolved) assetUrls.add(resolved);
      }
      const srcset = $(el).attr('srcset');
      if (srcset) {
        srcset.split(',').forEach((part) => {
          const item = part.trim().split(/\s+/)[0];
          const resolved = UrlRewriter.resolveUrl(item, pageUrl);
          if (resolved) assetUrls.add(resolved);
        });
      }
    });

    // 5. Video & Audio & Posters
    $('video, audio').each((_, el) => {
      const src = $(el).attr('src');
      if (src) {
        const resolved = UrlRewriter.resolveUrl(src, pageUrl);
        if (resolved) assetUrls.add(resolved);
      }
      const poster = $(el).attr('poster');
      if (poster) {
        const resolved = UrlRewriter.resolveUrl(poster, pageUrl);
        if (resolved) assetUrls.add(resolved);
      }
    });

    // 6. Inline CSS style="background: url(...)" and <style>
    const styleUrlRegex = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
    $('[style]').each((_, el) => {
      const style = $(el).attr('style') || '';
      let match;
      while ((match = styleUrlRegex.exec(style)) !== null) {
        const resolved = UrlRewriter.resolveUrl(match[2], pageUrl);
        if (resolved) assetUrls.add(resolved);
      }
    });

    $('style').each((_, el) => {
      const style = $(el).html() || '';
      let match;
      while ((match = styleUrlRegex.exec(style)) !== null) {
        const resolved = UrlRewriter.resolveUrl(match[2], pageUrl);
        if (resolved) assetUrls.add(resolved);
      }
    });

    return Array.from(assetUrls);
  }

  /**
   * Discovers same-origin internal hyperlinks from an HTML page
   */
  public extractInternalLinks(html: string, pageUrl: string): string[] {
    const $ = cheerio.load(html);
    const links = new Set<string>();

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        const resolved = UrlRewriter.resolveUrl(href, pageUrl);
        if (resolved) {
          try {
            const parsed = new URL(resolved);
            // Must match same origin
            if (parsed.origin === this.origin) {
              const norm = Crawler.normalizeUrl(resolved);
              links.add(norm);
            }
          } catch {
            // Ignore malformed links
          }
        }
      }
    });

    return Array.from(links);
  }

  /**
   * Main crawl loop
   */
  public async crawl(initialHtml?: string): Promise<{
    pages: ClonedPage[];
    crawledHtmlMap: Map<string, string>; // localPath -> originalHtml
  }> {
    const startNormalized = Crawler.normalizeUrl(this.startUrl);
    this.pageQueue.push({ url: startNormalized, depth: 0 });
    this.pageUrlToLocalMap.set(startNormalized, 'index.html');

    const crawledHtmlMap = new Map<string, string>();

    while (this.pageQueue.length > 0 && this.visitedPages.size < this.config.maxPages) {
      const current = this.pageQueue.shift()!;
      if (this.visitedPages.has(current.url)) continue;

      this.visitedPages.add(current.url);
      const isEntry = current.url === startNormalized;
      const localPath = this.getLocalPathForPage(current.url, isEntry);
      this.pageUrlToLocalMap.set(current.url, localPath);

      if (this.onProgress) {
        this.onProgress(`Crawling [${this.visitedPages.size}/${this.config.maxPages}]: ${current.url}`, 25 + (this.visitedPages.size / this.config.maxPages) * 20);
      }

      let html = '';
      if (isEntry && initialHtml) {
        html = initialHtml;
      } else {
        try {
          // SSRF validation
          await SsrfGuard.validateUrl(current.url, this.allowedOrigins);

          const resp = await fetch(current.url, {
            headers: {
              'User-Agent':
                this.config.userAgent ||
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 WebMirror/1.0',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
          });

          if (!resp.ok) continue;
          html = await resp.text();
        } catch (e) {
          console.error(`Failed to fetch page ${current.url}:`, e);
          continue;
        }
      }

      crawledHtmlMap.set(localPath, html);

      const pageTitle = (cheerio.load(html)('title').text() || 'Untitled').trim();
      this.pages.push({
        sourceUrl: current.url,
        localPath,
        title: pageTitle,
        byteSize: Buffer.byteLength(html, 'utf-8'),
        depth: current.depth
      });

      // 1. Extract and download all assets on this page
      const assetUrls = this.extractAssetUrlsFromHtml(html, current.url);
      for (const assetUrl of assetUrls) {
        await this.assetExtractor.downloadAsset(assetUrl, current.url, this.config.timeoutMs);
      }

      // 2. Discover new internal links if below max depth
      if (current.depth < this.config.crawlDepth && this.visitedPages.size + this.pageQueue.length < this.config.maxPages) {
        const internalLinks = this.extractInternalLinks(html, current.url);
        for (const link of internalLinks) {
          if (!this.visitedPages.has(link) && !this.pageQueue.some((q) => q.url === link)) {
            const nextDepth = current.depth + 1;
            const nextLocal = this.getLocalPathForPage(link, false);
            this.pageUrlToLocalMap.set(link, nextLocal);
            this.pageQueue.push({ url: link, depth: nextDepth });
          }
        }
      }
    }

    return { pages: this.pages, crawledHtmlMap };
  }
}
