#!/usr/bin/env node
/**
 * Sprint 5 demo: per-tier model enforcement (deny-path proof).
 *
 * Proves that a standard-tier user (ai-users group) cannot use a frontier-only
 * model even by passing the modelId directly to newChat/sendChatMessage,
 * bypassing the listModels() UI filter. The server-side gate in
 * getChatContext() rejects the request.
 *
 * As a control, the same user calling an allowed standard-tier model succeeds.
 *
 * Prerequisites:
 *   - Node 24+ (global WebSocket)
 *   - The workshop deployed behind Cloudflare Access
 *   - A CF_Authorization cookie for a user in the "ai-users" Access group
 *
 * Usage:
 *   CF_ACCESS_JWT="<jwt>" node scripts/demo/deny-path-demo.mjs
 *
 * How to get CF_ACCESS_JWT:
 *   1. Open the workshop URL in a browser where you're signed in to Cloudflare
 *      Access as a user in the "ai-users" group.
 *   2. Open DevTools > Application > Cookies > <your-domain>.
 *   3. Copy the value of the "CF_Authorization" cookie.
 *   4. Pass it as CF_ACCESS_JWT env var.
 *
 *   Alternatively, use a Cloudflare Access service token: set the
 *   CF-Access-Client-Id and CF-Access-Client-Secret headers on a request
 *   that mints a JWT for a service identity in the ai-users group, then
 *   pass that JWT here.
 *
 * Environment:
 *   CF_ACCESS_JWT    (required) — CF_Authorization cookie value / Access JWT
 *   WORKSHOP_URL     (optional) — base URL, defaults to https://os.acme-studios.org
 *   DENY_MODEL       (optional) — frontier-only model to test denial, defaults to claude-opus-5
 *   ALLOW_MODEL      (optional) — standard-tier model to test success, defaults to @cf/zai-org/glm-5.2
 */

import { newWebSocketRpcSession } from "../../cloudflare-os/packages/workshop-frontend/node_modules/capnweb/dist/index.js";

const WORKSHOP_URL = process.env.WORKSHOP_URL || "https://os.acme-studios.org";
const CF_ACCESS_JWT = process.env.CF_ACCESS_JWT;
const DENY_MODEL = process.env.DENY_MODEL || "claude-opus-5";
const ALLOW_MODEL = process.env.ALLOW_MODEL || "@cf/zai-org/glm-5.2";

if (!CF_ACCESS_JWT) {
  console.error("Error: CF_ACCESS_JWT env var is required.");
  console.error("See the header comment in this file for how to obtain it.");
  process.exit(1);
}

const wsUrl = WORKSHOP_URL.replace(/^http/, "ws") + "/api";

let results = [];

function record(name, passed, detail) {
  results.push({ name, passed, detail });
  let status = passed ? "PASS" : "FAIL";
  console.log(`[${status}] ${name}: ${detail}`);
}

async function connect() {
  // Create a WebSocket with the CF Access JWT in the header the server expects.
  // The server reads "cf-access-jwt-assertion" (see access.ts).
  let ws = new WebSocket(wsUrl, {
    headers: {
      "cf-access-jwt-assertion": CF_ACCESS_JWT,
      "Origin": WORKSHOP_URL,
    },
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("WebSocket connection failed")), { once: true });
  });

  return newWebSocketRpcSession(ws);
}

async function main() {
  console.log(`Connecting to ${wsUrl} ...`);
  let stub;
  try {
    stub = await connect();
  } catch (err) {
    console.error(`Connection failed: ${err.message}`);
    console.error("Check that CF_ACCESS_JWT is valid and the workshop URL is correct.");
    process.exit(1);
  }

  // Authenticate via Cloudflare Access.
  let auth;
  try {
    auth = await stub.authenticateFromCfAccess();
  } catch (err) {
    console.error(`Authentication failed: ${err.message}`);
    process.exit(1);
  }
  console.log("Authenticated via CF Access.");

  // Step 1: listModels() — should show only standard-tier models.
  let models;
  try {
    models = await auth.listModels();
  } catch (err) {
    record("listModels()", false, `threw: ${err.message}`);
    summary();
    return;
  }
  let modelIds = models.map(m => m.id);
  console.log(`listModels() returned ${modelIds.length} models: ${modelIds.join(", ")}`);

  let denyVisible = modelIds.includes(DENY_MODEL);
  record(
    `listModels() excludes ${DENY_MODEL} (frontier-only)`,
    !denyVisible,
    denyVisible ? "frontier model visible to standard user (should be filtered)" : "frontier model correctly hidden",
  );

  let allowVisible = modelIds.includes(ALLOW_MODEL);
  record(
    `listModels() includes ${ALLOW_MODEL} (standard-tier)`,
    allowVisible,
    allowVisible ? "standard model visible" : "standard model missing from list",
  );

  // Step 2: Try newChat with the frontier-only model (bypassing UI filter).
  // This should be rejected by the server-side gate in getChatContext().
  let denied = false;
  let denyError = null;
  try {
    await auth.newChat("demo test message", DENY_MODEL);
  } catch (err) {
    denied = true;
    denyError = err.message;
  }
  record(
    `newChat() with ${DENY_MODEL} is rejected`,
    denied,
    denied ? `server rejected: "${denyError}"` : "server accepted frontier model (ENFORCEMENT BROKEN)",
  );

  // Check the error message matches the tier enforcement message.
  if (denied) {
    let isTierError = denyError.includes("not available for your access tier");
    record(
      `Error message is the tier enforcement error`,
      isTierError,
      isTierError ? "correct tier error" : `unexpected error: "${denyError}"`,
    );
  }

  // Step 3: Control — newChat with an allowed standard-tier model.
  let allowed = false;
  let allowError = null;
  let chatId = null;
  try {
    chatId = await auth.newChat("demo control message", ALLOW_MODEL);
    allowed = true;
  } catch (err) {
    allowError = err.message;
  }
  record(
    `newChat() with ${ALLOW_MODEL} succeeds (control)`,
    allowed,
    allowed ? `chat created (id: ${chatId})` : `failed: "${allowError}"`,
  );

  // Step 4: Try sendChatMessage with the frontier model on the control chat.
  if (allowed && chatId != null) {
    let switchDenied = false;
    let switchError = null;
    try {
      await auth.sendChatMessage(chatId, "switch test", DENY_MODEL);
    } catch (err) {
      switchDenied = true;
      switchError = err.message;
    }
    record(
      `sendChatMessage() with ${DENY_MODEL} is rejected`,
      switchDenied,
      switchDenied ? `server rejected: "${switchError}"` : "server accepted model switch (ENFORCEMENT BROKEN)",
    );
  }

  // Cleanup: dispose the RPC stub.
  try {
    stub[Symbol.dispose]();
  } catch {}

  summary();
}

function summary() {
  let passed = results.filter(r => r.passed).length;
  let failed = results.filter(r => !r.passed).length;
  console.log("");
  console.log(`=== SUMMARY: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.log("");
    console.log("FAILURES:");
    for (let r of results.filter(r => !r.passed)) {
      console.log(`  - ${r.name}: ${r.detail}`);
    }
    process.exit(1);
  } else {
    console.log("All checks passed — per-tier enforcement is working.");
    process.exit(0);
  }
}

main().catch(err => {
  console.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
