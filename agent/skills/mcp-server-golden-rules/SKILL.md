---
name: mcp-server-golden-rules
description: "Build MCP servers against the 2025-06-18 spec using Streamable HTTP instead of deprecated HTTP+SSE. Use for MCP server architecture, transports, tool schemas, CORS/session debugging, and LLM-tool hardening."
---

# MCP Server Golden Rules (Spec 2025-06-18)

## Capability model
- Resources = readable data/URIs, Prompts = reusable templates, Tools = actions. Keep them separate.
- One tool = one responsibility; precise JSON Schema with descriptions, enums, nullable fields, safe defaults. Kitchen-sink tools confuse the model.

## Transport contract
- Local desktop/IDE: `stdio` — stdout carries only JSON-RPC, logs go to stderr.
- Remote/web: **Streamable HTTP** (`POST /mcp`, server-issued `Mcp-Session-Id`, optional SSE upgrade). HTTP+SSE is deprecated, compatibility fallback only.

## Boundaries, async, errors
- The MCP server stays backend-agnostic; inference/GPU choices belong in `amd-dual-gpu-inference`, not in generic server code.
- async/await for filesystem/network/tool work; validate arguments before side effects; return structured JSON-RPC errors (`-32xxx`) instead of crashing.
- LLM/prompt-injection boundaries → `security-and-pentesting-golden-rules`.

## Verification
`npx @modelcontextprotocol/inspector <start-command>` lists and calls every tool; remote server accepts `POST /mcp` and respects `Mcp-Session-Id`; stdio keeps stdout/stderr separated; CORS exposes MCP session/protocol headers for browser/llama.cpp-WebUI clients.
