# Skill Governor

A small Pi 0.84.4 resource extension for deterministic, prompt-budget-conscious
skill routing. It uses native `resources_discover`, `before_agent_start`,
`formatSkillsForPrompt`, and dynamic active-tool APIs; it does not grant
permissions, intercept file or shell operations, or evolve skills automatically.

## Behavior

- Metadata ranking is deterministic and includes manual skills. English/German
  inflection prefixes of at least three characters supplement exact matching;
  exact name matches remain stronger.
- Cloud prompts receive at most three matching descriptors. With no explicit
  `customPrompt` or `appendSystemPrompt`, interactive local sessions replace
  Pi's verbose default with a concise read-first ASCII prompt and admit at most
  one deterministic compact metadata record only when the full UTF-8 string is
  at most `routing.maxLocalSystemPromptBytes` (900 by default). The local
  record contains the complete untruncated skill name, description, and absolute
  path, followed by a short instruction to read that path when relevant.
  Control characters and XML delimiters are escaped so metadata cannot break its
  record. If that complete record would exceed the cap, it is omitted and
  `capability_route` remains available. Cloud prompts retain native
  `formatSkillsForPrompt` `<skill>` blocks. Only non-empty explicit custom/append
  prompts take precedence: after removal of Pi's native skill block they are
  preserved exactly, never truncated; an oversized explicit prompt receives no Governor
  addition. Tool schemas are separate provider input and outside this
  system-prompt byte bound.
- Matched manual skills are normally readable through Pi progressive disclosure;
  reading instructions grants no consequential authority.
- `capability_route` reports bounded (320-character) metadata. In cloud or
  headless sessions it routes skills only. In interactive local sessions it may
  restore only tools removed by this governor's current local profile; tools
  initially inactive or blocked by configuration are never candidates.
- Local profile transitions restore only the governor-owned removal delta, not a
  stale whole-tool snapshot. A restored cloud baseline is no longer treated as a
  routed addition; only still-local routed tools are removed on the next
  non-extension user input.
- `/skill-governor` is a read-only status/search/audit command. Static audit and
  `skill:lint` are deterministic checks, not a sandbox or security boundary.

## Measurement and benchmark note

On 2026-08-30, the installed Pi 0.84.4 native auto-skill prompt measured 7,924
characters (about 1,981 by coarse `chars / 4`). v2.7 does not use that verbose
default for ordinary interactive local sessions: `Buffer.byteLength` enforces a
900-byte complete Governor-generated prompt. This leaves room below 1,000 tokens for provider role framing while remaining a conservative byte bound
for the target byte-fallback tokenizers, while provider tool schemas remain
separate.

The differential LLM benchmark was not rerun for v2.7; historic v2.4 rows are
not v2.7 release evidence.
