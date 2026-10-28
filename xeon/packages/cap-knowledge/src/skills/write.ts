import { join } from "node:path";
import { assertNever, err, ok, parse, type Result } from "@xeon/contracts";
import {
  SkillCreateInputSchema,
  SkillEditInputSchema,
  SkillNameSchema,
  SkillPatchInputSchema,
  SkillRemoveInputSchema,
  SkillWriteFileInputSchema,
  type CallContext,
  type CallOptions,
  type KnowledgeActor,
  type LedgerOp,
  type SkillCreateInput,
  type SkillEditInput,
  type SkillManageInput,
  type SkillPatchInput,
  type SkillRemoveInput,
  type SkillWriteFileInput,
  type WritableSkillScope,
  type WriteOutcome,
} from "@xeon/contracts/capabilities";
import type { Static, TSchema } from "typebox";
import { isEvidenceValid } from "../approval/gate.ts";
import type { ProposalMethod } from "../approval/proposals.ts";
import type { Replayer } from "../approval/queue.ts";
import { actorOf } from "../actor.ts";
import { failure, fromStoreError, type KnowledgeFailure } from "../errors.ts";
import { utf8DecodeStrict, utf8Encode } from "../hash.ts";
import { hashOfTarget, readTarget, type ChangeTarget } from "../ledger/target.ts";
import { checkWriteExtras, scanForWrite, type ScanTarget } from "../write/scan.ts";
import { idemOf } from "../write/idempotency.ts";
import type { DecidedProposal, WritePlan, Writer } from "../write/pipeline.ts";
import { describeSkill, mainFileOf } from "./document.ts";
import { isAddressableSkillFile } from "./paths.ts";
import type { SkillsDeps } from "./service.ts";
import { allSkills, type SkillRow } from "./store.ts";
import { treeOf, type Tree } from "./tree.ts";
import {
  applyEdits,
  composeSkillMd,
  joinSkillMd,
  MAX_BODY_CHARS,
  MAX_DESCRIPTION_CHARS,
  MAX_SKILL_FILES,
  MAX_SUPPORT_FILE_BYTES,
  readSkillMd,
  withDescription,
} from "./write-model.ts";

// L2.knowledge.plan K3, spec §3.2 스킬 쓰기 연산. 연산마다 새 내용을 순수하게 계산한 뒤(§4.4.1 3~4단계) 위협 검사(5단계)를 하고,
// 쓰기 승인 게이트(6단계)와 원장 실행기(7~11단계)는 `Writer`가 맡는다.

const MAIN_FILE = "SKILL.md";

export interface SkillWriteDeps extends SkillsDeps {
  readonly writer: Writer;
  readonly containsKnown: ((text: string) => boolean) | undefined;
  /** 쓰기 전에 색인이 호출한 대화의 작업 폴더를 따르게 한다(`SkillsRuntime.syncFor`). 없으면 맞추지 않는다 */
  readonly syncFor?:
    | ((threadId: string | undefined) => Promise<Result<void, KnowledgeFailure>>)
    | undefined;
}

type WriteResult = Promise<Result<WriteOutcome, KnowledgeFailure>>;

export interface SkillWrites {
  create(input: SkillCreateInput, options?: CallOptions): WriteResult;
  edit(input: SkillEditInput, options?: CallOptions): WriteResult;
  patch(input: SkillPatchInput, options?: CallOptions): WriteResult;
  writeFile(input: SkillWriteFileInput, options?: CallOptions): WriteResult;
  remove(input: SkillRemoveInput, options?: CallOptions): WriteResult;
  manage(input: SkillManageInput, options?: CallOptions): WriteResult;
  /** 승인된 제안을 다시 실행하는 함수. 키는 대기열에 저장하는 메서드 이름이다 */
  readonly replayers: SkillReplayers;
}

interface SkillReplayers {
  readonly "skills.create": Replayer;
  readonly "skills.edit": Replayer;
  readonly "skills.patch": Replayer;
  readonly "skills.writeFile": Replayer;
  readonly "skills.remove": Replayer;
}

