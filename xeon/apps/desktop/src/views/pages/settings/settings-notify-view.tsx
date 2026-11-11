import { Button, Switch, toast } from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useDesktopShell } from "../../desktop-shell-context.ts";
import type { NotifyOutcome, NotifyStatus, OsNotifier } from "../../os-notify.ts";
import {
  permissionViewOf,
  type NotifyCategory,
  type NotifyPrefs,
  type PermissionKind,
} from "../../os-notify-model.ts";
import type { StatusDot } from "../../status-cell.tsx";
import { StatusBand } from "../shared/status-band.tsx";
import type { NotifyPrefsPort } from "../../os-notify-prefs.ts";
import { FORM_CONTROL_SIZE, SettingRow, SettingSection } from "./settings-section.tsx";

// 설정 "알림" 구역(B-10, DP-87 [결정: 2026-11-11 사용자]). 맨 위 권한 띠가 지금 알림을 보낼 수 있는지와 고치는 동작
// (시험 알림 보내기, 허락 요청, 다시 확인)을 한 덩어리로 보이고, 아래 카드가 종류마다 켜고 끄는 스위치 셋이다.
// 권한은 구역이 열릴 때 읽는다(`OsNotifier.probe`). 시험 알림은 창이 앞에 있어도 보낸다.
// 값은 로컬 설정(`LOCAL`)에 저장한다. 웹에는 문맥이 없어 `NotifyPanel`이 아무것도 그리지 않는다.
// 그림은 `NotifyPanelView`가 그리고, 문맥과 구독은 `NotifyPanel`이 잇는다.

const ROWS: readonly {
  readonly category: NotifyCategory;
  readonly label: MessageId;
  readonly info: MessageId;
}[] = [
  {
    category: "turnDone",
    label: "desktop.notifySettings.turnDone",
    info: "desktop.notifySettings.turnDone.info",
  },
  {
    category: "approval",
    label: "desktop.notifySettings.approval",
    info: "desktop.notifySettings.approval.info",
  },
  {
    category: "scheduleFailed",
    label: "desktop.notifySettings.scheduleFailed",
    info: "desktop.notifySettings.scheduleFailed.info",
  },
];

export function NotifyPanel(): ReactNode {
  const shell = useDesktopShell();
  if (shell === null) return null;
  return <NotifyPanelBound prefs={shell.prefs} notifier={shell.notifier} />;
}

function NotifyPanelBound(props: {
  readonly prefs: NotifyPrefsPort;
  readonly notifier: OsNotifier;
}): ReactNode {
  const { prefs: port, notifier } = props;
  const store = notifier.status;
  // 서버 렌더(시험)도 같은 상태를 읽으므로 서버 스냅숏으로 `get`을 함께 준다
  const status = useSyncExternalStore(store.subscribe, store.get, store.get);
  const [prefs, setPrefs] = useState<NotifyPrefs>(() => port.get());
  const [test, setTest] = useState<NotifyTest>({ kind: "idle" });
  // 구역이 열리면 권한을 읽는다(요청은 하지 않는다). 읽기 전에는 "아직 모름"이 고정되어 있었다(F10)
  useEffect(() => {
    detach(notifier.probe(), rethrow);
  }, [notifier]);
  const onChange = (category: NotifyCategory, on: boolean): void => {
    const before = prefs;
    setPrefs({ ...before, [category]: on });
    const save = async (): Promise<void> => {
      const saved = await port.set(category, on);
      // 저장하지 못하면 켜고 끈 값을 되돌리고 알린다
      if (saved) return;
      setPrefs(before);
      toast({ tone: "danger", title: t("desktop.notifySettings.saveFailed") });
    };
    detach(save(), rethrow);
  };
  const onTest = (): void => {
    setTest({ kind: "sending" });
    detach(
      notifier
        .sendTest(t("desktop.notifySettings.test.title"), t("desktop.notifySettings.test.body"))
        .then((outcome) => {
          setTest({ kind: "sent", outcome });
          return null;
        }),
      rethrow,
    );
  };
  return (
    <NotifyPanelView
      prefs={prefs}
      status={status}
      test={test}
      onChange={onChange}
      onTest={onTest}
      onRequest={() => {
        detach(notifier.request(), rethrow);
      }}
      onRecheck={() => {
        detach(notifier.probe(), rethrow);
      }}
    />
  );
}

