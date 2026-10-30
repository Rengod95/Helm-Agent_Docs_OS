import { afterAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eachAsync, parse, parseJson } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import { FIRST_DENY, validateManifest, type ToolCallDecision } from "@xeon/contracts/extensions";
import { createTestHost, type TestHost } from "@xeon/ext-host/testing";
import {
  checkGroupName,
  defineGroup,
  GroupSettingsSourceKey,
  TemplateIndexSchema,
  type GroupModule,
  type TemplateIndex,
  type TemplateKind,
} from "../../src/index.ts";
import { replayDrive } from "../../src/testing/index.ts";
import { fireSettled, install, serviceRig } from "../support/host.ts";
import { loadGeneratedGroup } from "../support/load-generated.ts";
import { groupManifestOf } from "../support/manifests.ts";
import { createReplayHarness } from "../support/replay-harness.ts";
import {
  GENERATED_ROOT,
  TEMPLATES_DIR,
  generateTemplate,
  linkGroupKit,
  removeGenerated,
} from "../support/generate-template.ts";

// 그룹 템플릿 시험(L3.slots.plan §5, S-01·S-03·S-04). 템플릿을 test/.generated/<무작위>/ 아래에 만들고 쓴 뒤 지운다.
// 생성 디렉터리는 패키지 안에 있어 @xeon/* 해석이 워크스페이스와 같다.
// 템플릿의 defaultEnabled는 false다(L3.slots.spec §3.3.5). 그래서 시험은 켜는 요청을 내고 다음 경계까지 돌린 뒤 본다.

const TEMPLATE_KINDS: readonly TemplateKind[] = ["drive", "policy", "observe"];

// 생성 뿌리(test/.generated)까지 지운다. 각 시험은 자기 무작위 디렉터리를 finally에서 지운다
afterAll(() => {
  rmSync(GENERATED_ROOT, { recursive: true, force: true });
});

/** 템플릿을 새 디렉터리에 만들고 본문을 돌린 뒤 지운다. 본문이 던져도 지운다 */
async function withGenerated<T>(
  kind: TemplateKind,
  name: string,
  body: (dir: string) => Promise<T>,
): Promise<T> {
  const root = join(GENERATED_ROOT, randomUUID());
  try {
    const written = await generateTemplate({ kind, name, target: join(root, name) });
    if (!written.ok)
      throw new Error(`generateTemplate(${kind}) failed: ${JSON.stringify(written.error)}`);
    const linked = await linkGroupKit(root);
    if (!linked.ok) throw new Error(`linkGroupKit failed: ${JSON.stringify(linked.error)}`);
    return await body(join(root, name));
  } finally {
    removeGenerated(root);
  }
}

async function readTemplateIndex(): Promise<TemplateIndex> {
  const json = parseJson(await Bun.file(join(TEMPLATES_DIR, "index.json")).text());
  if (!json.ok) throw new Error("templates/index.json is not JSON");
  const checked = parse(TemplateIndexSchema, json.value);
  if (!checked.ok) throw new Error("templates/index.json does not match TemplateIndexSchema");
  return checked.value;
}

/** 템플릿이 만든 그룹을 켠다. 켜는 요청은 다음 단계 경계에 적용되고, 그 뒤 settle한다 */
async function switchOn(t: TestHost, thread: ThreadId, name: string): Promise<void> {
  t.host.scope(name)?.enable();
  await t.boundary(thread).stepEnd();
  await t.settled();
}

/**
 * 재생 시험용: 템플릿 그룹을 기본 켜짐으로 바꾼 같은 그룹. 범위 정의에 defaultEnabled만 더하고 나머지는 그대로 둔다.
 * 재생은 그룹이 도는 동안의 결정성을 보므로 켜진 상태에서 시험한다.
 */
function enabledByDefault(module: GroupModule): GroupModule {
  return {
    ...module,
    entry: ({ manifest, scope }) =>
      module.entry({
        manifest,
        scope: (id, def, setup) => scope(id, { ...def, defaultEnabled: true }, setup),
      }),
  };
}

/** 설정 원천. 그룹 키 하나만 값을 준다 */
function blockedBy(name: string, tools: readonly string[]): (key: string) => unknown {
  return (key) => (key === `ext.${name}.blockedTools` ? [...tools] : undefined);
}

interface PolicyRig {
  readonly t: TestHost;
  readonly thread: ThreadId;
}

