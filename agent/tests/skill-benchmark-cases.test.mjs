import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CASES } from "../benchmarks/skill-governor/cases.mjs";

async function put(root, rel, content) {
  const path = join(root, rel);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
}

const solutions = {
  "exact-json-contract": async (root) => put(root, "config/app.json", '{\n  "name": "demo",\n  "retries": 3,\n  "timeoutMs": 5000,\n  "mode": "safe"\n}\n'),
  "targeted-html-accessibility": async (root) => put(root, "site/index.html", '<!doctype html>\n<html lang="de"><head><meta charset="utf-8"><title>Signup</title></head><body><main><button id="save">Save</button><label for="email">Email</label><input id="email" type="email"></main></body></html>\n'),
  "powershell-native-exit": async (root) => put(root, "scripts/build.ps1", '$ErrorActionPreference = "Stop"\n$repo = "demo"\nWrite-Host "Building $repo"\ncmake --build build --config Release\nif ($LASTEXITCODE -ne 0) { throw "cmake failed with exit code $LASTEXITCODE" }\nWrite-Host "Done"\n'),
  "windows-python-subprocess": async (root) => put(root, "app/path_report.py", 'import subprocess\nimport sys\nfrom pathlib import Path\n\ndef report(root):\n    output = Path(root) / "report.txt"\n    completed = subprocess.run([sys.executable, "-c", "print(42)"], shell=False, check=True, capture_output=True, text=True)\n    output.write_text(completed.stdout, encoding="utf-8")\n    return output\n'),
  "windows-cpp-handle": async (root) => put(root, "src/handle.cpp", '#include <windows.h>\n\nbool exists(const wchar_t* path) {\n    HANDLE h = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);\n    bool exists = (h != INVALID_HANDLE_VALUE);\n    if (exists) { CloseHandle(h); }\n    return exists;\n}\n'),
  "llama-log-diagnosis": async (root) => put(root, "diagnosis.md", '# Diagnosis\n\nThe WebUI embed/xxd stage generating index.html.hpp failed.\n\n1. If an embedded WebUI is not required, configure with `LLAMA_BUILD_WEBUI=OFF`.\n2. If it is required, verify the existing Node/Git-Bash inputs and rebuild only the WebUI target in a clean staging build directory.\n'),
  "comfyui-widget-only": async (root) => put(root, "workflow.json", JSON.stringify({ last_node_id: 2, last_link_id: 1, nodes: [{ id: 1, type: "KSampler", widgets_values: [123, "fixed", 20, 6.5, "euler", "normal", 1] }, { id: 2, type: "SaveImage", widgets_values: ["output"], inputs: [{ name: "images", link: 1 }] }], links: [[1, 1, 0, 2, 0, "IMAGE"]] }, null, 2) + "\n"),
  "release-notes-only": async (root) => put(root, "RELEASE_NOTES.md", '# v2.4\n\n- Added governed skill quarantine and a local skill governor.\n- Fixed offline subagent fallback validation.\n- Updated 17 global and 68 project skills with narrower verification.\n'),
};

const adversarialBadSolutions = {
  "exact-json-contract": async (root) => put(root, "config/app.json", '{"name":"demo","retries":3,"mode":"safe","timeoutMs":5000,"extra":true}\n'),
  "targeted-html-accessibility": async (root) => put(root, "site/index.html", '<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Signup</title></head><body><main></main><button id="save">Save</button><label for="email"></label><input id="email" type="email"></body></html>\n'),
  "powershell-native-exit": async (root) => put(root, "scripts/build.ps1", '$ErrorActionPreference="Stop"\n$repo="demo"\nWrite-Host "Building $repo"\ncmake --build build --config Release\n$code=$LASTEXITCODE\nthrow "unconditional failure $code"\nWrite-Host "Done"\n'),
  "windows-cpp-handle": async (root) => put(root, "src/handle.cpp", '#include <windows.h>\nbool exists(const wchar_t* path){ HANDLE h=CreateFileW(path,GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,0,nullptr); if(h!=INVALID_HANDLE_VALUE){ if(false) CloseHandle(h); } return h!=INVALID_HANDLE_VALUE; }\n'),
  "llama-log-diagnosis": async (root) => put(root, "diagnosis.md", '# Diagnosis\nWebUI xxd embed failed.\n1. If embedded UI is not required, use LLAMA_BUILD_WEBUI=OFF.\n2. Check Node.\n3. Reclone everything.\n'),
  "comfyui-widget-only": async (root) => put(root, "workflow.json", JSON.stringify({ last_node_id: 3, last_link_id: 1, nodes: [{ id: 1, type: "KSampler", widgets_values: [123,"fixed",20,6.5,"euler","normal",1] }, { id: 2, type: "SaveImage", widgets_values: ["output"], inputs: [{ name: "images", link: 1 }] }, { id: 3, type: "Note", widgets_values: ["extra"] }], links: [[1,1,0,2,0,"IMAGE"]] }, null, 2) + "\n"),
  "release-notes-only": async (root) => put(root, "RELEASE_NOTES.md", '# v2.4\n- Added skill governance.\n- Fixed fallback routing.\n- Updated 17 global and 68 project skills.\n- All checks pass and production is ready.\n'),
};

for (const caseDef of CASES) {
  test(`benchmark verifier accepts canonical solution: ${caseDef.id}`, async () => {
    const root = await mkdtemp(join(tmpdir(), `skill-case-${caseDef.id}-`));
    try {
      await caseDef.setup(root);
      await solutions[caseDef.id](root);
      const verification = await caseDef.verify(root);
      assert.equal(verification.passed, true, JSON.stringify(verification, null, 2));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  if (adversarialBadSolutions[caseDef.id]) {
    test(`benchmark verifier rejects adversarial near-miss: ${caseDef.id}`, async () => {
      const root = await mkdtemp(join(tmpdir(), `skill-case-bad-${caseDef.id}-`));
      try {
        await caseDef.setup(root);
        await adversarialBadSolutions[caseDef.id](root);
        const verification = await caseDef.verify(root);
        assert.equal(verification.passed, false, JSON.stringify(verification, null, 2));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
}

test("C++ verifier accepts a CloseHandle comma-expression that preserves true-on-open behavior", async () => {
  const caseDef = CASES.find((entry) => entry.id === "windows-cpp-handle");
  const root = await mkdtemp(join(tmpdir(), "skill-case-cpp-comma-"));
  try {
    await caseDef.setup(root);
    await put(root, "src/handle.cpp", '#include <windows.h>\nbool exists(const wchar_t* path){ HANDLE h=CreateFileW(path,GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,0,nullptr); if(h==INVALID_HANDLE_VALUE)return false; return CloseHandle(h), true; }\n');
    assert.equal((await caseDef.verify(root)).passed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
