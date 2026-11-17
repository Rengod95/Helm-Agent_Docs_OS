import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createMigrationSubmitter } from "../../../src/assembly/plugins/index.ts";
import { emit, type PlannedPluginWithMigration } from "@fresnel/plugin-migration";
import {
  APPROVE_TO_WORK,
  errorOf,
  pluginRigOf,
  removeRigs,
  SILENT,
  valueOf,
  type PluginRig,
} from "./intake-rig.ts";
import { writeFiles } from "./support.ts";

// 마이그레이션 제출(§7.5 [제안]). 손으로 만든 작은 계획 픽스처로 시험한다(실제 `propose`는 쓰지 않는다).
// 쓴 바이트, 초안과 `migration` 항목, 같은 이름 재제출 규칙, 경로 탈출 거절, 승인 뒤 새 버전, 원본 감시와의 중복 금지를 본다.

afterEach(() => {
  removeRigs();
});

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

/** 계획 하나. 지침 파일 하나가 든 트리다 */
function planOf(
  name: string,
  purpose: string,
  files: Readonly<Record<string, string>> = { "instructions/01-note.md": "요약한다\n" },
): PlannedPluginWithMigration {
  return {
    name,
    purpose,
    derivedFrom: ["~/.claude/CLAUDE.md"],
    tree: new Map(Object.entries(files).map(([path, text]) => [path, enc(text)] as const)),
    pendingBuilder: [],
    userConfig: [],
    migration: {
      rulesVersions: { "claude-code": "1" },
      sources: [{ path: "~/.claude/CLAUDE.md", sha256: "0".repeat(64) }],
      report: [],
    },
  };
}

function submitterOf(rig: PluginRig) {
  return createMigrationSubmitter({
    userDir: rig.userDir,
    intake: rig.intake,
    review: rig.review,
    log: SILENT,
  });
}

test("the submit writes the emitted bytes to <userDir>/<name>/ and opens a migration item and a draft", async () => {
  const rig = pluginRigOf();
  const submitter = submitterOf(rig);
  const plan = planOf("brief", "요약 보고서를 쓴다");
  const made = valueOf(await submitter.submitPlanned([plan]));
  expect(made.map((draft) => draft.name)).toEqual(["brief"]);

  // 파일 바이트는 `emit`이 낸 그대로다. 매니페스트와 이식 기록도 그 안에 있다
  const folder = join(rig.userDir, "brief");
  for (const [path, bytes] of emit(plan)) {
    expect(Buffer.from(readFileSync(join(folder, path)))).toEqual(Buffer.from(bytes));
  }
  expect(readFileSync(join(folder, "instructions/01-note.md"), "utf8")).toBe("요약한다\n");
  expect(readFileSync(join(folder, ".fresnel-plugin/plugin.json"), "utf8")).toBe(
    `${JSON.stringify({ schemaVersion: 2, name: "brief", version: "0.0.0", purpose: "요약 보고서를 쓴다" }, null, 2)}\n`,
  );

  const item = valueOf(await rig.review.get(made[0]?.itemId ?? "")).item;
  expect(item.provenance).toBe("migration");
  expect(item.kind).toBe("new");
  expect(item.state).toBe("pending");
  expect(item.originThreadId).toBeNull();
  expect(item.evidence).toEqual([]);
  expect(item.card.purpose).toBe("요약 보고서를 쓴다");
  expect(item.files.map((file) => file.path)).toEqual([
    ".fresnel-plugin/migration.json",
    ".fresnel-plugin/plugin.json",
    "instructions/01-note.md",
  ]);
  expect(
    valueOf(await rig.review.draftList("brief")).drafts.map((draft) => draft.submittedItemId),
  ).toEqual([item.itemId]);
});

test("a source scan right after the write queues nothing, so the folder has exactly one item", async () => {
  const rig = pluginRigOf();
  const submitter = submitterOf(rig);
  valueOf(await submitter.submitPlanned([planOf("brief", "요약 보고서를 쓴다")]));
  // 원본 훑기가 같은 해시를 보면 `unknown` 항목을 또 만들지 않는다(수용 기준 12)
  expect(valueOf(await rig.review.scan()).queued).toEqual([]);
  expect(valueOf(await rig.review.scan()).queued).toEqual([]);
  const items = valueOf(await rig.review.list({ name: "brief" })).items;
  expect(items.map((item) => [item.provenance, item.state])).toEqual([["migration", "pending"]]);
});