/** 설정 원천을 붙인 호스트에 그룹 하나를 올리고 세션을 연다. 그룹은 템플릿 기본값(꺼짐)으로 올라간다 */
async function policyHost(
  module: GroupModule,
  values: (key: string) => unknown,
): Promise<PolicyRig> {
  const t = await createTestHost();
  await t.host.registerPlatform({
    name: "settings-source",
    setup(ctx) {
      ctx.providePort(GroupSettingsSourceKey, { value: values });
    },
  });
  await install(t, module);
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  return { t, thread };
}

function callBefore(t: TestHost, thread: ThreadId, toolName: string, key: string) {
  return t.host.dispatch(
    "tool.call.before",
    { toolCallId: `call-${key}`, toolName, input: {} },
    { threadId: thread, dispatchKey: key },
  );
}

/** 그룹 상태 커밋 기록. 드라이브 그룹 시험이 커밋된 단계를 센다 */
function committedDocs(t: TestHost, thread: ThreadId) {
  return t.records.events(thread).filter((event) => event.kind === "grp.tpl-drive.state.committed");
}

test("template.index-matches-files", async () => {
  const index = await readTemplateIndex();
  const typed: TemplateIndex = index;
  expect(typed.schemaVersion).toBe(1);

  const listed = TEMPLATE_KINDS.flatMap((kind) => index.templates[kind].files);
  expect(listed.filter((file) => !existsSync(join(TEMPLATES_DIR, file)))).toEqual([]);

  const onDisk = [
    ...new Bun.Glob("**/*").scanSync({ cwd: TEMPLATES_DIR, dot: true, onlyFiles: true }),
  ]
    .filter((file) => file !== "index.json")
    .toSorted();
  for (const kind of TEMPLATE_KINDS) {
    const expected = onDisk.filter(
      (file) => file.startsWith("common/") || file.startsWith(`${kind}/`),
    );
    expect([...index.templates[kind].files].toSorted()).toEqual(expected);
  }
  const unowned = onDisk.filter(
    (file) =>
      !file.startsWith("common/") && !TEMPLATE_KINDS.some((kind) => file.startsWith(`${kind}/`)),
  );
  expect(unowned).toEqual([]);
  expect(index.templates.drive.files).toHaveLength(10);
  expect(index.templates.policy.files).toHaveLength(8);
  expect(index.templates.observe.files).toHaveLength(9);
});

