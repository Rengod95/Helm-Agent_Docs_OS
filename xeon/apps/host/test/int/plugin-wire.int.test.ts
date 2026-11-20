import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { WireError, type HostConnection } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { writeMarkerPlugin } from "../fixtures/plugin-review.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M5c §3.4, §4.7, §4.9, §4.10, §3.1 (int, 실제 엔진): 사용자 폴더의 플러그인을 검토 흐름으로 들이고 그 읽기·초안·되돌리기 메서드를 본다.
// `plugin.list`의 필터, `plugin.invocables`의 항목, `plugin.revert`가 원본 폴더를 검토본 내용으로 되돌리는 일,
// `plugin.draft.*`의 목록과 지우기, `plugin.draft.fromInstruction`이 지침 폴더와 검토 항목을 만드는 일, `pluginReview.file`이 후보 파일 글을 주는 일.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const NAME = "wire-kit";
const PROFILE = "wire-profile";
const OTHER_PROFILE = "wire-other";
const TIMEOUT_MS = 60_000;

type Connection = HostConnection;

/** 실제 엔진을 시작한다. 빌트인 묶음은 빈 임시 폴더로 바꿔 시험이 실제 설치 묶음을 읽지 않게 한다 */
async function startPluginHost(bundles: string) {
  const host = await startInProcessHost({
    devChecks: true,
    pluginHost: { disabled: true },
    defaultPluginsDir: bundles,
    extraPlugins: [],
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  return { host, connection };
}

/** 폴더 안의 모든 파일을 상대 경로와 글로 모은다. 되돌리기 전후를 값으로 비교한다 */
function snapshotOf(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else files[rel] = readFileSync(join(dir, entry.name), "utf8");
    }
  };
  walk(root, "");
  return files;
}

/** 검토함을 훑고 그 이름의 대기 항목 id를 돌려준다. 새 플러그인이어야 한다 */
async function scanForNew(connection: Connection, name: string): Promise<string> {
  await connection.request("plugin.scan", {});
  const listed = await connection.request("pluginReview.list", { state: "pending" });
  const item = listed.items.find((entry) => entry.name === name);
  if (item === undefined) throw new Error(`the review inbox has no pending item for ${name}`);
  expect(item.kind).toBe("new");
  return item.itemId;
}

/** 보관으로 승인한다(프로필에 넣지 않는다). 승인 결과를 돌려준다 */
async function approveLibrary(connection: Connection, itemId: string) {
  const decided = await connection.request("pluginReview.decide", {
    itemId,
    decision: { kind: "approve", profileIds: [], libraryOnly: true },
  });
  expect(decided.item.state).toBe("approved");
  return decided;
}

/** 지침 이름의 해시 자리: 입력 글 sha256의 앞 6자(16진수). 구현 규칙을 시험이 따로 적는다 */
function sha256Prefix(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 6);
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

