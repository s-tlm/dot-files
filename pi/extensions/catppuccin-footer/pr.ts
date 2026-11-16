import type { PullRequest, PullRequestStatus } from "./format.ts";

const API = "https://api.github.com";
const FAILED_CONCLUSIONS = new Set(["failure", "cancelled", "timed_out", "action_required", "startup_failure"]);
/** Bounds the ETag cache; head commits change with every push, so old entries pile up. */
const MAX_CACHED_RESPONSES = 200;

/** Runs a command; matches `pi.exec` so tests can stub it. */
export type Exec = (command: string, args: string[], options: { cwd: string; timeout: number }) => Promise<{ stdout: string; code: number }>;
export type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

export interface PullRequestFacts {
    draft: boolean;
    /** REST `mergeable_state`: clean, blocked, dirty, unstable, behind, has_hooks, draft, or unknown. */
    mergeableState: string;
    reviewersRequested: boolean;
    checksFailing: boolean;
    checksPending: boolean;
}

/** Failing checks beat everything, then mergeable, then waiting on reviewers. Drafts and the rest stay neutral. */
export function pullRequestStatus(pr: PullRequestFacts): PullRequestStatus {
    if (pr.checksFailing) return "failing";
    if (pr.draft) return "other";
    if (pr.mergeableState === "clean" || pr.mergeableState === "has_hooks") return "ready";
    // REST has no review decision; a PR blocked after its checks finish is waiting on reviews.
    if (pr.reviewersRequested || (pr.mergeableState === "blocked" && !pr.checksPending)) return "review";
    return "other";
}

/** Owner and name from a github.com remote URL in SSH, scp-like, or HTTPS form. */
export function parseGitHubRemote(url: string): { owner: string; repo: string } | undefined {
    const match = /^(?:[\w.+-]+:\/\/)?(?:[^@/]+@)?github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
    return match ? { owner: match[1], repo: match[2] } : undefined;
}

interface Cached {
    etag: string;
    body: unknown;
}

interface PullSummary {
    number: number;
    html_url: string;
}

interface PullDetail extends PullSummary {
    draft?: boolean;
    mergeable_state?: string;
    head: { sha: string };
    requested_reviewers?: unknown[];
    requested_teams?: unknown[];
}

interface CheckRuns {
    check_runs: { status: string; conclusion: string | null }[];
}

interface CombinedStatus {
    state: string;
    statuses: { state: string }[];
}

/**
 * Looks up the open PR for a branch through REST conditional requests.
 * A `304 Not Modified` reply does not count against the rate limit, so frequent polls stay cheap.
 */
export function createPullRequestClient(exec: Exec, fetchImpl: Fetch = fetch) {
    const responses = new Map<string, Cached>();
    const remotes = new Map<string, { owner: string; repo: string } | undefined>();
    let token: string | undefined;

    async function run(command: string, args: string[], cwd: string): Promise<string | undefined> {
        const result = await exec(command, args, { cwd, timeout: 10_000 });
        return result.code === 0 ? result.stdout.trim() : undefined;
    }

    async function get<T>(path: string): Promise<T> {
        token ??= await run("gh", ["auth", "token"], process.cwd());
        if (!token) throw new Error("gh is not signed in");

        const url = `${API}${path}`;
        const cached = responses.get(url);
        const headers: Record<string, string> = {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
        };
        if (cached) headers["If-None-Match"] = cached.etag;

        const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(10_000) });
        if (response.status === 304 && cached) return cached.body as T;
        if (response.status === 401) token = undefined; // Token revoked or rotated; fetch a fresh one next time.
        if (!response.ok) throw new Error(`GitHub ${response.status} for ${path}`);

        const body = (await response.json()) as T;
        const etag = response.headers.get("etag");
        if (etag) {
            if (responses.size >= MAX_CACHED_RESPONSES) responses.clear();
            responses.set(url, { etag, body });
        }
        return body;
    }

    /** The open PR for `branch`, or undefined when there is none or GitHub cannot be reached. */
    async function fetchPullRequest(cwd: string, branch: string): Promise<PullRequest | undefined> {
        try {
            if (!remotes.has(cwd)) {
                const url = await run("git", ["remote", "get-url", "origin"], cwd);
                remotes.set(cwd, url ? parseGitHubRemote(url) : undefined);
            }
            const remote = remotes.get(cwd);
            if (!remote) return undefined;
            const repo = `/repos/${encodeURIComponent(remote.owner)}/${encodeURIComponent(remote.repo)}`;

            // shortcut: only finds PRs opened from `origin` into `origin`, not from a fork; query the upstream if forks matter.
            const head = encodeURIComponent(`${remote.owner}:${branch}`);
            const [summary] = await get<PullSummary[]>(`${repo}/pulls?state=open&head=${head}&per_page=1`);
            if (!summary) return undefined;

            const pr = await get<PullDetail>(`${repo}/pulls/${summary.number}`);
            // shortcut: reads the first 100 check runs only; page through them if a repo ever runs more.
            const [runs, status] = await Promise.all([
                get<CheckRuns>(`${repo}/commits/${pr.head.sha}/check-runs?per_page=100`),
                get<CombinedStatus>(`${repo}/commits/${pr.head.sha}/status`),
            ]);

            return {
                number: pr.number,
                url: pr.html_url,
                status: pullRequestStatus({
                    draft: Boolean(pr.draft),
                    mergeableState: pr.mergeable_state ?? "unknown",
                    reviewersRequested: (pr.requested_reviewers?.length ?? 0) + (pr.requested_teams?.length ?? 0) > 0,
                    checksFailing:
                        runs.check_runs.some((run) => FAILED_CONCLUSIONS.has(run.conclusion ?? "")) ||
                        status.state === "failure" ||
                        status.state === "error",
                    checksPending:
                        runs.check_runs.some((run) => run.status !== "completed") ||
                        status.statuses.some((context) => context.state === "pending"),
                }),
            };
        } catch {
            return undefined;
        }
    }

    return { fetchPullRequest };
}
