import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Bug } from "@fresnel/contracts";
import { buildPluginCard } from "../../../src/assembly/plugins/card.ts";
import { readPluginFolder } from "../../../src/assembly/plugins/folder-reader.ts";
import {
  createPluginStore,
  type PluginReviewMeta,
  type PluginStore,
  type ReviewLogEntry,
} from "../../../src/assembly/plugins/store.ts";
import { passThroughFileLock, removeTree, tempRoot, writeFiles } from "./support.ts";

// M5c §4.6.2 검토본 저장소: 복사, 승격, current, 읽기 전용 권한, 무결성, 보관, 시작 때 정리, 결정 기록.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root);
});

interface Fixture {
  readonly root: string;
  readonly store: PluginStore;
  readonly src: string;
}

function fixtureOf(): Fixture {
  const root = tempRoot("plugin-store-");
  roots.push(root);
  const store = createPluginStore({
    root: join(root, "plugin-store"),
    fileLock: passThroughFileLock,
  });
  const src = join(root, "source");
  mkdirSync(src);
  return { root: join(root, "plugin-store"), store, src };
}

/** 원본 폴더에 스킬 플러그인을 쓴다. 설명을 바꾸면 내용 해시가 바뀐다 */
function writeSource(src: string, description: string): void {
  writeFiles(src, {
    "SKILL.md": `---\nname: greeter\ndescription: "${description}"\n---\nBody\n`,
    "notes/tips.md": "tips\n",
  });
}

/** 원본을 스냅샷하고 승격에 쓸 메타를 만든다. 카드는 실제 폴더에서 계산한다 */
async function approve(
  fixture: Fixture,
  description: string,
  approvedAt: string,
  decisionId: string,
): Promise<{ readonly contentHash: string; readonly meta: PluginReviewMeta }> {
  writeSource(fixture.src, description);
  const folder = readPluginFolder(fixture.src, { origin: "user" });
  if (!folder.ok) throw new Error(`fixture folder rejected: ${folder.error.kind}`);
  const snapshot = await fixture.store.snapshotCandidate(fixture.src);
  if (!snapshot.ok) throw new Error(`snapshot failed: ${snapshot.error.kind}`);
  const contentHash = snapshot.value.contentHash;
  const meta: PluginReviewMeta = {
    name: "greeter",
    version: folder.value.manifest.version,
    contentHash,
    approvedAt,
    decisionId,
    origin: "user",
    inferredManifest: folder.value.inferred,
    card: buildPluginCard({
      folder: folder.value,
      origin: { kind: "user" },
      review: { state: "approved", currentHash: contentHash, pendingItemId: null, approvedAt },
      usedBy: [],
      health: { state: "idle", lastActiveAt: null, lastError: null },
    }),
  };
  return { contentHash, meta };
}

function logEntry(itemId: string, contentHash: string): ReviewLogEntry {
  return {
    at: "2026-11-18T00:00:00.000Z",
    itemId,
    name: "greeter",
    kind: "new",
    candidateHash: contentHash,
    baseHash: null,
    decision: "approved",
    profileIds: [],
    actor: "user",
    provenance: null,
    originThreadId: null,
  };
}

/** 승인 전체: 승격, current, 기록. 끊김 없이 한 번에 한다 */
async function fullApprove(
  fixture: Fixture,
  description: string,
  approvedAt: string,
  decisionId: string,
): Promise<string> {
  const { contentHash, meta } = await approve(fixture, description, approvedAt, decisionId);
  const promoted = await fixture.store.promote(contentHash, meta);
  if (!promoted.ok) throw new Error(`promote failed: ${promoted.error.kind}`);
  const switched = await fixture.store.setCurrent("greeter", contentHash);
  if (!switched.ok) throw new Error(`setCurrent failed: ${switched.error.kind}`);
  const logged = await fixture.store.appendLog(logEntry(decisionId, contentHash));
  if (!logged.ok) throw new Error(`appendLog failed: ${logged.error.kind}`);
  return contentHash;
}