realTest(
  "plugin.list filters by origin, review state and profile, and the approved card carries the reviewed hash",
  async () => {
    const home: EngineHome = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const bundles = mkdtempSync(join(tmpdir(), "plugin-wire-bundles-"));
    const marker = join(bundles, "list.marker");
    writeMarkerPlugin(home, NAME, "LIST-1", marker);
    const { host, connection } = await startPluginHost(bundles);
    try {
      const itemId = await scanForNew(connection, NAME);
      const item = (await connection.request("pluginReview.get", { itemId })).item;

      // 아직 승인하지 않은 플러그인은 승인된 목록에 없다. 사용자 출처 목록에는 든다
      const unapproved = await connection.request("plugin.list", {
        filter: { origin: "user", reviewState: "approved" },
      });
      expect(unapproved.plugins.map((card) => card.name)).toEqual([]);
      const userRows = await connection.request("plugin.list", { filter: { origin: "user" } });
      expect(userRows.plugins.map((card) => card.name)).toEqual([NAME]);
      expect(userRows.plugins[0]?.purpose).toBe("Writes LIST-1 on each settled turn");
      expect(userRows.plugins[0]?.origin).toEqual({ kind: "user" });
      // 리뷰 대기 항목이 있는 플러그인은 검토 칸이 대기이고 그 항목 id를 싣는다
      expect(userRows.plugins[0]?.review.state).toBe("pending");
      expect(userRows.plugins[0]?.review.pendingItemId).toBe(itemId);

      await approveLibrary(connection, itemId);
      const approved = await connection.request("plugin.list", {
        filter: { origin: "user", reviewState: "approved" },
      });
      expect(approved.plugins.map((card) => card.name)).toEqual([NAME]);
      // 검토본의 해시는 검토 항목의 후보 해시와 같다
      expect(approved.plugins[0]?.review.currentHash).toBe(item.candidateHash);
      expect(approved.plugins[0]?.usedBy).toEqual([]);

      // 프로필에 넣으면 그 프로필 필터에 든다. 다른 프로필 필터에는 들지 않는다
      await connection.request("profile.put", {
        profile: {
          id: PROFILE,
          title: "Wire",
          plugins: [{ name: NAME }],
          settings: [],
          startDrive: null,
        },
        baseRev: null,
      });
      const inProfile = await connection.request("plugin.list", {
        filter: { profileId: PROFILE },
      });
      expect(inProfile.plugins.map((card) => [card.name, card.usedBy])).toEqual([
        [NAME, [PROFILE]],
      ]);
      const inOther = await connection.request("plugin.list", {
        filter: { profileId: OTHER_PROFILE },
      });
      expect(inOther.plugins.map((card) => card.name)).toEqual([]);
    } finally {
      await connection.close();
      await host.close();
      rmSync(bundles, { recursive: true, force: true });
      home.dispose();
    }
  },
  TIMEOUT_MS,
);

realTest(
  "plugin.invocables offers the approved plugin as a whole-plugin entry on any thread, and refuses a thread that does not exist",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const bundles = mkdtempSync(join(tmpdir(), "plugin-wire-bundles-"));
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-plugin-wire-")));
    const marker = join(workspace, "invocables.marker");
    writeMarkerPlugin(home, NAME, "INVOKE-1", marker);
    const { host, connection } = await startPluginHost(bundles);
    try {
      const thread = await connection.request("thread.create", { workspace });
      const itemId = await scanForNew(connection, NAME);

      // 검토 전에는 호출할 항목이 없다
      const before = await connection.request("plugin.invocables", { threadId: thread.threadId });
      expect(before.entries.filter((entry) => entry.plugin === NAME)).toEqual([]);

      const item = (await connection.request("pluginReview.get", { itemId })).item;
      const candidateHash = item.candidateHash;
      if (candidateHash === null) throw new Error("a code plugin item has a candidate");
      await approveLibrary(connection, itemId);
      const after = await connection.request("plugin.invocables", { threadId: thread.threadId });
      // 검토된 코드 플러그인은 이름으로 얹는 항목 하나를 가진다. 스킬과 명령이 없으니 그것뿐이다
      expect(after.entries.filter((entry) => entry.plugin === NAME)).toEqual([
        {
          plugin: NAME,
          entry: NAME,
          kind: "plugin",
          title: item.card.displayName,
          reviewedHash: candidateHash,
        },
      ]);

      const missing = await wireErrorOf(
        connection.request("plugin.invocables", { threadId: "thr_missing_wire" }),
      );
      expect(missing.data.kind).toBe("thread.notFound");
      expect(missing.data.details).toEqual({ threadId: "thr_missing_wire" });
    } finally {
      await connection.close();
      await host.close();
      rmSync(bundles, { recursive: true, force: true });
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  TIMEOUT_MS,
);

realTest(
  "plugin.revert puts a hand-edited folder back to the reviewed copy byte for byte; without a reviewed copy, or for an unknown name, it refuses",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const bundles = mkdtempSync(join(tmpdir(), "plugin-wire-bundles-"));
    const marker = join(bundles, "revert.marker");
    const folder = writeMarkerPlugin(home, NAME, "REVERT-1", marker);
    const { host, connection } = await startPluginHost(bundles);
    try {
      // 검토본이 아직 없다
      const unreviewed = await wireErrorOf(connection.request("plugin.revert", { name: NAME }));
      expect(unreviewed.code).toBe(3625);
      expect(unreviewed.data.kind).toBe("plugin.noReviewedCopy");
      expect(unreviewed.data.details).toEqual({ name: NAME });

      const itemId = await scanForNew(connection, NAME);
      await approveLibrary(connection, itemId);
      const reviewedFiles = snapshotOf(folder);

      // 손으로 고친다: 훅 코드를 바꾸고 훑으면 `plugin.get`이 원본이 검토본과 다르다고 본다
      writeMarkerPlugin(home, NAME, "HAND-EDIT", marker);
      await connection.request("plugin.scan", {});
      const edited = await connection.request("plugin.get", { name: NAME });
      expect(edited.source?.matchesReviewed).toBe(false);
      expect(snapshotOf(folder)).not.toEqual(reviewedFiles);

      expect(await connection.request("plugin.revert", { name: NAME })).toEqual({ restored: true });
      // 원본 폴더가 검토본 내용과 같아졌다
      expect(snapshotOf(folder)).toEqual(reviewedFiles);
      // 되돌린 뒤 손 수정 항목은 철회된다: 대기 목록에 없고, 철회 목록에 `update`로 남는다
      const pendingAfter = await connection.request("pluginReview.list", { state: "pending" });
      expect(pendingAfter.items.filter((item) => item.name === NAME)).toEqual([]);
      const withdrawn = await connection.request("pluginReview.list", { state: "withdrawn" });
      expect(withdrawn.items.map((item) => [item.name, item.kind, item.provenance])).toEqual([
        [NAME, "update", "unknown"],
      ]);
      const restored = await connection.request("plugin.get", { name: NAME });
      expect(restored.source).toEqual({ path: folder, matchesReviewed: true });

      const unknown = await wireErrorOf(connection.request("plugin.revert", { name: "wire-none" }));
      expect(unknown.code).toBe(3401);
      expect(unknown.data.kind).toBe("extension.notFound");
      expect(unknown.data.details).toEqual({ name: "wire-none" });
    } finally {
      await connection.close();
      await host.close();
      rmSync(bundles, { recursive: true, force: true });
      home.dispose();
    }
  },
  TIMEOUT_MS,
);

