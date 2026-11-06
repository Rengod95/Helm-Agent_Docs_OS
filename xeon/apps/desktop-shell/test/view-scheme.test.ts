import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Result } from "@fresnel/contracts";
import { fakeCtx } from "./support/fake-ctx.ts";
import {
  createAppRoots,
  frameCsp,
  MAX_FILE_BYTES,
  MAX_ROOTS,
  parseAppRootEntries,
  parseUri,
  respond,
  resolve,
  statusOf,
  validExtensionName,
  validVersion,
  viewSchemeModule,
  type AppFile,
  type AppRootInput,
  type AppRoots,
  type Rejection,
  type Refusal,
  type Tier,
} from "../src/main/view-scheme.ts";

// 글자 검사 기준은 옛 Tauri 구현(커밋 424f338a)의 `view_scheme.rs` 시험과 `packages/client/src/views/app/scheme.ts`의 출력이다.
// desktop-shell은 packages/client에 닿지 않으므로(L4끼리 import 금지, DR-10 허용 목록에 없다) TS 출력의 글자를 여기에 옮겨 적는다.

/** `appFrameCsp("fresnel-view://helm/1.0.0/")`의 출력과 같다 */
const FRAME_CSP_HELM =
  "default-src 'none'; script-src fresnel-view://helm/1.0.0/; style-src fresnel-view://helm/1.0.0/ 'unsafe-inline'; img-src fresnel-view://helm/1.0.0/ data: blob:; font-src fresnel-view://helm/1.0.0/; media-src fresnel-view://helm/1.0.0/ blob:; connect-src 'none'; frame-src 'none'; worker-src fresnel-view://helm/1.0.0/ blob:; form-action 'none'; base-uri 'none'";

/** `appResponseHeaders("text/html; charset=utf-8", base)`의 헤더 이름과 값(Content-Type과 CSP 제외) */
const FIXED_FRAME_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), display-capture=(), clipboard-read=(), clipboard-write=(), payment=(), usb=()",
};

/** 확장자 → Content-Type 표(Rust `CONTENT_TYPES`, TS `resolveAppFile`과 같다) */
const CONTENT_TYPE_TABLE: readonly (readonly [string, string])[] = [
  ["html", "text/html; charset=utf-8"],
  ["js", "text/javascript; charset=utf-8"],
  ["mjs", "text/javascript; charset=utf-8"],
  ["css", "text/css; charset=utf-8"],
  ["json", "application/json; charset=utf-8"],
  ["map", "application/json; charset=utf-8"],
  ["txt", "text/plain; charset=utf-8"],
  ["svg", "image/svg+xml"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["woff", "font/woff"],
  ["woff2", "font/woff2"],
  ["ttf", "font/ttf"],
];

const created: string[] = [];

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

interface Sandbox {
  /** 실제 경로인 임시 폴더. 이 밖에 `secret.txt`가 있다 */
  readonly dir: string;
  /** `extensions/helm/ui`, 시험의 app root */
  readonly ui: string;
}

/** Rust `Sandbox::new`와 같은 파일들을 만든다. 실제 경로로 두어 macOS의 `/var` → `/private/var` 링크에 흔들리지 않게 한다 */
function makeSandbox(): Sandbox {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "fresnel-view-scheme-")));
  created.push(dir);
  const ui = path.join(dir, "extensions/helm/ui");
  mkdirSync(path.join(ui, "sub"), { recursive: true });
  writeFileSync(path.join(ui, "index.html"), "<html>ok</html>");
  writeFileSync(path.join(ui, "app.js"), "1");
  writeFileSync(path.join(ui, "sub/a.css"), "a{}");
  writeFileSync(path.join(ui, "x.wasm"), "\0asm");
  writeFileSync(path.join(ui, "UP.JS"), "2");
  writeFileSync(path.join(dir, "secret.txt"), "SECRET");
  writeFileSync(path.join(dir, "extensions/helm/other.txt"), "OTHER");
  return { dir, ui };
}

function entryFor(root: string, overrides: Partial<AppRootInput> = {}): AppRootInput {
  return {
    extension: "helm",
    version: "1.0.0",
    root,
    entry: "index.html",
    trust: "user",
    ...overrides,
  };
}

