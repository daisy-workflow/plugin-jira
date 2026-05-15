# Jira plugin for Daisy-workflow

One Daisy node that talks to Jira Cloud. The action is selected per-node via
the **operation** dropdown — same UX as n8n's Jira node.

## Operations

| operation                  | What it does                                              |
|----------------------------|-----------------------------------------------------------|
| `issue.get`                | Fetch a single issue by key.                              |
| `issue.create`             | Create an issue in a project.                             |
| `issue.update`             | Patch fields on an existing issue.                        |
| `issue.delete`             | Permanently delete an issue.                              |
| `issue.search`             | JQL search (paginated).                                   |
| `issue.comment.add`        | Add a comment to an issue.                                |
| `issue.transition`         | Move an issue to a new status (by name or transition id). |
| `issue.transitions.list`   | List the transitions currently available on an issue.     |

## Configure auth

Create one **generic** config on the **Configurations** page (default name
`jira`) with three keys:

| Key        | Example                          |
|------------|----------------------------------|
| `host`     | `https://acme.atlassian.net`     |
| `email`    | `you@example.com`                |
| `apiToken` | API token from id.atlassian.com  |

A node can override the config name per-call via the `config` input — useful
if a workspace talks to multiple Jira instances.

## Install

```bash
docker compose -f docker-compose.yml -f docker-compose.plugins.yml \
  --profile jira up -d

npm run install-plugin -- --endpoint http://daisy-jira:8080
```

## Per-operation inputs

The manifest declares every input as optional except `operation`; each
handler checks its own required fields and returns a clear error if they're
missing. Quick reference:

- `issue.get` — `issueKey` (required), `fields[]`, `expand[]`
- `issue.create` — `projectKey` (required), `summary` (required), `issueType`, `description`, `assignee`, `priority`, `labels[]`, `components[]`, `dueDate`, `customFields`
- `issue.update` — `issueKey` (required) + any of the create fields (only the keys you pass get patched)
- `issue.delete` — `issueKey` (required)
- `issue.search` — `jql` (required), `maxResults`, `startAt`, `fields[]`
- `issue.comment.add` — `issueKey` (required), `comment` (required), `visibility`
- `issue.transition` — `issueKey` (required), `transitionId` or `transitionName`, optional `comment`, `resolution`
- `issue.transitions.list` — `issueKey` (required)

## Output envelope

```json
{
  "ok":        true,
  "operation": "issue.create",
  "status":    201,
  "result":    { "id": "10042", "key": "ACME-123", "self": "..." },
  "url":       "https://acme.atlassian.net/browse/ACME-123"
}
```

`result` is operation-specific:

- `issue.get` / `issue.create` → the issue object
- `issue.update` / `issue.delete` → `{ issueKey, updated|deleted: true }`
- `issue.search` → `{ issues[], total, startAt, maxResults }`
- `issue.comment.add` → the comment object (id, author, body, created, …)
- `issue.transition` → `{ issueKey, transitionId, transitionName }`
- `issue.transitions.list` → array of `{ id, name, to: { name, … } }`

## ADF (Atlassian Document Format)

Jira Cloud REST v3 requires comment / description bodies in ADF. The plugin
wraps plain-text inputs into a minimal ADF document automatically. If you
already have an ADF object (e.g. from another integration), pass it through
as JSON and it's forwarded as-is.

## Files

```
plugins-external/jira/
├── manifest.json        # node schema (inputs + outputs)
├── index.js             # servePlugin entry, dispatches by operation
├── lib/
│   ├── client.js        # auth + fetch wrapper + ADF helper
│   └── actions.js       # one async handler per operation
├── package.json
├── Dockerfile
└── README.md
```
