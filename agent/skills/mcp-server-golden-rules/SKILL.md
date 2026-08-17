---
name: "mcp-server-golden-rules"
description: "Design MCP servers, transports, schemas, CORS/session behavior, and tool boundaries against the current supported spec. Use for MCP implementation/debugging; do not use for generic REST APIs, inference tuning, or an MCP client-only task."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## When to Use
Use for MCP server architecture, tool/resource/prompt definitions, stdio or Streamable HTTP, schema validation, CORS/session bugs, and LLM-tool hardening. Confirm the repository's pinned MCP SDK/spec version before changing protocol behavior.

## Procedure
1. Separate resources (readable data), prompts (reusable templates), and tools (actions). Keep each tool focused with a precise schema and safe defaults.
2. Use stdio for local process integration with JSON-RPC-only stdout and logs on stderr.
3. Use Streamable HTTP for remote/browser integration (`POST /mcp`, protocol/session headers, optional streaming). Add legacy HTTP+SSE compatibility only when the target client requires it.
4. Validate every argument before side effects and return structured MCP/JSON-RPC errors instead of crashing.
5. Keep inference/GPU choices outside generic server code. Use `security-and-pentesting-golden-rules` for untrusted model/tool boundaries.
6. Preserve explicit task endpoints, paths, auth, and compatibility constraints; examples here do not replace them.

## Pitfalls
- Broad kitchen-sink tools are difficult for models to call correctly and hard to authorize.
- Logging to stdout corrupts stdio transport.
- CORS can succeed while required MCP session/protocol headers remain hidden from browsers.
- A current SDK may have changed the exact transport bootstrap; inspect installed types/docs rather than relying on historical snippets.

## Verification
1. Run the smallest server/unit test for changed schemas or handlers.
2. For transport changes, use MCP Inspector or one real client handshake and call one affected tool.
3. Verify stdout/stderr separation for stdio or session/protocol/CORS headers for HTTP.
4. Run prompt-injection/security tests only when the trust boundary or model-facing data path changed.
