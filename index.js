// Jira — one Daisy plugin, multiple operations selected by the `operation`
// input. Mirrors n8n's Jira node: the workflow author drops one node, picks
// the action from a dropdown, and fills the inputs that action needs.
//
// Wire it up:
//   1. `docker compose -f docker-compose.yml -f docker-compose.plugins.yml \
//          --profile jira up -d`
//   2. `npm run install-plugin -- --endpoint http://daisy-jira:8080`
//   3. Add a "generic" workspace config named "jira" with host/email/apiToken
//      on the Configurations page.
//   4. Use the node in any workflow.

import { servePlugin } from "@daisy-workflow/plugin-sdk";
import fs from "node:fs";

import { loadJiraAuth }   from "./lib/client.js";
import { OPERATIONS }     from "./lib/actions.js";

const manifest = JSON.parse(
  fs.readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
);

servePlugin({
  manifest,
  async execute(input, ctx) {
    const { operation, config = "jira" } = input || {};
    if (!operation) throw new Error("`operation` is required (see manifest enum for valid values)");

    const handler = OPERATIONS[operation];
    if (!handler) {
      throw new Error(
        `unknown operation "${operation}". Valid: ${Object.keys(OPERATIONS).join(", ")}`,
      );
    }

    // One auth lookup per call. Cheap (in-memory ctx.config), and we don't
    // want one operation's auth failure to leak into another's tracing.
    const auth = loadJiraAuth(ctx, config);

    const { status, result, url } = await handler(auth, input, ctx?.signal);

    return {
      ok:        true,
      operation,
      status,
      result,
      url,
    };
  },
  async readyz() { return true; },
});
