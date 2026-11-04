import { extSettingPrefixes, profileApplyRequestOf } from "@fresnel/client/workbench";
import { err, ok, parse, type Result } from "@fresnel/contracts";
import { ScopeHandlerFailedPayloadSchema } from "@fresnel/contracts/records";
import type { SettingDefWire } from "@fresnel/contracts/settings";
import type {
  EventsBatchParams,
  HostConnection,
  SettingsInvalidatedParams,
  StreamChunkParams,
} from "@fresnel/contracts/wire";
import type { CommandError, WorkbenchCommands } from "../views/commands.ts";

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

/** 목록을 다시 읽을 알림마다 `listener`를 부른다. 반환값은 구독 해제 */
export function subscribeExtChanges(
  connection: Pick<HostConnection, "onNotification">,
  listener: () => void,
): () => void {
  const offSettings = connection.onNotification("settings.invalidated", (params) => {
    if (isExtSettingsChange(params)) listener();
  });
  const offEvents = connection.onNotification("events.batch", (params) => {
    if (hasScopeChange(params)) listener();
  });
  const offChunks = connection.onNotification("stream.chunk", (params) => {
    if (asksDisable(params)) listener();
  });
  return () => {
    offSettings();
    offEvents();
    offChunks();
  };
}

export function createWorkbenchCommands(
  withConnection: WithConnection,
  subscribeChanges: (listener: () => void) => () => void,
): WorkbenchCommands {
  return {
    async list(threadId) {
      const listed = await withConnection((c) =>
        c.request("ext.list", threadId === undefined ? {} : { threadId }),
      );
      return listed.ok ? ok(listed.value.extensions) : err(listed.error);
    },
    onChanged: subscribeChanges,
    installPreview: (source) => withConnection((c) => c.request("ext.installPreview", { source })),
    install: (source, sha256) =>
      withConnection((c) => c.request("ext.install", { source, sha256 })),
    remove: (name) => withConnection((c) => c.request("ext.remove", { name })),
    bindings: (threadId) =>
      withConnection((c) => c.request("ext.bindings", threadId === undefined ? {} : { threadId })),
    async reload(name) {
      const done = await withConnection((c) => c.request("ext.reload", { name }));
      return done.ok ? ok(null) : err(done.error);
    },
    get: (name) => withConnection((c) => c.request("ext.get", { name })),
    async groups(threadId) {
      const got = await withConnection((c) => c.request("group.list", { threadId }));
      return got.ok ? ok(got.value.groups) : err(got.error);
    },
    driveLock: (threadId) => withConnection((c) => c.request("group.driveLock", { threadId })),
    timings: (name, threadId) =>
      withConnection((c) =>
        c.request("ext.timings", threadId === undefined ? { name } : { name, threadId }),
      ),
    explain: (key, threadId) =>
      withConnection((c) => c.request("settings.explain", { key, threadId })),
    async toggle(request) {
      const done = await withConnection((c) =>
        c.request("settings.set", {
          key: request.key,
          value: request.value,
          scope: request.scope,
        }),
      );
      return done.ok ? ok(null) : err(done.error);
    },
    // "다시 켜기"와 "켜 두기" 답. 켜짐을 설정에 먼저 써야 다음 시작에도 켜진 채다(끄기의 짝). 쓰기가 실패하면 켜기를 요청하지 않는다
    async reenable(name) {
      const saved = await withConnection((c) =>
        c.request("settings.set", { key: `ext.${name}.enabled`, value: true, scope: "user" }),
      );
      if (!saved.ok) return err(saved.error);
      const done = await withConnection((c) => c.request("ext.reenable", { name }));
      return done.ok ? ok(null) : err(done.error);
    },
    // "끄기" 답. 먼저 설정에 꺼짐을 써서 다음 시작에도 꺼진 채로 두고, 그다음 호스트가 auto_disable로 끈다(`ext.disableConfirm`).
    // 쓰기가 실패하면 끄기를 요청하지 않는다. 쓰기는 됐는데 `ext.disableConfirm`이 거절되면 설정을 켜짐으로 되돌린다:
    // 확장은 이번 실행에서 켜진 채인데 설정만 꺼져 있으면 질문도 사라지고(호스트가 설정 꺼짐을 "끈다" 답으로 본다) 재시작 때 갑자기 꺼진다.
    // 되돌리기도 실패하면 처음 오류를 돌려준다(되돌릴 수단이 더 없다)
    async keepOff(name) {
      const key = `ext.${name}.enabled`;
      const saved = await withConnection((c) =>
        c.request("settings.set", { key, value: false, scope: "user" }),
      );
      if (!saved.ok) return err(saved.error);
      const done = await withConnection((c) => c.request("ext.disableConfirm", { name }));
      if (done.ok) return ok(null);
      await withConnection((c) => c.request("settings.set", { key, value: true, scope: "user" }));
      return err(done.error);
    },
    async toggleForThread(request) {
      const done = await withConnection((c) =>
        c.request("settings.set", {
          key: request.key,
          value: request.value,
          scope: request.scope,
          threadId: request.threadId,
        }),
      );
      return done.ok ? ok(null) : err(done.error);
    },
    async profiles() {
      const got = await withConnection((c) => c.request("profile.list", {}));
      return got.ok ? ok(got.value.profiles) : err(got.error);
    },
    applyProfile: (id, threadId) =>
      withConnection((c) => c.request("profile.apply", profileApplyRequestOf(id, threadId))),
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
    async hooks() {
      const got = await withConnection((c) => c.request("hooks.list", {}));
      return got.ok ? ok(got.value.hooks) : err(got.error);
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
        c.request("group.metrics", threadId === undefined ? { id } : { id, threadId }),
      ),
    async views() {
      const got = await withConnection((c) => c.request("ext.ui.list", {}));
      return got.ok ? ok(got.value.items) : err(got.error);
    },
  };
}
