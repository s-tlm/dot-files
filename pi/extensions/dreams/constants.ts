// Defaults and limits shared across the extension. Messages read these so text and checks stay in sync.
export const DEFAULT_MODEL = "anthropic/claude-sonnet-5-5";
// Used only when --model is not set. On the benchmark it reorganised as well as Sonnet at the same cost.
export const DEFAULT_ORGANIZER_MODEL = "anthropic/claude-haiku-5-5";
export const DEFAULT_BUDGET_USD = 10;
export const DEFAULT_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 100;
export const MAX_SESSIONS = 100;
export const THINKING = "low";
// A pending job without a live worker after this long counts as failed.
export const STALE_JOB_MS = 60_000;
export const GIT_TIMEOUT_MS = 10_000;
export const WORKER_TIMEOUT_MS = 2 * 60 * 60 * 1000;
// Sessions read the start of MEMORY.md; both limits apply.
export const MEMORY_INDEX_LINES = 200;
export const MEMORY_INDEX_BYTES = 8 * 1024;
