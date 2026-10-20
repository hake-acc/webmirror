import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { JobModel, JobStage, LogEntry } from '../types';

export class JobStore extends EventEmitter {
  private jobs: Map<string, JobModel> = new Map();
  private baseDir: string;
  private workspacesDir: string;
  private dataFile: string;

  constructor(baseDir?: string) {
    super();
    this.baseDir = baseDir || path.resolve(process.cwd(), 'storage');
    this.workspacesDir = path.join(this.baseDir, 'workspaces');
    this.dataFile = path.join(this.baseDir, 'jobs.json');

    this.ensureDirs();
    this.loadPersistedJobs();
  }

  private ensureDirs(): void {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    if (!fs.existsSync(this.workspacesDir)) {
      fs.mkdirSync(this.workspacesDir, { recursive: true });
    }
  }

  private loadPersistedJobs(): void {
    try {
      if (fs.existsSync(this.dataFile)) {
        const raw = fs.readFileSync(this.dataFile, 'utf-8');
        const list: JobModel[] = JSON.parse(raw);
        for (const job of list) {
          // If a job was left in progress before restart, mark it as failed
          if (['connecting', 'rendering', 'discovering_pages', 'extracting_assets', 'rewriting_paths', 'building_export', 'testing', 'packaging'].includes(job.status)) {
            job.status = 'failed';
            job.error = 'Process terminated unexpectedly during server reload';
          }
          this.jobs.set(job.id, job);
        }
      }
    } catch (e) {
      console.error('Failed to load persisted jobs:', e);
    }
  }

  public persist(): void {
    try {
      const list = Array.from(this.jobs.values());
      fs.writeFileSync(this.dataFile, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to persist jobs:', e);
    }
  }

  public getWorkspaceDir(jobId: string): string {
    const dir = path.join(this.workspacesDir, jobId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  public getExportDir(jobId: string): string {
    const dir = path.join(this.getWorkspaceDir(jobId), 'webmirror-export');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  public createJob(job: JobModel): JobModel {
    this.jobs.set(job.id, job);
    this.persist();
    this.emit(`job:${job.id}`, job);
    this.emit('job:created', job);
    return job;
  }

  public getJob(id: string): JobModel | undefined {
    return this.jobs.get(id);
  }

  public getAllJobs(): JobModel[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.stats.startTime - a.stats.startTime);
  }

  public updateJob(id: string, updates: Partial<JobModel>): JobModel | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;

    Object.assign(job, updates);
    this.persist();
    this.emit(`job:${id}`, job);
    this.emit('job:updated', job);
    return job;
  }

  public updateStage(id: string, stage: JobStage, progress: number, currentTask?: string): void {
    const job = this.jobs.get(id);
    if (!job) return;

    job.status = stage;
    job.progress = Math.min(100, Math.max(0, progress));
    if (currentTask) {
      job.stats.currentTask = currentTask;
    }

    this.addLog(id, stage, currentTask || `Stage changed to ${stage}`, 'info');
    this.updateJob(id, { status: stage, progress: job.progress });
  }

  public addLog(id: string, stage: JobStage, message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const job = this.jobs.get(id);
    if (!job) return;

    const entry: LogEntry = {
      timestamp: Date.now(),
      stage,
      message,
      level
    };

    job.logs.push(entry);
    // Keep max 500 logs per job
    if (job.logs.length > 500) {
      job.logs.shift();
    }

    this.emit(`job:${id}:log`, entry);
    this.emit(`job:${id}`, job);
  }

  public deleteJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;

    // Delete workspace directory
    try {
      const dir = path.join(this.workspacesDir, id);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch (e) {
      console.error(`Failed to remove workspace for ${id}:`, e);
    }

    this.jobs.delete(id);
    this.persist();
    this.emit('job:deleted', id);
    return true;
  }

  public cleanupOldJobs(maxAgeMs = 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    for (const [id, job] of this.jobs.entries()) {
      if (now - job.stats.startTime > maxAgeMs) {
        this.deleteJob(id);
      }
    }
  }
}
