import { basename, join } from "node:path";
import { assertNever, eachAsync, err, ok, parse, repeatAsync, type Result } from "@xeon/contracts";
import {
  MemoryAddInputSchema,
  MemoryManageInputSchema,
  MemoryReplaceInputSchema,
  MemoryRemoveInputSchema,
  type CallOptions,
  type LedgerOp,
  type MemoryAddInput,
  type MemoryManageInput,
  type MemoryReadInput,
  type MemoryReadOutput,
  type MemoryRemoveInput,
  type MemoryReplaceInput,
  type MemoryStore,
  type MemoryStoreView,
  type MemoryWriteOutput,
} from "@xeon/contracts/capabilities";
import type { Static, TSchema } from "typebox";
import { actorOf } from "../actor.ts";
import type { ProposalMethod } from "../approval/proposals.ts";
import type { Replayer } from "../approval/queue.ts";
import { failure, fromStoreError, type KnowledgeFailure } from "../errors.ts";
import { sha256Hex, utf8Encode } from "../hash.ts";
import type { LedgerDeps } from "../ledger/change.ts";
import { recordExternalChange } from "../ledger/external.ts";
import { hashOfTarget, readTarget, type ChangeTarget } from "../ledger/target.ts";
import type { KnowledgeSettings } from "../settings.ts";
import { getFileState } from "../skills/store.ts";
import { treeOf, type Tree } from "../skills/tree.ts";
import { idemOf } from "../write/idempotency.ts";
import type { DecidedProposal, WritePlan, Writer } from "../write/pipeline.ts";
import { checkWriteExtras, scanForWrite } from "../write/scan.ts";
import {
  checkEntryText,
  codePoints,
  entryIdOf,
  parseMemoryFile,
  previewOf,
  serializeEntries,
  type ParsedMemory,
  type StructureIssue,
} from "./format.ts";

// L2.knowledge.plan K4, spec §3.3 메모리 스토어. 저장소 두 개(`user`, `env`)는 각각 한도가 있는 텍스트 파일 하나다. 읽기와 쓰기 앞에서
// 파일 해시를 마지막으로 확인한 해시와 비교해 바깥 편집(원장 `external`)과 드리프트(`.bak` 사본, 쓰기 거부)를 처리한다(§4.3.5).

const STORES: readonly MemoryStore[] = ["user", "env"];
const FILE_OF: Readonly<Record<MemoryStore, string>> = { user: "USER.md", env: "MEMORY.md" };
const MAX_BATCH_OPS = 8;
const MAX_STALE_RETRIES = 5;

export interface MemoryDeps extends LedgerDeps {
  /** 메모리 디렉터리 `<사용자 데이터>/memory`(spec §4.1). `xeon.os`의 데이터 디렉터리에서 만든다 */
  readonly memoryDir: string;
  readonly settings: (threadId: string | undefined) => KnowledgeSettings;
  readonly writer: Writer;
  readonly containsKnown: ((text: string) => boolean) | undefined;
}

type WriteResult = Promise<Result<MemoryWriteOutput, KnowledgeFailure>>;

export interface MemoryRuntime {
  read(
    input: MemoryReadInput,
    options?: CallOptions,
  ): Promise<Result<MemoryReadOutput, KnowledgeFailure>>;
  add(input: MemoryAddInput, options?: CallOptions): WriteResult;
  replace(input: MemoryReplaceInput, options?: CallOptions): WriteResult;
  remove(input: MemoryRemoveInput, options?: CallOptions): WriteResult;
  manage(input: MemoryManageInput, options?: CallOptions): WriteResult;
  /** 세션 첫 turn에 넣는 스냅샷 블록(spec §4.3.4). 메모리를 끄면 빈 문자열 */
  snapshotBlock(threadId: string | undefined): Promise<Result<string, KnowledgeFailure>>;
  readonly replayers: MemoryReplayers;
}

interface MemoryReplayers {
  readonly "memory.add": Replayer;
  readonly "memory.replace": Replayer;
  readonly "memory.remove": Replayer;
  readonly "memory.manage": Replayer;
}

