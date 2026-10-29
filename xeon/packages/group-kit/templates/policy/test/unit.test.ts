import { expect, test } from "bun:test";
import { createTestHost } from "@xeon/ext-host/testing";
import { GroupSettingsSourceKey } from "@xeon/group-kit";
import { checkGroup } from "@xeon/group-kit/testing";
import group from "../src/index.ts";

test("__ID__.denies-a-blocked-tool-and-passes-the-others", async () => {
  const t = await createTestHost();
  await t.host.registerPlatform({
    name: "settings-source",
    setup(ctx) {
      ctx.providePort(GroupSettingsSourceKey, {
        value: (key) => (key === "ext.__ID__.blockedTools" ? ["bash"] : undefined),
      });
    },
  });
  await t.host.install({
    manifest: group.manifest,
    entry: group.entry,
    loadIndex: 0,
    builtin: true,
  });
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  // 템플릿 그룹은 꺼진 상태로 올라간다. 켜는 요청은 다음 경계에 적용된다
  t.host.scope(group.manifest.name)?.enable();
  await t.boundary(thread).stepEnd();

  const blocked = await t.host.dispatch(
    "tool.call.before",
    { toolCallId: "call_blocked", toolName: "bash", input: {} },
    { threadId: thread, dispatchKey: "tc-blocked" },
  );
  expect(blocked.decision).toEqual({ block: true, reason: "__TITLE__ 정책이 이 도구를 막았다" });

  const passed = await t.host.dispatch(
    "tool.call.before",
    { toolCallId: "call_passed", toolName: "read", input: {} },
    { threadId: thread, dispatchKey: "tc-passed" },
  );
  expect(passed.decision).toBeUndefined();
});

test("__ID__.setup-declares-every-point-and-effect", async () => {
  const errors = (await checkGroup(group)).filter((found) => found.severity === "error");
  expect(errors).toEqual([]);
});