realTest(
  "plugin.draft.list shows a plugin's drafts newest first with parent links, and plugin.draft.discard removes one",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const bundles = mkdtempSync(join(tmpdir(), "plugin-wire-bundles-"));
    const marker = join(bundles, "draft.marker");
    const folder = writeMarkerPlugin(home, NAME, "DRAFT-1", marker);
    const { host, connection } = await startPluginHost(bundles);
    try {
      const first = await connection.request("plugin.draft.create", { dir: folder });
      writeMarkerPlugin(home, NAME, "DRAFT-2", marker);
      const second = await connection.request("plugin.draft.create", { dir: folder });

      const listed = await connection.request("plugin.draft.list", { name: NAME });
      expect(listed.drafts.map((draft) => draft.draftId)).toEqual([second.draftId, first.draftId]);
      // 초안 만들기가 돌려준 기록과 목록의 기록이 같다
      expect(listed.drafts[0]).toEqual(second.info);
      expect(listed.drafts[0]?.parent).toBe(first.draftId);
      expect(listed.drafts[1]?.parent).toBeNull();
      expect(listed.drafts[0]?.contentHash).toBe(second.contentHash);
      expect(listed.drafts[1]?.contentHash).toBe(first.contentHash);
      expect(second.card.review.state).toBe("draft");

      expect(await connection.request("plugin.draft.discard", { draftId: second.draftId })).toEqual(
        {},
      );
      const afterOne = await connection.request("plugin.draft.list", { name: NAME });
      expect(afterOne.drafts.map((draft) => draft.draftId)).toEqual([first.draftId]);

      // 지운 초안은 다시 지울 수 없다
      const gone = await wireErrorOf(
        connection.request("plugin.draft.discard", { draftId: second.draftId }),
      );
      expect(gone.code).toBe(3616);
      expect(gone.data.kind).toBe("draft.notFound");
      expect(gone.data.details).toEqual({ id: second.draftId });

      await connection.request("plugin.draft.discard", { draftId: first.draftId });
      expect(await connection.request("plugin.draft.list", { name: NAME })).toEqual({ drafts: [] });

      const unknown = await wireErrorOf(
        connection.request("plugin.draft.list", { name: "wire-none" }),
      );
      expect(unknown.data.kind).toBe("extension.notFound");
      expect(unknown.data.details).toEqual({ name: "wire-none" });
    } finally {
      await connection.close();
      await host.close();
      rmSync(bundles, { recursive: true, force: true });
      home.dispose();
    }
  },
  TIMEOUT_MS,
);