interface StoreState {
  readonly store: MemoryStore;
  readonly target: ChangeTarget;
  readonly tree: Tree | null;
  /** 디스크 내용의 sha256. 파일이 없으면 null(실행기의 `baseHash` 기준) */
  readonly diskHash: string | null;
  /** 모델이 보는 `fileHash`: 파일이 없으면 빈 내용의 해시 */
  readonly viewHash: string;
  readonly parsed: ParsedMemory;
  readonly limitChars: number;
  /** 구조가 깨져 쓰기를 막은 이유 */
  readonly blocked: StructureIssue | undefined;
}

interface Caller {
  readonly actor: Parameters<Writer["run"]>[0]["actor"];
  readonly context: CallOptions["context"];
  readonly requestId: string | undefined;
  readonly signal: AbortSignal | undefined;
  readonly decided: DecidedProposal | undefined;
  readonly note: string | undefined;
}

interface Extras {
  readonly approval?: MemoryAddInput["approval"];
  readonly overrideScan?: boolean | undefined;
  readonly reason?: string | undefined;
}

/** 한 번의 계산이 낸 새 항목 목록과 바뀐 텍스트 */
interface Planned {
  readonly texts: readonly string[];
  readonly op: LedgerOp;
  readonly destructive: boolean;
  /** 위협 검사 대상: 새로 쓰거나 바꾼 항목 */
  readonly written: readonly string[];
}

