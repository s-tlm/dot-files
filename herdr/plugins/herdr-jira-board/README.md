# Herdr Jira board

Browse your Jira board's active sprint in a floating pane. The TUI renders a full-width search bar and footer, an aligned ticket table and a right-hand preview. fzf provides local fuzzy matching and small selection dialogs. Browsing and ticket edits use Jira REST through Node's built-in `fetch`, without a language-model request. Peon still uses Atlassian MCP in the spawned pi pane.

## Install

You need Node 22 or later, fzf 0.74.5 or later, Herdr 0.9.5 or later and pi with the `peon` skill. The installed version was checked against Herdr protocol 22. Git-backed launches also need Git.

The plugin lives in your dotfiles at `herdr/plugins/herdr-jira-board`. `herdr plugin link` points Herdr at that folder, so pulling your dotfiles updates the plugin.

On each machine, run:

```sh
cd ~/Dotfiles/herdr/plugins/herdr-jira-board
npm ci --ignore-scripts
npm test
herdr plugin link "$PWD"
```

The tests use Node's built-in test runner. On macOS, the terminal integration tests also use `uv` and Python's standard library to drive a private pseudo-terminal.

In `~/.config/herdr/config.toml`, add this binding without replacing your existing bindings:

```toml
[[keys.command]]
key = "prefix+j"
type = "shell"
command = '"$HERDR_BIN_PATH" plugin action invoke open --plugin herdr-jira-board'
description = "Jira board"
```

Keep `prefix+k` unchanged. Reload your Herdr configuration only after the checks pass. The open action captures the originating workspace, pane and directory before opening the popup through the socket API. Open the action rather than the pane entrypoint directly.

## Authenticate

Use a normal Jira API token without scopes only if your organisation permits it. This token has broader access than a scoped token and follows your account's Jira permissions. If policy blocks it, stop rather than switching authentication methods. Never paste your token into chat, a command argument or a configuration file.

1. In your [Atlassian account](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/), create an API token without scopes and choose an expiry date. If you've already stored a normal token in Keychain, keep it; you don't need a replacement for this endpoint change.
2. Run `npm run auth` once. If `~/.config/herdr/plugins/config/herdr-jira-board/config.json` doesn't exist, the plugin creates it with an empty template and stops. It uses `$XDG_CONFIG_HOME/herdr/plugins/config/herdr-jira-board/config.json` instead when you set `XDG_CONFIG_HOME`. The plugin creates the directory with mode `0700` and the file with mode `0600`, and never overwrites an existing file.
3. Fill in every key in the configuration file. The file accepts only these five keys:

   ```json
   {
     "email": "your-email@example.com",
     "site": "https://example.atlassian.net",
     "board": 11,
     "project": "TEAM",
     "storyPointsField": "customfield_10000"
   }
   ```

   | Key | Value |
   | --- | --- |
   | `email` | Your Atlassian account email. It's also the Keychain account name. |
   | `site` | Your Jira Cloud URL in the form `https://<subdomain>.atlassian.net`, without a path, port, query or credentials. The plugin sends Basic authentication only to this site. |
   | `board` | Your board ID, a positive whole number. You'll find it in the board URL after `/boards/`. |
   | `project` | Your project key, such as `TEAM`. Only tickets in this project are browsed, edited or dispatched. |
   | `storyPointsField` | The custom field ID that your board uses for estimation, such as `customfield_10000`. `npm run auth` fails if the board uses a different field. |

   Never put your token in this file. The plugin rejects any other key.

4. In your own terminal, store the token in Keychain. Replace the email, keep `-w` as the last argument and enter the token at the password prompt. Don't append the token to the command:

   ```sh
   security add-generic-password -a 'your-email@example.com' -s 'herdr-jira-board' -w
   ```

5. Run `npm run auth` again. This reads the Keychain entry and verifies your identity, board configuration, saved filter and sprint metadata. macOS may ask you to allow Keychain access; the plugin doesn't open an OAuth browser or change pi's credentials.
6. Run `node bin/herdr-jira-board.mjs check`. This read-only check resolves the current scope, fetches every search page and prints the ticket count. It doesn't open a worker pane or test write permissions.

