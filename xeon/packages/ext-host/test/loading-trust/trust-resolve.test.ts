import { expect, test } from "bun:test";
import type { TrustChoice, TrustPrompter, TrustPromptRequest } from "@xeon/contracts/extensions";
import {
  resolveProjectTrust,
  type ResolveProjectTrustInput,
  type TrustLookup,
  type TrustVerdict,
  type TrustVia,
} from "../../src/loading-trust/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import {
  entryPaths,
  memoryFs,
  memoryTrustBackend,
  storeOf,
  type MemoryTrustBackend,
} from "./support/trust-fakes.ts";

const HOME = "/home/test";
const ROOT = "/work/proj";
const NEEDS_TRUST = [`${ROOT}/.xeon/extensions`];

type Decision = Awaited<ReturnType<ResolveProjectTrustInput["emitProjectTrust"]>>;

interface Harness {
  readonly input: ResolveProjectTrustInput;
  readonly backend: MemoryTrustBackend;
  readonly prompts: TrustPromptRequest[];
  readonly emitted: string[];
}

function harness(
  options: {
    readonly files?: readonly string[];
    readonly store?: string | null;
    readonly decision?: Decision | "throw";
    readonly choice?: TrustChoice | "throw" | undefined;
    readonly prompter?: boolean;
    readonly mode?: "interactive" | "headless";
    readonly defaultProjectTrust?: "ask" | "always" | "never";
    readonly trustOverride?: boolean;
    readonly sessionMemory?: Map<string, "allow" | "deny">;
  } = {},
): Harness {
  const backend = memoryTrustBackend(options.store ?? null);
  const fs = memoryFs(options.files ?? NEEDS_TRUST);
  const prompts: TrustPromptRequest[] = [];
  const emitted: string[] = [];
  const prompter: TrustPrompter = {
    ask(request) {
      prompts.push(request);
      if (options.choice === "throw") return Promise.reject(new Error("prompter failed"));
      return Promise.resolve(options.choice);
    },
  };
  const input: ResolveProjectTrustInput = {
    projectRoot: ROOT,
    mode: options.mode ?? "interactive",
    defaultProjectTrust: options.defaultProjectTrust ?? "ask",
    store: storeOf(backend, fs),
    fs,
    homeDir: HOME,
    emitProjectTrust: (cwd) => {
      emitted.push(cwd);
      if (options.decision === "throw") return Promise.reject(new Error("handler failed"));
      return Promise.resolve(options.decision);
    },
    sessionMemory: options.sessionMemory ?? new Map(),
    signal: new AbortController().signal,
    ...(options.trustOverride === undefined ? {} : { trustOverride: options.trustOverride }),
    ...(options.prompter === false ? {} : { prompter }),
  };
  return { input, backend, prompts, emitted };
}

function stored(entries: Record<string, "allow" | "deny">): string {
  return JSON.stringify({
    version: 1,
    entries: Object.fromEntries(
      Object.entries(entries).map(([path, verdict]) => [
        path,
        { verdict, decidedAt: "2026-01-01T00:00:00.000Z", via: "prompt" },
      ]),
    ),
  });
}

async function summary(h: Harness): Promise<{
  trusted: boolean;
  verdict: TrustVerdict;
  via: TrustVia;
}> {
  const result = await resolveProjectTrust(h.input);
  return { trusted: result.trusted, verdict: result.verdict, via: result.via };
}

test("headless untrusted by default", async () => {
  await eachInOrder(
    [{ mode: "headless" as const }, { mode: "interactive" as const, prompter: false }],
    async (options) => {
      const h = harness(options);
      expect(await summary(h)).toEqual({ trusted: false, verdict: "undecided", via: "headless" });
      expect(h.prompts).toHaveLength(0);
      expect(h.backend.calls.updates).toBe(0);
      return "continue";
    },
  );
});

test("override wins and is never saved", async () => {
  const denied = harness({ trustOverride: false, store: stored({ [ROOT]: "allow" }) });
  expect(await summary(denied)).toEqual({ trusted: false, verdict: "deny", via: "override" });
  const allowed = harness({ trustOverride: true, store: stored({ [ROOT]: "deny" }) });
  expect(await summary(allowed)).toEqual({ trusted: true, verdict: "allow", via: "override" });
  expect(allowed.emitted).toEqual([]);
  expect(allowed.backend.calls.updates).toBe(0);
});

test("no trust-requiring resource needs no decision", async () => {
  const h = harness({ files: [`${ROOT}/.xeon`], store: stored({ [ROOT]: "deny" }) });
  const result = await resolveProjectTrust(h.input);
  expect(result).toMatchObject({
    required: false,
    trusted: true,
    via: "notRequired",
    resources: [],
  });
  expect(h.emitted).toEqual([]);
});

test("point exception denies and saves nothing", async () => {
  const h = harness({ decision: "throw", defaultProjectTrust: "always" });
  expect(await summary(h)).toEqual({ trusted: false, verdict: "deny", via: "point" });
  expect(h.backend.calls.updates).toBe(0);
  expect(h.prompts).toHaveLength(0);
});

test("point decision wins over the store, and remember saves it", async () => {
  const yes = harness({ decision: { trusted: "yes" }, store: stored({ [ROOT]: "deny" }) });
  expect(await summary(yes)).toEqual({ trusted: true, verdict: "allow", via: "point" });
  expect(yes.backend.calls.updates).toBe(0);

  const remember = harness({ decision: { trusted: "yes", remember: true } });
  expect(await summary(remember)).toEqual({ trusted: true, verdict: "allow", via: "point" });
  expect(entryPaths(remember.backend.text())).toEqual([ROOT]);
  expect(remember.backend.text()).toContain('"via": "point"');

  const no = harness({ decision: { trusted: "no", remember: true } });
  expect(await summary(no)).toEqual({ trusted: false, verdict: "deny", via: "point" });
  expect(no.backend.text()).toContain('"verdict": "deny"');
});