/** 연산 하나가 계산한 변경. 위협 검사 대상과 게이트 입력을 함께 낸다 */
interface Built {
  readonly target: ChangeTarget;
  readonly op: LedgerOp;
  readonly destructive: boolean;
  readonly baseHash: string | null;
  readonly current: Tree | null;
  readonly next: Tree | null;
  readonly removal: "archive" | "delete";
  readonly scanTargets: readonly ScanTarget[];
  /** 대기열에 저장하는 입력의 범위 칸을 채울 해석된 범위 */
  readonly scope: WritableSkillScope;
}

/** 쓰기를 부른 쪽. 제안 결정으로 다시 실행하면 `decided`가 있다 */
interface Caller {
  readonly actor: KnowledgeActor;
  readonly context: CallContext | undefined;
  readonly requestId: string | undefined;
  readonly signal: AbortSignal | undefined;
  readonly decided: DecidedProposal | undefined;
  readonly note: string | undefined;
}

interface Extras {
  readonly approval?: SkillCreateInput["approval"];
  readonly overrideScan?: boolean | undefined;
  readonly reason?: string | undefined;
}

function isWritableRow(row: SkillRow): boolean {
  return (row.scope === "user" || row.scope === "project") && row.layout === "dir";
}

const SCOPE_RANK: Readonly<Record<string, number>> = { project: 0, user: 1, extension: 2, path: 3 };

function writeFailure(message: string): KnowledgeFailure {
  return failure("invalid_input", message);
}

function fileOf(tree: Tree | null, path: string): Uint8Array | undefined {
  return tree?.files.find((file) => file.path === path)?.bytes;
}

function withFile(tree: Tree, path: string, bytes: Uint8Array): Tree {
  return treeOf([...tree.files.filter((file) => file.path !== path), { path, bytes }]);
}

function withoutFile(tree: Tree, path: string): Tree {
  return treeOf(tree.files.filter((file) => file.path !== path));
}

function scanTargetOf(path: string, bytes: Uint8Array): ScanTarget[] {
  const text = utf8DecodeStrict(bytes);
  return text === undefined ? [] : [{ text, strict: path.startsWith("scripts/") }];
}

/** SKILL.md를 색인에 실을 수 있는지(설명이 있는지) 확인한다 */
function checkIndexable(tree: Tree, description: string | undefined): KnowledgeFailure | undefined {
  const document = describeSkill(mainFileOf(tree, "dir"));
  if (document === undefined) {
    return failure("internal", "the written SKILL.md cannot be read back");
  }
  if (description !== undefined && document.description !== description) {
    return failure("internal", "the written description does not read back as given");
  }
  return undefined;
}

function checkLimits(next: Tree): KnowledgeFailure | undefined {
  if (next.files.length > MAX_SKILL_FILES) {
    return failure("limit_exceeded", `a skill holds at most ${String(MAX_SKILL_FILES)} files`);
  }
  const tooBig = next.files.find(
    (file) => file.path !== MAIN_FILE && file.bytes.byteLength > MAX_SUPPORT_FILE_BYTES,
  );
  if (tooBig !== undefined) {
    return failure("limit_exceeded", `${tooBig.path} is larger than 1 MiB`);
  }
  return undefined;
}

/** 대기열이 저장하는 입력: 증거와 검사 우회를 빼고 해석된 범위를 채운다 */
function storable(input: Extras, scope: WritableSkillScope): unknown {
  const { approval: _approval, overrideScan: _override, ...rest } = input;
  return { ...rest, scope };
}

function callerOf(options: CallOptions | undefined): Result<Caller, KnowledgeFailure> {
  const actor = actorOf(options?.context);
  if (!actor.ok) return actor;
  return ok({
    actor: actor.value,
    context: options?.context,
    requestId: options?.requestId,
    signal: options?.signal,
    decided: undefined,
    note: undefined,
  });
}