function utcStamp(nowMs: number): string {
  return new Date(nowMs)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

function viewOf(state: StoreState): MemoryStoreView {
  return {
    store: state.store,
    entries: state.parsed.entries.map((entry) => ({
      id: entry.id,
      text: entry.text,
      chars: entry.chars,
    })),
    usedChars: state.parsed.usedChars,
    limitChars: state.limitChars,
    fileHash: state.viewHash,
    writeBlocked: state.blocked !== undefined,
  };
}

// ── 쓰기 계산 ─────────────────────────────────────────────────────────────

function writable(state: StoreState): KnowledgeFailure | undefined {
  if (state.blocked === undefined) return undefined;
  return failure(
    "drift_detected",
    `the ${state.store} memory file was changed outside Xeon and cannot be read as entries (${state.blocked}); a copy was kept in the .bak folder`,
    { detail: { store: state.store, issue: state.blocked } },
  );
}

function checkLimit(state: StoreState, texts: readonly string[]): KnowledgeFailure | undefined {
  const wouldBe = codePoints(serializeEntries(texts));
  // 한도를 넘더라도 줄어드는 쓰기는 막지 않는다(한도를 낮춘 뒤 정리할 길을 남긴다)
  if (wouldBe <= state.limitChars || wouldBe <= state.parsed.usedChars) return undefined;
  return failure(
    "memory_full",
    `the ${state.store} memory would hold ${String(wouldBe)} of ${String(state.limitChars)} characters; remove or replace entries in the same call`,
    {
      detail: {
        limit: state.limitChars,
        used: state.parsed.usedChars,
        wouldBe,
        entries: state.parsed.entries.map((entry) => ({
          id: entry.id,
          chars: entry.chars,
          preview: previewOf(entry.text),
        })),
      },
    },
  );
}

function duplicate(
  texts: readonly string[],
  candidate: string,
  exceptIndex: number | undefined,
): KnowledgeFailure | undefined {
  const id = entryIdOf(candidate);
  const clash = texts.findIndex((text, index) => index !== exceptIndex && entryIdOf(text) === id);
  return clash === -1
    ? undefined
    : failure("duplicate_entry", "an entry with the same text already exists", {
        detail: { entryId: id },
      });
}

function checkBase(state: StoreState, baseHash: string | undefined): KnowledgeFailure | undefined {
  if (baseHash === state.viewHash) return undefined;
  return failure("base_stale", "the memory changed since it was read; read it again", {
    detail: { currentHash: state.viewHash },
  });
}

function planAdd(state: StoreState, rawText: string): Result<Planned, KnowledgeFailure> {
  const entry = checkEntryText(rawText);
  if ("failure" in entry) return err(entry.failure);
  const texts = state.parsed.entries.map((item) => item.text);
  const clash = duplicate(texts, entry.text, undefined);
  if (clash !== undefined) return err(clash);
  const next = [...texts, entry.text];
  const full = checkLimit(state, next);
  if (full !== undefined) return err(full);
  return ok({ texts: next, op: "memory.add", destructive: false, written: [entry.text] });
}

function indexOfEntry(state: StoreState, entryId: string): number {
  return state.parsed.entries.findIndex((entry) => entry.id === entryId);
}

function planReplace(
  state: StoreState,
  entryId: string,
  rawText: string,
  baseHash: string | undefined,
): Result<Planned, KnowledgeFailure> {
  const stale = checkBase(state, baseHash);
  if (stale !== undefined) return err(stale);
  const at = indexOfEntry(state, entryId);
  if (at === -1) return err(failure("not_found", `memory entry ${entryId} does not exist`));
  const entry = checkEntryText(rawText);
  if ("failure" in entry) return err(entry.failure);
  const texts = state.parsed.entries.map((item) => item.text);
  const clash = duplicate(texts, entry.text, at);
  if (clash !== undefined) return err(clash);
  const next = texts.map((text, index) => (index === at ? entry.text : text));
  const full = checkLimit(state, next);
  if (full !== undefined) return err(full);
  return ok({ texts: next, op: "memory.replace", destructive: true, written: [entry.text] });
}

function planRemove(
  state: StoreState,
  entryId: string,
  baseHash: string | undefined,
): Result<Planned, KnowledgeFailure> {
  const stale = checkBase(state, baseHash);
  if (stale !== undefined) return err(stale);
  const at = indexOfEntry(state, entryId);
  if (at === -1) return err(failure("not_found", `memory entry ${entryId} does not exist`));
  const next = state.parsed.entries.filter((_entry, index) => index !== at).map((e) => e.text);
  return ok({ texts: next, op: "memory.remove", destructive: true, written: [] });
}

/** 한도가 찼을 때 지우기와 더하기를 한 번에 하려는 batch. 마지막 상태만 한도를 검사하고, 하나라도 틀리면 아무것도 쓰지 않는다 */
function planBatch(
  state: StoreState,
  input: Pick<MemoryManageInput, "ops" | "baseHash">,
): Result<Planned, KnowledgeFailure> {
  const ops = input.ops;
  if (ops === undefined || ops.length === 0 || ops.length > MAX_BATCH_OPS) {
    return err(failure("invalid_input", `batch needs 1 to ${String(MAX_BATCH_OPS)} ops`));
  }
  const needsBase = ops.some((op) => op.action !== "add");
  if (needsBase) {
    const stale = checkBase(state, input.baseHash);
    if (stale !== undefined) return err(stale);
  }
  // 항목 ID는 batch가 시작할 때의 값을 가리킨다
  const working: { originalId: string | null; text: string }[] = state.parsed.entries.map(
    (entry) => ({ originalId: entry.id, text: entry.text }),
  );
  const written: string[] = [];
  for (const [index, op] of ops.entries()) {
    const label = `op ${String(index + 1)}`;
    if (op.action === "add") {
      if (op.text === undefined) return err(failure("invalid_input", `${label}: add needs text`));
      const entry = checkEntryText(op.text);
      if ("failure" in entry) return err(entry.failure);
      const clash = duplicate(
        working.map((item) => item.text),
        entry.text,
        undefined,
      );
      if (clash !== undefined) return err(clash);
      working.push({ originalId: null, text: entry.text });
      written.push(entry.text);
      continue;
    }
    if (op.entryId === undefined) {
      return err(failure("invalid_input", `${label}: ${op.action} needs entryId`));
    }
    const at = working.findIndex((item) => item.originalId === op.entryId);
    if (at === -1) {
      return err(failure("not_found", `${label}: memory entry ${op.entryId} does not exist`));
    }
    if (op.action === "remove") {
      working.splice(at, 1);
      continue;
    }
    if (op.text === undefined) return err(failure("invalid_input", `${label}: replace needs text`));
    const entry = checkEntryText(op.text);
    if ("failure" in entry) return err(entry.failure);
    const clash = duplicate(
      working.map((item) => item.text),
      entry.text,
      at,
    );
    if (clash !== undefined) return err(clash);
    const target = working[at];
    if (target !== undefined) target.text = entry.text;
    written.push(entry.text);
  }
  const texts = working.map((item) => item.text);
  const full = checkLimit(state, texts);
  if (full !== undefined) return err(full);
  return ok({ texts, op: "memory.batch", destructive: needsBase, written });
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

/** 대기열이 저장하는 입력: 증거와 검사 우회를 뺀 것 */
function storable(input: Extras): unknown {
  const { approval: _approval, overrideScan: _override, ...rest } = input;
  return rest;
}

function method<I>(
  execute: (input: I, caller: Caller) => WriteResult,
): (input: I, options?: CallOptions) => WriteResult {
  return (input, options) => {
    const caller = callerOf(options);
    return caller.ok ? execute(input, caller.value) : Promise.resolve(caller);
  };
}

/** 승인된 제안을 다시 실행한다. 결과는 쓰기 결과만 돌려준다 */
function replayWith<S extends TSchema>(
  schema: S,
  execute: (input: Static<S>, caller: Caller) => WriteResult,
): Replayer {
  return async (call) => {
    const input = parse(schema, call.input);
    if (!input.ok) {
      return err(failure("internal", "the stored proposal input is malformed"));
    }
    const done = await execute(input.value, {
      actor: call.actor,
      context: undefined,
      requestId: undefined,
      signal: call.signal,
      decided: { proposalId: call.proposalId, afterUntrusted: call.afterUntrusted },
      note: call.note,
    });
    return done.ok ? ok(done.value.outcome) : done;
  };
}

export function createMemory(deps: MemoryDeps): MemoryRuntime {
  const { fs, writer } = deps;
  /** 구조가 깨진 내용을 이미 `.bak`으로 복사한 파일(경로 → 해시). 같은 내용을 두 번 복사하지 않는다 */
  const backedUp = new Map<string, string>();

  const limitOf = (store: MemoryStore, threadId: string | undefined): number => {
    const memory = deps.settings(threadId).memory;
    return store === "user" ? memory.userLimitChars : memory.envLimitChars;
  };

  async function backup(target: ChangeTarget, bytes: Uint8Array, hash: string): Promise<void> {
    if (backedUp.get(target.path) === hash) return;
    backedUp.set(target.path, hash);
    const dir = join(deps.memoryDir, ".bak");
    const made = await fs.mkdirp(dir);
    const written = made.ok
      ? await fs.writeAtomic(
          join(dir, `${basename(target.path)}.${utcStamp(deps.clock.now())}`),
          bytes,
        )
      : made;
    if (!written.ok) {
      deps.logger.error("knowledge.memory.backup_failed", {
        store: target.name,
        cause: written.error.kind,
      });
      return;
    }
    deps.logger.warn("knowledge.memory.drift", { store: target.name, hash });
  }

  /** 파일을 읽고 바깥 편집·드리프트를 처리한 현재 상태 */
  async function inspect(
    store: MemoryStore,
    threadId: string | undefined,
  ): Promise<Result<StoreState, KnowledgeFailure>> {
    const target: ChangeTarget = {
      kind: "memory",
      name: store,
      path: join(deps.memoryDir, FILE_OF[store]),
    };
    const tree = await readTarget(fs, target);
    if (!tree.ok) return tree;
    const bytes = tree.value?.files[0]?.bytes ?? null;
    const diskHash = hashOfTarget("memory", tree.value);
    const limitChars = limitOf(store, threadId);
    const parsed = parseMemoryFile(bytes, limitChars);
    const state: StoreState = {
      store,
      target,
      tree: tree.value,
      diskHash,
      viewHash: sha256Hex(bytes ?? ""),
      parsed,
      limitChars,
      blocked: parsed.issue,
    };
    const recorded = deps.db.read((tx) => getFileState(tx, target.path));
    if (!recorded.ok) return err(fromStoreError(recorded.error, "memory file state"));
    const previousHash = recorded.value?.hash ?? null;
    if (diskHash === previousHash) return ok(state);
    if (parsed.issue !== undefined && bytes !== null && diskHash !== null) {
      await backup(target, bytes, diskHash);
      return ok(state);
    }
    // 구조가 정상인 바깥 편집(처음 보는 파일과 지워진 파일 포함)은 원장에 남기고 새 해시로 계속한다
    const recordedChange = recordExternalChange(deps, {
      target,
      previousHash,
      current: tree.value,
    });
    return recordedChange.ok ? ok(state) : recordedChange;
  }

  // ── 읽기 ──────────────────────────────────────────────────────────────────

  function enabledOr(threadId: string | undefined): KnowledgeFailure | undefined {
    return deps.settings(threadId).memory.enabled
      ? undefined
      : failure("unavailable", "memory is turned off (l2.knowledge.memory.enabled)");
  }

  /** 저장소를 차례로 읽는다. 바깥 편집 기록의 순서가 일정해야 하므로 하나씩 읽는다 */
  async function inspectAll(
    stores: readonly MemoryStore[],
    threadId: string | undefined,
  ): Promise<Result<StoreState[], KnowledgeFailure>> {
    const states: StoreState[] = [];
    const stopped = await eachAsync(stores, async (store) => {
      const state = await inspect(store, threadId);
      if (!state.ok) return { value: state.error };
      states.push(state.value);
      return undefined;
    });
    return stopped === undefined ? ok(states) : err(stopped.value);
  }

  const read: MemoryRuntime["read"] = async (input, options) => {
    const threadId = options?.context?.threadId;
    const off = enabledOr(threadId);
    if (off !== undefined) return err(off);
    const wanted = input.stores ?? STORES;
    const states = await inspectAll(
      STORES.filter((candidate) => wanted.includes(candidate)),
      threadId,
    );
    return states.ok ? ok({ stores: states.value.map(viewOf) }) : states;
  };

  const snapshotBlock: MemoryRuntime["snapshotBlock"] = async (threadId) => {
    if (!deps.settings(threadId).memory.enabled) return ok("");
    const states = await inspectAll(STORES, threadId);
    if (!states.ok) return states;
    const blocks = states.value.map(viewOf).map((view) => {
      const lines = view.entries.map(
        (entry) => `[${entry.id}] ${entry.text.replaceAll("</memory", "&lt;/memory")}`,
      );
      const blocked = view.writeBlocked ? ' writeBlocked="true"' : "";
      return `<memory store="${view.store}" fileHash="${view.fileHash}" used="${String(view.usedChars)}" limit="${String(view.limitChars)}"${blocked}>\n${lines.join("\n")}${lines.length === 0 ? "" : "\n"}</memory>`;
    });
    return ok(blocks.join("\n"));
  };

  // ── 쓰기 흐름 ─────────────────────────────────────────────────────────────

  async function runOnce(
    proposalMethod: ProposalMethod,
    store: MemoryStore,
    extras: Extras,
    storedInput: unknown,
    caller: Caller,
    plan: (state: StoreState) => Result<Planned, KnowledgeFailure>,
  ): Promise<Result<MemoryWriteOutput, KnowledgeFailure>> {
    const checked = checkWriteExtras(caller.context, extras);
    if (!checked.ok) return checked;
    const threadId = caller.context?.threadId;
    if (caller.decided === undefined) {
      const idem = idemOf(caller.requestId, threadId, proposalMethod, storedInput);
      const known = writer.recall(idem);
      if (!known.ok) return known;
      if (known.value !== undefined) {
        const state = await inspect(store, threadId);
        return state.ok ? ok({ outcome: known.value, view: viewOf(state.value) }) : state;
      }
    }
    const off = enabledOr(threadId);
    if (off !== undefined) return err(off);
    const state = await inspect(store, threadId);
    if (!state.ok) return state;
    const blocked = writable(state.value);
    if (blocked !== undefined) return err(blocked);
    const planned = plan(state.value);
    if (!planned.ok) return planned;
    // 메모리는 매 세션 컨텍스트에 상주하므로 위협 검사를 항상 한다(`l2.knowledge.write.scan`은 스킬만 끈다)
    const scan = scanForWrite(
      "memory",
      planned.value.written.map((text) => ({ text, strict: false })),
      {
        enabled: true,
        overrideScan: checked.value.overrideScan,
        containsKnown: deps.containsKnown,
      },
    );
    if (!scan.ok) return scan;
    const file = FILE_OF[store];
    const next = treeOf([{ path: file, bytes: utf8Encode(serializeEntries(planned.value.texts)) }]);
    const writePlan: WritePlan = {
      method: proposalMethod,
      input: storedInput,
      target: state.value.target,
      op: planned.value.op,
      destructive: planned.value.destructive,
      baseHash: state.value.diskHash,
      current: state.value.tree,
      next,
      removal: "delete",
      scan: scan.value,
      reason: caller.note ?? extras.reason,
      rollbackOf: undefined,
      captureFailure: "internal",
    };
    const outcome = await writer.run({
      plan: writePlan,
      actor: caller.actor,
      context: caller.context,
      requestId:
        caller.decided === undefined
          ? idemOf(caller.requestId, threadId, proposalMethod, storedInput)
          : undefined,
      evidence: checked.value.evidence,
      signal: caller.signal,
      decided: caller.decided,
    });
    if (!outcome.ok) return outcome;
    const after = await inspect(store, threadId);
    return after.ok ? ok({ outcome: outcome.value, view: viewOf(after.value) }) : after;
  }

  /**
   * 읽은 뒤 쓰기 전에 다른 쓰기가 끼어들면 락 안 재확인이 `base_stale`을 낸다. 호출자가 `baseHash`를 주지 않는 쓰기(더하기)는
   * 서로 충돌하지 않으므로 다시 읽고 계산해 한 번 더 시도한다. 그래서 동시에 더한 두 항목이 모두 반영된다.
   */
  async function run(
    proposalMethod: ProposalMethod,
    store: MemoryStore,
    extras: Extras,
    storedInput: unknown,
    caller: Caller,
    plan: (state: StoreState) => Result<Planned, KnowledgeFailure>,
    retryOnStale: boolean,
  ): Promise<Result<MemoryWriteOutput, KnowledgeFailure>> {
    let retries = 0;
    return repeatAsync(async () => {
      const outcome = await runOnce(proposalMethod, store, extras, storedInput, caller, plan);
      if (
        !outcome.ok &&
        outcome.error.kind === "base_stale" &&
        retryOnStale &&
        retries < MAX_STALE_RETRIES
      ) {
        retries += 1;
        return undefined;
      }
      return { value: outcome };
    });
  }

  const runAdd = (input: MemoryAddInput, caller: Caller): WriteResult =>
    run(
      "memory.add",
      input.store,
      input,
      storable(input),
      caller,
      (state) => planAdd(state, input.text),
      true,
    );
  const runReplace = (input: MemoryReplaceInput, caller: Caller): WriteResult =>
    run(
      "memory.replace",
      input.store,
      input,
      storable(input),
      caller,
      (state) => planReplace(state, input.entryId, input.text, input.baseHash),
      false,
    );
  const runRemove = (input: MemoryRemoveInput, caller: Caller): WriteResult =>
    run(
      "memory.remove",
      input.store,
      input,
      storable(input),
      caller,
      (state) => planRemove(state, input.entryId, input.baseHash),
      false,
    );

  /** 모델 도구 `memory_manage`의 단일 입력. add·replace·remove는 같은 이름의 메서드와 같고 batch는 원자적으로 쓴다 */
  function runManage(input: MemoryManageInput, caller: Caller): WriteResult {
    const missing = (what: string): WriteResult =>
      Promise.resolve(err(failure("invalid_input", `${input.action} needs ${what}`)));
    const extras = {
      ...(input.approval === undefined ? {} : { approval: input.approval }),
      ...(input.overrideScan === undefined ? {} : { overrideScan: input.overrideScan }),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    };
    switch (input.action) {
      case "add":
        if (input.text === undefined) return missing("text");
        return runAdd({ store: input.store, text: input.text, ...extras }, caller);
      case "replace":
        if (input.entryId === undefined || input.text === undefined)
          return missing("entryId and text");
        if (input.baseHash === undefined) return missing("baseHash");
        return runReplace(
          {
            store: input.store,
            entryId: input.entryId,
            text: input.text,
            baseHash: input.baseHash,
            ...extras,
          },
          caller,
        );
      case "remove":
        if (input.entryId === undefined) return missing("entryId");
        if (input.baseHash === undefined) return missing("baseHash");
        return runRemove(
          { store: input.store, entryId: input.entryId, baseHash: input.baseHash, ...extras },
          caller,
        );
      case "batch":
        return run(
          "memory.manage",
          input.store,
          extras,
          storable(input),
          caller,
          (state) => planBatch(state, input),
          input.ops?.every((op) => op.action === "add") === true,
        );
      default:
        return assertNever(input.action, "MemoryManageAction");
    }
  }

  return {
    read,
    add: method(runAdd),
    replace: method(runReplace),
    remove: method(runRemove),
    manage: method(runManage),
    snapshotBlock,
    replayers: {
      "memory.add": replayWith(MemoryAddInputSchema, runAdd),
      "memory.replace": replayWith(MemoryReplaceInputSchema, runReplace),
      "memory.remove": replayWith(MemoryRemoveInputSchema, runRemove),
      "memory.manage": replayWith(MemoryManageInputSchema, runManage),
    },
  };
}
