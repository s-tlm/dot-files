import { isAbsolute, relative, resolve, sep } from "node:path";

/** Catppuccin Frappé palette, matching the Neovim plugin and Ghostty theme. */
export const FRAPPE = {
    rosewater: "#f2d5cf",
    flamingo: "#eebebe",
    pink: "#f4b8e4",
    mauve: "#ca9ee6",
    red: "#e78284",
    maroon: "#ea999c",
    peach: "#ef9f76",
    yellow: "#e5c890",
    green: "#a6d189",
    teal: "#81c8be",
    sky: "#99d1db",
    sapphire: "#85c1dc",
    blue: "#8caaee",
    lavender: "#babbf1",
    text: "#c6d0f5",
    subtext1: "#b5bfe2",
    subtext0: "#a5adce",
    overlay2: "#949cbb",
    overlay1: "#838ba7",
    overlay0: "#737994",
    surface2: "#626880",
    surface1: "#51576d",
    surface0: "#414559",
    base: "#303446",
    mantle: "#292c3c",
    crust: "#232634",
} as const;

export type FrappeColour = keyof typeof FRAPPE;

/** Nerd Font glyphs from the Basic Multilingual Plane, which terminals draw one cell wide. */
export const ICONS = {
    repo: "\uf401",
    branch: "\ue725",
    detached: "\uf417",
    folder: "\uf07b",
    session: "\uf02b",
    model: "\uf4bc",
    context: "\uf0e4",
    thinking: "\uf0eb",
} as const;

/** Frappé accents in hue order, so stepping through them reads as a rainbow. */
export const RAINBOW: readonly FrappeColour[] = [
    "red",
    "peach",
    "yellow",
    "green",
    "teal",
    "sky",
    "sapphire",
    "blue",
    "lavender",
    "mauve",
    "pink",
];

/**
 * Paints each letter a rainbow colour that shifts one step per frame, so the colours flow left to right.
 * A bold crest travels through the text on a sine wave, a few letters per cycle.
 */
export function rainbowWave(text: string, frame: number, painter: Painter): string {
    return [...text]
        .map((char, i) => {
            const colour = RAINBOW[(((i - frame) % RAINBOW.length) + RAINBOW.length) % RAINBOW.length];
            return painter.paint(colour, char, Math.sin((i - frame) * 0.5) > 0.6);
        })
        .join("");
}

const SEPARATOR = " │ ";
const MIN_GAP = 2;

/** Terminal styling and width handling, injected so tests can run without Pi. */
export interface Painter {
    paint(colour: FrappeColour, text: string, bold?: boolean): string;
    width(text: string): number;
    truncate(text: string, maxWidth: number, ellipsis?: string): string;
}

export interface UsageTotals {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
}

export interface UsageSummary {
    totals: UsageTotals;
    /** Cache hit rate of the latest assistant response, when it reported prompt tokens. */
    cacheHitRate?: number;
}

interface UsageLike {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    cost?: { total?: number };
}

interface EntryLike {
    type: string;
    usage?: UsageLike;
    message?: { role?: string; usage?: UsageLike };
}

export interface RepoInfo {
    name: string;
    root: string;
}

export interface FooterState {
    cwd: string;
    home?: string;
    repo?: RepoInfo;
    /** Branch from Pi's watcher: a name, "detached", or null outside Git. */
    branch: string | null;
    sessionName?: string;
    usage: UsageSummary;
    subscription: boolean;
    context?: { percent: number | null; contextWindow: number };
    model?: { provider: string; id: string; reasoning: boolean };
    thinkingLevel?: string;
    showProvider: boolean;
    /** Animation frame while fast mode is on; the model name is drawn as a rainbow wave. */
    fastFrame?: number;
    /** Ponytail's status text, shown before the model. */
    ponytail?: string;
    /** Other extensions' status texts, already ordered by key. */
    statuses: readonly string[];
}

