import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ClonedAsset, MissingAsset } from '../types';

export class AssetExtractor {
  private downloadedHashes: Map<string, string> = new Map(); // sha256 -> relative localPath
  private urlToLocalPath: Map<string, string> = new Map(); // absolute normalized URL -> relative localPath
  private missingAssets: MissingAsset[] = [];
  private totalBytesDownloaded = 0;

  constructor(private exportDir: string) {
    this.ensureDirectoryStructure();
  }

  private ensureDirectoryStructure(): void {
    const subdirs = [
      'assets/css',
      'assets/js',
      'assets/images',
      'assets/fonts',
      'assets/media',
      'assets/data',
      'pages'
    ];
    for (const sub of subdirs) {
      const full = path.join(this.exportDir, sub);
      if (!fs.existsSync(full)) {
        fs.mkdirSync(full, { recursive: true });
      }
    }
  }

  public getUrlToLocalPathMap(): Map<string, string> {
    return this.urlToLocalPath;
  }

  public getMissingAssets(): MissingAsset[] {
    return this.missingAssets;
  }

  public getTotalBytes(): number {
    return this.totalBytesDownloaded;
  }

  /**
   * Determine category and target directory based on content type and URL extension
   */
  public categorizeResource(url: string, contentType = ''): {
    category: 'css' | 'js' | 'images' | 'fonts' | 'media' | 'data' | 'other';
    subDir: string;
    ext: string;
  } {
    const cleanUrl = url.split('?')[0].split('#')[0];
    const rawExt = path.extname(cleanUrl).toLowerCase();
    const ct = contentType.toLowerCase();

    if (ct.includes('text/css') || rawExt === '.css') {
      return { category: 'css', subDir: 'assets/css', ext: '.css' };
    }
    if (ct.includes('javascript') || ct.includes('ecmascript') || rawExt === '.js' || rawExt === '.mjs') {
      return { category: 'js', subDir: 'assets/js', ext: rawExt || '.js' };
    }
    if (
      ct.includes('image/') ||
      ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.ico', '.bmp'].includes(rawExt)
    ) {
      let ext = rawExt;
      if (!ext) {
        if (ct.includes('png')) ext = '.png';
        else if (ct.includes('jpeg') || ct.includes('jpg')) ext = '.jpg';
        else if (ct.includes('svg')) ext = '.svg';
        else if (ct.includes('webp')) ext = '.webp';
        else if (ct.includes('gif')) ext = '.gif';
        else ext = '.png';
      }
      return { category: 'images', subDir: 'assets/images', ext };
    }
    if (
      ct.includes('font') ||
      ct.includes('woff') ||
      ['.woff2', '.woff', '.ttf', '.otf', '.eot'].includes(rawExt)
    ) {
      let ext = rawExt;
      if (!ext) {
        if (ct.includes('woff2')) ext = '.woff2';
        else if (ct.includes('woff')) ext = '.woff';
        else if (ct.includes('ttf')) ext = '.ttf';
        else ext = '.woff2';
      }
      return { category: 'fonts', subDir: 'assets/fonts', ext };
    }
    if (
      ct.includes('video/') ||
      ct.includes('audio/') ||
      ['.mp4', '.webm', '.ogg', '.mp3', '.wav', '.mov'].includes(rawExt)
    ) {
      return { category: 'media', subDir: 'assets/media', ext: rawExt || '.mp4' };
    }
    if (ct.includes('application/json') || rawExt === '.json') {
      return { category: 'data', subDir: 'assets/data', ext: '.json' };
    }

    return { category: 'other', subDir: 'assets/other', ext: rawExt || '.bin' };
  }

  /**
   * Save buffer to local assets directory with deduplication
   */
  public async saveAsset(
    sourceUrl: string,
    buffer: Buffer,
    contentType = ''
  ): Promise<ClonedAsset> {
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const { category, subDir, ext } = this.categorizeResource(sourceUrl, contentType);

    // If duplicate content exists, reuse existing file
    if (this.downloadedHashes.has(sha256)) {
      const existingRelPath = this.downloadedHashes.get(sha256)!;
      this.urlToLocalPath.set(sourceUrl, existingRelPath);
      return {
        sourceUrl,
        localPath: existingRelPath,
        mimeType: contentType || 'application/octet-stream',
        byteSize: buffer.length,
        sha256,
        category
      };
    }

    // Generate safe filename from url or hash
    const cleanUrl = sourceUrl.split('?')[0].split('#')[0];
    const baseName = path.basename(cleanUrl, path.extname(cleanUrl)).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
    const fileName = `${baseName || 'asset'}_${sha256.slice(0, 8)}${ext}`;
    const relPath = `${subDir}/${fileName}`;
    const fullPath = path.join(this.exportDir, relPath);

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, buffer);
    this.totalBytesDownloaded += buffer.length;
    this.downloadedHashes.set(sha256, relPath);
    this.urlToLocalPath.set(sourceUrl, relPath);

    return {
      sourceUrl,
      localPath: relPath,
      mimeType: contentType || 'application/octet-stream',
      byteSize: buffer.length,
      sha256,
      category
    };
  }

  /**
   * Fetch asset directly over HTTP(S) with timeouts and error recording
   */
  public async downloadAsset(
    sourceUrl: string,
    sourcePage?: string,
    timeoutMs = 15000
  ): Promise<ClonedAsset | null> {
    if (this.urlToLocalPath.has(sourceUrl)) {
      const localPath = this.urlToLocalPath.get(sourceUrl)!;
      return {
        sourceUrl,
        localPath,
        mimeType: '',
        byteSize: 0,
        sha256: '',
        category: 'other'
      };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(sourceUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 WebMirror/1.0',
          'Accept': '*/*'
        }
      });
      clearTimeout(timer);

      if (!resp.ok) {
        this.missingAssets.push({
          url: sourceUrl,
          type: resp.headers.get('content-type') || 'unknown',
          statusCode: resp.status,
          error: `HTTP ${resp.status} ${resp.statusText}`,
          sourcePage
        });
        return null;
      }

      const contentType = resp.headers.get('content-type') || '';
      const arrayBuf = await resp.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      return await this.saveAsset(sourceUrl, buffer, contentType);
    } catch (err: any) {
      this.missingAssets.push({
        url: sourceUrl,
        type: 'network_error',
        error: err.message || 'Failed to download asset',
        sourcePage
      });
      return null;
    }
  }
}
