import { Alert, Switch, toast } from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { InfoTip } from "../../craft/info-tip.tsx";
import { useDesktopShell } from "../../desktop-shell-context.ts";
import type { NotifyStatus, NotifyStatusStore } from "../../os-notify.ts";
import { permissionViewOf, type NotifyCategory, type NotifyPrefs } from "../../os-notify-model.ts";
import type { NotifyPrefsPort } from "../../os-notify-prefs.ts";
import { SettingSection } from "./settings-section.tsx";

// 설정 "실행과 서비스" 탭 맨 위의 OS 알림 묶음(B-10, d02 `NotifySettings`). 종류마다 켜고 끄는 스위치 셋이고,
// 설명은 정보 아이콘 뒤에 둔다. 마지막 전달이 실패했거나 권한이 막혔으면 경고 한 줄을 위에 보인다.
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
  return <NotifyPanelBound prefs={shell.prefs} store={shell.notifier.status} />;
}

function NotifyPanelBound(props: {
  readonly prefs: NotifyPrefsPort;
  readonly store: NotifyStatusStore;
}): ReactNode {
  const { prefs: port, store } = props;
  // 서버 렌더(시험)도 같은 상태를 읽으므로 서버 스냅숏으로 `get`을 함께 준다
  const status = useSyncExternalStore(store.subscribe, store.get, store.get);
  const [prefs, setPrefs] = useState<NotifyPrefs>(() => port.get());
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
  return <NotifyPanelView prefs={prefs} status={status} onChange={onChange} />;
}

export interface NotifyPanelViewProps {
  readonly prefs: NotifyPrefs;
  readonly status: NotifyStatus;
  readonly onChange: (category: NotifyCategory, on: boolean) => void;
}

export function NotifyPanelView(props: NotifyPanelViewProps): ReactNode {
  const { prefs, status, onChange } = props;
  const view = permissionViewOf(status.permission, status.lastDeliveryFailed);
  return (
    <div data-slot="settings-notify" data-notify-state={view.kind}>
      <SettingSection title={t("desktop.notifySettings.label")}>
        {view.kind === "denied" || view.kind === "failed" ? (
          <Alert tone="warning" size="sm">
            {t(view.text)}
          </Alert>
        ) : null}
        {ROWS.map((row) => (
          <div key={row.category} className="flex items-center justify-between gap-3 py-3">
            <span className="flex items-center gap-2 text-body text-text-primary">
              {t(row.label)}
              <InfoTip text={t(row.info)} />
            </span>
            <Switch
              size="sm"
              aria-label={t(row.label)}
              checked={prefs[row.category]}
              onCheckedChange={(on) => {
                onChange(row.category, on);
              }}
            />
          </div>
        ))}
        <div className="grid gap-1 pt-3">
          {view.kind === "prompt" || view.kind === "unknown" ? (
            <p className="text-ui-sm text-text-tertiary">{t(view.text)}</p>
          ) : null}
          <p className="text-ui-sm text-text-tertiary">{t("desktop.notifySettings.focusOnly")}</p>
        </div>
      </SettingSection>
    </div>
  );
}