function method<I>(
  execute: (input: I, caller: Caller) => WriteResult,
  syncFor: SkillWriteDeps["syncFor"],
): (input: I, options?: CallOptions) => WriteResult {
  return async (input, options) => {
    const caller = callerOf(options);
    if (!caller.ok) return caller;
    // 프로젝트 스킬의 색인은 이 호출이 속한 대화의 작업 폴더 것이어야 한다
    const synced = await syncFor?.(caller.value.context?.threadId);
    if (synced !== undefined && !synced.ok) return synced;
    return execute(input, caller.value);
  };
}

/** 승인된 제안을 다시 실행한다: 저장한 입력을 스키마로 다시 읽고 제안한 행위자로 쓰기 경로에 태운다 */
function replayWith<S extends TSchema>(
  schema: S,
  execute: (input: Static<S>, caller: Caller) => WriteResult,
): Replayer {
  return (call) => {
    const input = parse(schema, call.input);
    if (!input.ok) {
      return Promise.resolve(err(failure("internal", "the stored proposal input is malformed")));
    }
    return execute(input.value, {
      actor: call.actor,
      context: undefined,
      requestId: undefined,
      signal: call.signal,
      decided: { proposalId: call.proposalId, afterUntrusted: call.afterUntrusted },
      note: call.note,
    });
  };
}

