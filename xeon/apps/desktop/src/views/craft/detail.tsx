// 플러그인·그룹 자세히 보기. 캔버스 전체를 이 대상 하나로 바꾼다(state.detail이 id다). 가운데는 한 턴의 생명선,
// 옆은 상태(켜짐 스위치 하나)·구성·설정·버전·코드. 표가 많은 화면이라 배경 셰이더는 없다.
import { t, type MessageId } from "@fresnel/client/i18n";
import type { CanvasPlugin, CanvasSnapshot, Origin } from "@fresnel/client/workbench/canvas";
import { isOn } from "@fresnel/client/workbench/canvas";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  Button,
  Card,
  Chip,
  EmptyState,
  SectionHeader,
  SegmentedControl,
  SegmentedControlItem,
  Switch,
} from "@caustic/react";
import { ChevronLeft } from "@caustic/react/icons";
import { attemptAsync, detach, rethrow } from "@fresnel/contracts";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useCraft, type CraftMode } from "./craft-context.tsx";
import { Lifeline } from "./detail-flow.tsx";
import {
  codeOf,
  failLimitOf,
  membersOfTarget,
  originOf,
  switchNameOf,
  switchOf,
  targetOf,
  versionOf,
  type DetailTarget,
  type SwitchModel,
} from "./detail-model.ts";
import { Mark, shapeOf } from "./marks.tsx";
import { Provides } from "./provides.tsx";
import { columnsFor, loadRuns, type Column, type RunsLoad } from "./turn-flow.ts";

type DetailMode = "example" | "recent";

/** 최근 실행 칸의 상태. loading은 아직 읽는 중이다(읽기 결과가 없다) */
export type RunsView = RunsLoad | { readonly k: "loading" };

const LABEL = "text-footnote text-text-tertiary";

const BACK_LABEL: Record<CraftMode, MessageId> = {
  orbit: "desktop.craft.detail.back.orbit",
  strata: "desktop.craft.detail.back.strata",
  link: "desktop.craft.detail.back.link",
};

const ORIGIN_LABEL: Record<Origin, MessageId> = {
  builtin: "desktop.craft.detail.origin.builtin",
  user: "desktop.craft.detail.origin.user",
  project: "desktop.craft.detail.origin.project",
};

export function Detail(): ReactNode {
  const { source, state, dispatch } = useCraft();
  const id = state.detail;
  const target = useMemo(() => targetOf(source.snapshot, id), [source.snapshot, id]);
  const members = useMemo(() => (target === null ? [] : membersOfTarget(target)), [target]);
  const columns = useMemo(
    () => columnsFor(members, source.snapshot, source.order),
    [members, source.snapshot, source.order],
  );
  const memberKey = members.map((p) => p.id).join("\n");
  const [mode, setMode] = useState<DetailMode>("example");
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly load: RunsLoad } | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [switchFailed, setSwitchFailed] = useState(false);
  const recent = mode === "recent";

  // 최근 실행은 "최근 실행"을 고른 때만 읽는다. 읽기가 거부되면 loadRuns가 error 값으로 돌려준다.
  useEffect(() => {
    if (!recent) return undefined;
    let live = true;
    detach(
      loadRuns(source, members).then((load) => {
        if (live) setLoaded({ key: memberKey, load });
        return undefined;
      }),
      rethrow,
    );
    return () => {
      live = false;
    };
  }, [recent, source, members, memberKey]);

  if (id === null) return null;

  const runs: RunsView =
    loaded !== null && loaded.key === memberKey ? loaded.load : { k: "loading" };

  // 켜기·끄기는 그룹 단위 하나다(15-1). 대상 id는 toggleTargets가 정한다.
  const onSwitch = (on: boolean): void => {
    if (target === null) return;
    const ids = switchOf(source.snapshot, target).targets;
    setPending(true);
    setSwitchFailed(false);
    detach(
      attemptAsync(() => source.setOn(ids, on)).then((got) => {
        setPending(false);
        if (!got.ok) setSwitchFailed(true);
        return undefined;
      }),
      rethrow,
    );
  };

  return (
    <DetailView
      snapshot={source.snapshot}
      target={target}
      columns={columns}
      back={state.mode}
      mode={mode}
      runs={runs}
      pending={pending}
      switchFailed={switchFailed}
      onBack={() => {
        dispatch({ t: "detail", id: null });
      }}
      onMode={(next) => {
        setMode(next);
      }}
      onScope={(next) => {
        dispatch({ t: "detail", id: next });
      }}
      onSwitch={onSwitch}
    />
  );
}

