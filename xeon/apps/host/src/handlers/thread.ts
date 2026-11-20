import type { ItemId, ItemRecord, ThreadId } from "@fresnel/contracts/conversation";
import { maskItemRecord } from "@fresnel/contracts/conversation";
import type { ContextError } from "@fresnel/contracts/services";
import { assertNever, Bug, err, ok, type Result } from "@fresnel/contracts";
import {
  wireError,
  type ThreadProjectRef,
  type ThreadSummary,
  type WireError,
  type WireHandler,
} from "@fresnel/contracts/wire";
import type { ConnectionHub } from "../connection-types.ts";
import { itemLeafMasks, itemMaskEntries } from "../display-mask.ts";
import {
  exportFileName,
  exportLabelOf,
  renderExportPage,
  THREAD_EXPORT_BUDGET_BYTES,
} from "../export/thread-export.ts";
import { renderMarkdownHeader } from "../export/thread-markdown.ts";
import type { Engine, ThreadCompactFailure, ThreadReadFailure } from "../types.ts";
import { wireErrorOfLifecycle, wireErrorOfStore } from "../store-error.ts";
import { markTestRun, wireErrorOfProfile } from "./m4/profile-test-run.ts";
import { wireErrorOfProject } from "./m4/project.ts";
import { CRAFT_PROFILE_ID, DEFAULT_PROFILE_ID } from "../assembly/m4/profile-defaults.ts";
import { projectRefOf } from "../assembly/m4/project-scope.ts";
import { claimWrite, threadLocked, withWriteOwner } from "./owner.ts";

// L4.host-service.spec §3.4 M1 표. thread.create: thread를 만들고 쓰기 소유를 함께 얻는다(M1에서는 create가 소유를 얻는다).
// thread.open은 아래에 있다. M2 나머지(HOST.2)는 이 파일 아래쪽: list, read, close, fork, revert, delete.

export function createThreadCreateHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"thread.create"> {
  const { ports } = engine;
  const profiles = ports.m4.profileTestRun;
  const projects = ports.m4.project;
  return async (params, context) => {
    // 프로필: 적은 값이 있으면 그 프로필이 있는지 본다(없는 프로필 때문에 빈 대화가 남지 않게 한다, M5c §3.4). 없으면 기본값을 쓴다(§4.4.8).
    // 기본값에서 고른 `default`는 저장하지 않는다. 저장된 값이 없으면 `default`로 읽는다(§4.1.1)
    // 숨은 `craft`는 테스트 대화만 쓴다(§4.8.5). 일반 대화에 고르면 없는 프로필이다
    if (params.profileId === CRAFT_PROFILE_ID) {
      throw wireErrorOfProfile({ kind: "not_found", id: CRAFT_PROFILE_ID });
    }
    let profileId: string;
    let storedProfileId: string | undefined;
    if (params.profileId !== undefined) {
      const found = await profiles.get(params.profileId);
      if (!found.ok) throw wireErrorOfProfile(found.error);
      profileId = params.profileId;
      storedProfileId = params.profileId;
    } else {
      const chosen = await profiles.defaultFor(params.workspace);
      if (!chosen.ok) throw wireErrorOfProfile(chosen.error);
      profileId = chosen.value.profileId;
      storedProfileId = profileId === DEFAULT_PROFILE_ID ? undefined : profileId;
    }
    const created = await ports.threads.create({
      ...(params.workspace === undefined ? {} : { workspace: params.workspace }),
      ...(params.title === undefined ? {} : { title: params.title }),
      ...(params.testRun === true ? { testRun: true } : {}),
      ...(storedProfileId === undefined ? {} : { profileId: storedProfileId }),
      // 작업 폴더를 주지 않으면 기본 폴더 아래 대화별 폴더를 쓴다(§4.4.5)
      ...(params.workspace === undefined ? { defaultFolder: true } : {}),
    });
    await claimWrite(engine, hub(), context.connectionId, created.threadId);
    // 열기 훅의 대화 폴더는 쓰기 소유를 얻은 뒤, 첫 턴 전에 정한다(H-7)
    await ports.threads.applyOpenWorkspace(created.threadId);
    if (params.testRun === true) markTestRun(profiles, created.threadId, params.profileId);
    // 위치는 소유를 얻은 뒤에 읽는다: 열기가 이벤트를 커밋했을 수 있다
    const position = ports.threads.position(created.threadId);
    if (!position.ok) throw wireErrorOfStore(position.error, "thread.create position");
    // 같은 폴더의 다른 열린 대화는 알리기만 한다(U6). 막지 않고 복사하지 않는다
    const sameFolder = ports.threads.sameFolder(created.threadId);
    // 프로젝트 소속(§4.4.2). 열기 훅이 대화 폴더를 바꿨을 수 있으므로 지금의 값을 읽는다. Test run 대화는 프로젝트 묶음에서 뺀다(§4.8)
    const workspace = ports.threads.workspaceOf(created.threadId);
    if (!workspace.ok) throw wireErrorOfStore(workspace.error, "thread.create workspace");
    let project: ThreadProjectRef | null = null;
    if (workspace.value !== null && params.testRun !== true) {
      const attached = await projects.attach(workspace.value);
      if (!attached.ok) throw wireErrorOfProject(attached.error);
      project = attached.value;
      // 작업 폴더를 연 것이다. 그 폴더의 동반 플러그인을 검토 항목으로 훑는다(M5c §4.5.7). 실패는 로그에 남고 여는 일은 막지 않는다
      await ports.scanOpenedRoots();
    }
    return {
      threadId: created.threadId,
      position: position.value,
      sameFolder,
      project,
      profileId,
    };
  };
}