test("an undecided point falls through to the store, then the default", async () => {
  const fromStore = harness({ store: stored({ "/work": "allow" }) });
  expect(await summary(fromStore)).toEqual({ trusted: true, verdict: "allow", via: "store" });
  const always = harness({ defaultProjectTrust: "always" });
  expect(await summary(always)).toEqual({ trusted: true, verdict: "allow", via: "default" });
  const never = harness({ defaultProjectTrust: "never" });
  expect(await summary(never)).toEqual({ trusted: false, verdict: "deny", via: "default" });
  // 저장된 결정은 기본 정책보다 먼저다
  const storedDeny = harness({ store: stored({ [ROOT]: "deny" }), defaultProjectTrust: "always" });
  expect(await summary(storedDeny)).toEqual({ trusted: false, verdict: "deny", via: "store" });
});

test("session only is not persisted and remembered for the next decision", async () => {
  const memory = new Map<string, "allow" | "deny">();
  const first = harness({ choice: { kind: "session", verdict: "allow" }, sessionMemory: memory });
  expect(await summary(first)).toEqual({ trusted: true, verdict: "allow", via: "prompt" });
  expect(first.backend.calls.updates).toBe(0);
  expect(memory.get(ROOT)).toBe("allow");
  // 같은 호스트의 다음 판정은 프롬프트와 지점 발화 없이 세션 기억이다
  const second = harness({ choice: { kind: "session", verdict: "deny" }, sessionMemory: memory });
  expect(await summary(second)).toEqual({ trusted: true, verdict: "allow", via: "sessionMemory" });
  expect(second.prompts).toHaveLength(0);
  expect(second.emitted).toEqual([]);

  const denied = harness({ choice: { kind: "session", verdict: "deny" } });
  expect(await summary(denied)).toEqual({ trusted: false, verdict: "deny", via: "prompt" });
  expect(denied.backend.calls.updates).toBe(0);
});

test("prompt choices save the documented updates", async () => {
  const folder = harness({ choice: { kind: "folder", verdict: "allow" } });
  expect(await summary(folder)).toEqual({ trusted: true, verdict: "allow", via: "prompt" });
  expect(entryPaths(folder.backend.text())).toEqual([ROOT]);
  // 프롬프트는 찾은 자원, 상위 폴더, 다섯 선택지를 받는다
  expect(folder.prompts[0]).toMatchObject({
    projectRoot: ROOT,
    parent: "/work",
    resources: [".xeon/extensions"],
  });
  expect(folder.prompts[0]?.options).toHaveLength(5);

  const parent = harness({
    choice: { kind: "parent", verdict: "allow" },
    store: stored({ [ROOT]: "deny" }),
    decision: undefined,
  });
  // 프로젝트 루트에 deny가 저장돼 있으면 프롬프트에 닿기 전에 저장소가 답한다. 저장소를 비우고 다시 확인한다
  expect(await summary(parent)).toEqual({ trusted: false, verdict: "deny", via: "store" });
  const fresh = harness({ choice: { kind: "parent", verdict: "allow" } });
  expect(await summary(fresh)).toEqual({ trusted: true, verdict: "allow", via: "prompt" });
  expect(entryPaths(fresh.backend.text())).toEqual(["/work"]);

  const deny = harness({ choice: { kind: "folder", verdict: "deny" } });
  expect(await summary(deny)).toEqual({ trusted: false, verdict: "deny", via: "prompt" });
  expect(entryPaths(deny.backend.text())).toEqual([ROOT]);
});

test("a closed or failing prompt is untrusted and saves nothing", async () => {
  await eachInOrder(
    [undefined, "throw" as const, { kind: "parent", verdict: "deny" } as const],
    async (choice) => {
      const h = harness({ choice });
      expect(await summary(h)).toEqual({ trusted: false, verdict: "undecided", via: "prompt" });
      expect(h.backend.calls.updates).toBe(0);
      return "continue";
    },
  );
});

test("a corrupt store denies without a prompt, but always and never still apply", async () => {
  const corrupt = harness({ store: "{ broken", choice: { kind: "folder", verdict: "allow" } });
  const result = await resolveProjectTrust(corrupt.input);
  expect(result).toMatchObject({
    trusted: false,
    verdict: "undecided",
    via: "corruptStore",
    storeError: { kind: "corrupt" },
  });
  expect(corrupt.prompts).toHaveLength(0);
  expect(corrupt.backend.text()).toBe("{ broken");

  const always = harness({ store: "{ broken", defaultProjectTrust: "always" });
  expect(await summary(always)).toEqual({ trusted: true, verdict: "allow", via: "default" });
  const never = harness({ store: "{ broken", defaultProjectTrust: "never" });
  expect(await summary(never)).toEqual({ trusted: false, verdict: "deny", via: "default" });
});

test("a failed save keeps the decision and reports the store error", async () => {
  const h = harness({ decision: { trusted: "yes", remember: true }, store: "{ broken" });
  const result = await resolveProjectTrust(h.input);
  expect(result).toMatchObject({ trusted: true, via: "point", storeError: { kind: "corrupt" } });
  expect(h.backend.text()).toBe("{ broken");

  const lookup: TrustLookup = await h.input.store.lookup(ROOT);
  expect(lookup.kind).toBe("corrupt");
});
