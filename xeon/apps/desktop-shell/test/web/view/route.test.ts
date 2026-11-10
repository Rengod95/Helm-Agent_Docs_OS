import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createAppRoots, frameCsp, type AppRoots } from "../../../src/main/view-scheme.ts";
import { cleanupTempDirs, type Harness, rawHttp, startHarness } from "../server/support.ts";
import { tempDir } from "../support/fixtures.ts";

const harnesses: Harness[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((item) => item.stop()));
  cleanupTempDirs();
});

interface Fixture {
  readonly h: Harness;
  readonly port: number;
  readonly roots: AppRoots;
  readonly outside: string;
}

/** 확장 `helm` 1.0.0의 app root 하나를 둔 탭과 게이트웨이 */
async function fixture(): Promise<Fixture> {
  const h = await startHarness();
  harnesses.push(h);
  const base = tempDir();
  const root = path.join(base, "extensions", "helm");
  mkdirSync(path.join(root, "dist"), { recursive: true });
  writeFileSync(path.join(root, "index.html"), "<!doctype html><title>frame</title>\n");
  writeFileSync(path.join(root, "dist", "app.js"), "export const frame = 1;\n");
  writeFileSync(path.join(root, "my file.txt"), "spaced\n");
  const outside = path.join(base, "secret.txt");
  writeFileSync(outside, "secret-outside\n");
  symlinkSync(outside, path.join(root, "link.txt"));
  const roots = createAppRoots();
  const replaced = roots.replace(
    [{ extension: "helm", version: "1.0.0", root, entry: "index.html", trust: "user" }],
    undefined,
  );
  if (!replaced.ok) throw new Error("roots did not register");
  return { h, port: h.loopbackPort ?? 0, roots, outside };
}

const get = (f: Fixture, tail: string, headers: Record<string, string> = {}) =>
  rawHttp({ port: f.port, path: tail, headers });