/**
 * M5c §3.4 `thread.setProfile`. 대화가 참조하는 프로필을 바꾼다(`thread.updated { profileId }` 커밋). 쓰기 소유자만 부른다.
 * 프로필이 없으면 `profile.notFound`다. 적용은 다음 단계 경계부터다(§4.1.8).
 */
export function createThreadSetProfileHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"thread.setProfile"> {
  const { ports } = engine;
  const profiles = ports.m4.profileTestRun;
  return async (params, context) => {
    const { threadId, profileId } = params;
    requireThread(engine, threadId, "thread.setProfile");
    const conn = hub().state(context.connectionId);
    if (conn === undefined || conn.phase === "closed") throw wireError("request.cancelled");
    if (!engine.ports.locks.holds(threadId)) throw wireError("thread.notOwner");
    // 테스트 대화의 프로필은 `craft`로 고정이다. 프로필 칩이 없으므로 바꾸지 못한다(§4.8.5)
    const craft = engine.ports.threads.isCraftChat(threadId);
    if (!craft.ok) throw wireErrorOfStore(craft.error, "thread.setProfile craft lookup");
    if (craft.value) throw wireErrorOfProfile({ kind: "builtin_protected", id: profileId });
    if (profileId === CRAFT_PROFILE_ID)
      throw wireErrorOfProfile({ kind: "not_found", id: profileId });
    const found = await profiles.get(profileId);
    if (!found.ok) throw wireErrorOfProfile(found.error);
    const previewed = await profiles.preview({
      source: { kind: "stored", id: profileId },
      threadId,
    });
    if (!previewed.ok) throw wireErrorOfProfile(previewed.error);
    const set = ports.threads.setProfile(threadId, profileId);
    if (!set.ok) throw wireErrorOfLifecycle(set.error, "thread.setProfile");
    // 전환은 다음 단계 경계에서 적용된다. 유휴 대화도 다음 매크로태스크에 맞춘다(M5c §4.1.8)
    engine.ports.m4.pluginSet.recompute(threadId);
    // 화면의 프로필 칩과 실제 동작을 맞춘다(AGE-64): 새 프로필의 시작 Drive로 바꾸되 이미 일하는 Drive는 끊지 않는다
    const started = await ports.threads.switchStartDrive(threadId);
    if (!started.ok) throw wireErrorOfStore(started.error, "thread.setProfile start drive");
    // 미리 본 값을 그대로 싣는다(M5c §3.4). 전환 전의 대화 기준으로 잰 값이다
    const { permission, toolsChanged, cacheImpact } = previewed.value;
    return {
      position: set.value.position,
      preview: {
        ...(permission === undefined ? {} : { permission }),
        ...(toolsChanged === undefined ? {} : { toolsChanged }),
        ...(cacheImpact === undefined ? {} : { cacheImpact }),
      },
      startDrive: started.value,
    };
  };
}

