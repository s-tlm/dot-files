# Dreams

Dreams turns past pi sessions into a reviewed, read-only memory store for each repository. Worktrees share their main checkout's store.

## Use the extension

1. Run `/reload` to load the extension.
2. Run `/memory` to inspect your store.
3. Run `/dream` and confirm the selected sessions, model and budget.
4. Run `/dream show <id>` and `/dream diff <id>` when it finishes. The diff shows a file summary; read the output files before adoption.
5. Run `/dream adopt <id>` to replace your store and keep a backup, or `/dream discard <id>` to delete the output.

The memory prompt stays unchanged within a session until you adopt a dream or reload. Hand edits take effect after reload.

While a dream is active, the status bar cycles a sleeping-face ASCII animation beside its progress and cost, such as `(-_-) zzz dreaming 4/22 · $0.41`. The animation occupies nine columns, with dots instead of space padding so footer formatting cannot move the text. It stops when the dream finishes or you leave the session. The animation updates every 350 ms; job files are still polled every five seconds.

`/dream list` lists your repository's dreams. Add `--all` to include archived dreams. `/dream cancel <id>` requests cancellation through a file, without signalling a PID. `/dream archive <id>` hides a finished dream from the default list.

You can set `--sessions <id-or-folder,...>`, `--since 14d`, `--model provider/model-id`, `--instructions "..."`, `--budget 5`, `--concurrency 1` and `--keep-transcripts`. An explicit session list replaces automatic selection. Headless starts require `--yes`.

The default model is `anthropic/claude-sonnet-5-5`, with low thinking and a $5 reported-cost budget. Sequential analysis preserves chronological updates; concurrent analysis can overwrite conflicting facts.

## Storage and safety

The agent directory is `PI_CODING_AGENT_DIR` or `~/.pi/agent`. It contains `memory/` and `dreams/`. Session discovery uses `PI_CODING_AGENT_SESSION_DIR`, then pi's `sessionDir` setting, then the agent directory's `sessions/`.

Dreams never adopts output automatically. Failed output needs `/dream adopt <id> --force`. Adoption and discard require interactive confirmation. Each dream runs once; start a new dream after a failure.

Known secret formats are redacted, but unknown secrets can still reach your model provider. Transcripts are private and removed after a normal finish unless you keep them. Child session logs remain in the dream directory.

The main-session gate protects file-tool writes, including nested calls through codemode, but cannot stop shell writes. Child tools have narrower filesystem access. Neither gate provides OS isolation against another local process changing paths during a check.

Budget checks use completed responses, so in-flight work can exceed the budget. Cancellation and timeout stop child process groups. A forced OS kill cannot run cleanup.

## Test

Run the suite on Node 26:

```sh
/opt/homebrew/bin/node --test "$HOME/.pi/agent/extensions/dreams/test/"*.test.ts
```

The suite uses fake model processes and isolated stores. It also checks the installed pi loader without making provider requests.
