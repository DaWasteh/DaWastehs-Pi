---
name: llama-mcp-server
description: "Working on the local filesystem MCP server for llama.cpp WebUI at C:\\LAB\\llama-mcp-server. Use for any MCP server change, FastMCP/transport question, CORS or connection failure between llama.cpp WebUI and an MCP endpoint, or new MCP tool development on this system. Do not use for unrelated work."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit task requirements and repository evidence override this skill; use only the portion relevant to the current change and treat historical versions, counts, and paths as evidence to re-check.

# Local Filesystem MCP Server (FastMCP / HTTP)

## Project layout
- `L:\GitHub\llama-mcp\` (+ venv); GitHub remote is `github.com/DaWasteh/llama-mcp.git`.
- Since the v0.8 server split there are TWO servers sharing `server_common.py` (HTTP bootstrap): filesystem server via `server_dateisystem.bat` on port 8765 (37 tools) and research server via `server_recherche.bat` on port 8766 (10 tools), each with its own `requirements-*.txt` (`mcp[cli]>=1.27.0` pulls uvicorn/starlette). Launcher .bat files are prefixed `server_` by convention.
- Endpoints: `http://127.0.0.1:8765/mcp` and `http://127.0.0.1:8766/mcp` — the `/mcp` path is REQUIRED; entering the bare root URL in the WebUI is the classic 404 cause.

## Architecture decisions (keep these)
- **FastMCP high-level API**, not the low-level Server class: tool schemas auto-generate from type hints + docstrings; no manual `inputSchema`, no `InitializationOptions` boilerplate (which required `server_name`, `server_version`, `capabilities` in SDK >= 1.0 and was the original crash cause).
- **Transport: streamable-http** — llama.cpp WebUI needs a URL, stdio does not work there.
- **CORS**: wrap `mcp.streamable_http_app()` with Starlette `CORSMiddleware`, exposing `mcp-session-id` and `mcp-protocol-version` headers; run uvicorn directly for middleware control. Health-check route at `/`.

## Windows correctness rules for this codebase
- `BLOCKED_PATHS` comparisons must be case-insensitive (normcase both sides).
- No emoji prints; `run_server.bat` starts with `chcp 65001` + `PYTHONUTF8=1`, checks errorlevels, `pause` on failure.
- Mypy: guard `sys.stderr.reconfigure()` with `isinstance(sys.stderr, io.TextIOWrapper)` instead of type-ignore comments.
- Implement declared tool parameters fully (e.g. `list_directory(recursive=...)`) — no dead parameters or unused variables.

## When extending
New tools: plain typed Python functions with docstrings registered on the FastMCP instance. Path-taking tools must resolve + validate against the allowlist/blocklist BEFORE any filesystem call.

## Verification
1. For a tool-only change, run the focused unit/schema test and call that tool once through MCP Inspector or the local client.
2. For transport/CORS/session changes, verify the health route plus one real WebUI handshake to `/mcp` and inspect exposed protocol/session headers.
3. Do not require both servers or all 47 tools to run for an isolated implementation change; broaden only for shared `server_common.py` or release scope.