function hexOf(contentHash: string): string {
  return contentHash.slice("sha256:".length);
}

test("a snapshot copies the folder and its hash is the hash of the copy", async () => {
  const fixture = fixtureOf();
  writeSource(fixture.src, "Say hello");
  const snapshot = await fixture.store.snapshotCandidate(fixture.src);
  expect(snapshot.ok).toBe(true);
  if (!snapshot.ok) return;
  const copied = join(fixture.root, "candidates", hexOf(snapshot.value.contentHash), "tree");
  expect(existsSync(join(copied, "SKILL.md"))).toBe(true);
  expect(existsSync(join(copied, "notes", "tips.md"))).toBe(true);
  // 원본과 같은 내용이면 같은 해시다
  const again = await fixture.store.snapshotCandidate(fixture.src);
  expect(again.ok && again.value.contentHash).toBe(snapshot.value.contentHash);
});

test("promote seals the tree read-only and setCurrent makes that version the running one", async () => {
  const fixture = fixtureOf();
  const hash = await fullApprove(fixture, "Say hello", "2026-11-18T01:00:00.000Z", "d-1");
  const current = await fixture.store.current("greeter");
  expect(current.ok).toBe(true);
  if (!current.ok || current.value === null) throw new Error("no current version");
  expect(current.value.contentHash).toBe(hash);
  const tree = current.value.treePath;
  expect(statSync(join(tree, "SKILL.md")).mode & 0o777).toBe(0o444);
  expect(statSync(tree).mode & 0o777).toBe(0o555);
  expect(statSync(join(tree, "notes")).mode & 0o777).toBe(0o555);
  // 승격은 후보를 옮긴다. 후보 트리는 더 없다
  expect(existsSync(join(fixture.root, "candidates", hexOf(hash), "tree"))).toBe(false);
});

test("an executable file keeps its execute bit so the hash and integrity stay the same", async () => {
  const fixture = fixtureOf();
  writeSource(fixture.src, "Run it");
  const script = join(fixture.src, "run.sh");
  writeFileSync(script, "#!/bin/sh\necho hi\n");
  chmodSync(script, 0o755);
  const folder = readPluginFolder(fixture.src, { origin: "user" });
  if (!folder.ok) throw new Error("rejected");
  const snapshot = await fixture.store.snapshotCandidate(fixture.src);
  if (!snapshot.ok) throw new Error("snapshot");
  expect(snapshot.value.contentHash).toBe(folder.value.contentHash);
  const promoted = await fixture.store.promote(snapshot.value.contentHash, {
    name: "greeter",
    version: folder.value.manifest.version,
    contentHash: snapshot.value.contentHash,
    approvedAt: "2026-11-18T01:00:00.000Z",
    decisionId: "d-exec",
    origin: "user",
    inferredManifest: folder.value.inferred,
    card: buildPluginCard({
      folder: folder.value,
      origin: { kind: "user" },
      review: {
        state: "approved",
        currentHash: snapshot.value.contentHash,
        pendingItemId: null,
        approvedAt: "x",
      },
      usedBy: [],
      health: { state: "idle", lastActiveAt: null, lastError: null },
    }),
  });
  expect(promoted.ok).toBe(true);
  expect(
    statSync(
      join(
        fixture.root,
        "reviewed",
        "greeter",
        hexOf(snapshot.value.contentHash),
        "tree",
        "run.sh",
      ),
    ).mode & 0o777,
  ).toBe(0o555);
  const integrity = await fixture.store.verifyIntegrity("greeter", snapshot.value.contentHash);
  expect(integrity.ok).toBe(true);
});

