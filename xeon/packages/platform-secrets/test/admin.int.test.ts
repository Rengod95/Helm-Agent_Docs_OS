import { afterEach, describe, expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ChildRequest } from "../src/admin.ts";
import { createSecretsRuntime } from "../src/assemble.ts";
import { parseAuditLine } from "../src/audit-file.ts";
import { DEFAULT_SECRETS_CONFIG } from "../src/config.ts";
import { manualClock } from "./support/clock.ts";
import { httpCtx } from "./support/ctx.ts";
import { fixedLocalIds } from "./support/ids.ts";
import { metaOf } from "./support/meta.ts";
import { handleOf } from "./support/names.ts";
import { fakeOs, tempDir, type TempDir } from "./support/os.ts";
import { realSopsFixture, REAL_SOPS } from "./support/real-sops.ts";
import { trackedSource } from "./support/value-source.ts";

// E7 서비스 부분: 조립한 관리 서비스(실제 파일: 메타, 감사 파일, sops 파일)로 등록, 목록, 열람, 삭제.
// 실제 sops와 일회용 age 키를 쓴다. 바이너리가 없으면 건너뛴다. 값은 시험이 만든 가짜이고 불리언으로만 비교한다.

const real = REAL_SOPS !== null;
const sops = REAL_SOPS ?? "";
const NEW = handleOf("other-token");

const dirs: TempDir[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => dir.remove()));
});

async function assembled() {
  const dir = await tempDir();
  dirs.push(dir);
  const fx = await realSopsFixture(dir, sops, { EXISTING_KEY: "existing-fake-value-0101" });
  const config = dir.join("config");
  const clock = manualClock();
  const children: ChildRequest[] = [];
  const runtime = createSecretsRuntime({
    os: fakeOs({
      config,
      clock,
      binaries: { sops: [sops, "3.13.3"] },
    }),
    ids: fixedLocalIds(),
    config: () => ({
      ...DEFAULT_SECRETS_CONFIG,
      sops: { files: [{ env: "dev", path: fx.yaml }], binary: sops },
      ageKey: { source: "file", filePath: fx.keyFile },
    }),
    env: {
      PATH: Bun.env["PATH"] ?? "/usr/bin:/bin",
      SOPS_AGE_KEY: "parent-should-not-reach-child",
    },
    childRunner: (request) => {
      children.push(request);
      return Promise.resolve({ kind: "exited", exitCode: 0 });
    },
  });
  return { dir, fx, config, clock, runtime, children };
}

describe.skipIf(!real)("assembled admin service (E7)", () => {
  test("add, ls, test, reveal, run, rotate and rm over real files", async () => {
    const h = await assembled();
    const { admin, service } = h.runtime;
    const value = "assembled-fake-value-0102";
    const meta = metaOf({ name: "other-token", ref: "dev/OTHER_KEY", modes: ["runtime-http"] });

    // 등록: 값은 SOPS 파일로, 메타는 0600 파일로
    expect(await admin.add(meta, trackedSource(value))).toEqual({ ok: true, value: NEW });
    const metaPath = join(h.config, "secrets", "meta", "other-token.yaml");
    expect((await stat(metaPath)).mode & 0o777).toBe(0o600);
    expect((await readFile(metaPath, "utf8")).includes(value)).toBe(false);
    expect((await readFile(h.fx.yaml, "utf8")).includes(value)).toBe(false);

    // 목록: 복호화 없이 메타와 sops 항목을 합친다(EXISTING_KEY는 메타가 없어 orphaned)
    const listed = await admin.ls({ usage: false });
    expect(listed.ok && listed.value.map((l) => [l.handle, l.status])).toEqual([
      [NEW, "valid"],
      [null, "orphaned"],
    ]);

    // 점검
    const tested = await admin.test(NEW);
    expect(tested.ok && tested.value.length).toBe(value.length);

    // 사용(lease) 뒤 사용 이력에 보인다
    const lease = await service.lease(NEW, httpCtx());
    expect(lease.ok).toBe(true);
    if (lease.ok) lease.value.dispose();
    const usage = await admin.usage(NEW, { decision: "allow" });
    expect(usage.ok && usage.value.map((r) => r.type)).toEqual(["secret.used"]);

    // 열람: tty-confirm(이 기기에는 OS 인증이 없다), 값은 콜백에만 보이고 기록이 먼저 남는다
    let shown = false;
    const revealed = await admin.reveal(
      NEW,
      { method: "tty-confirm", verifiedAt: h.clock.now() },
      (view) => {
        shown = view.text() === value;
        return Promise.resolve();
      },
    );
    expect(revealed.ok).toBe(true);
    expect(shown).toBe(true);
    const stale = await admin.reveal(
      NEW,
      { method: "tty-confirm", verifiedAt: h.clock.now() - 61_000 },
      () => {
        shown = false;
        return Promise.resolve();
      },
    );
    expect(stale).toEqual({ ok: false, error: { kind: "reauth_required" } });
    expect(shown).toBe(true);

    // 사람 실행: 자식 env에만 값이 있고 부모의 민감 변수는 없다
    expect(
      (await admin.run({ OTHER_TOKEN: NEW }, ["tool", "arg"], { inheritStdio: true })).ok,
    ).toBe(true);
    expect(h.children[0]?.env["OTHER_TOKEN"] === value).toBe(true);
    expect("SOPS_AGE_KEY" in (h.children[0]?.env ?? {})).toBe(false);

    // 회전과 삭제
    const rotated = "rotated-fake-value-0103";
    expect((await admin.rotate(NEW, trackedSource(rotated))).ok).toBe(true);
    expect((await admin.test(NEW)).ok).toBe(true);
    expect((await admin.rm(NEW, { confirmed: true })).ok).toBe(true);
    const after = await admin.ls({ usage: false });
    expect(after.ok && after.value.map((l) => l.status)).toEqual(["orphaned"]);
    expect(
      (await readdir(join(h.config, "secrets", "meta"))).filter((n) => n.endsWith(".yaml")),
    ).toEqual([]);

    // 감사 파일: 0600, 줄마다 JSON, 값과 값의 조각이 없다
    const auditPath = join(h.config, "secrets", "audit.log");
    expect((await stat(auditPath)).mode & 0o777).toBe(0o600);
    const audit = await readFile(auditPath, "utf8");
    const types = audit
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => parseAuditLine(line)?.type);
    expect(types).toEqual([
      "secret.created",
      "secret.used",
      "secret.revealed",
      "secret.used",
      "secret.rotated",
      "secret.deleted",
    ]);
    expect([value, rotated].some((v) => audit.includes(v))).toBe(false);
    service[Symbol.dispose]();
  });

  test("a second add of the same name is already_exists and the sops file is not touched", async () => {
    const h = await assembled();
    const meta = metaOf({ name: "other-token", ref: "dev/OTHER_KEY", modes: ["runtime-http"] });
    expect((await h.runtime.admin.add(meta, trackedSource("first-fake-value-0104"))).ok).toBe(true);
    const before = await readFile(h.fx.yaml, "utf8");
    const again = await h.runtime.admin.add(meta, trackedSource("second-fake-value-0105"));
    expect(again).toEqual({ ok: false, error: { kind: "already_exists", handle: NEW } });
    expect(await readFile(h.fx.yaml, "utf8")).toBe(before);
    h.runtime.service[Symbol.dispose]();
  });
});