/**
 * L4.host-service.spec §3.4 M2 표, HS-23~HS-24. thread.open:
 * - `write`: thread가 없으면 3001. 이 프로세스가 이미 쥐었으면 그대로 `owner`(같은 호스트의 여러 연결이 쓰기 소유를 함께 쓴다).
 *   아니면 세션 잠금을 얻고(임대 토큰으로 쓰기를 여는 일은 어댑터가 한다) `owner`, 못 얻으면 3002와 대안이다.
 * - `observe`: 잠금 없이 연다. `observer`. 다른 프로세스가 쥔 thread의 커밋은 관찰 폴링이 전한다(HS-16).
 */
export function createThreadOpenHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"thread.open"> {
  const { ports } = engine;
  return async (params, context) => {
    const { threadId } = params;
    const exists = ports.threads.exists(threadId);
    if (!exists.ok) throw wireErrorOfStore(exists.error, "thread.open thread lookup");
    if (!exists.value) throw wireError("thread.notFound", { details: { threadId } });
    if (params.mode === "write") {
      await claimWrite(engine, hub(), context.connectionId, threadId);
      await ports.threads.applyOpenWorkspace(threadId);
    } else {
      const conn = hub().state(context.connectionId);
      if (conn === undefined || conn.phase === "closed") throw wireError("request.cancelled");
      conn.openThreads.add(threadId);
      conn.observedThreads.add(threadId);
      hub().watchObserved();
    }
    // 위치는 소유를 얻은 뒤에 읽는다: 열기가 이벤트를 커밋했을 수 있다
    const position = ports.threads.position(threadId);
    if (!position.ok) throw wireErrorOfStore(position.error, "thread.open position");
    return {
      threadId,
      role: params.mode === "write" ? "owner" : "observer",
      position: position.value,
    };
  };
}

/** thread가 있는지 본다. 없으면 3001, 읽기 실패는 store.* 이다 */
export function requireThread(engine: Engine, threadId: ThreadId, where: string): void {
  const exists = engine.ports.threads.exists(threadId);
  if (!exists.ok) throw wireErrorOfStore(exists.error, `${where} thread lookup`);
  if (!exists.value) throw wireError("thread.notFound", { details: { threadId } });
}

/** HS-28: 이 프로세스가 쓰기 소유를 쥔 thread만. 암묵 획득은 하지 않는다 */
export function requireOwned(engine: Engine, threadId: ThreadId): void {
  if (!engine.ports.locks.holds(threadId)) throw threadLocked(null);
}

function readFailure(error: ThreadReadFailure, where: string): WireError {
  switch (error.kind) {
    case "invalid_target":
      return wireError("thread.invalidTarget", { details: { reason: error.reason } });
    case "busy":
    case "io":
    case "row_invalid":
    case "thread_not_found":
      return wireErrorOfStore(error, where);
    default:
      return assertNever(error, "ThreadReadFailure");
  }
}

export function createThreadListHandler(engine: Engine): WireHandler<"thread.list"> {
  return async (params) => {
    const page = await engine.ports.threads.list(params);
    // Test run 표지(W-34)는 호스트가 안다. Test run이 아닌 대화에는 필드를 싣지 않는다
    const profiles = engine.ports.m4.profileTestRun;
    // 프로젝트 소속은 루트 목록으로 계산한다(§4.4.2). 루트를 읽지 못하면 목록은 그대로 보이고 소속만 비운다
    const roots = await engine.ports.m4.project.roots();
    if (!roots.ok) engine.ports.log.error("thread.list.project_roots", { kind: roots.error.kind });
    const threads: ThreadSummary[] = [];
    for (const summary of page.threads) {
      const testRun = profiles.testRunMarker(summary.threadId);
      // 저장된 프로필 id가 없으면 기본이다(M5c §4.1.1)
      const project =
        roots.ok && testRun === undefined ? projectRefOf(summary.workspace, roots.value) : null;
      const withProfile = { ...summary, profileId: summary.profileId ?? "default", project };
      threads.push(testRun === undefined ? withProfile : { ...withProfile, testRun });
    }
    return { ...page, threads };
  };
}

/** W-16: `around`은 `before`와 함께 쓰지 않는다. 계약 스키마가 이 조합을 막지 않으므로 처리기가 -32602로 거부한다 */
function aroundWithBefore(): WireError {
  return wireError("jsonrpc.invalidParams", {
    details: { issues: [{ path: "around", message: "around cannot be combined with before" }] },
  });
}

