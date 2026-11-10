import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type Status = "pending" | "running" | "completed" | "failed" | "canceled";
export type ErrorType = "timeout" | "input_memory_store_too_large" | "input_session_unavailable" | "internal_error" | "budget_exceeded" | "analyzer_failed";
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
}
export interface Dream {
  type: "dream";
  id: string;
  status: Status;
  store_key: string;
  repo_root: string;
  inputs: [{ type: "memory_store"; path: string }, { type: "sessions"; session_files: string[] }];
  outputs: { type: "memory_store"; path: string }[];
  model: string;
  instructions: string;
  concurrency: number;
  budget_usd: number;
  keep_transcripts: boolean;
  progress: { phase: string; done: number; total: number; failed: string[] };
  pid: number | null;
  created_at: string;
  cloned_at: string | null;
  ended_at: string | null;
  archived_at: string | null;
  usage: Usage;
  summary: string;
  error: { type: ErrorType; message: string } | null;
}
export interface DreamOptions {
  storeKey: string;
  storePath: string;
  repoRoot: string;
  sessionFiles: string[];
  model?: string;
  instructions?: string;
  concurrency?: number;
  budget?: number;
  keepTranscripts?: boolean;
}

export class DreamError extends Error {
  readonly type: ErrorType;
  constructor(type: ErrorType, message: string) {
    super(message);
    this.type = type;
    this.name = "DreamError";
  }
}

export function jobDirectory(root: string, id: string): string {
  if (!/^drm_[a-z0-9-]+$/.test(id)) throw new Error("Invalid dream ID");
  return join(root, id);
}

export function finished(status: Status): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

export function transition(job: Dream, status: Status, error: Dream["error"] = null): void {
  if (job.status === "canceled" && status === "canceled") return;
  const allowed: Record<Status, Status[]> = {
    pending: ["running", "failed", "canceled"],
    running: ["completed", "failed", "canceled"],
    completed: [], failed: [], canceled: [],
  };
  if (!allowed[job.status]?.includes(status)) throw new Error(`Cannot change ${job.status} to ${status}`);
  job.status = status;
  job.error = error;
  if (finished(status)) job.ended_at = new Date().toISOString();
}

export async function saveJob(directory: string, job: Dream): Promise<void> {
  const temporary = join(directory, `.dream-${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, join(directory, "dream.json"));
}

export async function createJob(root: string, options: DreamOptions): Promise<Dream> {
  const { sessionFiles } = options;
  if (sessionFiles.length < 1 || sessionFiles.length > 100 || new Set(sessionFiles).size !== sessionFiles.length) {
    throw new Error("Choose 1 to 100 distinct sessions");
  }
  const concurrency = options.concurrency ?? 1;
  const budget = options.budget ?? 5;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) throw new Error("Concurrency must be 1 to 100");
  if (!Number.isFinite(budget) || budget <= 0) throw new Error("Budget must be a positive dollar amount");
  const job: Dream = {
    type: "dream", id: `drm_${randomUUID()}`, status: "pending",
    store_key: options.storeKey, repo_root: options.repoRoot,
    inputs: [{ type: "memory_store", path: options.storePath }, { type: "sessions", session_files: sessionFiles }],
    outputs: [], model: options.model ?? "anthropic/claude-sonnet-5-5",
    instructions: options.instructions ?? "", concurrency, budget_usd: budget,
    keep_transcripts: options.keepTranscripts ?? false,
    progress: { phase: "pending", done: 0, total: sessionFiles.length, failed: [] },
    pid: null, created_at: new Date().toISOString(), cloned_at: null, ended_at: null, archived_at: null,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: 0 },
    summary: "", error: null,
  };
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = jobDirectory(root, job.id);
  await mkdir(directory, { mode: 0o700 });
  await saveJob(directory, job);
  return job;
}

export async function readJob(directory: string): Promise<Dream> {
  const job = JSON.parse(await readFile(join(directory, "dream.json"), "utf8")) as Dream;
  if (job.type !== "dream" || !["pending", "running", "completed", "failed", "canceled"].includes(job.status)) {
    throw new Error(`Invalid dream record: ${directory}`);
  }
  jobDirectory(".", job.id);
  return job;
}

export function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    throw error;
  }
}

export async function recoverJob(directory: string, now = Date.now()): Promise<Dream> {
  let job = await readJob(directory);
  const dead = job.status === "running" && (!job.pid || !pidAlive(job.pid));
  const neverStarted = job.status === "pending" && now - Date.parse(job.created_at) > 60_000 && (!job.pid || !pidAlive(job.pid));
  if (dead || neverStarted) {
    // Re-read so a worker that finished during the probe keeps its final state.
    job = await readJob(directory);
    if (!finished(job.status) && (!job.pid || !pidAlive(job.pid))) {
      transition(job, "failed", { type: "internal_error", message: "The dream worker is no longer running" });
      await saveJob(directory, job);
    }
  }
  return job;
}

export async function listJobs(root: string, all = false): Promise<Dream[]> {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const jobs: Dream[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^drm_[a-z0-9-]+$/.test(entry.name)) continue;
    const job = await recoverJob(join(root, entry.name));
    if (all || !job.archived_at) jobs.push(job);
  }
  return jobs.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function cancelJob(directory: string): Promise<void> {
  const job = await readJob(directory);
  if (job.status === "canceled") return;
  if (finished(job.status)) throw new Error(`Cannot cancel a ${job.status} dream`);
  await writeFile(join(directory, "cancel"), "", { mode: 0o600 });
  if ((job.pid && !pidAlive(job.pid)) || (!job.pid && Date.now() - Date.parse(job.created_at) > 60_000)) {
    const latest = await readJob(directory);
    if (!finished(latest.status) && (!latest.pid || !pidAlive(latest.pid))) {
      transition(latest, "canceled");
      await saveJob(directory, latest);
    }
  }
}

export async function archiveJob(directory: string): Promise<void> {
  const job = await recoverJob(directory);
  if (!finished(job.status)) throw new Error("Only finished dreams can be archived");
  job.archived_at ??= new Date().toISOString();
  await saveJob(directory, job);
}
