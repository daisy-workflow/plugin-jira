// Shared Jira REST client used by every operation in the jira plugin.
//
// Auth model: Basic auth (email:apiToken). Plain credentials come in via
// the workspace `generic` config Daisy injects through ctx.config — we
// never look at env vars or local files for secrets here.

export function loadJiraAuth(ctx, configName = "jira") {
  const cfg = ctx?.config?.[configName];
  if (!cfg) {
    throw new Error(
      `Jira config "${configName}" not found in workspace. ` +
      `Add a generic config on the Configurations page with host, email, apiToken.`,
    );
  }
  const host  = String(cfg.host  || "").replace(/\/+$/, "");
  const email = String(cfg.email || "");
  const token = String(cfg.apiToken || "");
  if (!host || !email || !token) {
    throw new Error(
      `Jira config "${configName}" is missing one of host / email / apiToken.`,
    );
  }
  const basic = Buffer.from(`${email}:${token}`).toString("base64");
  return {
    host,
    headers: {
      "Authorization": `Basic ${basic}`,
      "Accept":        "application/json",
      "Content-Type":  "application/json",
    },
  };
}

// Fetch wrapper with two abort sources merged into one signal:
//   1. local timeout (the plugin's per-call timeoutMs input)
//   2. the engine's abort signal (workflow-level cancel / hard timeout)
export async function jiraFetch({ host, headers }, path, init = {}, timeoutMs = 15000, signal) {
  const ac = new AbortController();
  const timer = setTimeout(
    () => ac.abort(new Error(`Jira request timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  const onUpstream = () => ac.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) ac.abort(signal.reason);
    else signal.addEventListener("abort", onUpstream, { once: true });
  }
  try {
    const res = await fetch(`${host}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers || {}) },
      signal:  ac.signal,
    });
    // 204 No Content (PUT /issue, POST /transitions) — no body to parse.
    const text = res.status === 204 ? "" : await res.text();
    let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) {
      const msg = body?.errorMessages?.[0] || body?.message || `HTTP ${res.status}`;
      const err = new Error(`Jira ${init.method || "GET"} ${path} failed: ${msg}`);
      err.status = res.status;
      err.body   = body;
      throw err;
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener?.("abort", onUpstream);
  }
}

// Jira Cloud REST v3 requires rich-text fields (description, comment
// body) in Atlassian Document Format. Customers will overwhelmingly
// pass plain text — wrap it for them. If the caller already passed an
// ADF doc, leave it alone.
export function toAdf(text) {
  if (text == null || text === "") return null;
  if (typeof text === "object" && text.type === "doc") return text;  // already ADF
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: String(text) }],
      },
    ],
  };
}

// Convenience: build the `${host}/browse/${key}` deep-link for an issue.
export function browseUrl(host, issueKey) {
  return `${host}/browse/${encodeURIComponent(issueKey)}`;
}
