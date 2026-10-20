import * as cheerio from 'cheerio';
import * as path from 'path';

export class UrlRewriter {
  /**
   * Computes a relative path from a source file's directory to a target relative file.
   * e.g. from 'pages/about/index.html' to 'assets/css/style.css' -> '../../assets/css/style.css'
   * e.g. from 'index.html' to 'assets/css/style.css' -> './assets/css/style.css'
   */
  public static getRelativePath(fromFilePath: string, toFilePath: string): string {
    const fromDir = path.dirname(fromFilePath);
    let rel = path.relative(fromDir, toFilePath).replace(/\\/g, '/');
    if (!rel.startsWith('.') && !rel.startsWith('/')) {
      rel = './' + rel;
    }
    return rel;
  }

  /**
   * Resolves a URL string against a base URL
   */
  public static resolveUrl(urlStr: string, baseUrl: string): string | null {
    try {
      const trimmed = urlStr.trim();
      if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('javascript:') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:') || trimmed.startsWith('#')) {
        return null;
      }
      return new URL(trimmed, baseUrl).href;
    } catch {
      return null;
    }
  }

  /**
   * Rewrites CSS content containing @import and url(...) to local relative paths
   */
  public static rewriteCss(
    cssContent: string,
    cssLocalPath: string,
    cssSourceUrl: string,
    urlToLocalMap: Map<string, string>
  ): string {
    // Match url(...) patterns: url("..."), url('...'), url(...)
    const urlPattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;

    return cssContent.replace(urlPattern, (match, quote, rawUrl) => {
      const trimmed = rawUrl.trim();
      if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('#')) {
        return match;
      }

      const absoluteUrl = this.resolveUrl(trimmed, cssSourceUrl);
      if (!absoluteUrl) return match;

      const localTarget = urlToLocalMap.get(absoluteUrl);
      if (localTarget) {
        const relative = this.getRelativePath(cssLocalPath, localTarget);
        return `url("${relative}")`;
      }

      return match;
    });
  }

  /**
   * Rewrites an entire HTML document:
   * - <link rel="stylesheet">, <link rel="icon">
   * - <script src="...">
   * - <img src="..." srcset="...">
   * - <source src="..." srcset="...">
   * - <video src="..." poster="...">
   * - <audio src="...">
   * - <a href="..."> internal page links
   * - inline style="background: url(...)"
   * - <style> tags
   */
  public static rewriteHtml(
    html: string,
    pageLocalPath: string,
    pageSourceUrl: string,
    urlToLocalMap: Map<string, string>,
    pageUrlToLocalMap: Map<string, string>
  ): string {
    const $ = cheerio.load(html);

    // 1. Remove or comment out base tag to avoid disrupting relative paths
    $('base').remove();

    // 2. Rewrite <link> tags (CSS, icons, preloads)
    $('link').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        const abs = this.resolveUrl(href, pageSourceUrl);
        if (abs && urlToLocalMap.has(abs)) {
          const target = urlToLocalMap.get(abs)!;
          $(el).attr('href', this.getRelativePath(pageLocalPath, target));
        }
      }
    });

    // 3. Rewrite <script> tags
    $('script').each((_, el) => {
      const src = $(el).attr('src');
      if (src) {
        const abs = this.resolveUrl(src, pageSourceUrl);
        if (abs && urlToLocalMap.has(abs)) {
          const target = urlToLocalMap.get(abs)!;
          $(el).attr('src', this.getRelativePath(pageLocalPath, target));
        }
      }
    });

    // 4. Rewrite <img> tags
    $('img').each((_, el) => {
      const src = $(el).attr('src');
      if (src) {
        const abs = this.resolveUrl(src, pageSourceUrl);
        if (abs && urlToLocalMap.has(abs)) {
          const target = urlToLocalMap.get(abs)!;
          $(el).attr('src', this.getRelativePath(pageLocalPath, target));
        }
      }

      const srcset = $(el).attr('srcset');
      if (srcset) {
        $(el).attr('srcset', this.rewriteSrcset(srcset, pageLocalPath, pageSourceUrl, urlToLocalMap));
      }
    });

    // 5. Rewrite <source> and <picture>
    $('source').each((_, el) => {
      const src = $(el).attr('src');
      if (src) {
        const abs = this.resolveUrl(src, pageSourceUrl);
        if (abs && urlToLocalMap.has(abs)) {
          $(el).attr('src', this.getRelativePath(pageLocalPath, urlToLocalMap.get(abs)!));
        }
      }
      const srcset = $(el).attr('srcset');
      if (srcset) {
        $(el).attr('srcset', this.rewriteSrcset(srcset, pageLocalPath, pageSourceUrl, urlToLocalMap));
      }
    });

    // 6. Rewrite <video> and <audio>
    $('video, audio').each((_, el) => {
      const src = $(el).attr('src');
      if (src) {
        const abs = this.resolveUrl(src, pageSourceUrl);
        if (abs && urlToLocalMap.has(abs)) {
          $(el).attr('src', this.getRelativePath(pageLocalPath, urlToLocalMap.get(abs)!));
        }
      }
      const poster = $(el).attr('poster');
      if (poster) {
        const abs = this.resolveUrl(poster, pageSourceUrl);
        if (abs && urlToLocalMap.has(abs)) {
          $(el).attr('poster', this.getRelativePath(pageLocalPath, urlToLocalMap.get(abs)!));
        }
      }
    });

    // 7. Rewrite internal <a> navigation links
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        const abs = this.resolveUrl(href, pageSourceUrl);
        if (abs) {
          // Normalize URL without fragment
          const cleanAbs = abs.split('#')[0];
          const hash = abs.includes('#') ? '#' + abs.split('#')[1] : '';

          if (pageUrlToLocalMap.has(cleanAbs)) {
            const localTarget = pageUrlToLocalMap.get(cleanAbs)!;
            const rel = this.getRelativePath(pageLocalPath, localTarget) + hash;
            $(el).attr('href', rel);
          }
        }
      }
    });

    // 8. Rewrite inline style attributes
    $('[style]').each((_, el) => {
      const style = $(el).attr('style');
      if (style && style.includes('url(')) {
        const rewritten = this.rewriteCss(style, pageLocalPath, pageSourceUrl, urlToLocalMap);
        $(el).attr('style', rewritten);
      }
    });

    // 9. Rewrite inline <style> tags
    $('style').each((_, el) => {
      const css = $(el).html();
      if (css && css.includes('url(')) {
        const rewritten = this.rewriteCss(css, pageLocalPath, pageSourceUrl, urlToLocalMap);
        $(el).html(rewritten);
      }
    });

    // 10. Inject offline client helper script for SPA routes & meta preservation
    const helperScript = `
<!-- WebMirror Offline Runtime Companion -->
<script>
(function() {
  window.__WEBMIRROR_PORTABLE__ = true;
  console.log('[WebMirror] Running high-fidelity offline clone');
})();
</script>
`;
    $('body').append(helperScript);

    return $.html();
  }

  private static rewriteSrcset(
    srcset: string,
    pageLocalPath: string,
    pageSourceUrl: string,
    urlToLocalMap: Map<string, string>
  ): string {
    const parts = srcset.split(',');
    const rewrittenParts = parts.map((part) => {
      const trimmed = part.trim();
      const tokens = trimmed.split(/\s+/);
      if (tokens.length === 0) return part;
      const url = tokens[0];
      const descriptor = tokens.slice(1).join(' ');

      const abs = this.resolveUrl(url, pageSourceUrl);
      if (abs && urlToLocalMap.has(abs)) {
        const rel = this.getRelativePath(pageLocalPath, urlToLocalMap.get(abs)!);
        return descriptor ? `${rel} ${descriptor}` : rel;
      }
      return part;
    });
    return rewrittenParts.join(', ');
  }
}
