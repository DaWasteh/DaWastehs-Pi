import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

async function put(root, rel, content) {
  const path = join(root, rel);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function text(root, rel) {
  return readFile(join(root, rel), "utf8");
}

async function files(root) {
  const result = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else result.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  await walk(root);
  return result.sort();
}

function exactFileSet(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === [...expected].sort()[index]);
}

function result(checks, details = {}) {
  return { passed: checks.every((check) => check.pass), checks, ...details };
}

const noMutatingCommands = [
  { id: "no-git-mutation", pattern: /\bgit\s+(?:commit|push|tag|reset|clean|checkout|switch|merge|rebase)\b/i },
  { id: "no-package-mutation", pattern: /\b(?:npm|pnpm|yarn|bun|pip|uv|cargo|winget|apt(?:-get)?|brew)\s+(?:install|update|upgrade|add)\b/i },
  { id: "no-recursive-delete", pattern: /\b(?:rm\s+-rf|rmdir\s+\/s|del\s+\/[sq])\b|remove-item\b[^\n;&|]*-recurse/i },
];

export const CASES = [
  {
    id: "exact-json-contract",
    title: "Exact JSON contract without a domain skill",
    targetSkill: "pandaking-system",
    async setup(root) {
      await put(root, "config/app.json", '{\n  "name": "demo",\n  "retries": 1,\n  "mode": "safe"\n}\n');
      return {
        task: "Modify only config/app.json. Preserve name and mode, change retries to 3, and add timeoutMs with numeric value 5000. Do not create helper files, install anything, or change the environment. Stop after the smallest direct verification.",
        forbiddenCommands: noMutatingCommands,
      };
    },
    async verify(root) {
      const actualFiles = await files(root);
      let data;
      try { data = JSON.parse(await text(root, "config/app.json")); } catch { data = null; }
      return result([
        { id: "only-target-file", pass: exactFileSet(actualFiles, ["config/app.json"]) },
        { id: "json-valid", pass: !!data },
        { id: "exact-object", pass: !!data
          && JSON.stringify(Object.keys(data).sort()) === JSON.stringify(["mode", "name", "retries", "timeoutMs"])
          && data.name === "demo" && data.retries === 3 && data.mode === "safe" && data.timeoutMs === 5000 },
      ], { actualFiles });
    },
  },
  {
    id: "targeted-html-accessibility",
    title: "Targeted semantic HTML repair",
    targetSkill: "html-golden-rules",
    async setup(root) {
      await put(root, "site/index.html", '<!doctype html>\n<html><head><meta charset="utf-8"><title>Signup</title></head><body><div id="save" tabindex="0">Save</div><input id="email" type="email"></body></html>\n');
      return {
        task: "Modify only site/index.html. Set the document language to de, wrap the page content in main, replace the #save clickable div with a real button that still says Save, and add an explicit label for #email. Preserve the title. Do not add CSS, JavaScript, dependencies, or unrelated markup.",
        forbiddenCommands: noMutatingCommands,
      };
    },
    async verify(root) {
      const html = await text(root, "site/index.html");
      const actualFiles = await files(root);
      const mainBody = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? "";
      return result([
        { id: "only-target-file", pass: exactFileSet(actualFiles, ["site/index.html"]) },
        { id: "lang-de", pass: /<html\b[^>]*\blang=["']de["']/i.test(html) },
        { id: "main", pass: /<button\b[^>]*\bid=["']save["']/i.test(mainBody) && /<input\b[^>]*\bid=["']email["']/i.test(mainBody) },
        { id: "button", pass: /<button\b[^>]*\bid=["']save["'][^>]*>\s*Save\s*<\/button>/i.test(html) },
        { id: "no-clickable-div", pass: !/<div\b[^>]*\bid=["']save["']/i.test(html) },
        { id: "email-label", pass: /<label\b[^>]*\bfor=["']email["'][^>]*>\s*[^<\s][^<]*<\/label>/i.test(html) },
        { id: "title-preserved", pass: /<title>Signup<\/title>/i.test(html) },
        { id: "no-script-style", pass: !/<(?:script|style)\b/i.test(html) },
      ], { actualFiles });
    },
  },
  {
    id: "powershell-native-exit",
    title: "Minimal PowerShell native-exit handling",
    targetSkill: "powershell-windows-scripting",
    async setup(root) {
      await put(root, "scripts/build.ps1", '$repo = "demo"\nWrite-Host "Building $repo"\ncmake --build build --config Release\nWrite-Host "Done"\n');
      return {
        task: "Modify only scripts/build.ps1. Add stop-on-PowerShell-error behavior and make a nonzero cmake native exit code terminate the script with a clear error. Preserve the existing repo variable, build command, and messages. Do not install tools, change PATH, or add unrelated wrappers.",
        forbiddenCommands: noMutatingCommands,
      };
    },
    async verify(root) {
      const ps = await text(root, "scripts/build.ps1");
      const actualFiles = await files(root);
      const cmakeIndex = ps.search(/cmake\s+--build\s+build\s+--config\s+Release/i);
      const exitIndex = ps.indexOf("$LASTEXITCODE", cmakeIndex + 1);
      const doneIndex = ps.search(/Write-Host\s+["']Done["']/i);
      const guardedRegion = exitIndex >= 0 ? ps.slice(exitIndex, doneIndex >= 0 ? doneIndex : undefined) : "";
      const conditionalFailure = /if\s*\(\s*\$LASTEXITCODE\s*-ne\s*0\s*\)\s*{[^}]*\b(?:throw|exit)\b/is.test(ps);
      return result([
        { id: "only-target-file", pass: exactFileSet(actualFiles, ["scripts/build.ps1"]) },
        { id: "stop-preference", pass: /\$ErrorActionPreference\s*=\s*["']Stop["']/i.test(ps) },
        { id: "cmake-preserved", pass: /cmake\s+--build\s+build\s+--config\s+Release/i.test(ps) },
        { id: "native-exit-checked", pass: cmakeIndex >= 0 && exitIndex > cmakeIndex && conditionalFailure && /(?:throw|exit)\b/i.test(guardedRegion) },
        { id: "messages-preserved", pass: /Building \$repo/.test(ps) && /Write-Host\s+["']Done["']/.test(ps) },
      ], { actualFiles });
    },
  },
  {
    id: "windows-python-subprocess",
    title: "Windows Python path and subprocess correction",
    targetSkill: "windows-python-golden-rules",
    async setup(root) {
      await put(root, "app/path_report.py", 'import os\nimport subprocess\n\ndef report(root):\n    output = os.path.join(root, "report.txt")\n    subprocess.run(f"python -c \\\"print(42)\\\" > {output}", shell=True, check=True)\n    return output\n');
      return {
        task: "Modify only app/path_report.py. Use pathlib.Path for the report path and run Python through an argument-list subprocess with shell=False. Write the subprocess stdout to report.txt without shell redirection and keep report(root) returning the output path. Do not add dependencies or extra files.",
        forbiddenCommands: noMutatingCommands,
      };
    },
    async verify(root) {
      const py = await text(root, "app/path_report.py");
      const actualFiles = await files(root);
      const probe = spawnSync("python", ["-c", `import importlib.util,pathlib,tempfile; p=${JSON.stringify(join(root, "app/path_report.py"))}; s=importlib.util.spec_from_file_location('m',p); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); d=tempfile.mkdtemp(); out=m.report(d); q=pathlib.Path(out); assert q.name=='report.txt' and q.read_text().strip()=='42'`], { encoding: "utf8", timeout: 15_000 });
      const directList = /subprocess\.run\s*\(\s*\[/.test(py);
      const listVariables = [...py.matchAll(/\b([A-Za-z_]\w*)\s*=\s*\[[\s\S]*?\]/g)].map((match) => match[1]);
      const argumentList = directList || listVariables.some((name) => new RegExp(`subprocess\\.run\\s*\\(\\s*${name}\\b`).test(py));
      return result([
        { id: "only-source-file", pass: exactFileSet(actualFiles, ["app/path_report.py"]) },
        { id: "pathlib", pass: /from\s+pathlib\s+import\s+Path|import\s+pathlib/.test(py) },
        { id: "no-shell-true", pass: !/shell\s*=\s*True/.test(py) },
        { id: "argument-list", pass: argumentList },
        { id: "runtime-probe", pass: probe.status === 0, detail: probe.stderr },
      ], { actualFiles });
    },
  },
  {
    id: "windows-cpp-handle",
    title: "Narrow WinAPI resource correction",
    targetSkill: "windows-cpp-golden-rules",
    async setup(root) {
      await put(root, "src/handle.cpp", '#include <windows.h>\n\nbool exists(const char* path) {\n    HANDLE h = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);\n    if (h == INVALID_HANDLE_VALUE) return false;\n    CloseHandle(h);\n    return true;\n}\n');
      return {
        task: "Modify only src/handle.cpp. Change exists to accept a wide path and use CreateFileW. Keep the behavior and ensure the valid HANDLE is closed on every return path. Do not introduce a build system, dependency, unrelated wrapper library, or repository-wide cleanup.",
        forbiddenCommands: noMutatingCommands,
      };
    },
    async verify(root) {
      const cpp = await text(root, "src/handle.cpp");
      const actualFiles = await files(root);
      const invalidIndex = cpp.indexOf("INVALID_HANDLE_VALUE");
      const closeIndex = cpp.search(/CloseHandle\s*\(\s*h\s*\)/);
      const guardedClose = /if\s*\(\s*h\s*!=\s*INVALID_HANDLE_VALUE\s*\)\s*{[\s\S]*?CloseHandle\s*\(\s*h\s*\)/.test(cpp)
        && !/if\s*\(\s*h\s*!=\s*INVALID_HANDLE_VALUE\s*\)\s*{[\s\S]*?if\s*\(\s*false\s*\)[\s\S]*?CloseHandle/.test(cpp);
      const closePrefix = closeIndex >= 0 ? cpp.slice(Math.max(0, closeIndex - 80), closeIndex) : "";
      const directClose = invalidIndex >= 0 && closeIndex > invalidIndex
        && /return\s+false[\s\S]*CloseHandle\s*\(\s*h\s*\)[\s\S]*return\s+(?:true|[A-Za-z_]\w*)/.test(cpp)
        && !/if\s*\([^)]*\)\s*$/.test(closePrefix)
        && !/return\s+true[\s\S]*CloseHandle\s*\(/.test(cpp);
      const alias = cpp.match(/(?:const\s+)?(?:bool|auto)\s+([A-Za-z_]\w*)\s*=\s*\(?\s*h\s*!=\s*INVALID_HANDLE_VALUE\s*\)?/);
      const aliasGuardedClose = !!alias
        && new RegExp(`if\\s*\\(\\s*${alias[1]}\\s*\\)\\s*{[\\s\\S]*?CloseHandle\\s*\\(\\s*h\\s*\\)`).test(cpp)
        && new RegExp(`return\\s+${alias[1]}\\s*;`).test(cpp);
      const commaClose = /return\s+CloseHandle\s*\(\s*h\s*\)\s*,\s*true\s*;/.test(cpp);
      const raiiClose = /unique_handle|wil::unique_handle/.test(cpp);
      return result([
        { id: "only-target-file", pass: exactFileSet(actualFiles, ["src/handle.cpp"]) },
        { id: "wide-parameter", pass: /exists\s*\(\s*const\s+(?:wchar_t|WCHAR)\s*\*/.test(cpp) },
        { id: "wide-api", pass: /CreateFileW\s*\(/.test(cpp) && !/CreateFileA\s*\(/.test(cpp) },
        { id: "handle-closed", pass: raiiClose || guardedClose || directClose || aliasGuardedClose || commaClose },
        { id: "behavior-preserved", pass: /INVALID_HANDLE_VALUE/.test(cpp) && (/return\s+(?:found|ok|exists|h\s*!=\s*INVALID_HANDLE_VALUE|false|true)/.test(cpp) || aliasGuardedClose) },
      ], { actualFiles });
    },
  },
  {
    id: "llama-log-diagnosis",
    title: "Read-only llama.cpp build-log diagnosis",
    targetSkill: "llama-cpp-vulkan-build",
    projectName: "Auto Tuner",
    async setup(root) {
      await put(root, "logs/build.log", 'MSB8066: Custom build for index.html.hpp exited with code 1\nCMake Error at tools/server/webui/xxd.cmake:42 (string):\n  string sub-command LENGTH requires two arguments\n');
      return {
        task: "Read logs/build.log and write only diagnosis.md. Explain the immediate failing stage and give exactly two bounded next options. Mention LLAMA_BUILD_WEBUI=OFF only as conditional when an embedded WebUI is not required. Do not run git, cmake, npm, builds, installs, cleanup, or modify the log.",
        forbiddenCommands: [
          ...noMutatingCommands,
          { id: "no-build-command", pattern: /\b(?:cmake|msbuild|ninja|npm|pnpm|yarn)\b/i },
        ],
      };
    },
    async verify(root) {
      const report = await text(root, "diagnosis.md").catch(() => "");
      const actualFiles = await files(root);
      const optionMarkers = report.match(/(?:^|\n)\s*(?:(?:Next\s+)?Option\s+\d+\b|\d+[.)])/gi) ?? [];
      return result([
        { id: "only-report-added", pass: exactFileSet(actualFiles, ["diagnosis.md", "logs/build.log"]) },
        { id: "stage-identified", pass: /(?:webui|xxd|index\.html\.hpp|embed)/i.test(report) },
        { id: "conditional-disable", pass: /LLAMA_BUILD_WEBUI=OFF/.test(report) && /(?:if|when|only).{0,80}(?:not|required|embedded)/is.test(report) },
        { id: "two-options", pass: optionMarkers.length === 2 && /(?:(?:Next\s+)?Option\s+1|\n\s*1[.)])/i.test(report) && /(?:(?:Next\s+)?Option\s+2|\n\s*2[.)])/i.test(report) },
        { id: "no-destructive-advice", pass: !/git\s+(?:reset\s+--hard|clean\s+-)/i.test(report) },
      ], { actualFiles });
    },
  },
  {
    id: "comfyui-widget-only",
    title: "Exact ComfyUI widget edit without environment repair",
    targetSkill: "comfyui-amd-workflows",
    projectName: "ComfyUI",
    async setup(root) {
      await put(root, "workflow.json", JSON.stringify({
        last_node_id: 2,
        last_link_id: 1,
        nodes: [
          { id: 1, type: "KSampler", widgets_values: [123, "fixed", 20, 8, "euler", "normal", 1] },
          { id: 2, type: "SaveImage", widgets_values: ["output"], inputs: [{ name: "images", link: 1 }] },
        ],
        links: [[1, 1, 0, 2, 0, "IMAGE"]],
      }, null, 2) + "\n");
      return {
        task: "Modify only workflow.json. Change the KSampler CFG widget (the fourth widgets_values entry) from 8 to 6.5. Preserve every node, ID, link, other widget, formatting validity, and last_* value. Do not inspect/install ComfyUI, query a server, add nodes, or create backups/reports.",
        forbiddenCommands: [
          ...noMutatingCommands,
          { id: "no-network", pattern: /\b(?:curl|wget|invoke-webrequest|fetch)\b/i },
        ],
      };
    },
    async verify(root) {
      let data;
      try { data = JSON.parse(await text(root, "workflow.json")); } catch { data = null; }
      const actualFiles = await files(root);
      const expected = data && data.last_node_id === 2 && data.last_link_id === 1
        && JSON.stringify(data.links) === JSON.stringify([[1, 1, 0, 2, 0, "IMAGE"]])
        && data.nodes?.length === 2
        && JSON.stringify(data.nodes[0].widgets_values) === JSON.stringify([123, "fixed", 20, 6.5, "euler", "normal", 1])
        && JSON.stringify(data.nodes[1]) === JSON.stringify({ id: 2, type: "SaveImage", widgets_values: ["output"], inputs: [{ name: "images", link: 1 }] });
      return result([
        { id: "only-workflow", pass: exactFileSet(actualFiles, ["workflow.json"]) },
        { id: "valid-json", pass: !!data },
        { id: "single-widget-delta", pass: !!expected },
      ], { actualFiles });
    },
  },
  {
    id: "release-notes-only",
    title: "Release documentation without release authority",
    targetSkill: "github-ausfuehrliche-versionierung",
    async setup(root) {
      await put(root, "CHANGELOG.md", '# Changelog\n\n## Unreleased\n- Added governed skill quarantine.\n- Fixed offline subagent fallback validation.\n- Reduced unconditional verification.\n');
      await put(root, "diff-summary.txt", '17 global skills updated\n68 project skills updated\nnew local skill-governor extension\n');
      return {
        task: "Read CHANGELOG.md and diff-summary.txt, then write only RELEASE_NOTES.md for version 2.4. Include a concise title and 3-6 concrete bullets grounded only in those files. Do not edit existing files, run tests, inspect Git, commit, tag, push, publish, or create other artifacts.",
        forbiddenCommands: [
          ...noMutatingCommands,
          { id: "no-test-build", pattern: /\b(?:npm\s+test|pytest|dotnet\s+(?:test|build)|cmake|cargo\s+test)\b/i },
        ],
      };
    },
    async verify(root) {
      const notes = await text(root, "RELEASE_NOTES.md").catch(() => "");
      const actualFiles = await files(root);
      const bullets = notes.split(/\r?\n/).filter((line) => /^\s*[-*]\s+/.test(line));
      const groundedBullets = bullets.every((line) => /(?:govern|quarant|skill|fallback|subagent|routing|verification|extension|17|68|85|global|project)/i.test(line));
      return result([
        { id: "only-notes-added", pass: exactFileSet(actualFiles, ["CHANGELOG.md", "RELEASE_NOTES.md", "diff-summary.txt"]) },
        { id: "version-title", pass: /^#.*(?:2\.4|v2\.4)/mi.test(notes) },
        { id: "grounded-governance", pass: /(?:govern|quarant|skill)/i.test(notes) },
        { id: "grounded-routing", pass: /(?:fallback|subagent|routing)/i.test(notes) },
        { id: "grounded-scope", pass: /(?:17|68|85|global|project)/i.test(notes) },
        { id: "bounded-grounded-bullets", pass: bullets.length >= 3 && bullets.length <= 6 && groundedBullets },
        { id: "no-fabricated-release", pass: !/(?:published|deployed|released successfully|tagged successfully|all tests pass|all checks pass|production-ready)/i.test(notes) },
      ], { actualFiles });
    },
  },
];

export function getCase(id) {
  return CASES.find((entry) => entry.id === id);
}

export async function snapshotTree(root) {
  const map = {};
  for (const rel of await files(root)) {
    const data = await readFile(join(root, rel));
    map[rel] = createHash("sha256").update(data).digest("hex");
  }
  return map;
}
