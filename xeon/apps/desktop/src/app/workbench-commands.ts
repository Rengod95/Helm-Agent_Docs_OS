import { extSettingPrefixes, threadSetProfileRequestOf } from "@fresnel/client/workbench";
import { err, ok, parse, type Result } from "@fresnel/contracts";
import { ScopeHandlerFailedPayloadSchema } from "@fresnel/contracts/records";
import type { PluginCard } from "@fresnel/contracts/extensions";
import type { SettingDefWire } from "@fresnel/contracts/settings";
import type {
  EventsBatchParams,
  HostConnection,
  SettingsInvalidatedParams,
  StreamChunkParams,
} from "@fresnel/contracts/wire";
import type { CommandError, WorkbenchCommands } from "../views/commands.ts";
import { installPreviewOfDraft } from "./plugin-draft.ts";

// 크래프트 명령. 결과는 요청의 반환값이다(거울에 넣지 않는다). 상태 반영은 `views/workbench`의 컨트롤러가 스토어에 한다.

type WithConnection = <T>(
  run: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

/** `settings.invalidated`가 확장 목록을 다시 읽을 까닭인가. 키 목록이 비면 전체 무효화로 보고, 확장 키(`ext.`)가 하나라도 있으면 맞다 */
export function isExtSettingsChange(params: Pick<SettingsInvalidatedParams, "keys">): boolean {
  return params.keys.length === 0 || params.keys.some((key) => key.startsWith("ext."));
}

/** 내구 이벤트 묶음에 `scope.changed`가 있나. 자동 끄기도 이 기록을 남기고, 목록의 `autoDisabled`가 그 뒤에 바뀐다 */
export function hasScopeChange(params: Pick<EventsBatchParams, "events">): boolean {
  return params.events.some((event) => event.kind === "scope.changed");
}

/**
 * 휘발 조각이 새 "끌까요" 질문을 알리나(`scope.handler_failed`의 `asksDisable`). 질문은 켜 둔 채라 내구 `scope.changed`가 없으므로
 * 이 조각이 목록을 다시 읽을 유일한 신호다
 */
export function asksDisable(params: Pick<StreamChunkParams, "event">): boolean {
  if (params.event.kind !== "scope.handler_failed") return false;
  const payload = parse(ScopeHandlerFailedPayloadSchema, params.event.payload);
  return payload.ok && payload.value.asksDisable === true;
}

/**
 * 목록을 다시 읽을 알림마다 `listener`를 부른다. 인자 `settled`는 적용이 끝났다는 신호다: 키 목록이 빈 `settings.invalidated`를
 * 호스트가 확장 설정 적용 뒤에 보낸다(`ext-enabled.ts`). 그때는 대기 중인 켜기·끄기의 결과를 판정한다. 반환값은 구독 해제
 */
export function subscribeExtChanges(
  connection: Pick<HostConnection, "onNotification">,
  listener: (settled: boolean) => void,
): () => void {
  const offSettings = connection.onNotification("settings.invalidated", (params) => {
    if (isExtSettingsChange(params)) listener(params.keys.length === 0);
  });
  const offEvents = connection.onNotification("events.batch", (params) => {
    if (hasScopeChange(params)) listener(false);
  });
  const offChunks = connection.onNotification("stream.chunk", (params) => {
    if (asksDisable(params)) listener(false);
  });
  return () => {
    offSettings();
    offEvents();
    offChunks();
  };
}

/**
 * 주도권 스택이 바뀐 알림(`drive.framesChanged`)이 이 대화의 것이면 `listener`를 부른다. 반환값은 구독 해제
 */
export function subscribeDriveFrames(
  connection: Pick<HostConnection, "onNotification">,
  threadId: string,
  listener: () => void,
): () => void {
  return connection.onNotification("drive.framesChanged", (params) => {
    if (params.threadId === threadId) listener();
  });
}

/** 공통 묶음에서 온 플러그인의 사용처 표지(카드의 `usedBy`) */
const COMMON_USER = "common";

/** 프로필(과 공통 묶음)에 든 플러그인 이름. 원샷 목록이 이미 든 플러그인을 가를 때 쓴다 */
export function pluginSetOf(
  cards: readonly Pick<PluginCard, "name" | "usedBy">[],
  profileId: string,
): ReadonlySet<string> {
  return new Set(
    cards
      .filter((card) => card.usedBy.includes(COMMON_USER) || card.usedBy.includes(profileId))
      .map((card) => card.name),
  );
}

function draftKey(source: string, sha256: string): string {
  return `${source}\n${sha256}`;
}

export function createWorkbenchCommands(
  withConnection: WithConnection,
  subscribeChanges: (listener: (settled: boolean) => void) => () => void,
  subscribeDrive: (threadId: string, listener: () => void) => () => void,
): WorkbenchCommands {
  // 미리 본 초안: 원본 폴더와 내용 해시 → draftId. `install`이 같은 초안을 검토함으로 보낸다
  const drafts = new Map<string, string>();
  return {
    async list(threadId) {
      const listed = await withConnection((c) =>
        c.request("ext.list", threadId === undefined ? {} : { threadId }),
      );
      return listed.ok ? ok(listed.value.extensions) : err(listed.error);
    },
    onChanged: subscribeChanges,
    // 설치는 검토함을 거친다. 미리 보기는 `plugin.draft.create`의 카드이고, 설치는 그 초안을 `pluginReview.submitDraft`로 보낸다
    async installPreview(source) {
      const made = await withConnection((c) => c.request("plugin.draft.create", { dir: source }));
      if (!made.ok) return err(made.error);
      drafts.set(draftKey(source, made.value.contentHash), made.value.draftId);
      return ok(installPreviewOfDraft(source, made.value));
    },
    async install(source, sha256) {
      const key = draftKey(source, sha256);
      const known = drafts.get(key);
      let draftId = known;
      if (draftId === undefined) {
        // 미리 보기 없이 부르면 여기서 초안을 만든다. 내용이 미리 본 것과 다르면 보내지 않는다
        const made = await withConnection((c) => c.request("plugin.draft.create", { dir: source }));
        if (!made.ok) return err(made.error);
        if (made.value.contentHash !== sha256) {
          return err({
            kind: "rejected",
            code: null,
            issue: "source_changed: content hash differs",
          });
        }
        draftId = made.value.draftId;
      }
      const id = draftId;
      const sent = await withConnection((c) =>
        c.request("pluginReview.submitDraft", { draftId: id }),
      );
      if (!sent.ok) return err(sent.error);
      drafts.delete(key);
      return ok({ itemId: sent.value.itemId });
    },
    // 지우기는 `plugin.requestRemove`가 검토 항목을 만든다. 지워지는 시점은 검토가 정한다
    remove: (name) => withConnection((c) => c.request("plugin.requestRemove", { name })),
    // "지침 추가"는 지침 한 줄을 그대로 보낸다. 승인은 검토함이 하므로 여기서 프로필을 고치지 않는다
    addInstruction: (text, profileId) =>
      withConnection((c) =>
        c.request(
          "plugin.draft.fromInstruction",
          profileId === undefined ? { text } : { text, profileId },
        ),
      ),
    bindings: (threadId) =>
      withConnection((c) => c.request("ext.bindings", threadId === undefined ? {} : { threadId })),
    async reload(name) {
      const done = await withConnection((c) => c.request("ext.reload", { name }));
      return done.ok ? ok(null) : err(done.error);
    },
    get: (name) => withConnection((c) => c.request("ext.get", { name })),
    async groups(threadId) {
      const got = await withConnection((c) => c.request("orchestration.list", { threadId }));
      return got.ok ? ok(got.value.groups) : err(got.error);
    },
    async driveFrames(threadId) {
      const got = await withConnection((c) => c.request("drive.frames", { threadId }));
      return got.ok ? ok(got.value.frames) : err(got.error);
    },
    onDriveFramesChanged: subscribeDrive,
    timings: (name, threadId) =>
      withConnection((c) =>
        c.request("ext.timings", threadId === undefined ? { name } : { name, threadId }),
      ),
    explain: (key, threadId) =>
      withConnection((c) => c.request("settings.explain", { key, threadId })),
    // "다시 시도". 전역 켜기 설정은 쓰지 않는다(관리 범위만 받는 키다). 엔진이 멈춘 표시를 풀고 다음 단계 경계에서 다시 싣는다
    async retry(name) {
      const done = await withConnection((c) => c.request("ext.reenable", { name }));
      return done.ok ? ok(null) : err(done.error);
    },
    // 엔진의 "계속 실패해요" 질문에 멈춤으로 답한다. 이번 실행에서만 멈추고 설정은 쓰지 않는다
    async stop(name) {
      const done = await withConnection((c) => c.request("ext.disableConfirm", { name }));
      return done.ok ? ok(null) : err(done.error);
    },
    async profiles() {
      const got = await withConnection((c) => c.request("profile.list", {}));
      return got.ok ? ok(got.value.profiles) : err(got.error);
    },
    // `thread.setProfile`은 쓰기 소유자만 부른다. 앱은 첫 턴(`turn.start`) 전까지 대화를 관찰로만 열므로, 고르기 전에 쓰기로 연다
    // (`thread.open write`, 이미 쥐었으면 그대로다). 다른 프로세스가 쥐었으면 그 오류(locked)를 그대로 돌려준다
    applyProfile: (id, threadId) =>
      withConnection(async (c) => {
        await c.request("thread.open", { threadId, mode: "write" });
        return c.request("thread.setProfile", threadSetProfileRequestOf(id, threadId));
      }),
    putProfile: (profile, baseRev) =>
      withConnection((c) => c.request("profile.put", { profile, baseRev })),
    async deleteProfile(id) {
      const done = await withConnection((c) => c.request("profile.delete", { id }));
      return done.ok ? ok(done.value.rev) : err(done.error);
    },
    previewProfile: (id, threadId) =>
      withConnection((c) =>
        c.request("profile.preview", threadId === undefined ? { id } : { id, threadId }),
      ),
    async defaultProfileFor(workspace) {
      const got = await withConnection((c) =>
        c.request("profile.defaultFor", workspace === null ? {} : { workspace }),
      );
      return got.ok ? ok(got.value.profileId) : err(got.error);
    },
    resetDefaultProfile: (preview) =>
      withConnection((c) => c.request("profile.default.reset", { preview })),
    async invocables(threadId) {
      const got = await withConnection((c) => c.request("plugin.invocables", { threadId }));
      return got.ok ? ok(got.value.entries) : err(got.error);
    },
    async pluginsInProfile(profileId) {
      const got = await withConnection((c) => c.request("plugin.list", { filter: { profileId } }));
      return got.ok ? ok(pluginSetOf(got.value.plugins, profileId)) : err(got.error);
    },
    async pluginCards() {
      const got = await withConnection((c) => c.request("plugin.list", {}));
      return got.ok ? ok(got.value.plugins) : err(got.error);
    },
    async recheckTools() {
      const got = await withConnection((c) => c.request("host.status", { includeBinaries: true }));
      return got.ok ? ok(null) : err(got.error);
    },
    async drafts(name) {
      const got = await withConnection((c) => c.request("plugin.draft.list", { name }));
      return got.ok ? ok(got.value.drafts) : err(got.error);
    },
    validateComposition: (composition) =>
      withConnection((c) => c.request("ext.validateComposition", { composition })),
    async kinds() {
      const got = await withConnection((c) => c.request("ext.kinds", {}));
      return got.ok ? ok(got.value.kinds) : err(got.error);
    },
    scaffold: (input) => withConnection((c) => c.request("ext.scaffold", input)),
    validateDir: (dir) => withConnection((c) => c.request("ext.validate", { dir })),
    packDir: (dir, out) =>
      withConnection((c) => c.request("ext.package", out === undefined ? { dir } : { dir, out })),
    versions: (name) => withConnection((c) => c.request("ext.versions", { name })),
    async rollback(name, version, clearState) {
      const done = await withConnection((c) =>
        c.request("ext.rollback", { name, version, ...(clearState ? { clearState } : {}) }),
      );
      return done.ok ? ok(done.value.appliesAt) : err(done.error);
    },
    async health() {
      const got = await withConnection((c) => c.request("ext.health", {}));
      return got.ok ? ok(got.value.health) : err(got.error);
    },
    async hooks(threadId) {
      const got = await withConnection((c) =>
        c.request("hooks.list", threadId === undefined ? {} : { threadId }),
      );
      return got.ok ? ok(got.value.hooks) : err(got.error);
    },
    async hookKeepOff(hook) {
      const done = await withConnection((c) => c.request("hooks.disableConfirm", { hook }));
      return done.ok ? ok(null) : err(done.error);
    },
    async hookReenable(hook) {
      const done = await withConnection((c) => c.request("hooks.reenable", { hook }));
      return done.ok ? ok(null) : err(done.error);
    },
    orderGet: () => withConnection((c) => c.request("hooks.order.get", {})),
    orderSet: (hook, order) => withConnection((c) => c.request("hooks.order.set", { hook, order })),
    orderReset: (hook) =>
      withConnection((c) => c.request("hooks.order.reset", hook === undefined ? {} : { hook })),
    orderPreview: (hook, order) =>
      withConnection((c) => c.request("hooks.order.preview", { hook, order })),
    trace: (threadId, turnId) =>
      withConnection((c) => c.request("trace.turn", { threadId, turnId })),
    async settings(name, threadId) {
      const listed = await Promise.all(
        extSettingPrefixes(name).map((prefix) =>
          withConnection((c) => c.request("settings.list", { prefix })),
        ),
      );
      const defs: SettingDefWire[] = [];
      for (const result of listed) {
        if (!result.ok) return err(result.error);
        defs.push(...result.value.defs);
      }
      if (defs.length === 0) return ok({ defs, values: [] });
      const got = await withConnection((c) =>
        c.request("settings.get", {
          keys: defs.map((def) => def.key),
          ...(threadId === undefined ? {} : { threadId }),
        }),
      );
      return got.ok ? ok({ defs, values: got.value.settings }) : err(got.error);
    },
    metrics: (id, threadId) =>
      withConnection((c) =>
        c.request("orchestration.metrics", threadId === undefined ? { id } : { id, threadId }),
      ),
    async views() {
      const got = await withConnection((c) => c.request("ext.ui.list", {}));
      return got.ok ? ok(got.value.items) : err(got.error);
    },
  };
}