/** Sums usage the same way as Pi's built-in footer, across every session entry. */
export function summariseUsage(entries: readonly EntryLike[]): UsageSummary {
    const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    let cacheHitRate: number | undefined;

    const add = (usage: UsageLike) => {
        totals.input += usage.input ?? 0;
        totals.output += usage.output ?? 0;
        totals.cacheRead += usage.cacheRead ?? 0;
        totals.cacheWrite += usage.cacheWrite ?? 0;
        totals.cost += usage.cost?.total ?? 0;
    };

    for (const entry of entries) {
        if (entry.type === "usage" && entry.usage) {
            add(entry.usage);
        } else if (entry.type === "message" && entry.message?.role === "assistant" && entry.message.usage) {
            const usage = entry.message.usage;
            add(usage);
            const promptTokens = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
            cacheHitRate = promptTokens > 0 ? ((usage.cacheRead ?? 0) / promptTokens) * 100 : undefined;
        } else if (entry.type === "message" && entry.message?.role === "toolResult" && entry.message.usage) {
            add(entry.message.usage);
        } else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
            add(entry.usage);
        }
    }

    return { totals, cacheHitRate };
}

/** Formats token counts like Pi's built-in footer. */
export function formatTokens(count: number): string {
    if (count < 1000) return count.toString();
    if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
    if (count < 1000000) return `${Math.round(count / 1000)}k`;
    if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
    return `${Math.round(count / 1000000)}M`;
}

/** Shortens paths inside the home directory to `~`. */
export function displayPath(cwd: string, home?: string): string {
    if (!home) return cwd;
    const fromHome = relative(resolve(home), resolve(cwd));
    const insideHome = fromHome === "" || (fromHome !== ".." && !fromHome.startsWith(`..${sep}`) && !isAbsolute(fromHome));
    if (!insideHome) return cwd;
    return fromHome === "" ? "~" : `~${sep}${fromHome}`;
}

/** Uses the built-in footer's warning thresholds. */
export function contextColour(percent: number | null): FrappeColour {
    if (percent === null) return "overlay1";
    if (percent > 90) return "red";
    if (percent > 70) return "yellow";
    return "green";
}

export function thinkingColour(level: string): FrappeColour {
    switch (level) {
        case "minimal":
            return "teal";
        case "low":
            return "sky";
        case "medium":
            return "blue";
        case "high":
            return "mauve";
        case "xhigh":
            return "pink";
        case "max":
            return "red";
        default:
            return "overlay0";
    }
}

