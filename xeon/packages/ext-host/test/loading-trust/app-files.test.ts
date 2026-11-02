// Plugin App 파일 경로 풀이 시험(X.loading-trust.spec §4.3.4): 적대적인 요청 경로 표와 정확한 결과 값.
import { expect, test } from "bun:test";
import type { AppDecl } from "@fresnel/contracts/extensions";
import type { ResolveAppFileInput } from "../../src/loading-trust/app-files.ts";
import { resolveAppFile, type AppFileResult } from "../../src/loading-trust/index.ts";
import { memoryLoaderFs, type MemoryTree } from "./support/memory-loader-fs.ts";

const EXT = "/ext/demo";
const GRAPH = "/ext/demo/ui/graph";
const APP: AppDecl = {
  root: "./ui/graph",
  entry: "index.html",
  bridge: "^1.0.0",
  reason: "canvas",
};

const TREE: MemoryTree = {
  files: {
    "/ext/demo/ui/graph/index.html": "<html></html>",
    "/ext/demo/ui/graph/UPPER.HTML": "<html></html>",
    "/ext/demo/ui/graph/assets/app.js": "export {};",
    "/ext/demo/ui/graph/assets/logo.png": "png",
    "/ext/demo/ui/graph/payload.wasm": "wasm",
    "/ext/demo/ui/graph/README": "no extension",
    // 한 번만 푼 요청(`%252e%252e/secret.txt`)이 가리키는 문자 그대로의 이름
    "/ext/demo/ui/graph/%2e%2e/secret.txt": "literal name",
    "/ext/demo/secret.txt": "inside the extension, outside the app root",
    "/outside/secret.txt": "outside the extension",
    "/outside/index.html": "outside the extension",
  },
  links: {
    "/ext/demo/ui/graph/escape": "/outside",
    "/ext/demo/ui/graph/leak.txt": "/outside/secret.txt",
    "/ext/demo/ui/graph/inner.txt": "/ext/demo/secret.txt",
  },
};

const REJECT_OUTSIDE: AppFileResult = { ok: false, reason: "outside_root" };
const REJECT_NOT_FOUND: AppFileResult = { ok: false, reason: "not_found" };

/** 요청 경로 하나를 풀어 결과를 돌려준다. 시험마다 새 메모리 파일 시스템을 쓴다 */
function resolveWith(
  requestPath: string,
  app: AppDecl = APP,
  tree: MemoryTree = TREE,
): Promise<AppFileResult> {
  const input: ResolveAppFileInput = {
    extensionRoot: EXT,
    app,
    requestPath,
    fs: memoryLoaderFs(tree),
  };
  return resolveAppFile(input);
}

const CASES: readonly (readonly [string, AppFileResult])[] = [
  // 허용: 빈 요청은 entry, 나머지는 app root 안 파일
  ["", { ok: true, path: `${GRAPH}/index.html`, contentType: "text/html; charset=utf-8" }],
  [
    "UPPER.HTML",
    { ok: true, path: `${GRAPH}/UPPER.HTML`, contentType: "text/html; charset=utf-8" },
  ],
  [
    "assets/app.js",
    { ok: true, path: `${GRAPH}/assets/app.js`, contentType: "text/javascript; charset=utf-8" },
  ],
  ["assets/logo.png", { ok: true, path: `${GRAPH}/assets/logo.png`, contentType: "image/png" }],
  // 퍼센트 인코딩은 한 번만 푼다: 두 번 인코딩한 점은 `..`이 되지 않고 문자 그대로 이름이다
  [
    "%252e%252e/secret.txt",
    { ok: true, path: `${GRAPH}/%2e%2e/secret.txt`, contentType: "text/plain; charset=utf-8" },
  ],
  // 적대적 요청: 모두 outside_root
  ["../secret.txt", REJECT_OUTSIDE],
  ["%2e%2e/secret.txt", REJECT_OUTSIDE],
  ["assets/../../secret.txt", REJECT_OUTSIDE],
  ["/etc/passwd", REJECT_OUTSIDE],
  ["..%5csecret.txt", REJECT_OUTSIDE],
  ["%00index.html", REJECT_OUTSIDE],
  ["\u0000index.html", REJECT_OUTSIDE],
  ["C:/Windows/win.ini", REJECT_OUTSIDE],
  ["C:win.ini", REJECT_OUTSIDE],
  ["assets//app.js", REJECT_OUTSIDE],
  ["./index.html", REJECT_OUTSIDE],
  ["assets\\app.js", REJECT_OUTSIDE],
  ["%E0%A4%A", REJECT_OUTSIDE],
  ["escape/secret.txt", REJECT_OUTSIDE],
  ["leak.txt", REJECT_OUTSIDE],
  ["inner.txt", REJECT_OUTSIDE],
  // 모양은 맞지만 없거나, 폴더이거나, 허용 목록 밖이다
  ["missing.html", REJECT_NOT_FOUND],
  ["assets", { ok: false, reason: "not_a_file" }],
  ["payload.wasm", { ok: false, reason: "forbidden_type" }],
  ["README", { ok: false, reason: "forbidden_type" }],
];

for (const [requestPath, expected] of CASES) {
  test(`app file: ${JSON.stringify(requestPath)} resolves to ${JSON.stringify(expected)}`, async () => {
    expect(await resolveWith(requestPath)).toEqual(expected);
  });
}

test("app file: an app root that is a symlink outside the extension refuses every file", async () => {
  const tree: MemoryTree = {
    files: { "/outside/index.html": "outside the extension" },
    dirs: ["/ext/demo/ui"],
    links: { "/ext/demo/ui/evil": "/outside" },
  };
  const app: AppDecl = { ...APP, root: "./ui/evil" };
  expect(await resolveWith("", app, tree)).toEqual(REJECT_OUTSIDE);
});

test("app file: an app root or entry that leaves the extension is outside_root without touching the file system", async () => {
  const escapingRoot: AppDecl = { ...APP, root: "../other" };
  expect(await resolveWith("", escapingRoot)).toEqual(REJECT_OUTSIDE);
  const escapingEntry: AppDecl = { ...APP, entry: "../index.html" };
  expect(await resolveWith("", escapingEntry)).toEqual(REJECT_OUTSIDE);
});

test("app file: a missing app root is not_found", async () => {
  const absent: AppDecl = { ...APP, root: "./ui/none" };
  expect(await resolveWith("index.html", absent)).toEqual(REJECT_NOT_FOUND);
});

test("app file: the result path is the resolved real path, not the request spelling", async () => {
  const tree: MemoryTree = {
    files: { "/ext/demo/ui/graph/assets/app.js": "export {};" },
    links: { "/ext/demo/ui/graph/js": "/ext/demo/ui/graph/assets" },
  };
  expect(await resolveWith("js/app.js", APP, tree)).toEqual({
    ok: true,
    path: `${GRAPH}/assets/app.js`,
    contentType: "text/javascript; charset=utf-8",
  });
});

test("app file: the request is resolved through the fs port only (no reads of the file body)", async () => {
  const fs = memoryLoaderFs(TREE);
  await resolveAppFile({ extensionRoot: EXT, app: APP, requestPath: "assets/app.js", fs });
  expect(fs.read).toEqual([]);
});
