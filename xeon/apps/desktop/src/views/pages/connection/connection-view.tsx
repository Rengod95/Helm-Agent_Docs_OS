import type { TargetEntry } from "@fresnel/client";
import { t, type Locale } from "@fresnel/client/i18n";
import { updateLineKey } from "@fresnel/client/settings";
import {
  Button,
  Dialog,
  DialogAction,
  DialogClose,
  ListDescription,
  ListDescriptionRow,
} from "@caustic/react";
import { useId, type ReactNode } from "react";
import type { EngineState } from "../../../state/engine/index.ts";
import type { ConnectionState, TargetChoice } from "./connection-model.ts";
import {
  ConnectionSection,
  LocalServiceCard,
  ServiceModeRows,
  type DetailHandlers,
} from "./connection-status.tsx";
import { HostSection } from "./connection-host-section.tsx";
import type { HostFormValue } from "./host-address.ts";
import { ScreenHeader } from "../../shell/screen-header.tsx";

// 연결 화면(P-08)의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 한 열이고 내용은 720px 폭에 가운데 맞춘다. 맨 위는 "호스트" 섹션, 그 아래는 서비스 스위치 묶음, 이 기기 서비스 카드,
// 서버 모드 섹션(`serverSection`)이 같은 순서로 이어진다. 섹션 사이는 `gap-10`이다.

/** 화면 동작. 속성 형태로 둬서 시험이 빈 함수를 넣을 수 있다 */
export interface ConnectionScreenHandlers extends DetailHandlers {
  /** 그 행의 호스트로 연결한다(셸에 대상 바꾸기) */
  readonly connect: (choice: TargetChoice) => void;
  readonly query: (text: string) => void;
  readonly openForm: () => void;
  readonly closeForm: () => void;
  readonly formChange: (value: HostFormValue) => void;
  readonly submitForm: () => void;
  readonly removeAsk: (entry: TargetEntry) => void;
  readonly removeCancel: () => void;
  readonly removeConfirm: () => void;
  readonly renameOpen: (entry: TargetEntry) => void;
  readonly renameField: (label: string) => void;
  readonly renameSubmit: () => void;
  readonly renameCancel: () => void;
  readonly dismissNotice: () => void;
  readonly confirmStop: () => void;
}

const ROWS_CLASS =
  "rounded-none [--cs-size-list-term:8rem] [&_[data-slot=list-description-row]]:px-0";

export interface ConnectionScreenViewProps {
  readonly state: ConnectionState;
  readonly engine: EngineState | null;
  readonly locale: Locale;
  readonly handlers: ConnectionScreenHandlers;
  /** 서버 모드 섹션. 이 기기 대상일 때만 그린다(원격 대상에서는 그리지 않는다). 상태를 읽는 동안에도 그리지 않는다 */
  readonly serverSection?: ReactNode;
}

export function ConnectionScreenView(props: ConnectionScreenViewProps): ReactNode {
  const { state, engine, locale, handlers, serverSection } = props;
  const headingId = useId();
  // 이 기기의 서비스 쪽 덩어리(스위치, 서비스 카드, 서버 모드)는 이 기기 대상이고 상태를 읽은 뒤에만 보인다
  const serviceShown = state.engineTarget.kind === "local" && state.status.kind !== "loading";
  return (
    <section aria-labelledby={headingId} className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader title={t("desktop.connection.title")} titleId={headingId} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="mx-auto grid w-full max-w-180 gap-10">
          <HostSection state={state} engine={engine} locale={locale} handlers={handlers} />
          {serviceShown ? (
            <ConnectionSection title={t("desktop.connection.service.heading")}>
              <ServiceModeRows state={state} handlers={handlers} />
            </ConnectionSection>
          ) : null}
          {serviceShown ? (
            <ConnectionSection title={t("desktop.connection.service.card.title")}>
              <LocalServiceCard state={state} handlers={handlers} />
            </ConnectionSection>
          ) : null}
          {serviceShown ? serverSection : null}
          <p className="m-0 text-ui text-text-tertiary">
            {t(updateLineKey({ state: "unchecked" }))}
          </p>
        </div>
      </div>
      <StopDialog state={state} handlers={handlers} />
    </section>
  );
}

function StopDialog(props: {
  readonly state: ConnectionState;
  readonly handlers: ConnectionScreenHandlers;
}): ReactNode {
  const { state, handlers } = props;
  const host = state.status.kind === "ready" ? state.status.snapshot.host : null;
  const connections = host === null ? 0 : host.connections;
  const liveTurns = host === null ? 0 : host.liveTurns;
  return (
    <Dialog
      kind="alert"
      size="sm"
      tone="danger"
      open={state.stopConfirm}
      onOpenChange={(open) => {
        if (!open) handlers.setStopConfirm(false);
      }}
      title={t("desktop.connection.stopDialog.title")}
      description={t("desktop.connection.stopDialog.body", { count: connections })}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.connection.stopDialog.keep")}
            </Button>
          </DialogClose>
          <DialogAction onClick={handlers.confirmStop}>
            {t("desktop.connection.stopDialog.confirm")}
          </DialogAction>
        </>
      }
    >
      <ListDescription variant="ghost" size="sm" className={ROWS_CLASS}>
        <ListDescriptionRow term={t("desktop.connection.status.liveTurns")}>
          {liveTurns}
        </ListDescriptionRow>
      </ListDescription>
    </Dialog>
  );
}