test("template.name-check-rejects-bad-names", async () => {
  expect(checkGroupName("focus_lens")).toEqual({
    ok: false,
    error: { kind: "group_name", reason: "pattern", name: "focus_lens" },
  });
  expect(checkGroupName("core")).toEqual({
    ok: false,
    error: { kind: "group_name", reason: "reserved", name: "core" },
  });
  expect(checkGroupName("focus-lens")).toEqual({ ok: true, value: "focus-lens" });

  // 생성기도 같은 검사를 쓰고, 쓰기 전에 거부한다
  const root = join(GENERATED_ROOT, randomUUID());
  try {
    const target = join(root, "focus_lens");
    expect(await generateTemplate({ kind: "policy", name: "focus_lens", target })).toEqual({
      ok: false,
      error: { kind: "group_name", reason: "pattern", name: "focus_lens" },
    });
    expect(existsSync(target)).toBe(false);

    // 대상 디렉터리가 비어 있지 않으면 파일을 쓰지 않고 거부한다(R3)
    const busy = join(root, "busy-group");
    mkdirSync(busy, { recursive: true });
    writeFileSync(join(busy, "keep.txt"), "keep");
    expect(await generateTemplate({ kind: "observe", name: "busy-group", target: busy })).toEqual({
      ok: false,
      error: { kind: "target_not_empty", target: busy },
    });
    expect(existsSync(join(busy, "src"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("template.manifest-passes-validateManifest", async () => {
  await eachAsync(TEMPLATE_KINDS, async (kind) => {
    await withGenerated(kind, "tpl-manifest", async (dir) => {
      const json = parseJson(await Bun.file(join(dir, ".xeon-plugin/plugin.json")).text());
      expect(json.ok).toBe(true);
      const result = validateManifest(json.ok ? json.value : undefined);
      expect(result.issues.filter((found) => found.severity === "error")).toEqual([]);
      expect(result.manifest).toMatchObject({
        name: "tpl-manifest",
        kind: "group",
        layer: "L3",
        usesDrive: kind === "drive",
        defaultEnabled: false,
      });

      // 실제 등록은 setup이 돌 때 호스트가 validateUsage로 대조한다. 템플릿은 꺼진 상태로 올라가 setup을 건너뛴다
      const module = await loadGeneratedGroup(join(dir, "src/index.ts"));
      const t = await createTestHost();
      const installed = await install(t, module);
      expect(installed.issues.filter((found) => found.severity === "error")).toEqual([]);
      expect(installed.setups.map((setup) => setup.status)).toEqual(["skipped"]);

      // 켜면 setup이 돌고, 등록이 선언과 맞아 진단이 남지 않는다
      const thread = t.newThread();
      await t.host.openThread(thread);
      await switchOn(t, thread, "tpl-manifest");
      expect(t.host.scope("tpl-manifest")?.status).toBe("enabled");
      expect(t.diagnostics).toEqual([]);
    });
    return undefined;
  });
});

test("template.drive-group-loads-and-toggles", async () => {
  await withGenerated("drive", "tpl-drive", async (dir) => {
    const module = await loadGeneratedGroup(join(dir, "src/index.ts"));
    const { t, thread, service } = await serviceRig([module]);
    // 로드: 템플릿 기본값은 꺼짐이라 임대도 drive 호출도 없다
    expect(t.host.scope("tpl-drive")?.status).toBe("disabled");
    expect(t.host.leaseOf(thread)).toBeNull();
    expect(t.loop.turns).toHaveLength(0);

    // 켜기: 다음 경계에서 임대를 받고 drive가 불린다. 세 경계가 지나면 세 단계가 커밋되고 phase가 done이 된다
    expect(service.enable("tpl-drive")).toMatchObject({ ok: true });
    await t.boundary(thread).stepEnd();
    await t.settled();
    expect(t.host.leaseOf(thread)).toMatchObject({ scopeId: "tpl-drive" });
    await eachAsync([1, 2, 3], async () => {
      await t.boundary(thread).turnSettled();
      return undefined;
    });
    expect(committedDocs(t, thread).map((draft) => draft.payload)).toHaveLength(3);
    expect(committedDocs(t, thread).at(-1)?.payload).toMatchObject({
      doc: { phase: "done", round: 3 },
    });
    const turnsWhenDone = t.loop.turns.length;
    expect(turnsWhenDone).toBe(3);

    // 끄기: 요청은 즉시 기록되고 다음 경계에서 임대가 반납된다
    expect(service.disable("tpl-drive")).toMatchObject({ ok: true });
    expect(t.host.leaseOf(thread)).toMatchObject({ scopeId: "tpl-drive" });
    const drafts = await t.boundary(thread).stepEnd();
    expect(drafts.map((draft) => draft.kind)).toContain("lease.released");
    expect(t.host.leaseOf(thread)).toBeNull();

    // 다시 켜기: 임대를 받고 drive가 불리지만, 커밋된 상태가 done이라 턴을 내지 않고 돌아간다
    expect(service.enable("tpl-drive")).toMatchObject({ ok: true });
    await t.boundary(thread).stepEnd();
    await t.settled();
    expect(t.host.leaseOf(thread)).toMatchObject({ scopeId: "tpl-drive" });
    expect(t.loop.turns).toHaveLength(turnsWhenDone);
    expect(committedDocs(t, thread)).toHaveLength(3);
  });
});

test("template.policy-group-denies-via-first", async () => {
  await withGenerated("policy", "tpl-policy", async (dir) => {
    const module = await loadGeneratedGroup(join(dir, "src/index.ts"));
    const { t, thread } = await policyHost(module, blockedBy("tpl-policy", ["bash"]));
    // 꺼진 기본 상태에서는 막지 않는다
    expect((await callBefore(t, thread, "bash", "tc-off")).decision).toBeUndefined();

    await switchOn(t, thread, "tpl-policy");
    const denied = await callBefore(t, thread, "bash", "tc-denied");
    expect(denied.decision).toEqual({
      block: true,
      reason: "tpl-policy 정책이 이 도구를 막았다",
    });
    const allowed = await callBefore(t, thread, "read", "tc-allowed");
    expect(allowed.decision).toBeUndefined();
  });
});

test("template.policy-exception-becomes-deny", async () => {
  await withGenerated("policy", "tpl-policy", async (dir) => {
    const policy = await loadGeneratedGroup(join(dir, "src/index.ts"));
    const t = await createTestHost();
    // 설정 원천이 읽기에서 던진다. 정책 핸들러의 settings() 호출이 던지므로 핸들러 예외가 된다
    await t.host.registerPlatform({
      name: "settings-source",
      setup(ctx) {
        ctx.providePort(GroupSettingsSourceKey, {
          value: (key) => {
            if (key === "ext.tpl-policy.blockedTools") {
              throw new TypeError("settings store unreadable");
            }
            return undefined;
          },
        });
      },
    });
    let laterCalls = 0;
    const later = defineGroup({
      manifest: groupManifestOf({ name: "tpl-later", points: ["tool.call.before"] }),
      setup(g) {
        g.on("tool.call.before", () => {
          laterCalls += 1;
          return undefined;
        });
      },
    });
    await install(t, policy, 0);
    await install(t, later, 1);
    const thread = t.newThread();
    await t.host.openThread(thread);
    await t.settled();
    await switchOn(t, thread, "tpl-policy");

    const result = await callBefore(t, thread, "bash", "tc-throws");
    expect(result.decision).toEqual(FIRST_DENY["tool.call.before"]);
    expect(result.decision).toEqual({
      block: true,
      reason: "extension handler failed",
      terminate: false,
    });
    // fail-closed: 뒤 핸들러는 실행되지 않는다
    expect(laterCalls).toBe(0);
  });
});

test("template.policy-group-disable-stops-first-handler", async () => {
  await withGenerated("policy", "tpl-policy", async (dir) => {
    const module = await loadGeneratedGroup(join(dir, "src/index.ts"));
    const { t, thread } = await policyHost(module, blockedBy("tpl-policy", ["bash"]));
    await switchOn(t, thread, "tpl-policy");
    const blockReason = {
      block: true,
      reason: "tpl-policy 정책이 이 도구를 막았다",
    } satisfies ToolCallDecision;
    expect((await callBefore(t, thread, "bash", "tc-on")).decision).toEqual(blockReason);

    // 끄기 요청은 다음 단계 경계에 적용된다. 적용 뒤에는 first 핸들러가 불리지 않아 도구가 통과한다
    t.host.scope("tpl-policy")?.disable();
    await t.boundary(thread).stepEnd();
    expect(t.host.scope("tpl-policy")?.status).toBe("disabled");
    expect((await callBefore(t, thread, "bash", "tc-off")).decision).toBeUndefined();

    await switchOn(t, thread, "tpl-policy");
    expect(t.host.scope("tpl-policy")?.status).toBe("enabled");
    expect((await callBefore(t, thread, "bash", "tc-back")).decision).toEqual(blockReason);
  });
});

test("template.replay-test-cuts-at-every-commit", async () => {
  await withGenerated("drive", "tpl-replay", async (dir) => {
    const module = await loadGeneratedGroup(join(dir, "src/index.ts"));
    // 생성된 test/replay.test.ts와 같은 검사를 group-kit의 재생 하니스로 한다. 생성 파일 자체는 아래 생성 실행 시험이 돌린다
    const report = await replayDrive({
      group: enabledByDefault(module),
      harness: createReplayHarness(),
    });
    expect(report.failure).toBeUndefined();
    expect(report.commits).toBeGreaterThanOrEqual(1);
    expect(report.cuts.map((cut) => cut.commitIndex)).toEqual(
      Array.from({ length: report.commits }, (_, index) => index + 1),
    );
    expect(report.cuts.every((cut) => cut.equal && cut.firstDiff === null)).toBe(true);
    expect(report.ok).toBe(true);
  });
});

test("template.observe-group-records-turn-count", async () => {
  await withGenerated("observe", "tpl-observe", async (dir) => {
    const module = await loadGeneratedGroup(join(dir, "src/index.ts"));
    const t = await createTestHost();
    await install(t, module);
    const thread = t.newThread();
    await t.host.openThread(thread);
    await t.settled();
    await switchOn(t, thread, "tpl-observe");

    const before = t.records.events(thread).length;
    await fireSettled(t, thread, "settled-1");
    await fireSettled(t, thread, "settled-2");
    const counted = t.records
      .events(thread)
      .filter((event) => event.kind === "grp.tpl-observe.turn.counted");
    expect(counted).toHaveLength(2);
    // 상태 커밋도 턴마다 한 번이다
    const committed = t.records
      .events(thread)
      .filter((event) => event.kind === "grp.tpl-observe.state.committed");
    expect(committed).toHaveLength(2);
    expect(t.records.events(thread).length - before).toBeGreaterThanOrEqual(4);
  });
});

test("template.generated-tests-pass", async () => {
  // 생성된 그룹은 수정 없이 bun test가 통과해야 한다(L3.slots.spec §4.3 2번). 한 번에 하나씩 돌린다(메모리 상한)
  await eachAsync(TEMPLATE_KINDS, async (kind) => {
    await withGenerated(kind, `tpl-run-${kind}`, async (dir) => {
      const proc = Bun.spawn([process.execPath, "test"], {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      expect({ kind, exitCode, output: exitCode === 0 ? "" : `${stdout}${stderr}` }).toEqual({
        kind,
        exitCode: 0,
        output: "",
      });
    });
    return undefined;
  });
});