test("verifyIntegrity reports pinned_corrupt when the sealed tree was changed outside the store", async () => {
  const fixture = fixtureOf();
  const hash = await fullApprove(fixture, "Say hello", "2026-11-18T01:00:00.000Z", "d-1");
  expect((await fixture.store.verifyIntegrity("greeter", hash)).ok).toBe(true);
  const tree = join(fixture.root, "reviewed", "greeter", hexOf(hash), "tree");
  // 시험이 읽기 전용을 풀고 파일을 고친다(누가 손으로 고친 흉내)
  chmodSync(join(tree, "SKILL.md"), 0o644);
  writeFileSync(join(tree, "SKILL.md"), "tampered");
  const result = await fixture.store.verifyIntegrity("greeter", hash);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.kind).toBe("pinned_corrupt");
});

test("retention keeps the newest five, the current one, and the one in use, and removes the rest", async () => {
  const fixture = fixtureOf();
  // 승인은 같은 원본 폴더를 쓰므로 차례로 한다
  const indexes = [0, 1, 2, 3, 4, 5, 6, 7];
  const hashes = await indexes.reduce<Promise<string[]>>(async (chain, index) => {
    const done = await chain;
    const day = String(index + 1).padStart(2, "0");
    const hash = await fullApprove(
      fixture,
      `version ${index}`,
      `2026-11-${day}T01:00:00.000Z`,
      `d-${index}`,
    );
    return [...done, hash];
  }, Promise.resolve([]));
  const at = (index: number): string => {
    const hash = hashes[index];
    if (hash === undefined) throw new Error(`no version ${index}`);
    return hash;
  };
  // 현재는 가장 오래된 것(0)으로 되돌린다(롤백 흉내). 쓰이는 것(1)도 남긴다. 최근 다섯(7~3)은 순서대로 남는다. 나머지 2만 지운다
  expect((await fixture.store.setCurrent("greeter", at(0))).ok).toBe(true);
  const pruned = await fixture.store.prune("greeter", { keep: 5, inUse: new Set([at(1)]) });
  expect(pruned).toEqual({ ok: true, value: [at(2)] });
  const listed = await fixture.store.versions("greeter");
  if (!listed.ok) throw new Error("versions");
  expect(listed.value.map((item) => item.contentHash).toSorted()).toEqual(
    [0, 1, 3, 4, 5, 6, 7].map(at).toSorted(),
  );
  expect(listed.value.find((item) => item.current)?.contentHash).toBe(at(0));
  expect(existsSync(join(fixture.root, "reviewed", "greeter", hexOf(at(2)), "tree"))).toBe(false);
});

test("recover removes an approval that was promoted but never made current, and keeps the current one", async () => {
  const fixture = fixtureOf();
  const kept = await fullApprove(fixture, "version one", "2026-11-18T01:00:00.000Z", "d-kept");
  // 승인 도중 끊김: 승격까지만 하고 current와 기록은 하지 않는다
  const interrupted = await approve(fixture, "version two", "2026-11-18T02:00:00.000Z", "d-cut");
  expect((await fixture.store.promote(interrupted.contentHash, interrupted.meta)).ok).toBe(true);
  const before = await fixture.store.versions("greeter");
  if (!before.ok) throw new Error("versions");
  expect(before.value.map((item) => item.contentHash).toSorted()).toEqual(
    [kept, interrupted.contentHash].toSorted(),
  );

  const recovered = await fixture.store.recover();
  expect(recovered.ok).toBe(true);
  if (!recovered.ok) return;
  expect(recovered.value.removed).toEqual([`greeter/${hexOf(interrupted.contentHash)}`]);
  const after = await fixture.store.versions("greeter");
  if (!after.ok) throw new Error("versions");
  expect(after.value.map((item) => item.contentHash)).toEqual([kept]);
  const current = await fixture.store.current("greeter");
  expect(current.ok && current.value?.contentHash).toBe(kept);
});

