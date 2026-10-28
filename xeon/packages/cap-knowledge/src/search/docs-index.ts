import { join } from "node:path";
import { err, ok, type Result } from "@xeon/contracts";
import type { KnowledgeHit } from "@xeon/contracts/capabilities";
import type { SqlTx, StoreDb } from "@xeon/contracts/records";
import { failure, fromStoreError, type KnowledgeFailure } from "../errors.ts";
import type { KnowledgeFs } from "../fs/port.ts";
import { parseMemoryFile } from "../memory/format.ts";
import { describeSkill, mainFileOf } from "../skills/document.ts";
import { allSkills } from "../skills/store.ts";
import { readDirTree, readSingleFileTree, type Tree } from "../skills/tree.ts";

// L2.knowledge.spec §3.8 스킬·메모리 검색 색인(`cap_knowledge_docsfts`). 스킬은 이름·설명·본문을, 메모리는 항목 하나를 문서 하나로 둔다.
// 정본은 파일이고 이 표는 파일에서 다시 만든다. 시작할 때 통째로 다시 만들고(`rebuild`), 쓰기와 바깥 편집은 같은 트랜잭션에서
// 해당 대상의 문서만 바꾼다(`updateDocsAfterChange`). FTS5를 쓸 수 없으면 표가 없고 `collect`가 LIKE 경로의 문서 목록을 낸다.

export interface DocRow {
  readonly kind: Extract<KnowledgeHit["kind"], "skill" | "memory">;
  /** skill: 스킬 이름, memory: `<저장소>:<항목 ID>` */
  readonly ref: string;
  /** skill: 범위(user·project·extension·path), memory: 저장소 */
  readonly scope: string;
  readonly title: string;
  readonly body: string;
}

const MEMORY_FILES: readonly (readonly [string, string])[] = [
  ["user", "USER.md"],
  ["env", "MEMORY.md"],
];

/** 스킬 한 장의 문서. 읽을 수 없거나 설명이 없으면 undefined */
function skillDocOf(
  scope: string,
  name: string,
  tree: Tree | null,
  layout: "dir" | "file",
): DocRow | undefined {
  if (tree === null) return undefined;
  const document = describeSkill(mainFileOf(tree, layout));
  if (document === undefined) return undefined;
  return {
    kind: "skill",
    ref: name,
    scope,
    title: name,
    body: `${document.description}\n${document.body}`.trim(),
  };
}

/** 메모리 저장소 한 곳의 문서들. 구조가 깨졌어도 읽을 수 있는 항목은 낸다 */
function memoryDocsOf(store: string, bytes: Uint8Array | null): DocRow[] {
  const parsed = parseMemoryFile(bytes, Number.MAX_SAFE_INTEGER);
  return parsed.entries.map((entry) => ({
    kind: "memory",
    ref: `${store}:${entry.id}`,
    scope: store,
    title: `${store} memory`,
    body: entry.text,
  }));
}

function insertDoc(tx: SqlTx, doc: DocRow): void {
  tx.run(
    "INSERT INTO cap_knowledge_docsfts (kind, ref, scope, title, body) VALUES (?, ?, ?, ?, ?)",
    [doc.kind, doc.ref, doc.scope, doc.title, doc.body.normalize("NFC")],
  );
}

export interface DocsChange {
  readonly kind: "skill" | "memory";
  /** 스킬: 이름, 메모리: 저장소 */
  readonly name: string;
  readonly scope: string | undefined;
  /** 적용 뒤 내용. 대상이 없어졌으면 null */
  readonly next: Tree | null;
}

/** 쓰기·바깥 편집이 일어난 같은 트랜잭션에서 대상의 문서만 바꾼다 */
export function updateDocsAfterChange(tx: SqlTx, change: DocsChange): void {
  if (change.kind === "skill") {
    const scope = change.scope ?? "user";
    tx.run("DELETE FROM cap_knowledge_docsfts WHERE kind = 'skill' AND ref = ? AND scope = ?", [
      change.name,
      scope,
    ]);
    const doc = skillDocOf(scope, change.name, change.next, "dir");
    if (doc !== undefined) insertDoc(tx, doc);
    return;
  }
  tx.run("DELETE FROM cap_knowledge_docsfts WHERE kind = 'memory' AND scope = ?", [change.name]);
  const bytes = change.next?.files[0]?.bytes ?? null;
  for (const doc of memoryDocsOf(change.name, bytes)) insertDoc(tx, doc);
}

export interface DocsIndex {
  /** 지금 파일에서 문서 목록을 읽는다(스킬 색인 행 기준 + 메모리 파일) */
  collect(): Promise<Result<readonly DocRow[], KnowledgeFailure>>;
  /** 표를 비우고 `collect` 결과로 다시 채운다. FTS 표가 없으면 아무것도 하지 않는다 */
  rebuild(): Promise<Result<void, KnowledgeFailure>>;
}

export interface DocsIndexDeps {
  readonly fs: KnowledgeFs;
  /** `cap.knowledge` 소유자의 범위 핸들 */
  readonly db: StoreDb;
  readonly memoryDir: string;
  /** `cap_knowledge_docsfts`가 있는가 */
  readonly docsFts: boolean;
}

export function createDocsIndex(deps: DocsIndexDeps): DocsIndex {
  async function collect(): Promise<Result<readonly DocRow[], KnowledgeFailure>> {
    const rows = deps.db.read((tx) => allSkills(tx));
    if (!rows.ok) return err(fromStoreError(rows.error, "skill index"));
    const trees = await Promise.all(
      rows.value.map(async (row) => {
        const tree =
          row.layout === "dir"
            ? await readDirTree(deps.fs, row.dir)
            : await readSingleFileTree(deps.fs, row.dir);
        return { row, tree };
      }),
    );
    const docs: DocRow[] = [];
    for (const { row, tree } of trees) {
      // 읽지 못한 스킬은 색인에서 빠진다. 다음 재색인이 바로잡는다
      if (!tree.ok) continue;
      const doc = skillDocOf(row.scope, row.name, tree.value, row.layout);
      if (doc !== undefined) docs.push(doc);
    }
    const reads = await Promise.all(
      MEMORY_FILES.map(async ([store, file]) => ({
        store,
        read: await deps.fs.readFile(join(deps.memoryDir, file)),
      })),
    );
    for (const { store, read } of reads) {
      if (read.ok) docs.push(...memoryDocsOf(store, read.value));
      else if (read.error.kind !== "not_found") {
        return err(
          failure("internal", `memory ${store} could not be read for the search index`, {
            cause: read.error,
          }),
        );
      }
    }
    return ok(docs);
  }

  async function rebuild(): Promise<Result<void, KnowledgeFailure>> {
    if (!deps.docsFts) return ok(undefined);
    const collected = await collect();
    if (!collected.ok) return collected;
    const written = deps.db.write((tx) => {
      tx.run("DELETE FROM cap_knowledge_docsfts");
      for (const doc of collected.value) insertDoc(tx, doc);
    });
    return written.ok ? ok(undefined) : err(fromStoreError(written.error, "docs index"));
  }

  return { collect, rebuild };
}