test("a submit that runs at the same time as a source scan still leaves exactly one item", async () => {
  const rig = pluginRigOf();
  const submitter = submitterOf(rig);
  // 쓰기와 초안과 항목은 검토 서비스의 한 직렬 구간이라 원본 훑기가 그 사이에 끼지 못한다(수용 기준 12)
  const [submitted, scanned] = await Promise.all([
    submitter.submitPlanned([planOf("brief", "요약 보고서를 쓴다")]),
    rig.review.scan(),
  ]);
  expect(valueOf(submitted).map((draft) => draft.name)).toEqual(["brief"]);
  expect(valueOf(scanned).queued).toEqual([]);
  const items = valueOf(await rig.review.list({ name: "brief" })).items;
  expect(items.map((item) => item.provenance)).toEqual(["migration"]);
});

test("a second submit of the same name while the first is still pending is refused with plugin.exists", async () => {
  const rig = pluginRigOf();
  const submitter = submitterOf(rig);
  valueOf(await submitter.submitPlanned([planOf("brief", "요약 보고서를 쓴다")]));
  const again = errorOf(
    await submitter.submitPlanned([
      planOf("brief", "요약 보고서를 쓴다", { "instructions/01-note.md": "다른 내용\n" }),
    ]),
  );
  expect(again).toEqual({ kind: "exists", name: "brief" });
  // 거절된 제출은 원본을 바꾸지 않는다
  expect(readFileSync(join(rig.userDir, "brief/instructions/01-note.md"), "utf8")).toBe(
    "요약한다\n",
  );
});

test("a path that leaves the folder or is absolute refuses the whole batch and writes nothing", async () => {
  const rig = pluginRigOf();
  const submitter = submitterOf(rig);
  const good = planOf("good", "좋은 계획");
  const escaping = planOf("escape", "나쁜 계획", { "../outside.md": "밖\n" });
  const absolute = planOf("absolute", "나쁜 계획", { "/etc/fresnel.md": "절대\n" });
  expect(errorOf(await submitter.submitPlanned([good, escaping]))).toEqual({
    kind: "path_invalid",
  });
  expect(errorOf(await submitter.submitPlanned([absolute]))).toEqual({ kind: "path_invalid" });
  // 한 계획이라도 거절되면 좋은 계획도 쓰지 않는다
  expect(existsSync(join(rig.userDir, "good"))).toBe(false);
  expect(existsSync(join(rig.userDir, "escape"))).toBe(false);
  expect(existsSync(join(rig.root, "config", "outside.md"))).toBe(false);
  expect(valueOf(await rig.review.list({})).items).toEqual([]);
});

test("an invalid name or two plans with one name are refused as draft_invalid and write nothing", async () => {
  const rig = pluginRigOf();
  const submitter = submitterOf(rig);
  const invalid = errorOf(await submitter.submitPlanned([planOf("Bad Name", "나쁜 이름")]));
  expect(invalid.kind).toBe("draft_invalid");
  expect(invalid.kind === "draft_invalid" ? invalid.issues.map((issue) => issue.code) : []).toEqual(
    ["name_invalid"],
  );
  const twice = errorOf(
    await submitter.submitPlanned([planOf("twin", "하나"), planOf("twin", "둘")]),
  );
  expect(twice.kind === "draft_invalid" ? twice.issues.map((issue) => issue.code) : []).toEqual([
    "name_duplicate",
  ]);
  expect(existsSync(join(rig.userDir, "twin"))).toBe(false);
});

test("a folder the user wrote by hand is never overwritten by a migration", async () => {
  const rig = pluginRigOf();
  writeFiles(rig.userDir, { "brief/instructions/01-note.md": "직접 쓴 것\n" });
  const refused = errorOf(
    await submitterOf(rig).submitPlanned([planOf("brief", "요약 보고서를 쓴다")]),
  );
  expect(refused).toEqual({ kind: "exists", name: "brief" });
  expect(readFileSync(join(rig.userDir, "brief/instructions/01-note.md"), "utf8")).toBe(
    "직접 쓴 것\n",
  );
});