export interface DetailViewProps {
  readonly snapshot: CanvasSnapshot;
  /** null이면 대상을 찾지 못한 것이다 */
  readonly target: DetailTarget | null;
  readonly columns: readonly Column[];
  /** 돌아갈 보기(순서·지도·링크). 뒤로 가기 글이 이것으로 정해진다 */
  readonly back: CraftMode;
  readonly mode: DetailMode;
  readonly runs: RunsView;
  readonly pending: boolean;
  readonly switchFailed: boolean;
  readonly onBack: () => void;
  readonly onMode: (mode: DetailMode) => void;
  readonly onScope: (id: string) => void;
  readonly onSwitch: (on: boolean) => void;
}

export function DetailView(props: DetailViewProps): ReactNode {
  const { snapshot, target } = props;
  const nameOf = (id: string): string => snapshot.plugins.find((p) => p.id === id)?.name ?? id;
  const header = (
    <Button size="md" variant="outline" iconStart={<ChevronLeft />} onClick={props.onBack}>
      {t(BACK_LABEL[props.back])}
    </Button>
  );
  if (target === null) {
    return (
      <section
        aria-label={t("desktop.craft.detail.missing.title")}
        className="flex h-full min-h-0 flex-col bg-surface-base"
      >
        <header className="flex h-14 flex-none items-center ps-4 pe-12">{header}</header>
        <EmptyState surface="none" title={t("desktop.craft.detail.missing.title")} />
      </section>
    );
  }
  const grouped = target.k === "group";
  const title = target.k === "group" ? target.group.name : target.plugin.name;
  const role = target.k === "group" ? target.group.role : target.plugin.role;
  const members = membersOfTarget(target);
  const sw = switchOf(snapshot, target);
  // 그룹에 속한 플러그인을 열었을 때만 범위를 고를 수 있다(그룹 전체로 넓히기)
  const scope =
    target.k === "plugin" && target.group !== undefined
      ? { plugin: target.plugin, group: target.group }
      : undefined;
  const kindText =
    target.k === "group"
      ? t("desktop.craft.detail.kind.group")
      : target.group === undefined
        ? t("desktop.craft.detail.kind.single")
        : t("desktop.craft.detail.kind.member", { group: target.group.name });
  const marks = props.mode === "recent" && props.runs.k === "ready" ? props.runs.byPlugin : null;
  const failing = members.flatMap((p) =>
    p.health === undefined
      ? []
      : [{ id: p.id, name: p.name, hook: p.health.hook, text: p.health.text }],
  );
  return (
    <section
      aria-label={t("desktop.craft.detail.label", { title })}
      className="flex h-full min-h-0 flex-col bg-surface-base"
    >
      <header className="flex min-h-14 flex-none flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-subtle py-2 ps-4 pe-12">
        {header}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {target.k === "group" ? (
            <span
              aria-hidden
              className="size-3 flex-none rounded-full"
              style={{ background: "var(--cs-color-info-border-strong)" }}
            />
          ) : (
            <Mark
              shape={shapeOf(target.plugin.layer)}
              size={22}
              group={target.group !== undefined}
              on={isOn(target.plugin)}
              failing={target.plugin.health !== undefined}
              autoOff={target.plugin.health?.autoOff === true}
            />
          )}
          <h2 className="m-0 truncate text-title-2 text-text-primary">{title}</h2>
          <Chip
            size="md"
            tone={target.k === "plugin" && target.group === undefined ? "neutral" : "info"}
            variant={target.k === "plugin" && target.group === undefined ? "outline" : "soft"}
          >
            {kindText}
          </Chip>
          {role !== undefined && (
            <span className="truncate text-body text-text-secondary">{role}</span>
          )}
        </div>
        {scope !== undefined && (
          <SegmentedControl
            aria-label={t("desktop.craft.detail.scope.label")}
            radius="lg"
            className="flex-none"
            value="plugin"
            onValueChange={(next) => {
              if (next === "group") props.onScope(scope.group.id);
            }}
          >
            <SegmentedControlItem value="plugin">
              {t("desktop.craft.detail.scope.plugin", { name: scope.plugin.name })}
            </SegmentedControlItem>
            <SegmentedControlItem value="group">
              {t("desktop.craft.detail.scope.group", { name: scope.group.name })}
            </SegmentedControlItem>
          </SegmentedControl>
        )}
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_20rem] gap-6 ps-4 pe-12 pt-4">
        <div className="min-h-0 overflow-y-auto pb-6 pe-1">
          <SectionHeader
            headingLevel={3}
            size="sm"
            title={t("desktop.craft.detail.flow.title")}
            className="mb-3"
            action={
              <SegmentedControl
                aria-label={t("desktop.craft.detail.mode.label")}
                radius="lg"
                value={props.mode}
                onValueChange={(next) => {
                  props.onMode(next === "recent" ? "recent" : "example");
                }}
              >
                <SegmentedControlItem value="example">
                  {t("desktop.craft.detail.mode.example")}
                </SegmentedControlItem>
                <SegmentedControlItem value="recent">
                  {t("desktop.craft.detail.mode.recent")}
                </SegmentedControlItem>
              </SegmentedControl>
            }
          />
          {failing.length > 0 && (
            <Alert
              tone="danger"
              size="sm"
              radius="lg"
              className="mb-2"
              actions={
                props.mode === "recent"
                  ? undefined
                  : [
                      {
                        label: t("desktop.craft.detail.failing.open"),
                        onClick: () => {
                          props.onMode("recent");
                        },
                      },
                    ]
              }
            >
              {failing.map((f) => (
                <span key={f.id} className="block">
                  {f.hook === undefined
                    ? t("desktop.craft.detail.failing.itemPlain", { name: f.name, text: f.text })
                    : t("desktop.craft.detail.failing.item", {
                        name: f.name,
                        hook: f.hook,
                        text: f.text,
                      })}
                </span>
              ))}
            </Alert>
          )}
          {props.mode === "recent" && <RecentNote runs={props.runs} />}
          <Lifeline columns={props.columns} grouped={grouped} nameOf={nameOf} marks={marks} />
        </div>
        <Aside
          target={target}
          members={members}
          sw={sw}
          pending={props.pending}
          switchFailed={props.switchFailed}
          onSwitch={props.onSwitch}
        />
      </div>
    </section>
  );
}

