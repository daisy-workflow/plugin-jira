// One handler per `operation` value the manifest declares. Each handler
// takes the resolved auth + the node inputs + the ctx signal, and returns
// the operation-specific payload that index.js wraps into the standard
// { ok, operation, status, result, url } envelope.

import { jiraFetch, toAdf, browseUrl } from "./client.js";

// ── issue.get ───────────────────────────────────────────────────────────
export async function issueGet(auth, input, signal) {
  const { issueKey, fields, expand, timeoutMs = 15000 } = input || {};
  if (!issueKey) throw new Error("operation=issue.get requires issueKey");

  const qs = new URLSearchParams();
  if (Array.isArray(fields) && fields.length) qs.set("fields", fields.join(","));
  if (Array.isArray(expand) && expand.length) qs.set("expand", expand.join(","));
  const suffix = qs.toString() ? `?${qs}` : "";

  const { status, body } = await jiraFetch(
    auth,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}${suffix}`,
    { method: "GET" },
    timeoutMs,
    signal,
  );
  return { status, result: body, url: browseUrl(auth.host, issueKey) };
}

// ── issue.create ────────────────────────────────────────────────────────
export async function issueCreate(auth, input, signal) {
  const {
    projectKey, summary, issueType = "Task", description,
    assignee, reporter, priority, labels, components, dueDate,
    customFields, timeoutMs = 15000,
  } = input || {};
  if (!projectKey) throw new Error("operation=issue.create requires projectKey");
  if (!summary)    throw new Error("operation=issue.create requires summary");

  // Build the request `fields` object. Only include keys the caller set —
  // sending nulls trips Jira validation on fields the workspace marks
  // required.
  const fields = {
    project:   { key: projectKey },
    summary,
    issuetype: { name: issueType },
  };
  if (description != null && description !== "") fields.description = toAdf(description);
  if (assignee)    fields.assignee = { accountId: assignee };
  if (reporter)    fields.reporter = { accountId: reporter };
  if (priority)    fields.priority = { name: priority };
  if (Array.isArray(labels) && labels.length)         fields.labels     = labels;
  if (Array.isArray(components) && components.length) fields.components = components.map(name => ({ name }));
  if (dueDate)     fields.duedate = dueDate;
  if (customFields && typeof customFields === "object") {
    for (const [k, v] of Object.entries(customFields)) fields[k] = v;
  }

  const { status, body } = await jiraFetch(
    auth,
    "/rest/api/3/issue",
    { method: "POST", body: JSON.stringify({ fields }) },
    timeoutMs,
    signal,
  );
  return {
    status,
    result: body,                                            // { id, key, self }
    url:    body?.key ? browseUrl(auth.host, body.key) : null,
  };
}

// ── issue.update ────────────────────────────────────────────────────────
export async function issueUpdate(auth, input, signal) {
  const {
    issueKey, summary, description, assignee, priority,
    labels, components, dueDate, customFields,
    timeoutMs = 15000,
  } = input || {};
  if (!issueKey) throw new Error("operation=issue.update requires issueKey");

  // Partial-update: only include keys the caller explicitly passed. An
  // empty string `assignee` means "unassign" (Jira accepts assignee=null).
  const fields = {};
  if (summary != null)              fields.summary = summary;
  if (description !== undefined)    fields.description = toAdf(description);
  if (assignee !== undefined)       fields.assignee = assignee === "" ? null : { accountId: assignee };
  if (priority)                     fields.priority = { name: priority };
  if (Array.isArray(labels))        fields.labels = labels;
  if (Array.isArray(components))    fields.components = components.map(name => ({ name }));
  if (dueDate !== undefined)        fields.duedate = dueDate || null;
  if (customFields && typeof customFields === "object") {
    for (const [k, v] of Object.entries(customFields)) fields[k] = v;
  }

  if (Object.keys(fields).length === 0) {
    // No-op update would still cost a Jira API round-trip + audit row.
    throw new Error("operation=issue.update called with no fields to change");
  }

  const { status } = await jiraFetch(
    auth,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
    { method: "PUT", body: JSON.stringify({ fields }) },
    timeoutMs,
    signal,
  );
  return {
    status,
    result: { issueKey, updated: true },   // PUT returns 204; consumer can re-fetch via issue.get
    url:    browseUrl(auth.host, issueKey),
  };
}

// ── issue.delete ────────────────────────────────────────────────────────
export async function issueDelete(auth, input, signal) {
  const { issueKey, timeoutMs = 15000 } = input || {};
  if (!issueKey) throw new Error("operation=issue.delete requires issueKey");

  const { status } = await jiraFetch(
    auth,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
    { method: "DELETE" },
    timeoutMs,
    signal,
  );
  return {
    status,
    result: { issueKey, deleted: true },
    url:    null,
  };
}

// ── issue.search ────────────────────────────────────────────────────────
export async function issueSearch(auth, input, signal) {
  const { jql, maxResults = 50, startAt = 0, fields, expand, timeoutMs = 20000 } = input || {};
  if (!jql) throw new Error("operation=issue.search requires jql");

  // POST /search accepts JQL + fields list in the body — no URL-length
  // issues for non-trivial queries.
  const body = {
    jql,
    startAt:    Math.max(0, Number(startAt) || 0),
    maxResults: Math.min(100, Math.max(1, Number(maxResults) || 50)),
  };
  if (Array.isArray(fields) && fields.length) body.fields = fields;
  if (Array.isArray(expand) && expand.length) body.expand = expand;

  const { status, body: resp } = await jiraFetch(
    auth,
    "/rest/api/3/search",
    { method: "POST", body: JSON.stringify(body) },
    timeoutMs,
    signal,
  );
  return {
    status,
    result: {
      issues:     Array.isArray(resp?.issues) ? resp.issues : [],
      total:      Number(resp?.total ?? 0),
      startAt:    Number(resp?.startAt ?? body.startAt),
      maxResults: Number(resp?.maxResults ?? body.maxResults),
    },
    url: null,
  };
}

// ── issue.comment.add ───────────────────────────────────────────────────
export async function issueCommentAdd(auth, input, signal) {
  const { issueKey, comment, visibility, timeoutMs = 15000 } = input || {};
  if (!issueKey) throw new Error("operation=issue.comment.add requires issueKey");
  if (!comment || !String(comment).trim()) {
    throw new Error("operation=issue.comment.add requires comment");
  }

  const reqBody = { body: toAdf(comment) };
  if (visibility && visibility.type && visibility.value) {
    reqBody.visibility = { type: visibility.type, value: visibility.value };
  }

  const { status, body } = await jiraFetch(
    auth,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
    { method: "POST", body: JSON.stringify(reqBody) },
    timeoutMs,
    signal,
  );
  return {
    status,
    result: body,                                  // full comment object
    url:    `${browseUrl(auth.host, issueKey)}?focusedCommentId=${encodeURIComponent(body?.id || "")}`,
  };
}

// ── issue.transitions.list ──────────────────────────────────────────────
export async function issueTransitionsList(auth, input, signal) {
  const { issueKey, timeoutMs = 15000 } = input || {};
  if (!issueKey) throw new Error("operation=issue.transitions.list requires issueKey");

  const { status, body } = await jiraFetch(
    auth,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    { method: "GET" },
    timeoutMs,
    signal,
  );
  return {
    status,
    result: body?.transitions || [],
    url:    browseUrl(auth.host, issueKey),
  };
}

// ── issue.transition ────────────────────────────────────────────────────
export async function issueTransition(auth, input, signal) {
  const {
    issueKey, transitionId, transitionName, comment, resolution,
    timeoutMs = 15000,
  } = input || {};
  if (!issueKey) throw new Error("operation=issue.transition requires issueKey");
  if (!transitionId && !transitionName) {
    throw new Error("operation=issue.transition requires transitionId or transitionName");
  }

  // Resolve name → id when only name was given. Available transitions
  // depend on current status + project workflow, so we ask Jira each
  // time rather than caching.
  let id = transitionId;
  let resolvedName = transitionName || null;
  if (!id) {
    const { body: tBody } = await jiraFetch(
      auth,
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
      { method: "GET" },
      timeoutMs,
      signal,
    );
    const wanted = String(transitionName).trim().toLowerCase();
    const match = (tBody?.transitions || []).find(t => String(t.name).toLowerCase() === wanted);
    if (!match) {
      const available = (tBody?.transitions || []).map(t => t.name).join(", ") || "(none)";
      throw new Error(
        `transition "${transitionName}" not available on ${issueKey}. Available: ${available}`,
      );
    }
    id = match.id;
    resolvedName = match.name;
  }

  // Optional comment + resolution ride along with the transition POST
  // — Jira applies them atomically with the status change.
  const reqBody = { transition: { id: String(id) } };
  if (comment && String(comment).trim()) {
    reqBody.update = { comment: [{ add: { body: toAdf(comment) } }] };
  }
  if (resolution) {
    reqBody.fields = { resolution: { name: resolution } };
  }

  const { status } = await jiraFetch(
    auth,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    { method: "POST", body: JSON.stringify(reqBody) },
    timeoutMs,
    signal,
  );
  return {
    status,
    result: { issueKey, transitionId: String(id), transitionName: resolvedName },
    url:    browseUrl(auth.host, issueKey),
  };
}

// Operation → handler map. Single source of truth used by index.js.
export const OPERATIONS = {
  "issue.get":              issueGet,
  "issue.create":           issueCreate,
  "issue.update":           issueUpdate,
  "issue.delete":           issueDelete,
  "issue.search":           issueSearch,
  "issue.comment.add":      issueCommentAdd,
  "issue.transition":       issueTransition,
  "issue.transitions.list": issueTransitionsList,
};