export function createSkillWrites(deps: SkillWriteDeps): SkillWrites {
  const { fs, writer } = deps;

  /** 쓸 수 있는 범위의 루트 디렉터리. 프로젝트 루트는 신뢰된 프로젝트에만 있다 */
  async function rootOf(
    scope: WritableSkillScope,
    threadId: string | undefined,
  ): Promise<Result<string, KnowledgeFailure>> {
    const resolved = await deps.roots(threadId);
    const root = scope === "project" ? resolved.roots.project : resolved.roots.user;
    if (root === undefined) {
      return err(
        failure(
          "unavailable",
          "the project skills directory is not available (no trusted project)",
        ),
      );
    }
    return ok(root);
  }

  /** 프로젝트 스킬은 사용자나 증거가 있는 확장만 쓴다. 저장소에 커밋되는 파일을 에이전트가 바꾸지 못하게 한다(spec §3.2) */
  function scopeAllowed(
    scope: WritableSkillScope,
    caller: Caller,
    evidence: Extras["approval"],
  ): KnowledgeFailure | undefined {
    if (scope === "user" || caller.decided !== undefined) return undefined;
    const trusted = deps.settings(caller.context?.threadId).write.trustedEvidenceSources;
    if (caller.actor.kind === "user" || isEvidenceValid(evidence, caller.actor, trusted)) {
      return undefined;
    }
    return failure(
      "denied",
      "project skills are written by the user or by an extension with approval evidence",
    );
  }

  /** 기존 스킬을 찾는다. 범위를 주지 않으면 모델이 보는 이름 해석(프로젝트 → 사용자 → 확장 → 경로)을 따른다 */
  function findExisting(
    name: string,
    requested: WritableSkillScope | undefined,
  ): Result<SkillRow, KnowledgeFailure> {
    const read = deps.db.read((tx) => allSkills(tx));
    if (!read.ok) return err(fromStoreError(read.error, "skill index"));
    const rows = read.value.filter((row) => row.name === name);
    const found =
      requested === undefined
        ? rows.toSorted((a, b) => (SCOPE_RANK[a.scope] ?? 9) - (SCOPE_RANK[b.scope] ?? 9))[0]
        : rows.find((row) => row.scope === requested);
    if (found === undefined) return err(failure("not_found", `skill ${name} is not in the index`));
    if (!isWritableRow(found)) {
      return err(
        failure(
          "read_only_scope",
          `skill ${name} comes from a read-only source (${found.scope}${found.layout === "file" ? ", single file" : ""})`,
        ),
      );
    }
    return ok(found);
  }

  interface Located {
    readonly row: SkillRow;
    readonly scope: WritableSkillScope;
    readonly target: ChangeTarget;
    readonly current: Tree;
    readonly hash: string;
  }

  async function locate(
    name: string,
    requested: WritableSkillScope | undefined,
    caller: Caller,
    evidence: Extras["approval"],
  ): Promise<Result<Located, KnowledgeFailure>> {
    const row = findExisting(name, requested);
    if (!row.ok) return row;
    const scope: WritableSkillScope = row.value.scope === "project" ? "project" : "user";
    const denied = scopeAllowed(scope, caller, evidence);
    if (denied !== undefined) return err(denied);
    const target: ChangeTarget = { kind: "skill", name, scope, path: row.value.dir };
    const current = await readTarget(fs, target);
    if (!current.ok) return current;
    if (current.value === null) {
      return err(failure("not_found", `skill ${name} is gone from disk; run reindex`));
    }
    const hash = hashOfTarget("skill", current.value);
    if (hash === null) return err(failure("internal", "an existing skill has no hash"));
    return ok({ row: row.value, scope, target, current: current.value, hash });
  }

  function checkBase(baseHash: string, located: Located): KnowledgeFailure | undefined {
    if (baseHash === located.hash) return undefined;
    return failure("base_stale", "the skill changed since it was read; read it again", {
      detail: { currentHash: located.hash },
    });
  }

  // ── 연산별 계산 ──────────────────────────────────────────────────────────

  async function buildCreate(
    input: SkillCreateInput,
    caller: Caller,
  ): Promise<Result<Built, KnowledgeFailure>> {
    const name = parse(SkillNameSchema, input.name);
    if (!name.ok) return err(writeFailure("name is not a valid skill name"));
    const description = input.description.trim();
    if (description === "" || description.length > MAX_DESCRIPTION_CHARS) {
      return err(failure("limit_exceeded", "description must be 1 to 1,024 characters"));
    }
    if (input.body.trim() === "" || input.body.length > MAX_BODY_CHARS) {
      return err(failure("limit_exceeded", "body must be 1 to 100,000 characters"));
    }
    const scope = input.scope ?? "user";
    const denied = scopeAllowed(scope, caller, input.approval);
    if (denied !== undefined) return err(denied);
    const root = await rootOf(scope, caller.context?.threadId);
    if (!root.ok) return root;
    const target: ChangeTarget = {
      kind: "skill",
      name: name.value,
      scope,
      path: join(root.value, name.value),
    };
    const indexed = deps.db.read((tx) => allSkills(tx));
    if (!indexed.ok) return err(fromStoreError(indexed.error, "skill index"));
    const existing = await readTarget(fs, target);
    if (!existing.ok) return existing;
    if (
      existing.value !== null ||
      indexed.value.some((row) => row.scope === scope && row.name === name.value)
    ) {
      return err(
        failure("name_conflict", `a ${scope} skill named ${name.value} already exists`, {
          detail: { name: name.value, scope },
        }),
      );
    }
    const md = utf8Encode(composeSkillMd(name.value, description, input.body));
    const next = treeOf([{ path: MAIN_FILE, bytes: md }]);
    const unreadable = checkIndexable(next, description);
    if (unreadable !== undefined) return err(unreadable);
    return ok({
      target,
      op: "skill.create",
      destructive: false,
      baseHash: null,
      current: null,
      next,
      removal: "archive",
      scanTargets: scanTargetOf(MAIN_FILE, md),
      scope,
    });
  }

  async function buildEdit(
    input: SkillEditInput,
    caller: Caller,
  ): Promise<Result<Built, KnowledgeFailure>> {
    if (input.description === undefined && input.body === undefined) {
      return err(writeFailure("edit needs a description, a body, or both"));
    }
    if (input.description !== undefined) {
      const description = input.description.trim();
      if (description === "" || description.length > MAX_DESCRIPTION_CHARS) {
        return err(failure("limit_exceeded", "description must be 1 to 1,024 characters"));
      }
    }
    if (
      input.body !== undefined &&
      (input.body.trim() === "" || input.body.length > MAX_BODY_CHARS)
    ) {
      return err(failure("limit_exceeded", "body must be 1 to 100,000 characters"));
    }
    const located = await locate(input.name, input.scope, caller, input.approval);
    if (!located.ok) return located;
    const stale = checkBase(input.baseHash, located.value);
    if (stale !== undefined) return err(stale);
    const main = fileOf(located.value.current, MAIN_FILE);
    const text = main === undefined ? undefined : utf8DecodeStrict(main);
    if (text === undefined) return err(failure("internal", "SKILL.md is missing or not UTF-8"));
    const parts = readSkillMd(text);
    if (!parts.ok) return parts;
    let frontmatter = parts.value.frontmatter;
    if (input.description !== undefined) {
      const replaced = withDescription(frontmatter, input.description.trim());
      if (!replaced.ok) return replaced;
      frontmatter = replaced.value;
    }
    const md = utf8Encode(joinSkillMd(frontmatter, input.body ?? parts.value.body));
    if (Buffer.compare(md, main ?? new Uint8Array()) === 0) {
      return err(writeFailure("the edit changes nothing"));
    }
    const next = withFile(located.value.current, MAIN_FILE, md);
    const unreadable = checkIndexable(next, input.description?.trim());
    if (unreadable !== undefined) return err(unreadable);
    return ok({
      target: located.value.target,
      op: "skill.edit",
      destructive: true,
      baseHash: located.value.hash,
      current: located.value.current,
      next,
      removal: "archive",
      scanTargets: scanTargetOf(MAIN_FILE, md),
      scope: located.value.scope,
    });
  }

  async function buildPatch(
    input: SkillPatchInput,
    caller: Caller,
  ): Promise<Result<Built, KnowledgeFailure>> {
    const path = input.file ?? MAIN_FILE;
    if (path !== MAIN_FILE && !isAddressableSkillFile(path)) {
      return err(writeFailure("file is not a supported skill file path"));
    }
    const located = await locate(input.name, input.scope, caller, input.approval);
    if (!located.ok) return located;
    const stale = checkBase(input.baseHash, located.value);
    if (stale !== undefined) return err(stale);
    const bytes = fileOf(located.value.current, path);
    if (bytes === undefined)
      return err(failure("not_found", `skill ${input.name} has no file ${path}`));
    const text = utf8DecodeStrict(bytes);
    if (text === undefined) return err(failure("unsupported", `${path} is not a UTF-8 text file`));
    let patched: Result<string, KnowledgeFailure>;
    if (path === MAIN_FILE) {
      const parts = readSkillMd(text);
      if (!parts.ok) return parts;
      const body = applyEdits(parts.value.body, input.edits);
      if (!body.ok) return body;
      if (body.value.length > MAX_BODY_CHARS) {
        return err(failure("limit_exceeded", "body must stay under 100,000 characters"));
      }
      patched = ok(joinSkillMd(parts.value.frontmatter, body.value));
    } else {
      patched = applyEdits(text, input.edits);
    }
    if (!patched.ok) return patched;
    const nextBytes = utf8Encode(patched.value);
    const next = withFile(located.value.current, path, nextBytes);
    const limited = checkLimits(next);
    if (limited !== undefined) return err(limited);
    if (path === MAIN_FILE) {
      const unreadable = checkIndexable(next, undefined);
      if (unreadable !== undefined) return err(unreadable);
    }
    return ok({
      target: located.value.target,
      op: "skill.patch",
      destructive: true,
      baseHash: located.value.hash,
      current: located.value.current,
      next,
      removal: "archive",
      scanTargets: scanTargetOf(path, nextBytes),
      scope: located.value.scope,
    });
  }

  async function buildWriteFile(
    input: SkillWriteFileInput,
    caller: Caller,
  ): Promise<Result<Built, KnowledgeFailure>> {
    if (!isAddressableSkillFile(input.path)) {
      return err(writeFailure("path is not a supported skill file path"));
    }
    const bytes = utf8Encode(input.content);
    if (bytes.byteLength > MAX_SUPPORT_FILE_BYTES) {
      return err(failure("limit_exceeded", "a support file is at most 1 MiB"));
    }
    const located = await locate(input.name, input.scope, caller, input.approval);
    if (!located.ok) return located;
    const existing = fileOf(located.value.current, input.path);
    if (existing !== undefined && input.baseHash === undefined) {
      return err(writeFailure("baseHash is required to overwrite an existing file"));
    }
    if (input.baseHash !== undefined) {
      const stale = checkBase(input.baseHash, located.value);
      if (stale !== undefined) return err(stale);
    }
    if (existing !== undefined && Buffer.compare(existing, bytes) === 0) {
      return err(writeFailure("the file already has this content"));
    }
    const next = withFile(located.value.current, input.path, bytes);
    const limited = checkLimits(next);
    if (limited !== undefined) return err(limited);
    return ok({
      target: located.value.target,
      op: "skill.write_file",
      // 새 파일은 비파괴, 기존 파일 덮어쓰기는 파괴적이다(spec §4.4.2)
      destructive: existing !== undefined,
      baseHash: located.value.hash,
      current: located.value.current,
      next,
      removal: "archive",
      scanTargets: scanTargetOf(input.path, bytes),
      scope: located.value.scope,
    });
  }

  async function buildRemove(
    input: SkillRemoveInput,
    caller: Caller,
  ): Promise<Result<Built, KnowledgeFailure>> {
    const mode = input.mode ?? "archive";
    if (mode === "delete" && caller.actor.kind !== "user") {
      return err(writeFailure("only the user can delete a skill permanently; use archive"));
    }
    if (input.file !== undefined && !isAddressableSkillFile(input.file)) {
      return err(writeFailure("file is not a supported skill file path"));
    }
    const located = await locate(input.name, input.scope, caller, input.approval);
    if (!located.ok) return located;
    const stale = checkBase(input.baseHash, located.value);
    if (stale !== undefined) return err(stale);
    const base = {
      target: located.value.target,
      destructive: true,
      baseHash: located.value.hash,
      current: located.value.current,
      scanTargets: [],
      scope: located.value.scope,
    } as const;
    if (input.file !== undefined) {
      if (fileOf(located.value.current, input.file) === undefined) {
        return err(failure("not_found", `skill ${input.name} has no file ${input.file}`));
      }
      return ok({
        ...base,
        op: "skill.write_file",
        next: withoutFile(located.value.current, input.file),
        removal: "archive",
      });
    }
    return ok({
      ...base,
      op: mode === "delete" ? "skill.delete" : "skill.archive",
      next: null,
      removal: mode,
    });
  }

  // ── 공통 흐름 ────────────────────────────────────────────────────────────

  async function run(
    proposalMethod: ProposalMethod,
    input: Extras,
    caller: Caller,
    build: () => Promise<Result<Built, KnowledgeFailure>>,
  ): Promise<Result<WriteOutcome, KnowledgeFailure>> {
    const checked = checkWriteExtras(caller.context, input);
    if (!checked.ok) return checked;
    if (caller.decided === undefined) {
      const known = writer.recall(
        idemOf(caller.requestId, caller.context?.threadId, proposalMethod, input),
      );
      if (!known.ok) return known;
      if (known.value !== undefined) return ok(known.value);
    }
    const settings = deps.settings(caller.context?.threadId);
    if (!settings.skills.enabled) {
      return err(failure("unavailable", "skills are turned off (l2.knowledge.skills.enabled)"));
    }
    const built = await build();
    if (!built.ok) return built;
    const scan = scanForWrite("skill", built.value.scanTargets, {
      enabled: settings.write.scan,
      overrideScan: checked.value.overrideScan,
      containsKnown: deps.containsKnown,
    });
    if (!scan.ok) return scan;
    const plan: WritePlan = {
      method: proposalMethod,
      input: storable(input, built.value.scope),
      target: built.value.target,
      op: built.value.op,
      destructive: built.value.destructive,
      baseHash: built.value.baseHash,
      current: built.value.current,
      next: built.value.next,
      removal: built.value.removal,
      scan: scan.value,
      reason: caller.note ?? input.reason,
      rollbackOf: undefined,
      captureFailure: "internal",
    };
    return writer.run({
      plan,
      actor: caller.actor,
      context: caller.context,
      requestId:
        caller.decided === undefined
          ? idemOf(caller.requestId, caller.context?.threadId, proposalMethod, input)
          : undefined,
      evidence: checked.value.evidence,
      signal: caller.signal,
      decided: caller.decided,
    });
  }

  const runCreate = (input: SkillCreateInput, caller: Caller) =>
    run("skills.create", input, caller, () => buildCreate(input, caller));
  const runEdit = (input: SkillEditInput, caller: Caller) =>
    run("skills.edit", input, caller, () => buildEdit(input, caller));
  const runPatch = (input: SkillPatchInput, caller: Caller) =>
    run("skills.patch", input, caller, () => buildPatch(input, caller));
  const runWriteFile = (input: SkillWriteFileInput, caller: Caller) =>
    run("skills.writeFile", input, caller, () => buildWriteFile(input, caller));
  const runRemove = (input: SkillRemoveInput, caller: Caller) =>
    run("skills.remove", input, caller, () => buildRemove(input, caller));

  /** 모델 도구 `skill_manage`의 단일 입력을 연산 하나로 보낸다. 필수 필드가 없으면 `invalid_input`이다 */
  function manage(input: SkillManageInput, caller: Caller): WriteResult {
    const missing = (what: string): WriteResult =>
      Promise.resolve(err(writeFailure(`${input.action} needs ${what}`)));
    const scope = input.scope === undefined ? {} : { scope: input.scope };
    switch (input.action) {
      case "create":
        if (input.description === undefined || input.body === undefined) {
          return missing("description and body");
        }
        return runCreate(
          { name: input.name, description: input.description, body: input.body, ...scope },
          caller,
        );
      case "edit":
        if (input.baseHash === undefined) return missing("baseHash");
        return runEdit(
          {
            name: input.name,
            baseHash: input.baseHash,
            ...(input.description === undefined ? {} : { description: input.description }),
            ...(input.body === undefined ? {} : { body: input.body }),
            ...scope,
          },
          caller,
        );
      case "patch":
        if (input.baseHash === undefined || input.edits === undefined) {
          return missing("baseHash and edits");
        }
        return runPatch(
          {
            name: input.name,
            baseHash: input.baseHash,
            edits: input.edits,
            ...(input.path === undefined ? {} : { file: input.path }),
            ...scope,
          },
          caller,
        );
      case "write_file":
        if (input.path === undefined || input.content === undefined) {
          return missing("path and content");
        }
        return runWriteFile(
          {
            name: input.name,
            path: input.path,
            content: input.content,
            ...(input.baseHash === undefined ? {} : { baseHash: input.baseHash }),
            ...scope,
          },
          caller,
        );
      case "remove":
        if (input.baseHash === undefined) return missing("baseHash");
        return runRemove(
          {
            name: input.name,
            baseHash: input.baseHash,
            ...(input.path === undefined ? {} : { file: input.path }),
            ...scope,
          },
          caller,
        );
      default:
        return assertNever(input.action, "SkillManageAction");
    }
  }

  return {
    create: method(runCreate, deps.syncFor),
    edit: method(runEdit, deps.syncFor),
    patch: method(runPatch, deps.syncFor),
    writeFile: method(runWriteFile, deps.syncFor),
    remove: method(runRemove, deps.syncFor),
    manage: method(manage, deps.syncFor),
    replayers: {
      "skills.create": replayWith(SkillCreateInputSchema, runCreate),
      "skills.edit": replayWith(SkillEditInputSchema, runEdit),
      "skills.patch": replayWith(SkillPatchInputSchema, runPatch),
      "skills.writeFile": replayWith(SkillWriteFileInputSchema, runWriteFile),
      "skills.remove": replayWith(SkillRemoveInputSchema, runRemove),
    },
  };
}
