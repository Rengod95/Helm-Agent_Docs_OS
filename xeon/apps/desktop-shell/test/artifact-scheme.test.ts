import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ARTIFACT_SCHEME,
  MAX_ARTIFACT_FILE_BYTES,
  MAX_ARTIFACT_FRAMES,
  MAX_ARTIFACT_TEXT_BYTES,
  MAX_FRAME_REFUSALS,
  artifactContentTypeOf,
  artifactCsp,
  artifactHeaders,
  artifactNavigationAllowed,
  createArtifactFrames,
  createArtifactSchemeModule,
  parseFrameOpenArgs,
  parseTokenArgs,
  respondArtifact,
  type ArtifactFrameInput,
  type ArtifactFrames,
  type OpenedFrame,
} from "../src/main/artifact-scheme.ts";
import type { ShellReply } from "../src/main/commands.ts";
import { fakeCtx } from "./support/fake-ctx.ts";

const created: string[] = [];

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/** 시험용 토큰. n번째 토큰은 32자 16진수 n이다 */
function tokenOf(n: number): string {
  return n.toString(16).padStart(32, "0");
}

const T1 = tokenOf(1);
const T2 = tokenOf(2);
const T3 = tokenOf(3);
const PREFIX = `${ARTIFACT_SCHEME}://`;

/** 토큰이 1, 2, 3...으로 나오는 등록부. 홈 검사는 건너뛴다 */
function framesWith(home?: string): ArtifactFrames {
  let count = 0;
  return createArtifactFrames({
    randomToken: () => {
      count += 1;
      return tokenOf(count);
    },
    home,
  });
}

interface Sandbox {
  /** 실제 경로인 임시 폴더. 프로젝트 밖에 `outside/secret.txt`가 있다 */
  readonly dir: string;
  /** 프로젝트 폴더(root) */
  readonly project: string;
}

/** 실제 경로로 만든다(macOS의 /var → /private/var 링크에 흔들리지 않게 한다) */
function makeSandbox(): Sandbox {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "art-")));
  created.push(dir);
  const project = path.join(dir, "project");
  mkdirSync(path.join(project, "sub"), { recursive: true });
  mkdirSync(path.join(dir, "outside"));
  writeFileSync(path.join(project, "index.html"), "<html>disk</html>");
  writeFileSync(path.join(project, "app.js"), "1");
  writeFileSync(path.join(project, "style.css"), "body{}");
  writeFileSync(path.join(project, "sub", "a.css"), "a{}");
  writeFileSync(path.join(project, "pic.png"), "PNG");
  writeFileSync(path.join(project, "prog.exe"), "MZ");
  writeFileSync(path.join(dir, "outside", "secret.txt"), "SECRET");
  // 프로젝트 밖의 파일로 가는 링크(거절되어야 한다)와 프로젝트 안의 파일로 가는 링크(나와야 한다)
  symlinkSync(path.join(dir, "outside", "secret.txt"), path.join(project, "link.html"));
  symlinkSync(path.join(project, "sub", "a.css"), path.join(project, "inside.css"));
  return { dir, project };
}

function inputOf(
  root: string | null,
  overrides: Partial<ArtifactFrameInput> = {},
): ArtifactFrameInput {
  return { root, entry: "index.html", text: null, wrap: "none", ...overrides };
}

function openOk(frames: ArtifactFrames, input: ArtifactFrameInput): OpenedFrame {
  const opened = frames.open(input);
  if (!opened.ok) throw new Error(`open refused: ${opened.error.kind}`);
  return opened.value;
}

function headersOf(response: Response): Record<string, string> {
  return Object.fromEntries(response.headers.entries());
}