/** F wire §3.4.6. 소유를 얻지 않는 읽기다 */
export function createThreadReadHandler(engine: Engine): WireHandler<"thread.read"> {
  return async (params) => {
    if (params.around !== undefined && params.before !== undefined) throw aroundWithBefore();
    const read = await engine.ports.threads.read(params);
    if (!read.ok) throw readFailure(read.error, "thread.read");
    // 화면 가림 표식은 items 옆에 붙인다. items와 position은 바뀌지 않는다(L0.secrets.spec §3.5.1)
    const masks = itemMaskEntries(engine.ports.secrets.display, read.value.items);
    return masks.length === 0 ? read.value : { ...read.value, masks };
  };
}

/** `thread.read`의 쪽 크기와 같다. 내보내기는 이 쪽을 끝까지 되읽어 가지 전체를 모은다 */
const EXPORT_READ_PAGE = 500;

/** 현재 가지의 item을 오래된 것부터 모두 모은다. 쪽 경계는 `thread.read`의 `hasMore`가 거짓이 될 때까지 되읽는다 */
async function branchItemsOf(
  engine: Engine,
  threadId: ThreadId,
): Promise<Result<ItemRecord[], ThreadReadFailure>> {
  const pages: ItemRecord[][] = [];
  let before: ItemId | undefined;
  let more = true;
  while (more) {
    // oxlint-disable-next-line no-await-in-loop -- 앞 쪽의 가장 오래된 item이 다음 쪽의 경계다 (F.wire-settings.spec §3.4.6)
    const page = await engine.ports.threads.read({
      threadId,
      limit: EXPORT_READ_PAGE,
      ...(before === undefined ? {} : { before }),
    });
    if (!page.ok) return err(page.error);
    pages.push(page.value.items);
    const oldest = page.value.items[0];
    more = page.value.hasMore && oldest !== undefined;
    before = oldest?.itemId;
  }
  return ok(pages.toReversed().flat());
}

/**
 * F wire §3.4.7 [제안]. 현재 가지를 `markdown` 문서나 `json` 배열로 옮겨 쪽 하나를 돌려준다. 소유를 얻지 않는 읽기다.
 * 화면 가림은 `thread.read`와 같은 잎 표식으로 적용한 뒤 본문을 만든다. 쪽 예산은 `budgetBytes`(시험이 작은 값을 넣는다).
 */
export function createThreadExportHandler(
  engine: Engine,
  budgetBytes: number = THREAD_EXPORT_BUDGET_BYTES,
): WireHandler<"thread.export"> {
  const { ports } = engine;
  const display = ports.secrets.display;
  return async (params) => {
    const { threadId, format, after } = params;
    requireThread(engine, threadId, "thread.export");
    const titled = ports.threads.title(threadId);
    if (!titled.ok) throw wireErrorOfStore(titled.error, "thread.export title");
    const loaded = await branchItemsOf(engine, threadId);
    if (!loaded.ok) throw readFailure(loaded.error, "thread.export");
    const items = loaded.value;
    let start = 0;
    if (after !== undefined) {
      const found = items.findIndex((item) => item.itemId === after);
      // 이 가지에 없는 item은 같은 thread에 있어도 item_not_found로 알린다
      if (found < 0) {
        throw readFailure({ kind: "invalid_target", reason: "item_not_found" }, "thread.export");
      }
      start = found + 1;
    }
    const label = exportLabelOf(display, threadId, titled.value);
    const page = renderExportPage({
      format,
      items,
      start,
      leading: after === undefined,
      header: renderMarkdownHeader({ title: label.shown, threadId, itemTotal: items.length }),
      reveal: (item) => maskItemRecord(item, itemLeafMasks(display, item)),
      budgetBytes,
    });
    return {
      format,
      filename: exportFileName(label.stem, format),
      chunk: page.chunk,
      ...(page.next === undefined ? {} : { next: page.next }),
      itemCount: page.itemCount,
    };
  };
}

/** 이 연결의 열기 기록을 지운다. 쓰기로 연 연결이 더 없고 live 작업이 없으면(HS-27) 잠금을 푼다(서비스 모드만) */
export function createThreadCloseHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"thread.close"> {
  return async (params, context) => {
    const { threadId } = params;
    requireThread(engine, threadId, "thread.close");
    const conn = hub().state(context.connectionId);
    if (conn === undefined || conn.phase === "closed") {
      throw wireError("request.cancelled");
    }
    conn.openThreads.delete(threadId);
    conn.writeThreads.delete(threadId);
    conn.observedThreads.delete(threadId);
    await hub().releaseUnused([threadId]);
    return {};
  };
}