/** 최근 실행 칸 위의 한 줄: 계측이 꺼졌거나, 읽는 중이거나, 읽지 못했거나, 기록이 없을 때 */
function RecentNote({ runs }: { readonly runs: RunsView }): ReactNode {
  if (runs.k === "loading") {
    return (
      <p role="status" className={`mb-2 ${LABEL}`}>
        {t("desktop.craft.detail.recent.loading")}
      </p>
    );
  }
  // 계측이 꺼져 있으면 숫자를 보이지 않는다. 생명선 모양만 아래에 남는다.
  if (runs.k === "locked") {
    return (
      <Alert tone="neutral" size="sm" radius="lg" className="mb-2">
        {t("desktop.craft.detail.recent.locked")}
      </Alert>
    );
  }
  if (runs.k === "error") {
    return (
      <Alert tone="danger" size="sm" radius="lg" className="mb-2">
        {t("desktop.craft.detail.recent.error")}
      </Alert>
    );
  }
  const none = [...runs.byPlugin.values()].every((m) => m.size === 0);
  if (!none) return null;
  return (
    <Alert tone="neutral" size="sm" radius="lg" className="mb-2">
      {t("desktop.craft.detail.recent.none")}
    </Alert>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Card variant="soft" radius="lg">
      <h3 className="m-0 text-footnote text-text-tertiary">{title}</h3>
      {children}
    </Card>
  );
}

