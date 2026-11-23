import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import type { EvidenceRef } from "@fresnel/contracts/extensions";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { locateTemplateDirs } from "@fresnel/core-authoring";
import type { PluginMode } from "@fresnel/contracts/services";
import { createDevkitPort } from "../../src/assembly/m4/devkit-port.ts";
import type { M4PortDeps } from "../../src/assembly/m4/deps.ts";
import { createPluginService } from "../../src/assembly/plugins/index.ts";
import { partial } from "../fixtures/unsafe.ts";
import { APPROVE_TO_WORK, PROFILES, pluginRigOf, removeRigs } from "./plugins/intake-rig.ts";

// 빌더의 제작 경로를 실제 검토 서비스 위에서 본다(M5c §4.9, 수락 기준). 뼈대 세 방식(훅, 지침, 구동)을 만들어
// 검사하고 제출하면 검토함에 항목이 하나씩 생기고, 승인된 훅 플러그인을 고치면 `update` 항목이 된다.
// 빌더 도구 대신 제작 포트를 직접 부른다: 도구 층의 흐름은 plugin-builder 시험이 본다.

afterAll(removeRigs);

/** 방식 하나의 뼈대를 만들고 검사하고 제출한다. 셋 모두 통과하면 참이다 */
async function buildAndSubmit(
  port: ReturnType<typeof createDevkitPort>,
  dir: string,
  mode: PluginMode,
  origin: ThreadId,
  evidence: readonly [EvidenceRef],
): Promise<boolean> {
  const name = dir.slice(dir.lastIndexOf("/") + 1);
  const made = await port.scaffold({
    kind: "single-plugin",
    name,
    dir,
    mode,
    purpose: `${mode} 시험 플러그인`,
    description: `${mode} 시험 플러그인이 하는 일을 적은 설명이다.`,
  });
  const checked = await port.validate(dir);
  const sent = await port.submit({
    dir,
    originThreadId: origin,
    evidence,
    purpose: `${mode} 시험 플러그인`,
  });
  return made.ok && checked.ok && checked.value.ok && sent.ok;
}

const templates = locateTemplateDirs({});
const MODES: readonly PluginMode[] = ["inject", "hook", "drive"];

/** 검토함과 제작 포트 한 벌을 세운다. 시험마다 새 임시 자리를 쓴다 */
function craftRigOf(): {
  readonly rig: ReturnType<typeof pluginRigOf>;
  readonly configDir: string;
  readonly port: ReturnType<typeof createDevkitPort>;
} {
  if (templates === null) throw new Error("the plugin templates are missing");
  const rig = pluginRigOf();
  const configDir = join(rig.root, "config");
  const service = createPluginService({
    configDir,
    projectRoots: () => Promise.resolve([]),
    managedDir: null,
    bundleDir: null,
    records: () => [],
    profiles: { list: () => Promise.resolve(ok(PROFILES)) },
    store: rig.store,
    log: { info() {} },
  });
  const port = createDevkitPort(
    partial<M4PortDeps>({
      plugins: {
        get: (name) => service.get(name),
        draftList: (name) => rig.review.draftList(name),
      },
    }),
    { templates, submit: () => rig.review.submitPort },
  );
  return { rig, configDir, port };
}

test("authoring modes: an Inject, a Hook and a Drive plugin each go to the review box with the craft thread as origin, and a fix of an approved hook is an update", async () => {
  const { rig, configDir, port } = craftRigOf();
  const origin = fixedIdFactory(702).next("thr");
  const evidence: readonly [EvidenceRef] = [{ kind: "turn", threadId: origin, turnId: "t-1" }];

  // 세 방식을 플러그인 원본 폴더에 만들고 검사하고 제출한다. 검토 서비스가 제출을 직렬로 처리한다
  const sent = await Promise.all(
    MODES.map((mode) =>
      buildAndSubmit(port, join(configDir, "plugins", `demo-${mode}`), mode, origin, evidence),
    ),
  );
  expect(sent).toEqual([true, true, true]);

  // 검토함에는 세 항목이 있고 모두 담당 AI(assistant)가 만든 새 플러그인이다
  const pending = await rig.review.list({ state: "pending" });
  if (!pending.ok) throw new Error("the review list failed");
  expect(
    pending.value.items
      .map((item) => [item.name, item.kind, item.provenance, item.originThreadId])
      .toSorted((a, b) => (a[0] ?? "").localeCompare(b[0] ?? "")),
  ).toEqual([
    ["demo-drive", "new", "assistant", origin],
    ["demo-hook", "new", "assistant", origin],
    ["demo-inject", "new", "assistant", origin],
  ]);

  // 훅 플러그인을 승인하면 검토본이 생긴다. 원본 폴더는 그 검토본과 같다
  const hook = pending.value.items.find((item) => item.name === "demo-hook");
  if (hook === undefined) throw new Error("no hook item");
  expect((await rig.review.decide(hook.itemId, APPROVE_TO_WORK)).ok).toBe(true);
  const source = await port.sourceOf("demo-hook");
  expect(source).toEqual(
    ok({
      dir: join(configDir, "plugins", "demo-hook"),
      bundled: false,
      differsFromReviewed: false,
    }),
  );

  // 고치기: 원본을 바꾸면 원본이 검토본과 달라진다. 빌더는 원본에서 시작하고 제출은 `update`가 된다
  const fixedDir = join(configDir, "plugins", "demo-hook");
  appendFileSync(join(fixedDir, "src", "index.ts"), "// fixed by the builder\n");
  expect(await port.sourceOf("demo-hook")).toEqual(
    ok({ dir: fixedDir, bundled: false, differsFromReviewed: true }),
  );
  expect((await port.validate(fixedDir)).ok).toBe(true);
  expect(
    (
      await port.submit({
        dir: fixedDir,
        originThreadId: origin,
        evidence,
        purpose: "훅 시험 플러그인 고침",
      })
    ).ok,
  ).toBe(true);
  const after = await rig.review.list({ state: "pending" });
  if (!after.ok) throw new Error("the review list failed");
  expect(
    after.value.items
      .filter((item) => item.name === "demo-hook")
      .map((item) => [item.kind, item.provenance, item.originThreadId]),
  ).toEqual([["update", "assistant", origin]]);
  // 다른 두 항목은 그대로 새 플러그인으로 남는다
  expect(after.value.items.filter((item) => item.kind === "new")).toHaveLength(2);
});

test("authoring modes: a Native plugin (one declarative screen, no orchestration) goes to the review box as a new plugin with its screen file", async () => {
  const { rig, configDir, port } = craftRigOf();
  const origin = fixedIdFactory(703).next("thr");
  const evidence: readonly [EvidenceRef] = [{ kind: "turn", threadId: origin, turnId: "t-1" }];

  const dir = join(configDir, "plugins", "demo-native");
  expect(await buildAndSubmit(port, dir, "native", origin, evidence)).toBe(true);
  expect(existsSync(join(dir, "ui", "native", "main.view.json"))).toBe(true);

  const pending = await rig.review.list({ state: "pending" });
  if (!pending.ok) throw new Error("the review list failed");
  expect(
    pending.value.items.map((item) => [item.name, item.kind, item.provenance, item.originThreadId]),
  ).toEqual([["demo-native", "new", "assistant", origin]]);
});
