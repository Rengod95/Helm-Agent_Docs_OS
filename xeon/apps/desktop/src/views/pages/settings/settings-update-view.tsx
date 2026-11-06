import { Button, ListDescription, ListDescriptionRow } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { useSyncExternalStore, type ReactNode } from "react";
import { useUpdate } from "../../update-context.ts";
import type { UpdateController } from "../../update-controller.ts";
import { ROWS_CLASS } from "./settings-overview.tsx";
import { canCheck, updateLineOf, type UpdateState } from "../../update-model.ts";

// 설정 개요 탭 맨 위의 업데이트 줄(B-10). 현재 버전, 상태 문구, "업데이트 확인" 단추를 한 줄에 둔다.
// 설정이 안 됐으면 단추를 숨기고 상태 문구 한 줄만 보인다. 웹에는 업데이트 문맥이 없어 `UpdatePanel`이 아무것도 그리지 않는다.
// 그림은 `UpdateLineView`가 그리고, 문맥과 구독은 `UpdatePanel`이 잇는다.

export function UpdatePanel(): ReactNode {
  const controller = useUpdate();
  if (controller === null) return null;
  return <UpdateLine controller={controller} />;
}

function UpdateLine(props: { readonly controller: UpdateController }): ReactNode {
  const { controller } = props;
  // 서버 렌더(시험)도 같은 상태를 읽으므로 서버 스냅숏으로 `getState`를 함께 준다
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  return (
    <UpdateLineView
      state={state}
      currentVersion={controller.currentVersion()}
      onCheck={() => {
        detach(controller.check(), rethrow);
      }}
    />
  );
}

export interface UpdateLineViewProps {
  readonly state: UpdateState;
  /** 지금 실행 중인 버전. 아직 모르면 `null`이다 */
  readonly currentVersion: string | null;
  readonly onCheck: () => void;
}

export function UpdateLineView(props: UpdateLineViewProps): ReactNode {
  const { state, currentVersion, onCheck } = props;
  const line = updateLineOf(state);
  const status = (
    <span role="status" className="text-ui-sm text-text-secondary">
      {t(line.text, line.args)}
    </span>
  );
  // 다른 개요 행처럼 라벨(term)은 왼쪽 열, 값은 오른쪽 열이다. 단추 줄은 정보 목록 아래에 같은 간격으로 둔다(rtE R-6a)
  const rows = (
    <ListDescription
      variant="ghost"
      size="xs"
      aria-label={t("desktop.update.line.title")}
      className={ROWS_CLASS}
    >
      <ListDescriptionRow term={t("desktop.update.line.title")}>
        <span className="flex min-w-0 flex-col gap-0.5">
          {currentVersion === null || state.kind === "unconfigured" ? null : (
            <span className="text-ui-sm text-text-tertiary tabular-nums">
              {t("desktop.update.line.version", { version: currentVersion })}
            </span>
          )}
          {status}
        </span>
      </ListDescriptionRow>
    </ListDescription>
  );
  if (state.kind === "unconfigured") {
    return (
      <div data-slot="settings-update" data-update-state={state.kind}>
        {rows}
      </div>
    );
  }
  return (
    <div className="grid gap-2" data-slot="settings-update" data-update-state={state.kind}>
      {rows}
      <div>
        <Button
          variant="outline"
          size="sm"
          loading={state.kind === "checking"}
          disabled={!canCheck(state)}
          onClick={onCheck}
        >
          {t("desktop.update.check.button")}
        </Button>
      </div>
    </div>
  );
}