/** 사용자 등급 `helm 1.0.0`이 `ui`를 가리키는 목록을 등록한다 */
function rootsOf(sandbox: Sandbox): AppRoots {
  const roots = createAppRoots();
  const result = roots.replace([entryFor(sandbox.ui)], undefined);
  expect(result).toEqual({ ok: true, value: [] });
  return roots;
}

function get(roots: AppRoots, tail: string): Promise<Result<AppFile, Refusal>> {
  return resolve(roots, `fresnel-view://helm/1.0.0/${tail}`);
}

/** 성공이면 본문과 Content-Type, 거절이면 던진다(시험 본문에서 `as`를 쓰지 않으려고 둔 도우미) */
function served(result: Result<AppFile, Refusal>): { text: string; contentType: string } {
  if (!result.ok) throw new Error(`refused: ${result.error.kind}`);
  return {
    text: new TextDecoder().decode(result.value.body),
    contentType: result.value.contentType,
  };
}

/** 거절 이유 이름. 성공이면 "served" */
async function refusal(roots: AppRoots, tail: string): Promise<string> {
  const result = await get(roots, tail);
  return result.ok ? "served" : result.error.kind;
}

describe("frame CSP and name rules", () => {
  test("frameCsp matches the TS appFrameCsp output", () => {
    expect(frameCsp("fresnel-view://helm/1.0.0/")).toBe(FRAME_CSP_HELM);
  });

  test("name and version rules", () => {
    const names = ["helm", "a", "a-b-1", "", "1a", "A", "a_b", "a/b", "a.b", "a".repeat(65)];
    expect(names.map((name) => [name, validExtensionName(name)])).toEqual([
      ["helm", true],
      ["a", true],
      ["a-b-1", true],
      ["", false],
      ["1a", false],
      ["A", false],
      ["a_b", false],
      ["a/b", false],
      ["a.b", false],
      ["a".repeat(65), false],
    ]);
    const versions = [
      "1.0.0",
      "10.20.30",
      "1.0.0-rc.1",
      "1.0",
      "1.0.0.0",
      "a.b.c",
      "1.0.0-",
      "1.0.0-a/b",
      "latest",
      "",
    ];
    expect(versions.map((version) => [version, validVersion(version)])).toEqual([
      ["1.0.0", true],
      ["10.20.30", true],
      ["1.0.0-rc.1", true],
      ["1.0", false],
      ["1.0.0.0", false],
      ["a.b.c", false],
      ["1.0.0-", false],
      ["1.0.0-a/b", false],
      ["latest", false],
      ["", false],
    ]);
  });

  test("rejection statuses match Rust Rejection::status", () => {
    const expected: readonly (readonly [Rejection, number])[] = [
      ["bad_request", 400],
      ["outside_root", 403],
      ["forbidden_type", 403],
      ["not_found", 404],
      ["not_a_file", 404],
      ["method_not_allowed", 405],
      ["too_large", 413],
    ];
    for (const [kind, status] of expected) {
      expect({ kind, status: statusOf(kind) }).toEqual({ kind, status });
    }
  });
});

describe("URI shape", () => {
  test("uri_shape_is_checked", async () => {
    const badUris = [
      "https://helm/1.0.0/a.js",
      "fresnel-view://helm/latest/a.js",
      "fresnel-view://user@helm/1.0.0/a.js",
      "fresnel-view://helm:80/1.0.0/a.js",
      "fresnel-view://HELM/1.0.0/a.js",
      "fresnel-view://helm/1.0.0/a.js?x=1",
      "fresnel-view://helm/1.0.0/a.js#x",
      "fresnel-view://helm",
      "fresnel-view:///1.0.0/a.js",
    ];
    expect(badUris.map((uri) => parseUri(uri))).toEqual(badUris.map(() => undefined));
    expect(parseUri("fresnel-view://helm/1.0.0/ui/a.js")).toEqual({
      extension: "helm",
      version: "1.0.0",
      tail: "ui/a.js",
    });
    // 등록되지 않은 확장이나 버전은 찾지 못한다
    const sandbox = makeSandbox();
    const roots = rootsOf(sandbox);
    expect(await resolve(roots, "fresnel-view://other/1.0.0/index.html")).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(await resolve(roots, "fresnel-view://helm/2.0.0/index.html")).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
  });
});

