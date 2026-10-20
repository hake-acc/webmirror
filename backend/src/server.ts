import express, { Request, Response } from 'express';
import cors from 'cors';
import * as path from 'path';
import * as fs from 'fs';
import { JobStore } from './storage/job-store';
import { BrowserEngine } from './engine/browser';
import { JobConfig, JobModel } from './types';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(cors());
app.use(express.json());

const jobStore = new JobStore();
const browserEngine = new BrowserEngine(jobStore);

// Periodic cleanup of old workspaces (24 hour retention)
setInterval(() => {
  jobStore.cleanupOldJobs();
}, 60 * 60 * 1000);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    jobsCount: jobStore.getAllJobs().length,
    version: '1.0.0'
  });
});

// List all jobs
app.get('/api/jobs', (req: Request, res: Response) => {
  const jobs = jobStore.getAllJobs().map((j) => ({
    id: j.id,
    url: j.url,
    status: j.status,
    progress: j.progress,
    stats: j.stats,
    fidelityScore: j.report?.fidelityScore,
    zipFileName: j.zipFileName,
    zipFileSize: j.zipFileSize
  }));
  res.json(jobs);
});

// Create new cloning job
app.post('/api/jobs', async (req: Request, res: Response) => {
  const {
    url,
    crawlDepth = 1,
    maxPages = 10,
    includeAssets = { css: true, js: true, images: true, fonts: true, media: true, json: true },
    viewport = { width: 1280, height: 800, name: 'Desktop' },
    performVisualDiff = true,
    testInteractions = true,
    timeoutMs = 15000,
    userAgent
  } = req.body;

  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    res.status(400).json({ error: 'A valid http/https URL is required' });
    return;
  }

  const id = 'job_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

  const config: JobConfig = {
    url,
    crawlDepth: Math.max(0, Math.min(5, crawlDepth)),
    maxPages: Math.max(1, Math.min(50, maxPages)),
    includeAssets,
    viewport,
    performVisualDiff,
    testInteractions,
    timeoutMs: Math.max(5000, Math.min(60000, timeoutMs)),
    userAgent
  };

  const job: JobModel = {
    id,
    url,
    normalizedUrl: url,
    status: 'connecting',
    progress: 0,
    config,
    stats: {
      discoveredPages: 0,
      crawledPages: 0,
      downloadedAssets: 0,
      failedAssets: 0,
      totalBytes: 0,
      startTime: Date.now(),
      currentTask: 'Queued for processing'
    },
    logs: [
      {
        timestamp: Date.now(),
        stage: 'connecting',
        message: `Job initialized for ${url}`,
        level: 'info'
      }
    ]
  };

  jobStore.createJob(job);

  // Kick off processing in the background
  setImmediate(() => {
    browserEngine.processJob(id);
  });

  res.status(201).json(job);
});

// Get job details
app.get('/api/jobs/:id', (req: Request, res: Response) => {
  const job = jobStore.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

// Server-Sent Events (SSE) live updates
app.get('/api/jobs/:id/events', (req: Request, res: Response) => {
  const id = req.params.id;
  const job = jobStore.getJob(id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send current state immediately
  res.write(`data: ${JSON.stringify({ type: 'state', job })}\n\n`);

  const onUpdate = (updatedJob: JobModel) => {
    res.write(`data: ${JSON.stringify({ type: 'state', job: updatedJob })}\n\n`);
  };

  const onLog = (entry: any) => {
    res.write(`data: ${JSON.stringify({ type: 'log', log: entry })}\n\n`);
  };

  jobStore.on(`job:${id}`, onUpdate);
  jobStore.on(`job:${id}:log`, onLog);

  req.on('close', () => {
    jobStore.removeListener(`job:${id}`, onUpdate);
    jobStore.removeListener(`job:${id}:log`, onLog);
  });
});

// Quality Assurance report
app.get('/api/jobs/:id/report', (req: Request, res: Response) => {
  const job = jobStore.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  if (!job.report) {
    res.status(400).json({ error: 'Quality report not ready yet' });
    return;
  }
  res.json(job.report);
});

// Download ZIP
app.get('/api/jobs/:id/download', (req: Request, res: Response) => {
  const job = jobStore.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  if (!job.zipFilePath || !fs.existsSync(job.zipFilePath)) {
    res.status(404).json({ error: 'Export ZIP archive not found or not completed' });
    return;
  }

  res.download(job.zipFilePath, job.zipFileName || 'webmirror-export.zip');
});

// Live Preview endpoint for the cloned website
app.use('/api/jobs/:id/preview', (req: Request, res: Response, next) => {
  const id = req.params.id;
  const job = jobStore.getJob(id);
  if (!job) {
    res.status(404).send('Job not found');
    return;
  }

  const exportDir = jobStore.getExportDir(id);
  if (!fs.existsSync(exportDir)) {
    res.status(404).send('Export directory does not exist yet');
    return;
  }

  express.static(exportDir)(req, res, next);
});

// Cancel job
app.post('/api/jobs/:id/cancel', (req: Request, res: Response) => {
  const job = jobStore.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  if (['completed', 'failed', 'cancelled'].includes(job.status)) {
    res.status(400).json({ error: 'Job has already finished' });
    return;
  }

  jobStore.updateStage(req.params.id, 'cancelled', job.progress, 'Job cancelled by user');
  res.json({ message: 'Job cancelled successfully' });
});

// Retry failed assets
app.post('/api/jobs/:id/retry', (req: Request, res: Response) => {
  const job = jobStore.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  // Re-run the browser engine processing
  jobStore.updateStage(req.params.id, 'connecting', 5, 'Retrying failed resources');
  setImmediate(() => {
    browserEngine.processJob(req.params.id);
  });

  res.json({ message: 'Retry initiated', job });
});

// Delete job workspace
app.delete('/api/jobs/:id', (req: Request, res: Response) => {
  const success = jobStore.deleteJob(req.params.id);
  if (!success) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json({ message: 'Job workspace deleted' });
});

export { app, jobStore, browserEngine };

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[WebMirror] Processing service listening on http://0.0.0.0:${PORT}`);
  });
}