realTest(
  "plugin.draft.fromInstruction writes the instruction folder and a user_instruction review item, and refuses a second draft under the same name while the first is pending",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const bundles = mkdtempSync(join(tmpdir(), "plugin-wire-bundles-"));
    const pluginsDir = join(home.root, "config", "plugins");
    const { host, connection } = await startPluginHost(bundles);
    const text = "항상 한국어로 답한다";
    try {
      const made = await connection.request("plugin.draft.fromInstruction", {
        text,
        name: "instr-wire",
      });
      expect(Object.keys(made).toSorted()).toEqual(["draftId", "itemId"]);

      // 지침 폴더: 지침 파일은 입력 글 그대로이고, 매니페스트는 지침 한 개를 가진 최소 플러그인이다
      const folder = join(pluginsDir, "instr-wire");
      expect(readFileSync(join(folder, "instructions.md"), "utf8")).toBe(text);
      expect(
        JSON.parse(readFileSync(join(folder, ".fresnel-plugin", "plugin.json"), "utf8")),
      ).toEqual({
        schemaVersion: 2,
        name: "instr-wire",
        version: "0.0.0",
        purpose: text,
        components: { instructions: ["instructions.md"] },
      });

      const item = (await connection.request("pluginReview.get", { itemId: made.itemId })).item;
      expect(item.provenance).toBe("user_instruction");
      expect(item.kind).toBe("new");
      expect(item.state).toBe("pending");
      expect(item.name).toBe("instr-wire");
      expect(item.files.map((file) => file.path).toSorted()).toEqual([
        ".fresnel-plugin/plugin.json",
        "instructions.md",
      ]);

      const drafts = await connection.request("plugin.draft.list", { name: "instr-wire" });
      expect(drafts.drafts.map((draft) => [draft.draftId, draft.submittedItemId])).toEqual([
        [made.draftId, made.itemId],
      ]);
      const candidateHash = item.candidateHash;
      if (candidateHash === null) throw new Error("the instruction item has a candidate");
      expect(drafts.drafts.map((draft) => draft.contentHash)).toEqual([candidateHash]);

      // 같은 이름은 대기 중이면 새 버전으로 덮어쓰지 않는다. 파일은 그대로다
      const again = await wireErrorOf(
        connection.request("plugin.draft.fromInstruction", {
          text: "다른 지침",
          name: "instr-wire",
        }),
      );
      expect(again.code).toBe(3624);
      expect(again.data.kind).toBe("plugin.exists");
      expect(again.data.details).toEqual({ name: "instr-wire" });
      expect(readFileSync(join(folder, "instructions.md"), "utf8")).toBe(text);

      // 이름을 안 주면 `instr-` 뒤에 입력 글 sha256의 앞 6자를 쓴다
      const generatedText = "Use short answers.";
      const generated = await connection.request("plugin.draft.fromInstruction", {
        text: generatedText,
      });
      const expectedName = `instr-${sha256Prefix(generatedText)}`;
      const generatedItem = (
        await connection.request("pluginReview.get", { itemId: generated.itemId })
      ).item;
      expect(generatedItem.name).toBe(expectedName);
      expect(readFileSync(join(pluginsDir, expectedName, "instructions.md"), "utf8")).toBe(
        generatedText,
      );

      // 빈 글(공백만)은 초안을 만들지 않는다: 폴더도, 검토 항목도 없다
      const blankName = `instr-${sha256Prefix("   ")}`;
      const blank = await wireErrorOf(
        connection.request("plugin.draft.fromInstruction", { text: "   " }),
      );
      expect(blank.code).toBe(3621);
      expect(blank.data.kind).toBe("plugin.invalid");
      expect(blank.data.details).toEqual({
        issues: [{ code: "text_blank", severity: "error" }],
      });
      expect(existsSync(join(pluginsDir, blankName))).toBe(false);
      const pending = await connection.request("pluginReview.list", { state: "pending" });
      expect(pending.items.filter((entry) => entry.name === blankName)).toEqual([]);

      // 이름 문법을 어긴 이름은 와이어 입력 검사에서 막힌다
      const badName = await wireErrorOf(
        connection.request("plugin.draft.fromInstruction", { text: "ok", name: "Bad Name" }),
      );
      expect(badName.data.kind).toBe("jsonrpc.invalidParams");
    } finally {
      await connection.close();
      await host.close();
      rmSync(bundles, { recursive: true, force: true });
      home.dispose();
    }
  },
  TIMEOUT_MS,
);