describe("serving files", () => {
  test("serves entry and files with their content type", async () => {
    const sandbox = makeSandbox();
    const roots = rootsOf(sandbox);
    expect(served(await get(roots, ""))).toEqual({
      text: "<html>ok</html>",
      contentType: "text/html; charset=utf-8",
    });
    expect(served(await get(roots, "app.js"))).toEqual({
      text: "1",
      contentType: "text/javascript; charset=utf-8",
    });
    expect(served(await get(roots, "sub/a.css"))).toEqual({
      text: "a{}",
      contentType: "text/css; charset=utf-8",
    });
    // 확장자는 대소문자를 가리지 않는다
    expect(served(await get(roots, "UP.JS")).contentType).toBe("text/javascript; charset=utf-8");
  });

  test("every allow-listed extension gets its table content type", async () => {
    const sandbox = makeSandbox();
    const roots = rootsOf(sandbox);
    for (const [ext] of CONTENT_TYPE_TABLE) {
      writeFileSync(path.join(sandbox.ui, `t.${ext}`), "x");
    }
    const results = await Promise.all(
      CONTENT_TYPE_TABLE.map(async ([ext]) => {
        const result = await get(roots, `t.${ext}`);
        return { ext, contentType: result.ok ? result.value.contentType : result.error.kind };
      }),
    );
    expect(results).toEqual(CONTENT_TYPE_TABLE.map(([ext, type]) => ({ ext, contentType: type })));
  });

  test("hostile_requests_are_refused_with_fixed_reasons", async () => {
    const sandbox = makeSandbox();
    const roots = rootsOf(sandbox);
    const cases: readonly (readonly [string, string])[] = [
      ["../secret.txt", "outside_root"],
      ["%2e%2e/secret.txt", "outside_root"],
      ["sub/%2E%2E/%2E%2E/secret.txt", "outside_root"],
      ["a//b", "outside_root"],
      ["./app.js", "outside_root"],
      ["sub/./a.css", "outside_root"],
      ["%5Capp.js", "outside_root"],
      ["app.js%00.png", "outside_root"],
      ["%2Fetc%2Fpasswd", "outside_root"],
      ["C:/Windows/win.ini", "outside_root"],
      ["%GG", "outside_root"],
      ["%C3%28", "outside_root"],
      // 두 번 인코딩한 `..`은 한 번만 풀어 글자 그대로의 마디가 된다. 그런 이름의 파일이 없으니 찾지 못한 것이다
      ["%252e%252e/secret.txt", "not_found"],
      ["nope.js", "not_found"],
      ["sub", "not_a_file"],
      ["sub/", "outside_root"],
      ["x.wasm", "forbidden_type"],
    ];
    const actual = await Promise.all(
      cases.map(async ([tail]) => ({ tail, kind: await refusal(roots, tail) })),
    );
    expect(actual).toEqual(cases.map(([tail, kind]) => ({ tail, kind })));
  });

  test("the extension allow-list refuses wasm, extensionless names, and dot-only names", async () => {
    const sandbox = makeSandbox();
    const roots = rootsOf(sandbox);
    writeFileSync(path.join(sandbox.ui, "README"), "x");
    writeFileSync(path.join(sandbox.ui, ".html"), "x");
    expect(await refusal(roots, "README")).toBe("forbidden_type");
    expect(await refusal(roots, ".html")).toBe("forbidden_type");
    expect(await refusal(roots, "x.wasm")).toBe("forbidden_type");
  });

  test("a file over the 16 MiB limit is refused and one at the limit is served", async () => {
    const sandbox = makeSandbox();
    const roots = rootsOf(sandbox);
    const big = path.join(sandbox.ui, "big.js");
    writeFileSync(big, "");
    truncateSync(big, MAX_FILE_BYTES + 1);
    expect(await refusal(roots, "big.js")).toBe("too_large");
    expect((await respond(roots, "GET", "fresnel-view://helm/1.0.0/big.js")).status).toBe(413);
    // 한도와 같은 크기는 내준다(이 시험은 Rust의 `MAX_FILE_BYTES` 경계를 맞춘다)
    truncateSync(big, MAX_FILE_BYTES);
    const atLimit = await get(roots, "big.js");
    expect(atLimit.ok && atLimit.value.body.byteLength).toBe(MAX_FILE_BYTES);
  });

  test("a directory is not a file", async () => {
    const sandbox = makeSandbox();
    const roots = rootsOf(sandbox);
    expect(await refusal(roots, "sub")).toBe("not_a_file");
  });
});