/** 요청을 차례로 보낸다(거절 기록의 순서를 정하려고 하나씩 기다린다) */
async function requestInOrder(frames: ArtifactFrames, uris: readonly string[]): Promise<number[]> {
  const statuses: number[] = [];
  await uris.reduce<Promise<void>>(async (previous, uri) => {
    await previous;
    const response = await respondArtifact(frames, "GET", uri);
    statuses.push(response.status);
  }, Promise.resolve());
  return statuses;
}

/** 프레임 CSP 글자. base는 `fresnel-artifact://<토큰>/`이다 */
function cspOf(base: string): string {
  return [
    "default-src 'none'",
    `script-src ${base} 'unsafe-inline'`,
    `style-src ${base} 'unsafe-inline'`,
    `img-src ${base} data: blob:`,
    `font-src ${base} data:`,
    `media-src ${base} data: blob:`,
    "connect-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "manifest-src 'none'",
  ].join("; ");
}

const PERMISSIONS_POLICY =
  "camera=(), microphone=(), geolocation=(), display-capture=(), clipboard-read=(), clipboard-write=(), payment=(), usb=()";

describe("content types and CSP", () => {
  test("artifactContentTypeOf allows the listed extensions only, ASCII case-insensitive", () => {
    const rows: readonly (readonly [string, string | undefined])[] = [
      ["a.html", "text/html; charset=utf-8"],
      ["a.htm", "text/html; charset=utf-8"],
      ["a.css", "text/css; charset=utf-8"],
      ["a.js", "text/javascript; charset=utf-8"],
      ["a.mjs", "text/javascript; charset=utf-8"],
      ["a.json", "application/json; charset=utf-8"],
      ["a.txt", "text/plain; charset=utf-8"],
      ["a.md", "text/plain; charset=utf-8"],
      ["a.csv", "text/plain; charset=utf-8"],
      ["a.svg", "image/svg+xml"],
      ["a.png", "image/png"],
      ["a.jpg", "image/jpeg"],
      ["a.jpeg", "image/jpeg"],
      ["a.gif", "image/gif"],
      ["a.webp", "image/webp"],
      ["a.ico", "image/x-icon"],
      ["a.woff", "font/woff"],
      ["a.woff2", "font/woff2"],
      ["a.ttf", "font/ttf"],
      ["a.otf", "font/otf"],
      ["UP.HTML", "text/html; charset=utf-8"],
      ["a.exe", undefined],
      ["a.wasm", undefined],
      ["a.map", undefined],
      ["noext", undefined],
      ["a.html.", undefined],
    ];
    expect(rows.map(([name]) => artifactContentTypeOf(name))).toEqual(rows.map(([, type]) => type));
  });

  test("artifactCsp and artifactHeaders produce the exact policy and headers", () => {
    const base = `${PREFIX}${T1}/`;
    expect(artifactCsp(base)).toBe(cspOf(base));
    expect(artifactHeaders("text/plain; charset=utf-8", base)).toEqual({
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Content-Security-Policy": cspOf(base),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": PERMISSIONS_POLICY,
    });
  });
});