/** 시험 알림의 진행. 보낸 뒤에는 결과가 남는다 */
type NotifyTest =
  | { readonly kind: "idle" }
  | { readonly kind: "sending" }
  | { readonly kind: "sent"; readonly outcome: NotifyOutcome };

export interface NotifyPanelViewProps {
  readonly prefs: NotifyPrefs;
  readonly status: NotifyStatus;
  readonly test?: NotifyTest | undefined;
  readonly onChange: (category: NotifyCategory, on: boolean) => void;
  readonly onTest?: (() => void) | undefined;
  readonly onRequest?: (() => void) | undefined;
  readonly onRecheck?: (() => void) | undefined;
}

/** 권한 띠의 모양: 점, 제목, 주 동작 */
const BAND: Readonly<
  Record<
    PermissionKind,
    {
      readonly tone: StatusDot;
      readonly title: MessageId;
      readonly action: "test" | "request" | "recheck";
    }
  >
> = {
  ok: { tone: "success", title: "desktop.notifySettings.band.ok", action: "test" },
  denied: { tone: "danger", title: "desktop.notifySettings.band.denied", action: "test" },
  failed: { tone: "warning", title: "desktop.notifySettings.band.failed", action: "test" },
  prompt: { tone: "neutral", title: "desktop.notifySettings.band.prompt", action: "request" },
  unknown: { tone: "neutral", title: "desktop.notifySettings.band.unknown", action: "recheck" },
};

const OUTCOME_TEXT: Readonly<Record<NotifyOutcome, MessageId>> = {
  shown: "desktop.notifySettings.test.shown",
  denied: "desktop.notifySettings.test.denied",
  failed: "desktop.notifySettings.test.failed",
};

/**
 * 알림 구역(DP-87): 맨 위 권한 띠(상태 점 · 제목 · 설명 · 시험 알림/허락 요청/다시 확인 단추 · 시험 결과),
 * 아래 "보낼 알림" 카드(종류별 스위치 셋). 앱이 앞에 있을 때는 보내지 않는다는 말은 그 카드의 설명이다.
 */
export function NotifyPanelView(props: NotifyPanelViewProps): ReactNode {
  const { prefs, status, onChange } = props;
  const view = permissionViewOf(status.permission, status.lastDeliveryFailed);
  const band = BAND[view.kind];
  const test = props.test ?? { kind: "idle" };
  const action =
    band.action === "test" ? (
      <Button
        variant="outline"
        size={FORM_CONTROL_SIZE}
        loading={test.kind === "sending"}
        disabled={props.onTest === undefined}
        onClick={props.onTest}
      >
        {t("desktop.notifySettings.test.button")}
      </Button>
    ) : band.action === "request" ? (
      <Button
        variant="outline"
        size={FORM_CONTROL_SIZE}
        disabled={props.onRequest === undefined}
        onClick={props.onRequest}
      >
        {t("desktop.notifySettings.request.button")}
      </Button>
    ) : (
      <Button
        variant="outline"
        size={FORM_CONTROL_SIZE}
        disabled={props.onRecheck === undefined}
        onClick={props.onRecheck}
      >
        {t("desktop.notifySettings.recheck.button")}
      </Button>
    );
  return (
    <div data-slot="settings-notify" data-notify-state={view.kind}>
      <SettingSection title={t("desktop.notifySettings.permission.title")} body="rows">
        <StatusBand
          slot="settings-notify-band"
          state={view.kind}
          tone={band.tone}
          title={t(band.title)}
          description={t(view.text)}
          actions={action}
          result={
            test.kind === "sent" ? (
              <span data-notify-test={test.outcome}>{t(OUTCOME_TEXT[test.outcome])}</span>
            ) : undefined
          }
        />
      </SettingSection>
      <SettingSection
        title={t("desktop.notifySettings.label")}
        description={t("desktop.notifySettings.focusOnly")}
      >
        {ROWS.map((row) => (
          <SettingRow
            key={row.category}
            label={t(row.label)}
            info={t(row.info)}
            control={
              <Switch
                size={FORM_CONTROL_SIZE}
                aria-label={t(row.label)}
                checked={prefs[row.category]}
                onCheckedChange={(on) => {
                  onChange(row.category, on);
                }}
              />
            }
          />
        ))}
      </SettingSection>
    </div>
  );
}