describe("symlinks and roots", () => {
  test("symlinks that leave the root are refused", async () => {
    const sandbox = makeSandbox();
    symlinkSync(path.join(sandbox.dir, "secret.txt"), path.join(sandbox.ui, "link.txt"));
    symlinkSync(path.join(sandbox.dir, "extensions/helm"), path.join(sandbox.ui, "dir-link"));
    const roots = rootsOf(sandbox);
    expect(await refusal(roots, "link.txt")).toBe("outside_root");
    expect(await refusal(roots, "dir-link/other.txt")).toBe("outside_root");

    // root 자체가 등록 뒤에 밖을 가리키는 링크로 바뀌어도 밖의 파일은 나오지 않는다
    const swapped = createAppRoots();
    const linkRoot = path.join(sandbox.dir, "root-link");
    symlinkSync(sandbox.ui, linkRoot);
    expect(swapped.replace([entryFor(linkRoot)], undefined)).toEqual({ ok: true, value: [] });
    unlinkSync(linkRoot);
    symlinkSync(path.join(sandbox.dir, "extensions/helm"), linkRoot);
    expect(await refusal(swapped, "../secret.txt")).toBe("outside_root");
    // 등록 때 푼 실제 경로(ext/ui)를 쓰므로 링크를 바꿔도 root가 밖으로 옮겨 가지 않는다
    expect(await refusal(swapped, "other.txt")).toBe("not_found");
    expect(served(await get(swapped, "app.js")).text).toBe("1");
  });

  test("registration rejects bad input and replaces the whole list", async () => {
    const sandbox = makeSandbox();
    const roots = rootsOf(sandbox);
    expect(roots.replace([entryFor(sandbox.ui, { extension: "Bad" })], undefined)).toEqual({
      ok: true,
      value: [{ index: 0, kind: "bad_name" }],
    });
    expect(roots.replace([entryFor(sandbox.ui, { version: "x" })], undefined)).toEqual({
      ok: true,
      value: [{ index: 0, kind: "bad_version" }],
    });
    expect(roots.replace([entryFor(sandbox.ui, { entry: "../index.html" })], undefined)).toEqual({
      ok: true,
      value: [{ index: 0, kind: "bad_entry" }],
    });
    expect(roots.replace([entryFor("relative/dir")], undefined)).toEqual({
      ok: true,
      value: [{ index: 0, kind: "not_absolute" }],
    });
    expect(roots.replace([entryFor(path.join(sandbox.ui, "index.html"))], undefined)).toEqual({
      ok: true,
      value: [{ index: 0, kind: "not_a_directory" }],
    });
    // 나쁜 항목만 건너뛰었으므로 목록은 비었다(이전 항목은 사라졌다)
    expect(await refusal(roots, "app.js")).toBe("not_found");

    // 성공하면 이전 항목이 사라진다
    expect(roots.replace([entryFor(sandbox.ui)], undefined)).toEqual({ ok: true, value: [] });
    expect(roots.replace([entryFor(sandbox.ui, { version: "2.0.0" })], undefined)).toEqual({
      ok: true,
      value: [],
    });
    expect(await refusal(roots, "app.js")).toBe("not_found");

    // 항목 수가 한도를 넘으면 목록 전체를 거부한다. 한도와 같으면 받는다(같은 키는 한 번만 남는다)
    const tooMany = Array.from({ length: MAX_ROOTS + 1 }, () => entryFor(sandbox.ui));
    expect(roots.replace(tooMany, undefined)).toEqual({
      ok: false,
      error: { kind: "too_many" },
    });
    const atLimit = Array.from({ length: MAX_ROOTS }, () => entryFor(sandbox.ui));
    expect(roots.replace(atLimit, undefined)).toEqual({ ok: true, value: [] });
  });

  test("roots must sit in the extension install dir and not be broad", () => {
    const sandbox = makeSandbox();
    const roots = createAppRoots();
    const ui = sandbox.ui;
    // 다른 확장의 설치 폴더 이름으로는 등록할 수 없다
    expect(roots.replace([entryFor(ui, { extension: "other" })], undefined)).toEqual({
      ok: true,
      value: [{ index: 0, kind: "outside_install" }],
    });
    // 설치 폴더 밖(`extensions/<이름>`이 아닌 곳)
    expect(roots.replace([entryFor(sandbox.dir)], undefined)).toEqual({
      ok: true,
      value: [{ index: 0, kind: "outside_install" }],
    });
    // 프로젝트 등급은 `.fresnel/extensions/<이름>` 모양이어야 한다
    expect(roots.replace([entryFor(ui, { trust: "project" })], undefined)).toEqual({
      ok: true,
      value: [{ index: 0, kind: "outside_install" }],
    });
    const projectUi = path.join(sandbox.dir, "proj/.fresnel/extensions/helm/ui");
    mkdirSync(projectUi, { recursive: true });
    expect(roots.replace([entryFor(projectUi, { trust: "project" })], undefined)).toEqual({
      ok: true,
      value: [],
    });
    // `/`와 홈 폴더, 홈을 품은 폴더
    expect(roots.replace([entryFor("/")], undefined)).toEqual({
      ok: true,
      value: [{ index: 0, kind: "too_broad" }],
    });
    const home = path.join(sandbox.dir, "extensions/helm");
    expect(roots.replace([entryFor(home)], home)).toEqual({
      ok: true,
      value: [{ index: 0, kind: "too_broad" }],
    });
    expect(roots.replace([entryFor(ui)], ui)).toEqual({
      ok: true,
      value: [{ index: 0, kind: "too_broad" }],
    });
    // 홈이 root를 품고 있는 것은 막지 않는다(root가 홈 안에 있을 뿐이다)
    expect(roots.replace([entryFor(ui)], sandbox.dir)).toEqual({ ok: true, value: [] });
  });

  test("a bad entry is skipped and the rest of the list is registered", async () => {
    const sandbox = makeSandbox();
    const roots = createAppRoots();
    // 앞의 나쁜 항목(다른 확장의 설치 폴더), 좋은 항목, 뒤의 나쁜 항목(`/`)
    const result = roots.replace(
      [
        entryFor(sandbox.ui, { extension: "other" }),
        entryFor(sandbox.ui),
        entryFor("/", { extension: "helm2" }),
      ],
      undefined,
    );
    expect(result).toEqual({
      ok: true,
      value: [
        { index: 0, kind: "outside_install" },
        { index: 2, kind: "too_broad" },
      ],
    });
    expect(served(await get(roots, "app.js")).text).toBe("1");
    // 항목 수가 한도를 넘으면 목록 전체를 거부하고 지난 목록을 그대로 둔다
    const tooMany = Array.from({ length: MAX_ROOTS + 1 }, () => entryFor(sandbox.ui));
    expect(roots.replace(tooMany, undefined)).toEqual({
      ok: false,
      error: { kind: "too_many" },
    });
    expect(served(await get(roots, "app.js")).text).toBe("1");
  });

  test("a project extension cannot replace a user extension's root", async () => {
    const sandbox = makeSandbox();
    const projectUi = path.join(sandbox.dir, "proj/.fresnel/extensions/helm/ui");
    mkdirSync(projectUi, { recursive: true });
    writeFileSync(path.join(projectUi, "index.html"), "PROJECT");
    const userEntry = entryFor(sandbox.ui, { trust: "user" });
    const projectEntry = entryFor(projectUi, { trust: "project" });
    const roots = createAppRoots();
    // 프로젝트가 뒤에 와도 사용자가 이긴다
    roots.replace([userEntry, projectEntry], undefined);
    expect(served(await get(roots, "index.html")).text).toBe("<html>ok</html>");
    // 프로젝트가 앞에 와도 사용자가 이긴다
    roots.replace([projectEntry, userEntry], undefined);
    expect(served(await get(roots, "index.html")).text).toBe("<html>ok</html>");
    // 프로젝트만 있으면 프로젝트다
    roots.replace([projectEntry], undefined);
    expect(served(await get(roots, "index.html")).text).toBe("PROJECT");
  });

  test("a managed root beats a user root and both beat a project root regardless of order", async () => {
    const sandbox = makeSandbox();
    const managedUi = path.join(sandbox.dir, "managed/extensions/helm/ui");
    mkdirSync(managedUi, { recursive: true });
    writeFileSync(path.join(managedUi, "index.html"), "MANAGED");
    const managed = entryFor(managedUi, { trust: "managed" });
    const user = entryFor(sandbox.ui, { trust: "user" });
    const roots = createAppRoots();
    roots.replace([user, managed], undefined);
    expect(served(await get(roots, "index.html")).text).toBe("MANAGED");
    roots.replace([managed, user], undefined);
    expect(served(await get(roots, "index.html")).text).toBe("MANAGED");
  });
});

