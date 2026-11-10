---
name: jira
description: Create (and update) Jira tickets in the easygo-group DATA project with the user's conventions pre-applied - epic scan, current DE sprint, assignee, both team fields, story points. Use whenever the user asks to create, file, or raise a Jira ticket, or to update/close existing ones.
---

# Jira tickets (easygo-group / DATA)

Create tickets with the Atlassian MCP tools using the conventions
below. They were set by the user and apply unless the request says
otherwise.

## Fixed identifiers

- cloudId: `259f7d3c-24cd-4c78-ab7b-0e6c4d5c3209`
  (https://easygo-group.atlassian.net)
- Project: `DATA` (Data Team). Default issue type: `Task`.
- Assignee: the current user. Their accountId is in the `context.
  atlassianAccountId` of any MCP response (verify it matches the
  session user via `atlassianUserInfo` if unsure).

## Custom fields (set ALL of these on every ticket)

| Field | ID | Value |
|---|---|---|
| Team (platform) | `customfield_10001` | `"09240176-88b5-4f2e-bc79-111f9d927109"` (Data Engineering) |
| Data Team (select) | `customfield_15032` | `{"id": "41540"}` (Data Engineering) |
| Sprint | `customfield_10020` | numeric id of the active DE sprint (see below) |
| Story Points | `customfield_10045` | number, uses the Fibonacci scale. NEVER use `customfield_10016` (inactive twin) |
| Epic | `parent` | `{"key": "<EPIC>"}` |

Pass these via `additional_fields` on create, or `fields` on edit.

## Procedure

1. **Epic**: if the user names one, use it. Otherwise scan open epics
   (`project = DATA AND issuetype = Epic AND statusCategory != Done`)
   and pick the clearly relevant one; if none is clear, ask.
   Databricks platform work belongs under `DATA-2507` (Databricks
   Platform Rollout). If the user asks to create one, create it.
2. **Sprint**: find the active Data Engineering sprint by searching
   `project = DATA AND sprint in openSprints()` with fields
   `["customfield_10020"]` and picking the sprint whose name contains
   `Data Platform Sprint` with `state: active`. Add to the sprint by default;
   skip only if the user says backlog.
3. **Create** with `createJiraIssue` (`contentFormat: markdown`),
   setting summary, description, assignee, and all custom fields in
   one call.
4. **Verify**: `getJiraIssue` with the custom field IDs afterwards -
   create screens can silently drop fields. Re-apply any that are
   missing with `editJiraIssue`.
5. **Report** the ticket key and browse URL
   (`https://easygo-group.atlassian.net/browse/<KEY>`).

## Description style

Same rules as PR descriptions: short prose intro (one or two
sentences), then a small bullet list for scope or changes; each
bullet one or two sentences. Never any self-mention. Link related
PRs, tickets, and repos inline. Australian spelling. For tickets that
record completed work, open with "Completed." and include a
"Verified:" line stating the evidence.

## Story Points

All tasks should have an explicit story point estimate. If the user
gives one, use it. Otherwise estimate one. Story points use the Fibonacci scale.

## Status transitions

- Move to Done with `transitionJiraIssue`, transition id `31`
  (confirm with `getTransitionsForJiraIssue` if the workflow ever
  changes; other known ids: To Do `11`, In Progress `21`, Review `3`,
  Blocked `2`).
- Tickets for already-finished work: create, then transition to Done.
- Done tickets remain editable (fields can still be updated).

## Gotchas

- JQL search results overflow the context easily; the tool saves big
  results to a file - extract with `jq` via Bash instead of reading,
  or use `searchResultMode: "count"` when only a count is needed.
- The `names` expansion on `getJiraIssue` maps customfield IDs to
  display names when a field ID is in doubt.
- `additional_fields` values must be typed correctly: Sprint is a
  bare number, Story Points a bare number, Data Team an option object
  `{"id": "41540"}`, platform Team a bare string id.
