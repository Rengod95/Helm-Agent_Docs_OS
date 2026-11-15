// 이 기기의 서비스가 이 앱과 다른 엔진 빌드일 때의 알림(L4.desktop.spec 엔진 빌드 비교). 셸이 앱을 열 때 서비스를 맞추고(한가하면 새 빌드로 다시 띄운다),
// 결과는 `service_status`의 `engineReplaced`, `engineOutdated`로 읽는다. 엔진과 연결이 live가 될 때마다 한 번만 읽는다(폴링하지 않는다, FS-22 `watch`).
// 다시 시작 필요 목록은 엔진이 돌아오면 `watchEngineReturn`이 비우고, 이 감시는 그 뒤에도 여전히 옛 엔진이면 다시 올린다.
import type { Result } from "@fresnel/contracts";
import type { EngineMirror, ReadonlyStore } from "../state/engine/index.ts";
import { watch } from "../state/shared/index.ts";
import type { UiStore } from "../state/ui/index.ts";
import type { IpcError, ServiceStatusReply } from "../transport/ipc.ts";
import { stageOf } from "./restart-needed.ts";

export function watchServiceEngine(deps: {
  readonly engine: ReadonlyStore<Pick<EngineMirror, "engine" | "link">>;
  readonly ui: UiStore;
  readonly serviceStatus: () => Promise<Result<ServiceStatusReply, IpcError>>;
  /** 서비스를 새 빌드로 다시 띄웠다는 알림을 한 번 띄운다 */
  readonly onReplaced: () => void;
  readonly report: (cause: unknown) => void;
}): () => void {
  const read = async (): Promise<void> => {
    // 대상이 원격이면 이 기기의 서비스와 상관없다
    if (deps.ui.read.getState().engineTarget.kind !== "local") return;
    const status = await deps.serviceStatus();
    if (!status.ok || !status.value.running) return;
    if (status.value.engineReplaced === true) deps.onReplaced();
    if (status.value.engineOutdated === true) {
      deps.ui.actions.noteRestartNeeded({ kind: "engine_outdated", name: "" });
    }
  };
  return watch(
    deps.engine,
    (s) => stageOf(s.engine, s.link.phase),
    (stage) => {
      if (stage !== "live") return;
      read().catch(deps.report);
    },
    deps.report,
  );
}