The plugin retrieves the token with `/usr/bin/security find-generic-password`, capturing its stdout in memory. It sends Basic authentication directly to your configured Jira site. Browse links use the same site. The scoped-token gateway isn't used. Requests reject redirects without forwarding credentials.

To rotate the token, create a replacement normal API token, then run the storage command with `-U` before the other options. Keep `-w` last so the replacement is entered at the prompt. Run `auth` and `check`, then revoke the old token. A `401` can mean a rejected or expired token; a `403` can mean missing Jira permissions or a policy restriction. If access fails, stop rollout. Don't bypass policy.

## Required permissions

You need access to the board and saved filter, Browse projects and any issue-security access. Edits also need the relevant Edit issues, Transition issues and Add comments permissions. No granular token scopes are configured for a normal token; its access is bounded by your account permissions and organisation policy, not by this plugin's narrower board query.

Sources: [Basic authentication](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/) and [API-token management](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/).

## Browse tickets

The board, project and site come from your configuration file. Each refresh resolves the board's saved filter and the active sprint again. Queries intersect your configured project, that filter and that sprint. Completed tickets remain visible. Filters never widen that scope.

If there are no active sprints or more than one, the browser shows an explicit empty state. Resolve the ambiguity in Jira and press `r`; it never picks a sprint silently.

The search bar and footer span the full pane, with thin separators and muted key-label hints matching herdr-bar. The table has aligned **Ticket ID**, **Created**, **Name**, **Status** and **Assignee** headers. **Created** shows the ticket's creation date as `YYYY-MM-DD`, in Jira's time zone. **Name** shows the Jira summary. The sorted column's heading shows `▼`. Long values use an ellipsis without shifting adjacent columns; actions always use the original ticket key.

Use `/` to edit the query, including action letters. `Enter` or `Esc` returns to navigation without hiding your query. Narrow footers omit whole lower-priority hints while retaining the quit hint. The preview appears only when the table still fits at full width, from about 105 columns. Narrower panes show the table alone; panes under 56 columns ask you to widen them.

| Key | Action |
| --- | --- |
| `j` / `k`, arrows | Highlight a ticket. |
| `/` | Enter fuzzy search. Action letters become query text. |
| `f` | Cycle the sort through every column, left to right: ticket ID, created date, name, status, then assignee, each descending. Ticket IDs sort by number. Missing values sort last. Status sorts Done, then in-progress, then to-do categories, then by name. The sort replaces search ranking and persists while the board is open. |
| `Enter` / `Esc` in search | Return to navigation without running an action. |
| `a` | Filter by all assignees, yourself, unassigned or an account ID. |
| `d` | Start peon in a Herdr-managed worktree for Git directories, or a sibling pane otherwise. |
| `s` | Choose an available workflow transition. |
| `p` | Choose Fibonacci story points, including zero. |
| `c` | Edit a multiline comment, then submit or cancel. |
| `r` | Reload the board filter, sprint and tickets. |
| `Shift+Up` / `Shift+Down` | Scroll the preview. |
| `Alt+j` / `Alt+k` | Scroll the preview by a page. |
| `q` / `Esc` in navigation | Close the browser. |

The preview includes the description, story points, reporter, assignee and status. Duplicate display names remain distinct in the assignee picker. Search text, the filter and the highlighted ticket survive actions where possible.

## Start work

Press `d` to start peon using the directory captured from your originating pane when you opened the board. There's no directory picker or repository inference from ticket text. To use a different directory, change directory in your pane and reopen the board.

For a Git directory, including a nested or linked checkout, Herdr creates `feat/<project>-<number>`, in lower case, from that checkout's committed `HEAD`. Herdr registers and groups the worktree workspace automatically, using your configured `worktrees.directory` or its default under `~/.herdr/worktrees/`. Pi starts in the new workspace's root pane without changing your focus. If that branch already exists without a worktree and points at the same commit, for example after you deleted its worktree, Herdr reuses it. A branch with a worktree, or at a different commit, stops dispatch; inspect it, or delete it with `git branch -d` if it has no work. A bare repository works if its `HEAD` resolves to a commit; an unborn repository doesn't.

