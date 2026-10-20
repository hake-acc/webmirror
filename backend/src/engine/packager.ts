import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { CloneManifest, QualityReport } from '../types';

export class Packager {
  constructor(
    private exportDir: string,
    private workspaceDir: string
  ) {}

  public writeManifest(manifest: CloneManifest): void {
    const filePath = path.join(this.exportDir, 'manifest.json');
    fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  public writeReport(report: QualityReport): void {
    const filePath = path.join(this.exportDir, 'clone-report.json');
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
  }

  public writeReadme(
    sourceUrl: string,
    report: QualityReport,
    manifest: CloneManifest
  ): void {
    const readmeContent = `# WebMirror Static Export

Cloned from: **${sourceUrl}**  
Date of capture: **${manifest.clonedAt}**  
Fidelity Score: **${report.fidelityScore}%**  

## Project Structure
\`\`\`text
webmirror-export/
├── index.html            # Main entry page
├── assets/
│   ├── css/              # Stylesheets with rewritten relative url() references
│   ├── js/               # Preserved client-side JavaScript bundles
│   ├── fonts/            # Web fonts (woff2, woff, ttf, etc.)
│   ├── images/           # Deduplicated images and SVGs
│   └── media/            # Video and audio assets
├── pages/                # Preserved internal crawl routes
├── manifest.json         # Source URL mapping and SHA-256 asset inventory
├── clone-report.json     # Automated QA scorecard and broken link audit
└── README.md             # Deployment and usage instructions
\`\`\`

## Local Preview
To preview this static copy locally with any HTTP server:
\`\`\`bash
# Using Python
python3 -m http.server 8080

# Or using Node.js
npx serve .
\`\`\`
Open \`http://localhost:8080\` in any modern browser.

## Deploying to Static Hosting

### 1. Vercel
\`\`\`bash
npm i -g vercel
vercel deploy --prod
\`\`\`

### 2. Netlify
- Go to [Netlify Drop](https://app.netlify.com/drop)
- Drag and drop this folder or the generated ZIP archive.

### 3. Cloudflare Pages
- Run \`npx wrangler pages deploy .\` or upload via the Cloudflare dashboard.

### 4. GitHub Pages
- Initialize a Git repository inside this directory and push to the \`gh-pages\` branch.

## Quality and Fidelity Summary
- **Total Discovered Pages:** ${manifest.totalPages}
- **Total Preserved Assets:** ${manifest.totalAssets} (${(manifest.totalBytes / 1024 / 1024).toFixed(2)} MB)
- **Static Hosting Ready:** ${report.deploymentCompatibility.staticHostingReady ? 'Yes' : 'Requires review'}
- **Missing Resources:** ${report.missingAssets.length}
- **Broken Links:** ${report.brokenLinks.length}

> [!NOTE]
> Static website exports preserve original client-side markup, CSS animations, and layout fidelity.
> Dynamic backend server-side databases, private APIs, authentication cookies, and transactional forms cannot be reproduced offline.
`;

    const filePath = path.join(this.exportDir, 'README.md');
    fs.writeFileSync(filePath, readmeContent, 'utf-8');
  }

  /**
   * Compresses the export directory into a portable .zip archive
   */
  public async createZip(zipFileName: string): Promise<{ zipPath: string; byteSize: number }> {
    const zipPath = path.join(this.workspaceDir, zipFileName);

    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', {
        zlib: { level: 9 } // maximum compression
      });

      output.on('close', () => {
        const stats = fs.statSync(zipPath);
        resolve({
          zipPath,
          byteSize: stats.size
        });
      });

      archive.on('error', (err: any) => reject(err));

      archive.pipe(output);

      // Append all files from the export directory with the root folder name 'webmirror-export'
      archive.directory(this.exportDir, 'webmirror-export');

      archive.finalize();
    });
  }
}
