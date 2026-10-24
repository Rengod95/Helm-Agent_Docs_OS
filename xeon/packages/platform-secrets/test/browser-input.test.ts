import { describe, expect, test } from "bun:test";
import type { SecretAuditRecord } from "@xeon/contracts/capabilities";
import { matchOrigin } from "../src/policy.ts";
import { memorySecrets } from "../src/testing/index.ts";
import { manualClock } from "./support/clock.ts";
import { APPROVAL_PER_SESSION } from "./support/ctx.ts";
import { fixedLocalIds } from "./support/ids.ts";
import { metaOf, type MetaInput } from "./support/meta.ts";
import { handleOf } from "./support/names.ts";
import { fakeValue, seededRandom } from "./support/random.ts";
import { allZero } from "./support/value-source.ts";

// plan SC-17, spec §4.3 M4 규칙. 값은 fill 콜백에만 보이고 origin은 정확히 같아야 한다.

const HANDLE = handleOf("github-token");
const BROWSER_META: MetaInput = {
  modes: ["browser-input"],
  tools: ["web.browse"],
  origins: ["https://login.example.test"],
  approval: "per-session",
};

function setup(metaInput: MetaInput = BROWSER_META, value?: string) {
  const clock = manualClock();
  const secret = value ?? fakeValue(seededRandom(33), 24, true);
  const mem = memorySecrets({
    clock,
    scheduler: clock,
    ids: fixedLocalIds(),
    secrets: [{ meta: metaOf(metaInput), value: secret }],
  });
  const records: SecretAuditRecord[] = [];
  mem.onAudit((record) => records.push(record));
  return { mem, secret, records };
}

const CTX = {
  purpose: "web.browse",
  actor: "agent",
  threadId: "thr_test",
  toolCallId: "call_9",
  projectId: null,
  approval: APPROVAL_PER_SESSION,
} as const;

describe("withBrowserInput (M4)", () => {
  test("fill gets the value for the exact origin, then the bytes are zeroed and the lease is closed", async () => {
    const { mem, secret, records } = setup();
    let matches = false;
    const copy: { bytes: Uint8Array | null } = { bytes: null };
    const result = await mem.withBrowserInput(HANDLE, "https://login.example.test", CTX, (view) => {
      matches = view.text() === secret;
      copy.bytes = view.bytes;
      return Promise.resolve("filled");
    });
    expect(result).toEqual({ ok: true, value: "filled" });
    expect(matches).toBe(true);
    expect(copy.bytes !== null && allZero(copy.bytes)).toBe(true);
    expect(mem.activeLeaseCount(HANDLE)).toBe(0);
    expect(records.map((r) => r.type)).toEqual(["secret.approved", "secret.used"]);
    expect(records.at(-1)).toMatchObject({
      type: "secret.used",
      mode: "browser-input",
      host: "login.example.test",
      commandHash: null,
    });
    expect(JSON.stringify(records).includes(secret)).toBe(false);
  });

  const wrongOrigins = [
    "https://evil.example.test",
    "https://sub.login.example.test",
    "http://login.example.test",
    "https://login.example.test:8443",
    "https://login.example.test/path",
    "not a url",
  ];
  for (const origin of wrongOrigins) {
    test(`origin ${origin} never reaches the provider or the fill callback`, async () => {
      const { mem, records } = setup();
      let called = false;
      const result = await mem.withBrowserInput(HANDLE, origin, CTX, () => {
        called = true;
        return Promise.resolve(1);
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({ kind: "denied", handle: HANDLE, reason: "origin_mismatch" });
      }
      expect(called).toBe(false);
      expect(mem.providerLeaseCalls()).toBe(0);
      expect(records.map((r) => r.type)).toEqual(["secret.denied"]);
    });
  }

  test("approval is required by the meta and a mode outside the meta is denied", async () => {
    const { mem } = setup();
    const noApproval = await mem.withBrowserInput(
      HANDLE,
      "https://login.example.test",
      { ...CTX, approval: null },
      () => Promise.resolve(1),
    );
    expect(noApproval.ok).toBe(false);
    if (!noApproval.ok) expect(noApproval.error).toMatchObject({ reason: "approval_missing" });

    const other = setup({ ...BROWSER_META, modes: ["runtime-http"] });
    const wrongMode = await other.mem.withBrowserInput(
      HANDLE,
      "https://login.example.test",
      CTX,
      () => Promise.resolve(1),
    );
    expect(wrongMode.ok).toBe(false);
    if (!wrongMode.ok) expect(wrongMode.error).toMatchObject({ reason: "mode_not_allowed" });
  });

  test("a value shorter than 8 bytes is allowed in this mode because the screen is masked by the driver", async () => {
    const { mem } = setup(BROWSER_META, "short");
    let seen = "";
    const result = await mem.withBrowserInput(HANDLE, "https://login.example.test", CTX, (view) => {
      seen = view.text();
      return Promise.resolve(true);
    });
    expect(result.ok).toBe(true);
    expect(seen).toBe("short");
  });
});

describe("matchOrigin", () => {
  test("only case and the default port notation are equal", () => {
    expect(matchOrigin("https://Login.Example.test", "https://login.example.test")).toBe(true);
    expect(matchOrigin("https://login.example.test:443", "https://login.example.test")).toBe(true);
    expect(matchOrigin("https://login.example.test", "https://login.example.test:443")).toBe(true);
    expect(matchOrigin("https://*.example.test", "https://a.example.test")).toBe(false);
    expect(matchOrigin("https://login.example.test", "https://login.example.test.evil.test")).toBe(
      false,
    );
    expect(matchOrigin("http://login.example.test", "http://login.example.test")).toBe(false);
    expect(matchOrigin("https://user@login.example.test", "https://login.example.test")).toBe(
      false,
    );
  });
});
