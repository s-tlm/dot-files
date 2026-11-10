import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { RepoInfo } from "./format.ts";

/**
 * Finds the Git work tree containing `cwd` by reading `.git` metadata.
 * Worktrees use their main repository's name. Submodules keep their own name.
 */
export function findRepository(cwd: string): RepoInfo | undefined {
    let dir = resolve(cwd);
    while (true) {
        const dotGit = join(dir, ".git");
        if (existsSync(dotGit)) return describeRepository(dir, dotGit);
        const parent = dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}

function describeRepository(root: string, dotGit: string): RepoInfo | undefined {
    try {
        const stat = statSync(dotGit);
        if (stat.isDirectory()) return { name: basename(root), root };
        if (!stat.isFile()) return undefined;

        const pointer = readFileSync(dotGit, "utf8").trim();
        if (!pointer.startsWith("gitdir:")) return undefined;
        const gitDir = resolve(root, pointer.slice("gitdir:".length).trim());
        const commonDirFile = join(gitDir, "commondir");
        const commonDir = existsSync(commonDirFile)
            ? resolve(gitDir, readFileSync(commonDirFile, "utf8").trim())
            : gitDir;

        const commonName = basename(commonDir);
        if (commonName === ".git") return { name: basename(dirname(commonDir)), root };
        if (commonName.endsWith(".git") && commonName.length > ".git".length) {
            return { name: commonName.slice(0, -".git".length), root };
        }
        return { name: basename(root), root };
    } catch {
        // Unreadable metadata: show the plain folder rather than guessing a name.
        return undefined;
    }
}