test("after approval the same plan submits nothing, and a changed plan is an approvable update that replaces the stale files", async () => {
  const rig = pluginRigOf();
  const submitter = submitterOf(rig);
  const first = valueOf(
    await submitter.submitPlanned([
      planOf("brief", "요약 보고서를 쓴다", {
        "instructions/01-note.md": "요약한다\n",
        "instructions/02-extra.md": "덧붙인다\n",
      }),
    ]),
  );
  const approved = valueOf(await rig.review.decide(first[0]?.itemId ?? "", APPROVE_TO_WORK));
  expect(approved.appliedTo).toEqual(["work"]);

  // 같은 계획이면 새 초안도 항목도 없다(§8 수용 14)
  expect(
    valueOf(
      await submitter.submitPlanned([
        planOf("brief", "요약 보고서를 쓴다", {
          "instructions/01-note.md": "요약한다\n",
          "instructions/02-extra.md": "덧붙인다\n",
        }),
      ]),
    ),
  ).toEqual([]);

  // 바뀐 계획은 새 버전이다. 옛 파일 `02-extra.md`는 지운다
  const second = valueOf(
    await submitter.submitPlanned([
      planOf("brief", "새 목적", { "instructions/01-note.md": "고친 내용\n" }),
    ]),
  );
  expect(second.map((draft) => draft.name)).toEqual(["brief"]);
  expect(existsSync(join(rig.userDir, "brief/instructions/02-extra.md"))).toBe(false);
  expect(readFileSync(join(rig.userDir, "brief/instructions/01-note.md"), "utf8")).toBe(
    "고친 내용\n",
  );

  const update = valueOf(await rig.review.get(second[0]?.itemId ?? "")).item;
  expect([update.kind, update.provenance, update.state]).toEqual([
    "update",
    "migration",
    "pending",
  ]);
  expect(update.baseHash).not.toBeNull();
  const outcome = valueOf(await rig.review.decide(update.itemId, APPROVE_TO_WORK));
  expect(outcome.item.state).toBe("approved");
  expect(outcome.item.card.purpose).toBe("새 목적");
  // 원본 훑기는 승인 뒤에도 새 항목을 만들지 않는다
  expect(valueOf(await rig.review.scan()).queued).toEqual([]);
});

test("after approval a hand edit of the folder makes the next migration refuse with plugin.exists", async () => {
  const rig = pluginRigOf();
  const submitter = submitterOf(rig);
  const first = valueOf(await submitter.submitPlanned([planOf("brief", "요약 보고서를 쓴다")]));
  valueOf(await rig.review.decide(first[0]?.itemId ?? "", APPROVE_TO_WORK));
  writeFiles(rig.userDir, { "brief/instructions/01-note.md": "손으로 고쳤다\n" });
  expect(
    errorOf(
      await submitter.submitPlanned([
        planOf("brief", "요약 보고서를 쓴다", { "instructions/01-note.md": "새 내용\n" }),
      ]),
    ),
  ).toEqual({ kind: "exists", name: "brief" });
  expect(readFileSync(join(rig.userDir, "brief/instructions/01-note.md"), "utf8")).toBe(
    "손으로 고쳤다\n",
  );
});

test("a migrated plugin with an empty purpose is approvable only with a purpose: purpose_required", async () => {
  const rig = pluginRigOf();
  const made = valueOf(await submitterOf(rig).submitPlanned([planOf("bare", "")]));
  expect(errorOf(await rig.review.decide(made[0]?.itemId ?? "", APPROVE_TO_WORK))).toEqual({
    kind: "purpose_required",
    itemId: made[0]?.itemId ?? "",
  });
  const approved = valueOf(
    await rig.review.decide(made[0]?.itemId ?? "", {
      ...APPROVE_TO_WORK,
      purpose: "목적을 채운다",
    }),
  );
  expect(approved.item.state).toBe("approved");
});
