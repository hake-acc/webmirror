export type JobStage =
  | 'connecting'
  | 'rendering'
  | 'discovering_pages'
  | 'extracting_assets'
  | 'rewriting_paths'
  | 'building_export'
  | 'testing'
  | 'packaging'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ViewportConfig {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  name: string;
}

export interface AssetDownloadOptions {
  css: boolean;
  js: boolean;
  images: boolean;
  fonts: boolean;
  media: boolean;
  json: boolean;
}

export interface JobConfig {
  url: string;
  crawlDepth: number; // 0 = single page, 1 = 1 level deep, etc.
  maxPages: number;
  includeAssets: AssetDownloadOptions;
  viewport: ViewportConfig;
  performVisualDiff: boolean;
  testInteractions: boolean;
  timeoutMs: number;
  userAgent?: string;
  maxAssetSizeMb?: number;
}

export interface JobStats {
  discoveredPages: number;
  crawledPages: number;
  downloadedAssets: number;
  failedAssets: number;
  totalBytes: number;
  startTime: number;
  endTime?: number;
  currentTask: string;
}

export interface LogEntry {
  timestamp: number;
  stage: JobStage;
  message: string;
  level: 'info' | 'warn' | 'error';
}

export interface ClonedPage {
  sourceUrl: string;
  localPath: string;
  title: string;
  byteSize: number;
  depth: number;
}

export interface ClonedAsset {
  sourceUrl: string;
  localPath: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  category: 'css' | 'js' | 'images' | 'fonts' | 'media' | 'data' | 'other';
}

export interface MissingAsset {
  url: string;
  type: string;
  statusCode?: number;
  error: string;
  sourcePage?: string;
}

export interface BrokenLink {
  sourcePage: string;
  targetUrl: string;
  statusCode?: number;
  reason: string;
}

export interface DeploymentCompatibility {
  staticHostingReady: boolean;
  vercelReady: boolean;
  netlifyReady: boolean;
  githubPagesReady: boolean;
  cloudflareReady: boolean;
  warnings: string[];
  recommendations: string[];
}

export interface QualityReport {
  fidelityScore: number; // 0 - 100
  originalScreenshotUrl?: string;
  clonedScreenshotUrl?: string;
  diffScreenshotUrl?: string;
  pixelDiffRatio?: number;
  missingAssets: MissingAsset[];
  brokenLinks: BrokenLink[];
  consoleErrors: string[];
  unresolvedIssues: string[];
  deploymentCompatibility: DeploymentCompatibility;
  categoryCounts: Record<string, number>;
  generatedAt: number;
}

export interface CloneManifest {
  version: string;
  clonedAt: string;
  origin: string;
  entryPage: string;
  totalPages: number;
  totalAssets: number;
  totalBytes: number;
  pages: ClonedPage[];
  assets: ClonedAsset[];
}

export interface JobModel {
  id: string;
  url: string;
  normalizedUrl: string;
  status: JobStage;
  progress: number; // 0 to 100
  config: JobConfig;
  stats: JobStats;
  error?: string;
  logs: LogEntry[];
  manifest?: CloneManifest;
  report?: QualityReport;
  zipFileName?: string;
  zipFileSize?: number;
  exportDirPath?: string;
  zipFilePath?: string;
}