describe("responses", () => {
  test("responses carry the frame headers and hide reasons", async () => {
    const sandbox = makeSandbox();
    const roots = rootsOf(sandbox);
    const ok = await respond(roots, "GET", "fresnel-view://helm/1.0.0/index.html");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(ok.headers.get("Content-Security-Policy")).toBe(FRAME_CSP_HELM);
    expect(ok.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(ok.headers.get("Cache-Control")).toBe("no-store");
    expect(ok.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(await ok.text()).toBe("<html>ok</html>");
  });

  test("every fixed frame header has the TS value", async () => {
    const sandbox = makeSandbox();
    const roots = rootsOf(sandbox);
    const ok = await respond(roots, "GET", "fresnel-view://helm/1.0.0/index.html");
    for (const [name, value] of Object.entries(FIXED_FRAME_HEADERS)) {
      expect({ name, value: ok.headers.get(name) }).toEqual({ name, value });
    }
  });

  test("HEAD returns the headers with an empty body and the same refusals", async () => {
    const sandbox = makeSandbox();
    const roots = rootsOf(sandbox);
    const head = await respond(roots, "HEAD", "fresnel-view://helm/1.0.0/index.html");
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Security-Policy")).toBe(FRAME_CSP_HELM);
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    const headMissing = await respond(roots, "HEAD", "fresnel-view://helm/1.0.0/none.js");
    expect(headMissing.status).toBe(404);
    const headDenied = await respond(roots, "HEAD", "fresnel-view://helm/1.0.0/%2e%2e/secret.txt");
    expect(headDenied.status).toBe(403);
    const headWasm = await respond(roots, "HEAD", "fresnel-view://helm/1.0.0/x.wasm");
    expect(headWasm.status).toBe(403);
  });

  test("failures are empty bodies with the status code of the reason", async () => {
    const sandbox = makeSandbox();
    const roots = rootsOf(sandbox);
    const denied = await respond(roots, "GET", "fresnel-view://helm/1.0.0/%2e%2e/secret.txt");
    expect(denied.status).toBe(403);
    expect((await denied.arrayBuffer()).byteLength).toBe(0);
    const missing = await respond(roots, "GET", "fresnel-view://helm/1.0.0/none.js");
    expect(missing.status).toBe(404);
    const post = await respond(roots, "POST", "fresnel-view://helm/1.0.0/index.html");
    expect(post.status).toBe(405);
    const put = await respond(roots, "PUT", "fresnel-view://helm/1.0.0/index.html");
    expect(put.status).toBe(405);
    const bad = await respond(roots, "GET", "https://example.com/");
    expect(bad.status).toBe(400);
  });
});

describe("module wiring", () => {
  test("the scheme is declared with the narrow privileges and no bypassCSP", () => {
    expect(viewSchemeModule.name).toBe("view-scheme");
    expect(viewSchemeModule.schemes).toEqual([
      {
        scheme: "fresnel-view",
        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
      },
    ]);
  });

  test("the scheme handler serves a frame and the command sets the roots", async () => {
    const fake = fakeCtx();
    viewSchemeModule.register(fake.ctx);
    const sandbox = makeSandbox();
    const reply = await fake.call("app_roots_set", {
      entries: [
        {
          extension: "helm",
          version: "1.0.0",
          root: sandbox.ui,
          entry: "index.html",
          trust: "user",
        },
      ],
    });
    expect(reply).toEqual({ ok: true, value: [] });
    const handler = fake.schemes.get("fresnel-view");
    if (handler === undefined) throw new Error("scheme handler is not registered");
    const response = await handler(new Request("fresnel-view://helm/1.0.0/app.js"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("1");
    // 프레임 주소는 `#n=<nonce>` 조각을 단다(buildAppUrl). 조각은 요청 대상이 아니므로 같은 파일이 나온다
    const withNonce = await handler(new Request("fresnel-view://helm/1.0.0/app.js#n=abc123"));
    expect(withNonce.status).toBe(200);
    expect(await withNonce.text()).toBe("1");
  });

  test("the handler sees the URL after WHATWG dot-segment normalization", async () => {
    const fake = fakeCtx();
    viewSchemeModule.register(fake.ctx);
    const sandbox = makeSandbox();
    await fake.call("app_roots_set", {
      entries: [
        {
          extension: "helm",
          version: "1.0.0",
          root: sandbox.ui,
          entry: "index.html",
          trust: "user",
        },
      ],
    });
    const handler = fake.schemes.get("fresnel-view");
    if (handler === undefined) throw new Error("scheme handler is not registered");
    // `..`은 URL 정리에서 버전 자리를 지우므로 400이 된다. 밖의 파일(`secret.txt`)은 나오지 않는다
    const escaped = await handler(new Request("fresnel-view://helm/1.0.0/%2e%2e/secret.txt"));
    expect(escaped.status).toBe(400);
    expect(await escaped.text()).toBe("");
    // 정리된 `.`은 root 안의 파일이 된다
    const dotted = await handler(new Request("fresnel-view://helm/1.0.0/sub/./a.css"));
    expect(dotted.status).toBe(200);
    expect(await dotted.text()).toBe("a{}");
  });

  test("the command rejects a malformed list as bad_shape", async () => {
    const fake = fakeCtx();
    viewSchemeModule.register(fake.ctx);
    const good = {
      extension: "helm",
      version: "1.0.0",
      root: "/",
      entry: "index.html",
      trust: "user",
    };
    const withoutTrust = { extension: "helm", version: "1.0.0", root: "/", entry: "index.html" };
    const malformed: readonly unknown[] = [
      null,
      { entries: "nope" },
      { entries: [{ ...good, extra: 1 }] },
      { entries: [{ ...good, trust: "admin" }] },
      { entries: [withoutTrust] },
    ];
    const replies = await Promise.all(malformed.map((args) => fake.call("app_roots_set", args)));
    expect(replies).toEqual(malformed.map(() => ({ ok: false, error: "bad_shape" })));
  });

  test("the command reports too_many and skipped entries by index and kind", async () => {
    const fake = fakeCtx();
    viewSchemeModule.register(fake.ctx);
    const sandbox = makeSandbox();
    const row = (extra: Record<string, string>) => ({
      extension: "helm",
      version: "1.0.0",
      root: sandbox.ui,
      entry: "index.html",
      trust: "user",
      ...extra,
    });
    expect(
      await fake.call("app_roots_set", {
        entries: Array.from({ length: MAX_ROOTS + 1 }, () => row({})),
      }),
    ).toEqual({ ok: false, error: "too_many" });
    expect(
      await fake.call("app_roots_set", {
        entries: [row({}), row({ root: "/" }), row({ root: "relative" })],
      }),
    ).toEqual({
      ok: true,
      value: [
        { index: 1, kind: "too_broad" },
        { index: 2, kind: "not_absolute" },
      ],
    });
  });

  test("parseAppRootEntries accepts exactly the five fields with a known trust", () => {
    const row: AppRootInput = {
      extension: "helm",
      version: "1.0.0",
      root: "/x",
      entry: "index.html",
      trust: "managed",
    };
    expect(parseAppRootEntries({ entries: [row] })).toEqual({ ok: true, value: [row] });
    const tiers: readonly Tier[] = ["project", "user", "managed"];
    for (const trust of tiers) {
      expect(parseAppRootEntries({ entries: [{ ...row, trust }] }).ok).toBe(true);
    }
  });
});
