---
name: "maintain-pandabot-llm-providers"
created: "2026-07-10"
description: "Maintain and verify PandaBot API, CLI-subscription, GUI runtime-switch, and SSH LLM backends. Manual-only; do not use for unrelated work."
version: 4
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when adding/changing PandaBot LLM providers, model discovery, GUI profiles, Google Gemma transport, subscription CLIs, or SSH tunnels in this repo.

## Procedure
1. Keep provider/profile persistence in llm_profiles.py, pure command/parsing helpers in cli_backends.py, tkinter orchestration in pandabot_gui.py, and request dispatch in pandabot.py.
2. For Google Gemma 4 use native v1beta generateContent, normalize gemma-4-26b-a4b to gemma-4-26b-a4b-it, migrate old /v1beta/openai/chat/completions base URLs, use at least 512 maxOutputTokens, retry transient 429/5xx, and extract only parts without thought=true.
3. For API model dropdowns call each credential's /models endpoint; Google uses native ListModels with generateContent filtering and pagination. Keep dropdowns editable.
4. For subscription backends use only official authenticated CLIs, argument-list subprocesses, an empty temporary cwd, conservative tool/read-only flags, timeouts, and provider-specific response parsers. Never reuse browser cookies or grant allow-all tools.
5. Discover Windows CLIs in `%APPDATA%\npm`, `~\.local\bin`, and WinGet Links before PATH; ignore the VS Code Copilot placeholder wrapper. Offer official npm installs (`@anthropic-ai/claude-code`, `@openai/codex`, `@google/gemini-cli`, `@github/copilot`) asynchronously, then re-resolve the executable before login.
6. Use `sv-ttk` for the modern cross-platform theme; launchers install requirements-gui.txt when missing while the bot continues to run from repo `.venv`.
7. For runtime switching, atomically write the active control profile and apply it before the next LLM request when PANDABOT_GUI_CONTROL=1; reopen aiohttp sessions when URL or timeout changes.
8. For SSH use system OpenSSH local forwarding with BatchMode, ExitOnForwardFailure, keepalive, process groups, monitored stderr, and graceful stop before kill.
9. Run `.venv/Scripts/python.exe -m ruff check .`, `.venv/Scripts/python.exe -m ruff format --check .`, `.venv/Scripts/python.exe -m pytest -q`, py_compile for core modules, and a withdrawn tkinter GUI smoke test.
## Pitfalls
- Old user .env files may still set GOOGLE_LLM_MAX_TOKENS=120 and the former OpenAI shim URL; clamp/migrate at runtime rather than requiring manual edits.
- Do not set thinkingLevel=minimal for gemma-4-26b-a4b-it; it has returned HTTP 500.
- Gemini and Copilot -p flags consume the following prompt value, so place -p last before run_cli appends the prompt.
- `shutil.which()` alone is insufficient on Windows: native Claude may live in `~\.local\bin` outside PATH, while VS Code may expose a broken `copilot` placeholder before the real npm/WinGet binary.
- Global npm install subprocesses must remain fixed registry metadata, never user-composed package names; keep installation off the tkinter main thread.
- Coding-agent CLIs may retain global MCP/extensions/account tools despite conservative flags; document this residual risk and isolate cwd.
- Secrets files and control files must stay gitignored and atomically written with best-effort 0600 permissions.
## Verification
1. All pytest tests pass without real network/CLI calls.
2. Ruff check and format check pass.
3. Live Google smoke (when explicitly appropriate) produces visible answers from both gemma-4-31b-it and gemma-4-26b-a4b-it without leaking thought parts.
4. Google ListModels includes both Gemma IDs and GUI smoke can instantiate PandaBotGUI.
5. git diff --check passes and no secrets/profile/control/subagent artifacts appear in git status.