/** 원본 thread의 쓰기 소유는 필요 없다. 새 thread를 만들고 그 thread의 쓰기 소유를 얻는다 */
export function createThreadForkHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"thread.fork"> {
  const { ports } = engine;
  return async (params, context) => {
    requireThread(engine, params.threadId, "thread.fork");
    const forked = await ports.threads.fork(params.threadId, params.at);
    if (!forked.ok) throw wireErrorOfLifecycle(forked.error, "thread.fork");
    await claimWrite(engine, hub(), context.connectionId, forked.value.threadId);
    await ports.threads.applyOpenWorkspace(forked.value.threadId);
    // 위치는 소유를 얻은 뒤에 읽는다: 열기가 이벤트를 커밋했을 수 있다
    const position = ports.threads.position(forked.value.threadId);
    if (!position.ok) throw wireErrorOfStore(position.error, "thread.fork position");
    return { threadId: forked.value.threadId, position: position.value };
  };
}

export function createThreadRevertHandler(engine: Engine): WireHandler<"thread.revert"> {
  return async (params) => {
    requireThread(engine, params.threadId, "thread.revert");
    requireOwned(engine, params.threadId);
    const reverted = await engine.ports.threads.revert(params.threadId, params.to);
    if (!reverted.ok) throw wireErrorOfLifecycle(reverted.error, "thread.revert");
    // `leaf`는 파일 되감기가 쓴다. 이 메서드의 결과에는 싣지 않는다(F wire §3.3.1 thread.revert)
    return { position: reverted.value.position };
  };
}

/**
 * 제목을 바꾼다(G2-12, HS-73). 쓰기 소유자만 바꿀 수 있어 `thread.delete`처럼 열지 않고 바꾸는 클라이언트(`fresnel sessions rename`)를 위해
 * 소유를 쥐지 않았으면 한 번 얻어 본다. 얻지 못하면 3002다. 이 호출이 얻은 잠금은 바꾼 뒤 놓되, 그동안 다른 연결이 소유를 이어받았으면
 * 놓지 않는다(`withWriteOwner`). 결과 `position`은 제목 변경 이벤트를 반영한 저장소 위치다
 */
export function createThreadRenameHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"thread.rename"> {
  const { ports } = engine;
  return async (params) => {
    const { threadId } = params;
    requireThread(engine, threadId, "thread.rename");
    return await withWriteOwner(engine, hub(), threadId, () => {
      const renamed = ports.threads.rename(threadId, params.title);
      if (!renamed.ok) throw wireErrorOfLifecycle(renamed.error, "thread.rename");
      return renamed.value;
    });
  };
}

/**
 * 대화가 다음 turn부터 쓸 모델을 정한다(M4 T-MODEL). `model`은 `provider/id`이고 카탈로그(`ports.models`)에 없으면 `jsonrpc.invalidParams`다.
 * null은 지정을 거둔다. 쓰기 소유는 `thread.rename`과 같게 한 번 얻어 본다
 */
export function createThreadSetModelHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"thread.setModel"> {
  const { ports } = engine;
  return async (params) => {
    const { threadId, model } = params;
    requireThread(engine, threadId, "thread.setModel");
    if (model !== null) {
      const slash = model.indexOf("/");
      const provider = slash < 0 ? "" : model.slice(0, slash);
      const modelId = slash < 0 ? "" : model.slice(slash + 1);
      if (!ports.models.modelIds(provider).includes(modelId)) {
        throw wireError("jsonrpc.invalidParams", {
          details: { issues: [{ path: "model", message: "model is not in the catalog" }] },
        });
      }
    }
    return await withWriteOwner(engine, hub(), threadId, () => {
      const set = ports.threads.setModel(threadId, model);
      if (!set.ok) throw wireErrorOfLifecycle(set.error, "thread.setModel");
      return set.value;
    });
  };
}

/**
 * 쓰기 소유자만 지울 수 있다. `fresnel sessions rm`처럼 thread를 열지 않고 지우는 클라이언트를 위해 소유를 쥐지 않았으면 한 번 얻어 본다
 * (HS-28 암묵 획득과 같은 규칙. 표(§3.4)가 "잠금을 얻을 수 없으면 거부"라고 적었다). 얻지 못하면 3002다.
 * 지우지 못했으면 이 호출이 얻은 잠금은 놓되, 그동안 다른 연결이 소유를 이어받았으면 놓지 않는다(`withWriteOwner`).
 */
