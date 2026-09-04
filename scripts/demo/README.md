# Demo Scripts

## deny-path-demo.mjs

Proves per-tier model enforcement (Sprint 5): a standard-tier user cannot use
a frontier-only model even by bypassing the UI and passing the modelId directly
to `newChat()` / `sendChatMessage()`.

### Prerequisites

- Node 24+ (provides a global `WebSocket`)
- The workshop deployed behind Cloudflare Access at `os.acme-studios.org`
- A `CF_Authorization` cookie for a user in the **ai-users** Access group

### Getting the CF Access JWT

1. Open `https://os.acme-studios.org` in a browser where you're signed in to
   Cloudflare Access as a user in the **ai-users** group (not ai-admins).
2. Open DevTools → Application → Cookies → `os.acme-studios.org`.
3. Copy the value of the `CF_Authorization` cookie.

Alternatively, use a Cloudflare Access service token to mint a JWT for a
service identity in the ai-users group.

### Running

```bash
CF_ACCESS_JWT="<paste CF_Authorization cookie value>" \
  node scripts/demo/deny-path-demo.mjs
```

Optional env vars:

| Var | Default | Description |
|---|---|---|
| `WORKSHOP_URL` | `https://os.acme-studios.org` | Workshop base URL |
| `DENY_MODEL` | `claude-opus-5` | Frontier-only model to test denial |
| `ALLOW_MODEL` | `@cf/zai-org/glm-5.2` | Standard-tier model to test success |

### Expected output

```
Connecting to wss://os.acme-studios.org/api ...
Authenticated via CF Access.
listModels() returned 7 models: @cf/moonshotai/kimi-k2.7-code, ...
[PASS] listModels() excludes claude-opus-5 (frontier-only): frontier model correctly hidden
[PASS] listModels() includes @cf/zai-org/glm-5.2 (standard-tier): standard model visible
[PASS] newChat() with claude-opus-5 is rejected: server rejected: "Model "claude-opus-5" is not available for your access tier."
[PASS] Error message is the tier enforcement error: correct tier error
[PASS] newChat() with @cf/zai-org/glm-5.2 succeeds (control): chat created (id: 1)
[PASS] sendChatMessage() with claude-opus-5 is rejected: server rejected: "..."

=== SUMMARY: 6 passed, 0 failed ===
All checks passed — per-tier enforcement is working.
```

### What it does

1. Connects via WebSocket to the Workshop RPC endpoint
2. Authenticates using the CF Access JWT (same path the browser uses)
3. Calls `listModels()` — verifies the frontier model is filtered out
4. Calls `newChat("msg", "claude-opus-5")` — verifies the server rejects it
   with the tier enforcement error (not just hidden from the UI)
5. Calls `newChat("msg", "@cf/zai-org/glm-5.2")` — verifies it succeeds (control)
6. Calls `sendChatMessage(chatId, "msg", "claude-opus-5")` — verifies model
   switching to a frontier model is also rejected

The script creates a throwaway chat but does not delete it. It does not modify
any user settings or models.