describe("GET /view/<token>/<extension>/<version>/<path>", () => {
  test("serves the entry and files with the frame headers and no cookie", async () => {
    const f = await fixture();
    const { token } = f.h.views.issue("tab-1", f.roots);
    const entry = await get(f, `/view/${token}/helm/1.0.0/index.html`);
    expect(entry.status).toBe(200);
    expect(entry.body).toContain("<title>frame</title>");
    expect(entry.headers["content-type"]).toBe("text/html; charset=utf-8");
    const base = `http://127.0.0.1:${String(f.port)}/view/${token}/helm/1.0.0/`;
    expect(entry.headers["content-security-policy"]).toBe(frameCsp(base));
    expect(entry.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(entry.headers["access-control-allow-origin"]).toBe("*");
    expect(entry.headers["cache-control"]).toBe("no-store");
    expect(entry.headers["x-content-type-options"]).toBe("nosniff");
    expect(entry.headers["set-cookie"]).toBeUndefined();
    const script = await get(f, `/view/${token}/helm/1.0.0/dist/app.js`);
    expect(script.status).toBe(200);
    expect(script.body).toBe("export const frame = 1;\n");
    const spaced = await get(f, `/view/${token}/helm/1.0.0/my%20file.txt`);
    expect(spaced.body).toBe("spaced\n");
    const bare = await get(f, `/view/${token}/helm/1.0.0/`);
    expect(bare.body).toContain("<title>frame</title>");
  });

  test("the frame CSP differs from the desktop one only in the base", async () => {
    const f = await fixture();
    const { token } = f.h.views.issue("tab-1", f.roots);
    const web = `http://127.0.0.1:${String(f.port)}/view/${token}/helm/1.0.0/`;
    const desktop = "fresnel-view://helm/1.0.0/";
    expect(frameCsp(web).replaceAll(web, "{base}")).toBe(
      frameCsp(desktop).replaceAll(desktop, "{base}"),
    );
    const res = await get(f, `/view/${token}/helm/1.0.0/index.html`);
    const csp = res.headers["content-security-policy"];
    expect(typeof csp === "string" ? csp.replaceAll(web, "{base}") : null).toBe(
      frameCsp(desktop).replaceAll(desktop, "{base}"),
    );
  });

  test("a frame request with Origin null (opaque origin) is served, cookies are not needed", async () => {
    const f = await fixture();
    const { token } = f.h.views.issue("tab-1", f.roots);
    const res = await get(f, `/view/${token}/helm/1.0.0/dist/app.js`, { origin: "null" });
    expect(res.status).toBe(200);
  });

  test("missing, unknown and malformed tokens are 401 or 400", async () => {
    const f = await fixture();
    const unknown = "A".repeat(43);
    const cases = [
      ["/view/", 400],
      ["/view//helm/1.0.0/index.html", 400],
      [`/view/${unknown}/helm/1.0.0/index.html`, 401],
      ["/view/short/helm/1.0.0/index.html", 401],
    ] as const;
    const results = await Promise.all(cases.map(([tail]) => get(f, tail)));
    expect(results.map((res) => res.status)).toEqual(cases.map(([, status]) => status));
  });

  test("an expired token is refused", async () => {
    const f = await fixture();
    const { token } = f.h.views.issue("tab-1", f.roots);
    expect((await get(f, `/view/${token}/helm/1.0.0/index.html`)).status).toBe(200);
    f.h.clock.advance(60 * 60 * 1000);
    expect((await get(f, `/view/${token}/helm/1.0.0/index.html`)).status).toBe(401);
  });

  test("another tab's token does not reach this tab's roots", async () => {
    const f = await fixture();
    const other = createAppRoots();
    const foreign = f.h.views.issue("tab-2", other);
    const res = await get(f, `/view/${foreign.token}/helm/1.0.0/index.html`);
    expect(res.status).toBe(404);
    // 닫힌 탭의 토큰도 거절한다
    const mine = f.h.views.issue("tab-1", f.roots);
    f.h.views.revokeTab("tab-1");
    expect((await get(f, `/view/${mine.token}/helm/1.0.0/index.html`)).status).toBe(401);
  });

  test("path escapes, hostile names and queries are refused", async () => {
    const f = await fixture();
    const { token } = f.h.views.issue("tab-1", f.roots);
    const cases: readonly (readonly [string, number])[] = [
      [`/view/${token}/helm/1.0.0/%2e%2e/secret.txt`, 400],
      [`/view/${token}/helm/1.0.0/..%2fsecret.txt`, 403],
      [`/view/${token}/helm/1.0.0/dist%2f..%2f..%2fsecret.txt`, 403],
      [`/view/${token}/helm/1.0.0/%252e%252e/secret.txt`, 404],
      [`/view/${token}/helm/1.0.0/%00`, 403],
      [`/view/${token}/helm/1.0.0/a%5cb`, 403],
      [`/view/${token}/helm/1.0.0/link.txt`, 403],
      [`/view/${token}/helm/1.0.0/missing.js`, 404],
      [`/view/${token}/helm/1.0.0/dist`, 404],
      [`/view/${token}/Helm/1.0.0/index.html`, 400],
      [`/view/${token}/helm/1.0/index.html`, 400],
      [`/view/${token}/helm/9.9.9/index.html`, 404],
      [`/view/${token}/other/1.0.0/index.html`, 404],
      [`/view/${token}/helm/1.0.0/index.html?x=1`, 400],
    ];
    const results = await Promise.all(cases.map(([tail]) => get(f, tail)));
    expect(results.map((res, at) => [cases[at]?.[0], res.status])).toEqual(
      cases.map(([tail, status]) => [tail, status]),
    );
    for (const res of results) expect(res.body).not.toContain("secret-outside");
  });

  test("only GET and HEAD are answered", async () => {
    const f = await fixture();
    const { token } = f.h.views.issue("tab-1", f.roots);
    const tail = `/view/${token}/helm/1.0.0/index.html`;
    const head = await rawHttp({ port: f.port, method: "HEAD", path: tail });
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
    const post = await rawHttp({
      port: f.port,
      method: "POST",
      path: tail,
      headers: { origin: f.h.origin },
    });
    expect(post.status).toBe(405);
    const put = await rawHttp({
      port: f.port,
      method: "PUT",
      path: tail,
      headers: { origin: f.h.origin },
    });
    expect(put.status).toBe(405);
  });
});