export function createThreadDeleteHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"thread.delete"> {
  const { ports } = engine;
  return async (params) => {
    const { threadId } = params;
    requireThread(engine, threadId, "thread.delete");
    await withWriteOwner(engine, hub(), threadId, async () => {
      const removed = await ports.threads.remove(threadId);
      if (!removed.ok) throw wireErrorOfLifecycle(removed.error, "thread.delete");
    });
    // 이 thread를 열어 둔 연결의 기록을 지운다
    for (const conn of hub().connections()) {
      conn.openThreads.delete(threadId);
      conn.writeThreads.delete(threadId);
      conn.observedThreads.delete(threadId);
    }
    return {};
  };
}

/** 컴팩션을 끝내지 못한 이유를 와이어 오류로 옮긴다(F wire §3.5.2). 모델 출력과 제공자 응답 본문은 싣지 않는다 */
function compactFailure(error: ThreadCompactFailure, where: string): WireError | Bug {
  switch (error.kind) {
    case "busy":
    case "io":
    case "row_invalid":
    case "thread_not_found":
      return wireErrorOfStore(error, where);
    case "thread_closed":
      return wireError("thread.closed", { details: { threadId: error.threadId } });
    case "turn_running":
      return wireError("turn.busy", { details: { turnId: error.turnId } });
    case "model_unavailable":
      // 요약을 만들 모델이 없다: 요약 호출이 시작되지 못한 것이라 요약 실패 이유로 알린다
      return wireError("thread.compactFailed", { details: { reason: "summary_failed" } });
    case "context_failed":
      return contextFailure(error.error, where);
    default:
      return assertNever(error, "ThreadCompactFailure");
  }
}

function contextFailure(error: ContextError, where: string): WireError | Bug {
  switch (error.kind) {
    case "aborted":
      return wireError("request.cancelled");
    case "branch_not_found":
      // 컨텍스트 서비스가 활성 가지를 스스로 읽는다. 열려 있는 thread에 이벤트가 없다는 것은 저장소의 불변 조건 위반이다
      return new Bug(`${where}: the active branch of an existing thread has no events`, {
        cause: error,
      });
    case "read_failed":
    case "projection_failed":
    case "summary_failed":
    case "summary_has_tool_call":
    case "summary_truncated":
    case "commit_failed":
      return wireError("thread.compactFailed", { details: { reason: error.kind } });
    default:
      return assertNever(error.kind, "ContextErrorKind");
  }
}

/**
 * 대화를 지금 요약한다(G2-01, HS-77). `turn.start`처럼 쓰기 소유를 암묵 획득하고(HS-28), 열린 turn이 있으면 3003이다.
 * 컨텍스트 서비스가 이유 `manual`로 요약하고 `thread.compacted`를 커밋한다. 요약할 것이 없거나 컴팩션이 꺼져 있으면 오류가 아니라
 * `skipped`다. 확장이 막으면 3006(`thread.compact.before`), 요약이나 커밋이 실패하면 3008이다
 */
export function createThreadCompactHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"thread.compact"> {
  const { ports } = engine;
  return async (params, context) => {
    const { threadId } = params;
    requireThread(engine, threadId, "thread.compact");
    await claimWrite(engine, hub(), context.connectionId, threadId);
    const compacted = await ports.threads.compact(threadId, params.instructions, context.signal);
    if (!compacted.ok) {
      ports.log.error("thread.compact_failed", { threadId, kind: compacted.error.kind });
      throw compactFailure(compacted.error, "thread.compact");
    }
    const outcome = compacted.value;
    switch (outcome.status) {
      case "compacted": {
        // 위치는 커밋한 뒤에 읽는다: 컴팩션 이벤트를 반영한 저장소 위치다
        const position = ports.threads.position(threadId);
        if (!position.ok) throw wireErrorOfStore(position.error, "thread.compact position");
        return {
          status: "compacted",
          eventId: outcome.eventId,
          tokensBefore: outcome.tokensBefore,
          tokensAfter: outcome.tokensAfter,
          fromExtension: outcome.fromExtension,
          position: position.value,
        };
      }
      case "skipped":
        return { status: "skipped", why: outcome.why };
      case "cancelled":
        throw wireError("thread.cancelledByExtension", {
          details: { point: "thread.compact.before", reason: outcome.reason.slice(0, 512) },
        });
      default:
        return assertNever(outcome, "CompactOutcome");
    }
  };
}