/** Collapses a status to one line, like the built-in footer. */
export function sanitiseStatus(text: string): string {
    return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function location(state: FooterState, painter: Painter): string {
    const parts: string[] = [];
    if (state.repo) {
        parts.push(painter.paint("mauve", `${ICONS.repo} ${state.repo.name}`, true));
    } else {
        parts.push(painter.paint("blue", `${ICONS.folder} ${displayPath(state.cwd, state.home)}`));
    }

    if (state.branch) {
        const detached = state.branch === "detached";
        const icon = detached ? ICONS.detached : ICONS.branch;
        parts.push(painter.paint(detached ? "peach" : "green", `${icon} ${state.branch}`));
    }

    if (state.repo) {
        const subpath = relative(state.repo.root, state.cwd);
        if (subpath && subpath !== ".." && !subpath.startsWith(`..${sep}`) && !isAbsolute(subpath)) {
            parts.push(painter.paint("subtext0", subpath));
        }
    }

    return parts.join("  ");
}

function metrics(state: FooterState, painter: Painter): string {
    const { totals, cacheHitRate } = state.usage;
    const groups: string[] = [];

    const tokens: string[] = [];
    if (totals.input) tokens.push(painter.paint("sapphire", `↑${formatTokens(totals.input)}`));
    if (totals.output) tokens.push(painter.paint("teal", `↓${formatTokens(totals.output)}`));
    if (tokens.length > 0) groups.push(tokens.join(" "));

    const cache: string[] = [];
    if (totals.cacheRead) cache.push(painter.paint("overlay1", `R${formatTokens(totals.cacheRead)}`));
    if (totals.cacheWrite) cache.push(painter.paint("overlay1", `W${formatTokens(totals.cacheWrite)}`));
    if ((totals.cacheRead || totals.cacheWrite) && cacheHitRate !== undefined) {
        cache.push(painter.paint("green", `CH ${cacheHitRate.toFixed(1)}%`));
    }
    if (cache.length > 0) groups.push(cache.join(" "));

    if (totals.cost || state.subscription) {
        const cost = painter.paint("yellow", `$${totals.cost.toFixed(3)}`);
        groups.push(state.subscription ? `${cost} ${painter.paint("overlay1", "sub")}` : cost);
    }

    if (state.context) {
        const { percent, contextWindow } = state.context;
        const value = percent === null ? "?" : `${percent.toFixed(1)}%`;
        groups.push(
            painter.paint(contextColour(percent), `${ICONS.context} ${value}`) +
                painter.paint("overlay1", `/${formatTokens(contextWindow)}`),
        );
    }

    return groups.join(painter.paint("surface2", SEPARATOR));
}

/** Model labels in order of preference: with the provider, then without it. */
function modelLabels(state: FooterState, painter: Painter): string[] {
    if (!state.model) return [painter.paint("overlay0", `${ICONS.model} no model`)];

    let suffix = "";
    if (state.model.reasoning) {
        const level = state.thinkingLevel ?? "off";
        suffix = painter.paint("surface2", " · ") + painter.paint(thinkingColour(level), `${ICONS.thinking} ${level}`);
    }

    const icon = painter.paint("blue", `${ICONS.model} `);
    const id = state.fastFrame === undefined ? painter.paint("blue", state.model.id) : rainbowWave(state.model.id, state.fastFrame, painter);
    const compact = icon + id + suffix;
    if (!state.showProvider) return [compact];
    return [icon + painter.paint("overlay1", `${state.model.provider} `) + id + suffix, compact];
}

/** Right labels in order of preference: drop the provider, then the ponytail status, then truncate the model. */
function rightLabels(state: FooterState, painter: Painter): string[] {
    const models = modelLabels(state, painter);
    const ponytail = sanitiseStatus(state.ponytail ?? "");
    if (!ponytail) return models;
    const prefix = ponytail + painter.paint("surface2", SEPARATOR);
    return [...models.map((label) => prefix + label), models.at(-1)!];
}

/** Places `left` and the first right label that fits, keeping every line within `width`. */
function align(left: string, rightLabels: readonly string[], width: number, painter: Painter): string {
    let leftText = left;
    let leftWidth = painter.width(leftText);
    if (leftWidth > width) {
        leftText = painter.truncate(leftText, width, painter.paint("overlay1", "…"));
        leftWidth = painter.width(leftText);
    }

    for (const right of rightLabels) {
        const rightWidth = painter.width(right);
        if (leftWidth + MIN_GAP + rightWidth <= width) {
            return leftText + " ".repeat(width - leftWidth - rightWidth) + right;
        }
    }

    const last = rightLabels.at(-1);
    const available = width - leftWidth - MIN_GAP;
    if (!last || available <= 0) return leftText;
    const right = painter.truncate(last, available, "");
    return leftText + " ".repeat(width - leftWidth - painter.width(right)) + right;
}

export function renderFooter(state: FooterState, width: number, painter: Painter): string[] {
    const safeWidth = Math.max(0, Math.floor(width));
    const sessionLabels = state.sessionName
        ? [painter.paint("lavender", `${ICONS.session} ${sanitiseStatus(state.sessionName)}`)]
        : [];

    const lines = [
        align(location(state, painter), sessionLabels, safeWidth, painter),
        align(metrics(state, painter), rightLabels(state, painter), safeWidth, painter),
    ];

    const statuses = state.statuses.map(sanitiseStatus).filter(Boolean);
    if (statuses.length > 0) {
        lines.push(painter.truncate(statuses.join(" "), safeWidth, painter.paint("overlay1", "…")));
    }
    return lines;
}