realTest(
  "pluginReview.file returns the candidate file text exactly, and refuses a path outside the snapshot or an unknown item",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const bundles = mkdtempSync(join(tmpdir(), "plugin-wire-bundles-"));
    const marker = join(bundles, "file.marker");
    const folder = writeMarkerPlugin(home, NAME, "FILE-1", marker);
    const codeText = readFileSync(join(folder, "src", "index.ts"), "utf8");
    const manifestText = readFileSync(join(folder, ".fresnel-plugin", "plugin.json"), "utf8");
    const { host, connection } = await startPluginHost(bundles);
    try {
      const itemId = await scanForNew(connection, NAME);

      expect(
        await connection.request("pluginReview.file", { itemId, path: "src/index.ts" }),
      ).toEqual({
        path: "src/index.ts",
        text: codeText,
        truncated: false,
      });
      expect(
        await connection.request("pluginReview.file", {
          itemId,
          path: ".fresnel-plugin/plugin.json",
        }),
      ).toEqual({ path: ".fresnel-plugin/plugin.json", text: manifestText, truncated: false });

      const escaped = await wireErrorOf(
        connection.request("pluginReview.file", { itemId, path: "../escape.txt" }),
      );
      expect(escaped.code).toBe(3653);
      expect(escaped.data.kind).toBe("pluginReview.pathInvalid");
      const absent = await wireErrorOf(
        connection.request("pluginReview.file", { itemId, path: "src/missing.ts" }),
      );
      expect(absent.data.kind).toBe("pluginReview.pathInvalid");

      const unknown = await wireErrorOf(
        connection.request("pluginReview.file", {
          itemId: "rvw_missing_wire",
          path: "src/index.ts",
        }),
      );
      expect(unknown.code).toBe(3651);
      expect(unknown.data.details).toEqual({ id: "rvw_missing_wire" });
    } finally {
      await connection.close();
      await host.close();
      rmSync(bundles, { recursive: true, force: true });
      home.dispose();
    }
  },
  TIMEOUT_MS,
);