describe("open", () => {
  test("each validation refusal comes back as its own kind", () => {
    const sandbox = makeSandbox();
    const frames = framesWith();
    const kinds = [
      inputOf(sandbox.project, { entry: "../index.html" }),
      inputOf(sandbox.project, { entry: "/abs.html" }),
      inputOf(sandbox.project, { entry: "sub//a.html" }),
      inputOf(sandbox.project, { entry: "a\\b.html" }),
      inputOf(sandbox.project, { entry: "x.exe" }),
      inputOf("relative/dir"),
      inputOf(path.join(sandbox.dir, "missing")),
      inputOf(path.join(sandbox.project, "index.html")),
      inputOf("/"),
      inputOf(null),
      inputOf(null, { text: "a".repeat(MAX_ARTIFACT_TEXT_BYTES + 1) }),
      inputOf(sandbox.project, { text: "가".repeat(Math.floor(MAX_ARTIFACT_TEXT_BYTES / 3) + 1) }),
      inputOf(null, { text: "a".repeat(MAX_ARTIFACT_TEXT_BYTES) }),
    ].map((input) => {
      const opened = frames.open(input);
      return opened.ok ? "opened" : opened.error.kind;
    });
    expect(kinds).toEqual([
      "bad_entry",
      "bad_entry",
      "bad_entry",
      "bad_entry",
      "forbidden_type",
      "not_absolute",
      "not_a_directory",
      "not_a_directory",
      "too_broad",
      "no_source",
      "too_large",
      "too_large",
      "opened",
    ]);
  });

  test("the home folder and its parents are too broad; a folder inside home is not", () => {
    const sandbox = makeSandbox();
    const frames = createArtifactFrames({ home: sandbox.project });
    expect(frames.open(inputOf(sandbox.project))).toEqual({
      ok: false,
      error: { kind: "too_broad" },
    });
    expect(frames.open(inputOf(sandbox.dir))).toEqual({ ok: false, error: { kind: "too_broad" } });
    expect(frames.open(inputOf(path.join(sandbox.project, "sub")))).toEqual({
      ok: true,
      value: { token: expect.any(String), url: expect.any(String) },
    });
  });

  test("the URL carries the encoded entry, or the bare root for wrap image", () => {
    const sandbox = makeSandbox();
    const frames = framesWith();
    expect(openOk(frames, inputOf(sandbox.project))).toEqual({
      token: T1,
      url: `${PREFIX}${T1}/index.html`,
    });
    expect(openOk(frames, inputOf(sandbox.project, { entry: "sub/a b.css" })).url).toBe(
      `${PREFIX}${T2}/sub/a%20b.css`,
    );
    expect(openOk(frames, inputOf(sandbox.project, { entry: "pic.png", wrap: "image" })).url).toBe(
      `${PREFIX}${T3}/`,
    );
  });

  test("the default token is 32 lowercase hex characters", () => {
    const sandbox = makeSandbox();
    const opened = createArtifactFrames({ home: undefined }).open(inputOf(sandbox.project));
    if (!opened.ok) throw new Error("open refused");
    expect(opened.value.token).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("serving", () => {
  test("serves file bytes with the exact headers and CSP", async () => {
    const sandbox = makeSandbox();
    const frames = framesWith();
    const { url } = openOk(frames, inputOf(sandbox.project));
    const base = `${PREFIX}${T1}/`;
    const response = await respondArtifact(frames, "GET", `${base}sub/a.css`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("a{}");
    expect(headersOf(response)).toEqual({
      "content-type": "text/css; charset=utf-8",
      "access-control-allow-origin": "*",
      "content-security-policy": cspOf(base),
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "permissions-policy": PERMISSIONS_POLICY,
    });
    const entry = await respondArtifact(frames, "GET", url);
    expect(await entry.text()).toBe("<html>disk</html>");
  });

  test("inline text replaces the entry while a sibling file still comes from disk", async () => {
    const sandbox = makeSandbox();
    const frames = framesWith();
    const { url } = openOk(frames, inputOf(sandbox.project, { text: "<p>older</p>" }));
    const base = `${PREFIX}${T1}/`;
    expect(url).toBe(`${base}index.html`);
    const root = await respondArtifact(frames, "GET", base);
    expect(root.status).toBe(200);
    expect(headersOf(root)["content-type"]).toBe("text/html; charset=utf-8");
    expect(await root.text()).toBe("<p>older</p>");
    const named = await respondArtifact(frames, "GET", `${base}index.html`);
    expect(await named.text()).toBe("<p>older</p>");
    const sibling = await respondArtifact(frames, "GET", `${base}style.css`);
    expect(sibling.status).toBe(200);
    expect(await sibling.text()).toBe("body{}");
  });

  test("paths that leave the root are 403 outside_root and logged once per path", async () => {
    const sandbox = makeSandbox();
    const frames = framesWith();
    openOk(frames, inputOf(sandbox.project));
    const base = `${PREFIX}${T1}/`;
    const statuses = await requestInOrder(frames, [
      `${base}../outside/secret.txt`,
      `${base}%2e%2e/outside/secret.txt`,
      `${base}..%2Foutside%2Fsecret.txt`,
      `${base}%2Fetc%2Fpasswd`,
      `${base}/etc/passwd`,
      `${base}bad%zz.txt`,
    ]);
    expect(statuses).toEqual([403, 403, 403, 403, 403, 403]);
    const refused = await respondArtifact(frames, "GET", `${base}../outside/secret.txt`);
    expect(refused.status).toBe(403);
    expect(await refused.text()).toBe("");
    expect(frames.refusals(T1)).toEqual([
      { path: "../outside/secret.txt", kind: "outside_root" },
      { path: "/etc/passwd", kind: "outside_root" },
      { path: "bad%zz.txt", kind: "outside_root" },
    ]);
  });

  test("malformed addresses are 400 and are not logged", async () => {
    const sandbox = makeSandbox();
    const frames = framesWith();
    openOk(frames, inputOf(sandbox.project));
    const base = `${PREFIX}${T1}/`;
    const bad = await respondArtifact(frames, "GET", `${base}index.html?x=1`);
    expect(bad.status).toBe(400);
    const badToken = await respondArtifact(frames, "GET", `${PREFIX}NOT-A-TOKEN/index.html`);
    expect(badToken.status).toBe(400);
    expect(frames.refusals(T1)).toEqual([]);
  });

  test("a symlink that leaves the root is 403 outside_root; one that stays inside is served", async () => {
    const sandbox = makeSandbox();
    const frames = framesWith();
    openOk(frames, inputOf(sandbox.project));
    const base = `${PREFIX}${T1}/`;
    const escaped = await respondArtifact(frames, "GET", `${base}link.html`);
    expect(escaped.status).toBe(403);
    expect(await escaped.text()).toBe("");
    const inside = await respondArtifact(frames, "GET", `${base}inside.css`);
    expect(inside.status).toBe(200);
    expect(await inside.text()).toBe("a{}");
    expect(frames.refusals(T1)).toEqual([{ path: "link.html", kind: "outside_root" }]);
  });

  test("a forbidden extension is 403, a missing file 404, a directory 404 not_a_file", async () => {
    const sandbox = makeSandbox();
    const frames = framesWith();
    openOk(frames, inputOf(sandbox.project));
    const base = `${PREFIX}${T1}/`;
    const statuses = await requestInOrder(frames, [
      `${base}prog.exe`,
      `${base}missing.js`,
      `${base}sub`,
    ]);
    expect(statuses).toEqual([403, 404, 404]);
    expect(frames.refusals(T1)).toEqual([
      { path: "prog.exe", kind: "forbidden_type" },
      { path: "missing.js", kind: "not_found" },
      { path: "sub", kind: "not_a_file" },
    ]);
  });

  test("a file over the disk cap is 413 too_large", async () => {
    const sandbox = makeSandbox();
    const frames = framesWith();
    openOk(frames, inputOf(sandbox.project));
    const big = path.join(sandbox.project, "big.txt");
    writeFileSync(big, "x");
    truncateSync(big, MAX_ARTIFACT_FILE_BYTES + 1);
    const response = await respondArtifact(frames, "GET", `${PREFIX}${T1}/big.txt`);
    expect(response.status).toBe(413);
    expect(frames.refusals(T1)).toEqual([{ path: "big.txt", kind: "too_large" }]);
  });

  test("an unknown token is 404 and leaves no log", async () => {
    const frames = framesWith();
    const response = await respondArtifact(frames, "GET", `${PREFIX}${tokenOf(99)}/index.html`);
    expect(response.status).toBe(404);
    expect(frames.refusals(tokenOf(99))).toBeUndefined();
  });

  test("with root null only the entry is served, from its text", async () => {
    const frames = framesWith();
    const { url } = openOk(frames, inputOf(null, { entry: "sub/a b.html", text: "<p>only</p>" }));
    const base = `${PREFIX}${T1}/`;
    expect(url).toBe(`${base}sub/a%20b.html`);
    const named = await respondArtifact(frames, "GET", url);
    expect(named.status).toBe(200);
    expect(headersOf(named)["content-type"]).toBe("text/html; charset=utf-8");
    expect(await named.text()).toBe("<p>only</p>");
    expect(await (await respondArtifact(frames, "GET", base)).text()).toBe("<p>only</p>");
    const other = await respondArtifact(frames, "GET", `${base}app.js`);
    expect(other.status).toBe(404);
    expect(frames.refusals(T1)).toEqual([{ path: "app.js", kind: "not_found" }]);
  });

  test("wrap image serves a centered img page at the root and the file under it", async () => {
    const sandbox = makeSandbox();
    const frames = framesWith();
    const { url } = openOk(frames, inputOf(sandbox.project, { entry: "pic.png", wrap: "image" }));
    expect(url).toBe(`${PREFIX}${T1}/`);
    const page = await respondArtifact(frames, "GET", url);
    expect(page.status).toBe(200);
    expect(headersOf(page)["content-type"]).toBe("text/html; charset=utf-8");
    expect(await page.text()).toBe(
      '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100%;object-fit:contain}</style></head><body><img src="pic.png" alt=""></body></html>',
    );
    const image = await respondArtifact(frames, "GET", `${url}pic.png`);
    expect(headersOf(image)["content-type"]).toBe("image/png");
    expect(await image.text()).toBe("PNG");
  });

  test("HEAD returns the headers and no body", async () => {
    const sandbox = makeSandbox();
    const frames = framesWith();
    openOk(frames, inputOf(sandbox.project));
    const base = `${PREFIX}${T1}/`;
    const response = await respondArtifact(frames, "HEAD", `${base}index.html`);
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(headersOf(response)["content-type"]).toBe("text/html; charset=utf-8");
    expect(headersOf(response)["content-security-policy"]).toBe(cspOf(base));
    expect(await response.text()).toBe("");
  });

  test("other methods are 405 with an empty body", async () => {
    const sandbox = makeSandbox();
    const frames = framesWith();
    openOk(frames, inputOf(sandbox.project));
    const response = await respondArtifact(frames, "POST", `${PREFIX}${T1}/index.html`);
    expect(response.status).toBe(405);
    expect(await response.text()).toBe("");
  });
});

describe("registry", () => {
  test("keeps the newest frames and evicts the oldest", async () => {
    const sandbox = makeSandbox();
    const frames = framesWith();
    const tokens = Array.from(
      { length: MAX_ARTIFACT_FRAMES + 1 },
      () => openOk(frames, inputOf(sandbox.project)).token,
    );
    expect(tokens[0]).toBe(T1);
    expect(frames.refusals(T1)).toBeUndefined();
    expect(frames.refusals(tokenOf(MAX_ARTIFACT_FRAMES + 1))).toEqual([]);
    const evicted = await respondArtifact(frames, "GET", `${PREFIX}${T1}/index.html`);
    expect(evicted.status).toBe(404);
    const kept = await respondArtifact(frames, "GET", `${PREFIX}${T2}/index.html`);
    expect(kept.status).toBe(200);
  });

  test("refusals are deduplicated by path and kind and capped", async () => {
    const sandbox = makeSandbox();
    const frames = framesWith();
    openOk(frames, inputOf(sandbox.project));
    const base = `${PREFIX}${T1}/`;
    await requestInOrder(frames, [`${base}dup.txt`, `${base}dup.txt`, `${base}dup.txt`]);
    expect(frames.refusals(T1)).toEqual([{ path: "dup.txt", kind: "not_found" }]);
    const many = Array.from(
      { length: MAX_FRAME_REFUSALS + 8 },
      (_, i) => `${base}missing-${i}.txt`,
    );
    await requestInOrder(frames, many);
    const refused = frames.refusals(T1) ?? [];
    expect(refused.length).toBe(MAX_FRAME_REFUSALS);
    expect(refused.slice(1)).toEqual(
      Array.from({ length: MAX_FRAME_REFUSALS - 1 }, (_, i) => ({
        path: `missing-${i}.txt`,
        kind: "not_found",
      })),
    );
  });
});

describe("revealTarget", () => {
  test("gives the real file under the root and refuses the rest", async () => {
    const sandbox = makeSandbox();
    const frames = framesWith();
    const sub = openOk(frames, inputOf(sandbox.project, { entry: "sub/a.css" })).token;
    expect(await frames.revealTarget(sub)).toEqual({
      ok: true,
      value: path.join(sandbox.project, "sub", "a.css"),
    });
    const linked = openOk(frames, inputOf(sandbox.project, { entry: "link.html" })).token;
    expect(await frames.revealTarget(linked)).toEqual({ ok: false, error: { kind: "not_found" } });
    const missing = openOk(frames, inputOf(sandbox.project, { entry: "nope.html" })).token;
    expect(await frames.revealTarget(missing)).toEqual({ ok: false, error: { kind: "not_found" } });
    const textOnly = openOk(frames, inputOf(null, { text: "x" })).token;
    expect(await frames.revealTarget(textOnly)).toEqual({ ok: false, error: { kind: "no_root" } });
    expect(await frames.revealTarget(tokenOf(99))).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
  });
});

describe("navigation guard", () => {
  test("an artifact frame moves only inside its own token address", () => {
    const frame = `${PREFIX}${T1}/index.html`;
    const rows: readonly { frame: string; target: string; allowed: boolean }[] = [
      { frame: "about:blank", target: "https://example.com/", allowed: true },
      {
        frame: "fresnel-view://helm/1.0.0/index.html",
        target: "https://example.com/",
        allowed: true,
      },
      { frame, target: `${PREFIX}${T1}/app.js`, allowed: true },
      { frame, target: `${PREFIX}${T1}/`, allowed: true },
      { frame, target: `${PREFIX}${T2}/`, allowed: false },
      { frame, target: "https://example.com/", allowed: false },
      { frame, target: "javascript:alert(1)", allowed: false },
      { frame, target: "data:text/html,<p>x</p>", allowed: false },
      { frame, target: "about:blank", allowed: false },
      { frame: `${PREFIX}${T1}/`, target: `${PREFIX}${T1}`, allowed: false },
      { frame: `${PREFIX}nothex/index.html`, target: `${PREFIX}nothex/app.js`, allowed: false },
      { frame: `${PREFIX}${T1}x/index.html`, target: `${PREFIX}${T1}x/app.js`, allowed: false },
    ];
    expect(rows.map((row) => artifactNavigationAllowed(row.frame, row.target))).toEqual(
      rows.map((row) => row.allowed),
    );
  });
});

describe("argument parsing", () => {
  test("parseFrameOpenArgs accepts exactly the four keys with their value types", () => {
    const good: ArtifactFrameInput = { root: "/p", entry: "index.html", text: null, wrap: "none" };
    expect(parseFrameOpenArgs(good)).toEqual({ ok: true, value: good });
    const withText: ArtifactFrameInput = { root: null, entry: "a.md", text: "# hi", wrap: "image" };
    expect(parseFrameOpenArgs(withText)).toEqual({ ok: true, value: withText });
    const bad: readonly unknown[] = [
      null,
      [],
      "text",
      { root: "/p", entry: "index.html", text: null },
      { ...good, extra: 1 },
      { ...good, root: 1 },
      { ...good, entry: null },
      { ...good, text: undefined },
      { ...good, wrap: "gif" },
    ];
    expect(bad.map((args) => parseFrameOpenArgs(args))).toEqual(
      bad.map(() => ({ ok: false, error: { kind: "bad_shape" } })),
    );
  });

  test("parseTokenArgs accepts exactly a token string", () => {
    expect(parseTokenArgs({ token: T1 })).toEqual({ ok: true, value: T1 });
    const bad: readonly unknown[] = [null, {}, { token: 1 }, { token: T1, extra: 1 }, T1];
    expect(bad.map((args) => parseTokenArgs(args))).toEqual(
      bad.map(() => ({ ok: false, error: { kind: "bad_shape" } })),
    );
  });
});

/** 명령 응답에서 토큰을 꺼낸다. 성공이 아니면 던진다(시험 본문에서 `as`를 쓰지 않으려고 둔 도우미) */
function tokenFromReply(reply: ShellReply): string {
  if (!reply.ok || typeof reply.value !== "object" || reply.value === null) {
    throw new Error("open command failed");
  }
  const token = Object.getOwnPropertyDescriptor(reply.value, "token")?.value;
  if (typeof token !== "string") throw new Error("open command reply has no token");
  return token;
}

describe("module wiring", () => {
  test("declares the scheme with the narrow privileges", () => {
    const module = createArtifactSchemeModule(() => undefined);
    expect(module.name).toBe("artifact-scheme");
    expect(module.schemes).toEqual([
      {
        scheme: "fresnel-artifact",
        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
      },
    ]);
  });

  test("commands open, report, and reveal frames; the scheme serves them", async () => {
    const revealed: string[] = [];
    const fake = fakeCtx();
    createArtifactSchemeModule((target) => {
      revealed.push(target);
    }).register(fake.ctx);
    const sandbox = makeSandbox();
    const opened = await fake.call("artifact_frame_open", {
      root: sandbox.project,
      entry: "index.html",
      text: null,
      wrap: "none",
    });
    const token = tokenFromReply(opened);
    const handler = fake.schemes.get("fresnel-artifact");
    if (handler === undefined) throw new Error("scheme handler is not registered");
    const served = await handler(new Request(`${PREFIX}${token}/index.html#n=abc123`));
    expect(served.status).toBe(200);
    expect(await served.text()).toBe("<html>disk</html>");
    const refused = await handler(new Request(`${PREFIX}${token}/prog.exe`));
    expect(refused.status).toBe(403);
    expect(await fake.call("artifact_frame_status", { token })).toEqual({
      ok: true,
      value: { refused: [{ path: "prog.exe", kind: "forbidden_type" }] },
    });
    expect(await fake.call("artifact_frame_status", { token: tokenOf(99) })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await fake.call("artifact_reveal", { token })).toEqual({ ok: true, value: null });
    expect(revealed).toEqual([path.join(sandbox.project, "index.html")]);
  });

  test("command errors carry the kind; a text-only frame cannot be revealed", async () => {
    const fake = fakeCtx();
    createArtifactSchemeModule(() => undefined).register(fake.ctx);
    expect(await fake.call("artifact_frame_open", { root: null, entry: "a.html" })).toEqual({
      ok: false,
      error: "bad_shape",
    });
    expect(
      await fake.call("artifact_frame_open", {
        root: "relative",
        entry: "a.html",
        text: null,
        wrap: "none",
      }),
    ).toEqual({ ok: false, error: "not_absolute" });
    const textOnly = tokenFromReply(
      await fake.call("artifact_frame_open", {
        root: null,
        entry: "a.html",
        text: "<p>x</p>",
        wrap: "none",
      }),
    );
    expect(await fake.call("artifact_reveal", { token: textOnly })).toEqual({
      ok: false,
      error: "no_root",
    });
    expect(await fake.call("artifact_reveal", {})).toEqual({ ok: false, error: "bad_shape" });
  });
});
