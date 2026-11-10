import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createWebContext } from "../../../src/web/session/web-context.ts";
import { createViewTokens, VIEW_TOKEN_TTL_MS } from "../../../src/web/view/tokens.ts";
import { respondView } from "../../../src/web/view/route.ts";
import { cleanupTempDirs, tempDir } from "../support/fixtures.ts";
import { recordedLog, sessionOptions } from "../session/support.ts";

afterEach(() => {
  cleanupTempDirs();
});

function tab(views: ReturnType<typeof createViewTokens>, tabId: string) {
  return createWebContext({
    ...sessionOptions(path.join(tempDir(), "absent.sock"), recordedLog()),
    views,
    tabId,
    deviceId: "dev_test",
    send: () => undefined,
  });
}

function installRoot(): string {
  const root = path.join(tempDir(), "extensions", "helm");
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "index.html"), "<title>frame</title>\n");
  return root;
}

function pathOf(reply: unknown): string {
  if (typeof reply !== "object" || reply === null) throw new Error("no reply");
  const value: unknown = Object.getOwnPropertyDescriptor(reply, "path")?.value;
  if (typeof value !== "string") throw new Error("no path");
  return value;
}

describe("view_root", () => {
  test("a tab's token serves its own registered roots, not another tab's", async () => {
    const clock = { now: () => 1_000 };
    const views = createViewTokens({ clock });
    const a = tab(views, "tab-a");
    const b = tab(views, "tab-b");
    try {
      const set = await a.dispatch("app_roots_set", {
        entries: [
          {
            extension: "helm",
            version: "1.0.0",
            root: installRoot(),
            entry: "index.html",
            trust: "user",
          },
        ],
      });
      expect(set.ok).toBe(true);
      const rootA = await a.dispatch("view_root", undefined);
      const rootB = await b.dispatch("view_root", undefined);
      expect(rootA.ok && rootB.ok).toBe(true);
      const request = (root: unknown) => ({
        method: "GET",
        pathname: `${pathOf(root)}helm/1.0.0/index.html`,
        search: "",
        tls: true,
        host: "origin.test:8443",
      });
      expect((await respondView(views, request(rootA.ok ? rootA.value : null))).status).toBe(200);
      expect((await respondView(views, request(rootB.ok ? rootB.value : null))).status).toBe(404);
      const issued = rootA.ok ? rootA.value : null;
      expect(
        typeof issued === "object" && issued !== null
          ? Object.getOwnPropertyDescriptor(issued, "expiresAt")?.value
          : 0,
      ).toBe(1_000 + VIEW_TOKEN_TTL_MS);
    } finally {
      await a.close();
      await b.close();
    }
  });

  test("closing the tab revokes its tokens", async () => {
    const views = createViewTokens({ clock: { now: () => 0 } });
    const a = tab(views, "tab-a");
    const root = await a.dispatch("view_root", undefined);
    if (!root.ok) throw new Error("view_root failed");
    await a.close();
    const res = await respondView(views, {
      method: "GET",
      pathname: `${pathOf(root.value)}helm/1.0.0/index.html`,
      search: "",
      tls: false,
      host: "127.0.0.1:1",
    });
    expect(res.status).toBe(401);
  });
});