function Aside({
  target,
  members,
  sw,
  pending,
  switchFailed,
  onSwitch,
}: {
  readonly target: DetailTarget;
  readonly members: readonly CanvasPlugin[];
  readonly sw: SwitchModel;
  readonly pending: boolean;
  readonly switchFailed: boolean;
  readonly onSwitch: (on: boolean) => void;
}): ReactNode {
  const [codeOpen, setCodeOpen] = useState(false);
  const on = sw.total > 0 && sw.onCount === sw.total;
  const partial = sw.total > 1 && sw.onCount > 0 && sw.onCount < sw.total;
  const stateText = partial
    ? t("desktop.craft.detail.status.partial", { on: sw.onCount, total: sw.total })
    : !on && sw.autoOff
      ? t("desktop.craft.detail.status.autoOff")
      : null;
  const failLimit = failLimitOf(members);
  const version = versionOf(target);
  return (
    <aside
      aria-label={t("desktop.craft.detail.aside.label")}
      className="grid min-h-0 content-start gap-3 overflow-y-auto pb-6"
    >
      <Section title={t("desktop.craft.detail.status.title")}>
        <div className="grid gap-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-body text-text-primary">
              {t(on ? "desktop.craft.detail.status.on" : "desktop.craft.detail.status.off")}
            </span>
            <Switch
              size="sm"
              aria-label={t("desktop.craft.detail.status.switch", { name: switchNameOf(target) })}
              checked={on}
              disabled={pending || sw.total === 0}
              onCheckedChange={onSwitch}
            />
          </div>
          {stateText !== null && <span className={LABEL}>{stateText}</span>}
          {switchFailed && (
            <Alert tone="danger" size="sm" radius="lg">
              {t("desktop.craft.detail.status.failed")}
            </Alert>
          )}
        </div>
      </Section>
      <Section title={t("desktop.craft.detail.config.title")}>
        {target.k === "group" && (
          <p className="m-0 font-mono text-mono-sm text-text-primary">
            {target.group.config ?? t("desktop.craft.detail.config.none")}
          </p>
        )}
        {members.map((p) => (
          <div key={p.id} className="grid gap-2">
            {target.k === "group" && (
              <span className="text-ui-strong text-text-primary">{p.name}</span>
            )}
            <Provides plugin={p} />
          </div>
        ))}
      </Section>
      <Section title={t("desktop.craft.detail.settings.title")}>
        {/* [미결: wire 없음] 설정 값 목록, 설정 편집, 코드 저장은 엔진 wire가 없어 이 화면에 없다.
            지금 읽을 수 있는 것은 실패 한도(실패 기록이 있을 때 엔진이 준 값)뿐이고 읽기 전용이다. */}
        {failLimit === undefined ? (
          <span className={LABEL}>{t("desktop.craft.detail.settings.none")}</span>
        ) : (
          <dl className="m-0 grid gap-1.5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
              <dt className="text-body text-text-secondary">
                {t("desktop.craft.detail.settings.failLimit")}
              </dt>
              <dd className="m-0 text-body text-text-primary">
                {t("desktop.craft.detail.settings.failLimitValue", { n: failLimit })}
              </dd>
            </div>
          </dl>
        )}
      </Section>
      <Section title={t("desktop.craft.detail.version.title")}>
        <div className="flex flex-wrap items-baseline gap-x-3 text-body text-text-primary">
          {version === undefined ? (
            <span>{t("desktop.craft.detail.version.none")}</span>
          ) : (
            <span>{t("desktop.craft.detail.version.value", { v: version })}</span>
          )}
          <span className="text-text-secondary">{t(ORIGIN_LABEL[originOf(target)])}</span>
        </div>
      </Section>
      <Accordion
        type="single"
        size="sm"
        value={codeOpen ? "code" : ""}
        onValueChange={(next) => {
          setCodeOpen(next === "code");
        }}
      >
        <AccordionItem value="code">
          <AccordionTrigger>{t("desktop.craft.detail.code.title")}</AccordionTrigger>
          <AccordionContent>
            {/* 코드 칸은 읽기 전용이다. 매니페스트 원문이 wire에 없어 스냅샷을 보인다. */}
            <pre className="m-0 max-h-56 overflow-auto rounded-md bg-bg-inset px-3 py-2.5 font-mono text-mono-sm text-text-primary">
              {codeOf(target)}
            </pre>
            <span className={LABEL}>{t("desktop.craft.detail.code.readonly")}</span>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </aside>
  );
}