realTest(
  "pluginReview.file reads the previous approved version of an update (side base) and the new side, before and after the decision, and the card carries the manifest version",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const bundles = mkdtempSync(join(tmpdir(), "plugin-wire-bundles-"));
    const marker = join(bundles, "base.marker");
    const folder = writeMarkerPlugin(home, NAME, "BASE-1", marker);
    const oldCode = readFileSync(join(folder, "src", "index.ts"), "utf8");
    const { host, connection } = await startPluginHost(bundles);
    try {
      const first = await scanForNew(connection, NAME);
      expect(
        (await connection.request("pluginReview.get", { itemId: first })).item.card.version,
      ).toBe("1.0.0");
      // 처음 설치에는 지난 판이 없다
      expect(
        (await connection.request("pluginReview.get", { itemId: first })).item.baseFiles,
      ).toBeUndefined();
      const baseRefused = await wireErrorOf(
        connection.request("pluginReview.file", {
          itemId: first,
          path: "src/index.ts",
          side: "base",
        }),
      );
      expect(baseRefused.data.kind).toBe("pluginReview.pathInvalid");
      await approveLibrary(connection, first);

      // 담당 AI가 코드를 고치고 파일을 하나 더한 새 판을 낸다
      writeMarkerPlugin(home, NAME, "BASE-2", marker);
      writeFileSync(join(folder, "extra.md"), "Only in the new version.\n");
      const newCode = readFileSync(join(folder, "src", "index.ts"), "utf8");
      const draft = await connection.request("plugin.draft.create", { dir: folder });
      const submitted = await connection.request("pluginReview.submitDraft", {
        draftId: draft.draftId,
      });
      const update = (await connection.request("pluginReview.get", { itemId: submitted.itemId }))
        .item;
      expect(update.kind).toBe("update");
      expect(update.baseFiles?.map((file) => file.path).toSorted()).toEqual([
        ".fresnel-plugin/plugin.json",
        "src/index.ts",
      ]);
      expect(update.files.map((file) => file.path).toSorted()).toEqual([
        ".fresnel-plugin/plugin.json",
        "extra.md",
        "src/index.ts",
      ]);
      expect(
        await connection.request("pluginReview.file", {
          itemId: submitted.itemId,
          path: "src/index.ts",
          side: "base",
        }),
      ).toEqual({ path: "src/index.ts", text: oldCode, truncated: false });
      expect(
        await connection.request("pluginReview.file", {
          itemId: submitted.itemId,
          path: "src/index.ts",
        }),
      ).toEqual({ path: "src/index.ts", text: newCode, truncated: false });
      const newOnly = await wireErrorOf(
        connection.request("pluginReview.file", {
          itemId: submitted.itemId,
          path: "extra.md",
          side: "base",
        }),
      );
      expect(newOnly.data.kind).toBe("pluginReview.pathInvalid");

      // 결정한 뒤에도 두 쪽을 읽는다
      await connection.request("pluginReview.decide", {
        itemId: submitted.itemId,
        decision: { kind: "approve", profileIds: [], libraryOnly: true },
      });
      expect(
        await connection.request("pluginReview.file", {
          itemId: submitted.itemId,
          path: "src/index.ts",
          side: "base",
        }),
      ).toEqual({ path: "src/index.ts", text: oldCode, truncated: false });
      expect(
        await connection.request("pluginReview.file", {
          itemId: submitted.itemId,
          path: "extra.md",
        }),
      ).toEqual({ path: "extra.md", text: "Only in the new version.\n", truncated: false });
    } finally {
      await connection.close();
      await host.close();
      rmSync(bundles, { recursive: true, force: true });
      home.dispose();
    }
  },
  TIMEOUT_MS,
);

realTest(
  "an approved instruction plugin can be drafted again under its name: the new draft is an update item and the folder takes the new text",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const bundles = mkdtempSync(join(tmpdir(), "plugin-wire-bundles-"));
    const folder = join(home.root, "config", "plugins", "instr-again");
    const { host, connection } = await startPluginHost(bundles);
    try {
      const first = await connection.request("plugin.draft.fromInstruction", {
        text: "first text",
        name: "instr-again",
      });
      await connection.request("pluginReview.decide", {
        itemId: first.itemId,
        decision: { kind: "approve", profileIds: [], libraryOnly: true },
      });

      // 승인본이 있으면 같은 이름의 새 지침을 새 버전으로 받는다
      const second = await connection.request("plugin.draft.fromInstruction", {
        text: "second text",
        name: "instr-again",
      });
      expect(readFileSync(join(folder, "instructions.md"), "utf8")).toBe("second text");
      const item = (await connection.request("pluginReview.get", { itemId: second.itemId })).item;
      expect([item.kind, item.state, item.provenance]).toEqual([
        "update",
        "pending",
        "user_instruction",
      ]);
      expect(item.name).toBe("instr-again");

      // 초안 목록은 두 초안을 최신 먼저 보이고, 새 초안이 앞 초안을 잇는다
      const drafts = await connection.request("plugin.draft.list", { name: "instr-again" });
      expect(drafts.drafts.map((draft) => draft.draftId)).toEqual([second.draftId, first.draftId]);
      expect(drafts.drafts[0]?.parent).toBe(first.draftId);
    } finally {
      await connection.close();
      await host.close();
      rmSync(bundles, { recursive: true, force: true });
      home.dispose();
    }
  },
  TIMEOUT_MS,
);