Uncommitted edits and untracked files stay in your original checkout. The plugin doesn't fetch, copy those files, reset branches or remove worktrees after failures. Use repositories you've verified: normal Git hooks and checkout filters can run during creation. The plugin never grants Git trust automatically. Herdr lacks an atomic create-only branch flag, so a concurrent branch creation can race the preflight check; the new checkout's commit is checked before pi starts.

Outside Git, peon starts in a sibling pane in the captured directory and workspace. Missing directories, permission or trust failures, and unknown API failures stop dispatch rather than falling back to another directory or your focused pane. The board shows dispatch and write failures in red under the search bar.

A new pane's shell can still be initialising after Herdr creates the worktree. The plugin retries startup only when Herdr explicitly returns `agent_pane_busy`, which sends no input and reserves no name. Shell eligibility and pi readiness share a 30-second deadline; timeouts, socket failures and other startup errors are never retried. Pi starts with `--thinking xhigh`. The plugin then submits `/skill:peon` with the ticket key and URL. Once Herdr acknowledges submission, you return to the board while peon continues in the background. The board doesn't wait for peon's task or plan to finish. Peon must read current details and all comments through Atlassian MCP. For Git launches, it uses the prepared worktree and branch rather than treating that fresh branch as existing work or creating another. Dispatch authorises read-only intake and planning, not code changes, Jira top-ups or automatic reassignment. You must approve the resulting plan separately.

Dispatch records contain identifiers, branch names and delivery stages, not ticket descriptions. You'll find them under `${XDG_STATE_HOME:-~/.local/state}/herdr-jira-board/`, keyed by socket, originating workspace and ticket. Repeated keypresses don't create another worker. An uncertain worktree creation, split, startup or prompt outcome blocks a repeated dispatch. Inspect Herdr's worktrees and the named pi pane before clearing any record; a timeout doesn't prove that creation or delivery failed.

## Update Jira

Every write requires a submit/cancel confirmation showing the ticket and proposed change. The plugin rechecks the active board scope before writing or dispatching.

Status changes fetch fresh transitions. If a transition needs required fields, the plugin names them and asks you to complete it in Jira. Points updates change only your configured `storyPointsField` and confirm the stored value with a read-back. Comments use the issue comment endpoint with an Atlassian Document Format (ADF) body, never a description replacement or transition update. Each typed line becomes an ADF paragraph, including blank lines; Markdown characters remain literal text.

The comment editor is the executable named by `VISUAL`, then `EDITOR`, or `vi`. Set it to an executable path without shell arguments. A cancelled or failed comment keeps its draft for the current browser session. Closing the browser removes drafts and previews, so copy a draft before closing if you need it later.

Writes are never retried automatically. Rate-limited reads allow at most two retries within a 30-second request budget and honour `Retry-After`; each attempt has a 10-second timeout. If a write fails, times out or returns an unreadable result, inspect Jira before repeating it. A successful write followed by a failed refresh can also leave a stale list; refresh to check the stored state.

## Privacy and limits

Ticket bodies stay in memory and private session files, removed on normal exit or a handled termination signal. Content is stripped of terminal control sequences. A forced kill or power loss can leave a private `herdr-jira-board-*` directory in your system temporary directory; remove it after confirming no browser session uses it.

The plugin doesn't provide backlog browsing, other boards, arbitrary JQL, ticket creation, general worktree browsing/removal, an MCP browser fallback or a provider framework.

## Dependencies

The browser uses `@mariozechner/pi-tui` `0.73.1` for terminal painting, input editing and Unicode widths. That version supports Node 22.15. Its npm name is deprecated after a namespace move, but the successor package requires Node 22.19 or later. A tested cleanup guard handles its delayed keyboard-protocol startup callback, and inherited terminal debug logging is disabled to keep ticket descriptions out of log files.
