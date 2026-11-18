import { describe, expect, test } from "bun:test";
import { createProjectTrust } from "../src/index.ts";
import { createProjectTrustStore, type TrustStoreBackend } from "@fresnel/ext-host";
import type { LoaderFs } from "@fresnel/contracts/extensions";

const ROOT = "/work/repo";
const signal = new AbortController().signal;

function fakeFs(existing: readonly string[]): LoaderFs {
  const present = new Set(existing);
  return {
    readText: () => Promise.resolve(null),
    listDir: () => Promise.resolve(null),
    exists: (path) => Promise.resolve(present.has(path)),
    realpath: (path) => Promise.resolve(path),
  };
}

function memoryBackend(initial: string | null = null): TrustStoreBackend {
  let text = initial;
  return {
    read: () => Promise.resolve({ ok: true, text }),
    update: (fn) => {
      text = fn(text);
      return Promise.resolve();
    },
  };
}

function trustFor(options: {
  files: readonly string[];
  backend?: TrustStoreBackend;
  emit?: Parameters<typeof createProjectTrust>[0]["emitProjectTrust"];
  override?: boolean;
}) {
  return createProjectTrust({
    mode: "headless",
    defaultProjectTrust: "ask",
    store: createProjectTrustStore(
      options.backend ?? memoryBackend(),
      (path) => Promise.resolve(path),
      { now: () => 1_700_000_000_000 },
    ),
    fs: fakeFs(options.files),
    homeDir: "/home/user",
    emitProjectTrust: options.emit ?? (() => Promise.resolve(undefined)),
    sessionMemory: new Map(),
    ...(options.override === undefined ? {} : { trustOverride: options.override }),
  });
}

describe("project trust (decision D6)", () => {
  test("a project without trust-requiring files needs no decision", async () => {
    expect(await trustFor({ files: [] }).isTrusted(ROOT, signal)).toBe(true);
  });

  test("a project with .fresnel/mcp.json and no decision is not trusted", async () => {
    const trust = trustFor({ files: [`${ROOT}/.fresnel/mcp.json`] });
    expect(await trust.isTrusted(ROOT, signal)).toBe(false);
  });

  test("a project with only a root .mcp.json needs no decision (the file is not read, M5g-2)", async () => {
    // 부정 시험: 루트 `.mcp.json`은 신뢰 자원이 아니므로 결정 없이 신뢰 판정이 끝난다(notRequired)
    expect(await trustFor({ files: [`${ROOT}/.mcp.json`] }).isTrusted(ROOT, signal)).toBe(true);
  });

  test("a project with only .agents/skills at the project or above needs no decision", async () => {
    const files = [`${ROOT}/.agents/skills`, "/work/.agents/skills"];
    expect(await trustFor({ files }).isTrusted(ROOT, signal)).toBe(true);
  });

  test("the session.trust.before point can allow it", async () => {
    const trust = trustFor({
      files: [`${ROOT}/.fresnel/mcp.json`],
      emit: () => Promise.resolve({ trusted: "yes" }),
    });
    expect(await trust.isTrusted(ROOT, signal)).toBe(true);
    const denied = trustFor({
      files: [`${ROOT}/.fresnel/mcp.json`],
      emit: () => Promise.resolve({ trusted: "no" }),
    });
    expect(await denied.isTrusted(ROOT, signal)).toBe(false);
  });

  test("a remembered decision is read from the trust store", async () => {
    const backend = memoryBackend();
    const store = createProjectTrustStore(backend, (path) => Promise.resolve(path), {
      now: () => 1_700_000_000_000,
    });
    await store.setMany([{ path: ROOT, verdict: "allow", via: "command" }]);
    expect(
      await trustFor({ files: [`${ROOT}/.fresnel/mcp.json`], backend }).isTrusted(ROOT, signal),
    ).toBe(true);
  });

  test("a one-shot override wins", async () => {
    const trust = trustFor({ files: [`${ROOT}/.fresnel/mcp.json`], override: true });
    expect(await trust.isTrusted(ROOT, signal)).toBe(true);
  });
});
