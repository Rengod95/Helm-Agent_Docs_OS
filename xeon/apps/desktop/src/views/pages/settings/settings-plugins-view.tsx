import { t } from "@fresnel/client/i18n";
import {
  extNameOf,
  INITIAL_WORKBENCH,
  rowOf,
  toggleRequestOf,
  type ExtRowVM,
} from "@fresnel/client/workbench";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { Alert, Button, Skeleton, Switch } from "@caustic/react";
import { useEffect, useState, type ReactNode } from "react";
import { useLinkPhase } from "../../../state/engine/index.ts";
import { useCommands } from "../../commands.ts";
import { detachVoid } from "../../workbench/controller.ts";
import { ExtName, stateText } from "../../workbench/ext-row.tsx";
import { originText } from "../../workbench/trust-dialog.tsx";
import { SettingSection } from "./settings-section.tsx";

// 설정 "플러그인과 그룹" 탭 맨 위의 실행 화면(시안 p13-plugins): 플러그인 그룹과 플러그인 목록을 이름·출처·상태·스위치 한 줄씩 보인다.
// 값은 `workbench.list`(확장 목록 알림마다 다시 읽는다)이고, 스위치는 크래프트와 같은 `workbench.toggle`로 쓴다.
// 이 탭은 전에도 `ext.<이름>.enabled` 키를 신뢰 확인 없이 썼으므로 같은 동작을 둔다(신뢰 확인은 확장 화면의 일이다).
// 시안의 "이 대화" 구역, 그룹 만들기, 핸들러 실패 기록은 이 탭에 쓸 데이터 경로가 아직 없어 두지 않았다.

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly rev: number; readonly entries: readonly ExtListEntry[] };

const MUTED = "text-ui-sm text-text-tertiary";

function Row(props: {
  readonly entry: ExtListEntry;
  readonly row: ExtRowVM;
  readonly busy: boolean;
  readonly onToggle: (name: string, target: boolean) => void;
}): ReactNode {
  const { entry, row } = props;
  return (
    <div className="flex min-h-8 min-w-0 items-center gap-2.5 py-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-ui font-medium text-text-primary">
          <ExtName row={row} />
        </span>
        <span className={MUTED}>{originText(entry.origin)}</span>
        {row.state === "on" || row.state === "off" ? null : (
          <span className={MUTED}>{stateText(row.state)}</span>
        )}
      </div>
      <Switch
        size="sm"
        checked={row.on}
        disabled={row.lock !== null || props.busy}
        aria-label={t("desktop.settings.plugins.switch", { name: extNameOf(entry) })}
        onCheckedChange={(target) => {
          props.onToggle(entry.name, target);
        }}
      />
    </div>
  );
}

/** 그림. 읽는 중이면 Skeleton, 실패하면 오류 한 줄이다 */
function PluginsPanelView(props: {
  readonly load: Load;
  readonly busy: ReadonlySet<string>;
  readonly onToggle: (name: string, target: boolean) => void;
  readonly onReload: () => void;
}): ReactNode {
  const reload = (
    <Button size="xs" variant="ghost" onClick={props.onReload}>
      {t("desktop.settings.plugins.reload")}
    </Button>
  );
  if (props.load.kind === "error") {
    return (
      <Alert tone="danger" layout="inline" action={reload}>
        {t("desktop.settings.plugins.loadFailed")}
      </Alert>
    );
  }
  if (props.load.kind === "loading") return <Skeleton height={48} />;
  const entries = props.load.entries;
  const draw = (list: readonly ExtListEntry[], empty: string): ReactNode =>
    list.length === 0 ? (
      <p className={`m-0 ${MUTED}`}>{empty}</p>
    ) : (
      list.map((entry) => (
        <Row
          key={entry.name}
          entry={entry}
          row={rowOf(entry, {})}
          busy={props.busy.has(entry.name)}
          onToggle={props.onToggle}
        />
      ))
    );
  return (
    <>
      <SettingSection title={t("desktop.settings.plugins.groups")} end={reload}>
        {draw(
          entries.filter((e) => e.isGroup),
          t("desktop.settings.plugins.groups.empty"),
        )}
      </SettingSection>
      <SettingSection title={t("desktop.settings.plugins.plugins")}>
        {draw(
          entries.filter((e) => !e.isGroup),
          t("desktop.settings.plugins.plugins.empty"),
        )}
      </SettingSection>
    </>
  );
}

export function PluginsPanel(): ReactNode {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  // 다시 읽기 신호. 단추, 쓰기 끝, 확장 목록 알림이 올린다
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!live) return undefined;
    return commands.workbench.onChanged(() => {
      setTick((n) => n + 1);
    });
  }, [commands, live]);
  useEffect(() => {
    if (!live) return undefined;
    let stale = false;
    const read = async (): Promise<void> => {
      const listed = await commands.workbench.list();
      if (stale) return;
      setLoad(listed.ok ? { kind: "ready", rev: tick, entries: listed.value } : { kind: "error" });
    };
    detachVoid(read());
    return () => {
      stale = true;
    };
  }, [commands, live, tick]);
  const onToggle = (name: string, target: boolean): void => {
    if (load.kind !== "ready") return;
    const plan = toggleRequestOf({ ...INITIAL_WORKBENCH, entries: load.entries }, name, target);
    if (!plan.ok) return;
    setBusy((prev) => new Set([...prev, name]));
    const write = async (): Promise<void> => {
      await commands.workbench.toggle(plan.request);
      setBusy((prev) => new Set([...prev].filter((n) => n !== name)));
      setTick((n) => n + 1);
    };
    detachVoid(write());
  };
  return (
    <PluginsPanelView
      load={load}
      busy={busy}
      onToggle={onToggle}
      onReload={() => {
        setTick((n) => n + 1);
      }}
    />
  );
}