test("recover keeps a current version even when its log line was not written (crash after setCurrent)", async () => {
  const fixture = fixtureOf();
  const { contentHash, meta } = await approve(
    fixture,
    "version one",
    "2026-11-18T01:00:00.000Z",
    "d-nolog",
  );
  expect((await fixture.store.promote(contentHash, meta)).ok).toBe(true);
  expect((await fixture.store.setCurrent("greeter", contentHash)).ok).toBe(true);
  const recovered = await fixture.store.recover();
  expect(recovered.ok && recovered.value.removed).toEqual([]);
  const current = await fixture.store.current("greeter");
  expect(current.ok && current.value?.contentHash).toBe(contentHash);
});

test("recover removes a copy left half-made by an interrupted snapshot", async () => {
  const fixture = fixtureOf();
  mkdirSync(join(fixture.root, "candidates", ".staging-broken", "tree"), { recursive: true });
  const recovered = await fixture.store.recover();
  expect(recovered.ok).toBe(true);
  expect(existsSync(join(fixture.root, "candidates", ".staging-broken"))).toBe(false);
});

test("the review log is append-only and reads back in order; a missing log reads as empty", async () => {
  const fixture = fixtureOf();
  expect(await fixture.store.readLog()).toEqual({ ok: true, value: [] });
  const first = logEntry("d-1", `sha256:${"a".repeat(64)}`);
  const second = {
    ...logEntry("d-2", `sha256:${"b".repeat(64)}`),
    decision: "bundled" as const,
    actor: "release" as const,
    kind: "bundled" as const,
  };
  expect((await fixture.store.appendLog(first)).ok).toBe(true);
  expect((await fixture.store.appendLog(second)).ok).toBe(true);
  const read = await fixture.store.readLog();
  expect(read.ok && read.value).toEqual([first, second]);
});

test("names and versions skip a folder with no meta.json, and invalid names and hashes are results, not throws", async () => {
  const fixture = fixtureOf();
  await fullApprove(fixture, "version one", "2026-11-18T01:00:00.000Z", "d-1");
  mkdirSync(join(fixture.root, "reviewed", "greeter", "f".repeat(64)), { recursive: true });
  const listed = await fixture.store.versions("greeter");
  expect(listed.ok && listed.value.length).toBe(1);
  expect(await fixture.store.names()).toEqual({ ok: true, value: ["greeter"] });

  const badName = await fixture.store.current("Bad Name");
  expect(badName.ok).toBe(false);
  if (!badName.ok) expect(badName.error.kind).toBe("invalid_name");
  const badHash = await fixture.store.setCurrent("greeter", "md5:xyz");
  expect(badHash.ok).toBe(false);
  if (!badHash.ok) expect(badHash.error.kind).toBe("invalid_hash");
});

test("promote refuses a meta whose hash differs from the candidate: that is a caller bug", async () => {
  const fixture = fixtureOf();
  const { contentHash, meta } = await approve(
    fixture,
    "version one",
    "2026-11-18T01:00:00.000Z",
    "d-bug",
  );
  const other = `sha256:${"c".repeat(64)}`;
  let thrown: unknown;
  try {
    await fixture.store.promote(other, { ...meta, contentHash });
  } catch (caught) {
    thrown = caught;
  }
  expect(thrown).toBeInstanceOf(Bug);
});

test("discardCandidate removes the candidate folder", async () => {
  const fixture = fixtureOf();
  writeSource(fixture.src, "Discard me");
  const snapshot = await fixture.store.snapshotCandidate(fixture.src);
  if (!snapshot.ok) throw new Error("snapshot");
  expect((await fixture.store.discardCandidate(snapshot.value.contentHash)).ok).toBe(true);
  expect(existsSync(join(fixture.root, "candidates", hexOf(snapshot.value.contentHash)))).toBe(
    false,
  );
});

test("the path functions name drafts and queue items under the store root", () => {
  const fixture = fixtureOf();
  expect(fixture.store.draftDir("dr_1")).toBe(join(fixture.root, "drafts", "dr_1"));
  expect(fixture.store.queueFile("rv_1")).toBe(join(fixture.root, "queue", "rv_1.json"));
});
