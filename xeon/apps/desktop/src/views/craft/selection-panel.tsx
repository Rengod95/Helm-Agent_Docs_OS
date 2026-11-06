// 선택 패널(지도의 오른쪽). 위에서부터 이름과 표식, 켜짐 스위치 하나, 자동 꺼짐 알림(질문과 두 답), 중요한 것(실패 알림, 구성), 하는 일 순서다.
// 스위치는 대상 하나다: 그룹 구성원이면 그룹 전체가, 그룹이면 그룹 전체가 함께 바뀐다(toggleTargets).
import {
  Alert,
  Badge,
  Button,
  Card,
  CardFooter,
  CardHeader,
  CardHeading,
  CardMeta,
  CardTitle,
  Chip,
  IconButton,
  List,
  ListRow,
  ScrollArea,
  SectionHeader,
  Switch,
} from "@caustic/react";
import { X } from "@caustic/react/icons";
import { t, type MessageId } from "@fresnel/client/i18n";
import { extOf } from "@fresnel/client/workbench";
import type { CanvasGroup, CanvasPlugin, Origin, Sel } from "@fresnel/client/workbench/canvas";
import { isOn } from "@fresnel/client/workbench/canvas";
import type { ReactNode } from "react";
import { ExtNotice } from "../workbench/craft-parts.tsx";
import { HookNoticeFor } from "../workbench/hook-notice.tsx";
import { useWorkbench } from "../../state/workbench/index.ts";
import { useCraft } from "./craft-context.tsx";
import { groupOnCount } from "./orbit-model.ts";
import { layerName, layerTitle } from "./orbit-names.ts";
import { InfoTip } from "./info-tip.tsx";
import { Mark, shapeOf } from "./marks.tsx";
import { Provides } from "./provides.tsx";
import { useSwitch } from "./use-switch.ts";

const ORIGIN_TEXT: Record<Origin, MessageId> = {
  builtin: "desktop.craft.detail.origin.builtin",
  user: "desktop.craft.detail.origin.user",
  project: "desktop.craft.detail.origin.project",
};

/** 패널의 폭(화면 px). 지도는 이만큼 오른쪽을 비우고 맞춘다 */
export const PANEL_W = 320;

export function SelectionPanel(): ReactNode {
  const { source, state } = useCraft();
  const sel = state.sel;
  if (!state.panel) return null;
  if (sel.k === "plugin") {
    const plugin = source.snapshot.plugins.find((p) => p.id === sel.id);
    return plugin === undefined ? null : <PluginBody plugin={plugin} />;
  }
  if (sel.k === "group") {
    const group = source.snapshot.groups.find((g) => g.id === sel.id);
    return group === undefined ? null : <GroupBody group={group} />;
  }
  // 훅 칩을 고르면(순서 보기) 그 훅의 질문이나 꺼짐을 보인다. 질문도 꺼짐도 없으면 패널을 열지 않는다
  const hook = hookOf(sel);
  if (hook !== null) return <HookBody hook={hook} />;
  return null;
}

/** 고른 것이 훅이면 그 이름: 훅 칸(`hook`)이나 순서 보기의 `hook:<이름>` 칸(`builtin`) */
function hookOf(sel: Sel): string | null {
  if (sel.k === "hook") return sel.id;
  if (sel.k === "builtin" && sel.slot.startsWith("hook:")) return sel.slot.slice("hook:".length);
  return null;
}

function HookBody({ hook }: { readonly hook: string }): ReactNode {
  const { dispatch } = useCraft();
  // 훅 이름 칩이면 그 훅에 걸린 외부 훅(id)의 알림을, 외부 훅 id 자체이면 그 알림을 보인다
  const ids = useWorkbench((s) =>
    s.hookNotices.filter((n) => n.hook === hook || n.point === hook).map((n) => n.hook),
  );
  if (ids.length === 0) return null;
  return (
    <Frame
      mark={<Mark shape="diamond" size={22} group={false} on failing />}
      title={hook}
      grouped={false}
      onClose={() => dispatch({ t: "clear" })}
      action={null}
    >
      {ids.map((id) => (
        <HookNoticeFor key={id} hook={id} />
      ))}
    </Frame>
  );
}

interface SwitchRowProps {
  readonly name: string;
  readonly on: boolean;
  /** 켜짐·꺼짐 말고 알려 줄 상태(자동 꺼짐, 일부만 켜짐). 짧아서 줄로 보인다 */
  readonly partial: string;
  /** 설명 한 줄(그룹과 함께 바뀐다). 정보 아이콘 뒤에 둔다(DP-58) */
  readonly tip: string;
  readonly disabled: boolean;
  readonly onChange: (next: boolean) => void;
}

function SwitchRow(props: SwitchRowProps): ReactNode {
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1 text-body text-text-primary">
          {props.on ? t("desktop.craft.orbit.state.on") : t("desktop.craft.orbit.state.off")}
          {props.tip !== "" && <InfoTip text={props.tip} />}
        </span>
        <Switch
          size="sm"
          aria-label={props.name}
          checked={props.on}
          disabled={props.disabled}
          onCheckedChange={props.onChange}
        />
      </div>
      {props.partial !== "" && (
        <span className="text-footnote text-text-tertiary">{props.partial}</span>
      )}
    </div>
  );
}

function Frame(props: {
  readonly mark: ReactNode;
  readonly title: string;
  /** 이름 밑의 한 줄(역할). 없으면 줄을 두지 않는다 */
  readonly sub?: string | undefined;
  /** 이름 밑의 작은 표찰 줄(층, 그룹, 버전, 출처) */
  readonly meta?: ReactNode;
  /** 그룹이거나 그룹에 든 것이면 참: 맨 위에 그룹 색 가는 줄을 단다 */
  readonly grouped: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly action: ReactNode;
}): ReactNode {
  return (
    <Card
      role="region"
      aria-label={t("desktop.craft.orbit.panel.label")}
      variant="surface"
      size="sm"
      shadow="4"
      className="craft-glass animate-enter absolute right-3 top-27 z-20 flex max-h-[calc(100%-120px)] flex-col gap-0 overflow-hidden"
      style={{ width: PANEL_W }}
    >
      {props.grouped && (
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-0.5"
          style={{ background: "var(--cs-color-info-graphic)" }}
        />
      )}
      <div className="grid gap-2 pb-3">
        <CardHeader headerAlign="center">
          {props.mark}
          <CardHeading>
            <CardTitle as="h2" className="truncate">
              {props.title}
            </CardTitle>
          </CardHeading>
          <IconButton
            size="sm"
            variant="ghost"
            label={t("desktop.craft.orbit.panel.close")}
            onClick={props.onClose}
          >
            <X aria-hidden />
          </IconButton>
        </CardHeader>
        {props.sub !== undefined && (
          <div className="truncate text-body text-text-secondary">{props.sub}</div>
        )}
        {props.meta !== undefined && (
          <div className="flex flex-wrap items-center gap-1.5">{props.meta}</div>
        )}
      </div>
      {/* 가운데만 길면 스크롤한다. 머리와 아래 줄(하는 일)은 고정이다 */}
      <ScrollArea className="-mx-1 min-h-0 flex-1" label={t("desktop.craft.orbit.panel.content")}>
        <div className="grid gap-3 px-1 pb-3">{props.children}</div>
      </ScrollArea>
      {props.action === null ? null : (
        <CardFooter footer="divided" className="flex-nowrap">
          {props.action}
        </CardFooter>
      )}
    </Card>
  );
}

function PluginBody({ plugin }: { readonly plugin: CanvasPlugin }): ReactNode {
  const { source, dispatch } = useCraft();
  const sw = useSwitch();
  const on = isOn(plugin);
  const health = plugin.health;
  const grouped = plugin.group !== undefined;
  // 그룹에 든 플러그인이면 그룹이 쥔 설정도 중요한 것에 함께 보인다
  const owner = source.snapshot.groups.find((g) => g.id === plugin.group);
  const groupLabel = grouped ? groupName(source.snapshot.groups, plugin.group) : "";
  const inGroup = grouped ? t("desktop.craft.orbit.panel.groupWide", { group: groupLabel }) : "";
  return (
    <Frame
      mark={
        <Mark
          shape={shapeOf(plugin.layer)}
          size={22}
          group={grouped}
          on={on}
          failing={health !== undefined}
          autoOff={health?.autoOff === true}
        />
      }
      title={plugin.name}
      sub={plugin.role}
      meta={
        <>
          <Badge size="xs" variant="outline">
            {layerTitle(plugin.layer)}
          </Badge>
          {grouped && (
            <Chip size="xs" tone="info" variant="soft">
              {groupLabel}
            </Chip>
          )}
          {plugin.version !== undefined && <CardMeta>v{plugin.version}</CardMeta>}
          {!grouped && <CardMeta>{t(ORIGIN_TEXT[plugin.origin])}</CardMeta>}
        </>
      }
      grouped={grouped}
      onClose={() => dispatch({ t: "clear" })}
      action={
        <>
          <Button
            size="sm"
            variant="solid"
            onClick={() => dispatch({ t: "detail", id: plugin.id })}
          >
            {t("desktop.craft.orbit.panel.details")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => source.openBuilder(plugin.hooks[0] ?? null)}
          >
            {t("desktop.craft.orbit.panel.build")}
          </Button>
        </>
      }
    >
      <SwitchRow
        name={plugin.name}
        on={on}
        partial={health?.autoOff === true ? t("desktop.craft.orbit.state.autoOff") : ""}
        tip={inGroup}
        disabled={sw.pending !== null}
        onChange={(next) => sw.set(plugin.id, next)}
      />
      {sw.failure !== null && <SwitchFailed />}
      <ExtNotice name={extOf(plugin.id)} />
      {health !== undefined && (
        <Alert tone="danger" size="sm" radius="md">
          <span className="block">
            {health.hook !== undefined && health.limit !== undefined
              ? t("desktop.craft.orbit.panel.failed", {
                  hook: health.hook,
                  fails: health.fails,
                  limit: health.limit,
                })
              : t("desktop.craft.orbit.panel.failedPlain", { fails: health.fails })}
          </span>
          <span className="block font-mono text-mono-sm">{health.text}</span>
        </Alert>
      )}
      {owner?.config !== undefined && (
        <div className="flex items-center gap-2">
          <span className="text-footnote text-text-tertiary">
            {t("desktop.craft.orbit.panel.config")}
          </span>
          <Badge size="xs" mono>
            {owner.config}
          </Badge>
        </div>
      )}
      <section className="grid gap-1.5">
        <SectionHeader size="xs" headingLevel={3} title={t("desktop.craft.detail.config.title")} />
        <Provides plugin={plugin} />
      </section>
    </Frame>
  );
}

function GroupBody({ group }: { readonly group: CanvasGroup }): ReactNode {
  const { source, dispatch } = useCraft();
  const sw = useSwitch();
  const snapshot = source.snapshot;
  const count = groupOnCount(snapshot, group.id);
  const all = count.total > 0 && count.on === count.total;
  const partial =
    count.on === 0 || all
      ? ""
      : t("desktop.craft.orbit.panel.partial", { on: count.on, total: count.total });
  const members = group.members.flatMap((id) => {
    const p = snapshot.plugins.find((x) => x.id === id);
    return p === undefined ? [] : [p];
  });
  return (
    <Frame
      mark={<Mark shape="diamond" size={22} group on={all} />}
      title={group.name}
      sub={group.role}
      meta={
        <>
          <Chip size="xs" tone="info" variant="soft">
            {t("term.pluginGroup")}
          </Chip>
          <CardMeta>v{group.version}</CardMeta>
          <CardMeta>{t(ORIGIN_TEXT[group.origin])}</CardMeta>
          {group.config !== undefined && (
            <Badge size="xs" mono>
              {group.config}
            </Badge>
          )}
        </>
      }
      grouped
      onClose={() => dispatch({ t: "clear" })}
      action={
        <>
          <Button size="sm" variant="solid" onClick={() => dispatch({ t: "detail", id: group.id })}>
            {t("desktop.craft.orbit.panel.details")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => source.openBuilder(null)}>
            {t("desktop.craft.orbit.panel.build")}
          </Button>
        </>
      }
    >
      <SwitchRow
        name={group.name}
        on={all}
        partial={partial}
        tip=""
        disabled={sw.pending !== null}
        onChange={(next) => sw.set(group.id, next)}
      />
      {sw.failure !== null && <SwitchFailed />}
      <ExtNotice name={group.id} />
      <section className="grid gap-1.5">
        <SectionHeader size="xs" headingLevel={3} title={t("desktop.craft.orbit.panel.members")} />
        <List
          size="xs"
          variant="ghost"
          dividers={false}
          aria-label={t("desktop.craft.orbit.panel.members")}
        >
          {members.map((p) => (
            <ListRow
              key={p.id}
              leading={<Mark shape={shapeOf(p.layer)} size={18} group on={isOn(p)} />}
              title={p.name}
              description={layerName(p.layer)}
              onClick={() => dispatch({ t: "selectPlugin", id: p.id })}
            />
          ))}
        </List>
      </section>
    </Frame>
  );
}

/** 켜기·끄기가 거부됐을 때의 알림. 원인은 상태에 남고, 화면은 문구로 알린다 */
function SwitchFailed(): ReactNode {
  return (
    <Alert tone="danger" size="sm" radius="md" role="alert">
      {t("desktop.craft.orbit.panel.switchFailed")}
    </Alert>
  );
}

function groupName(groups: readonly CanvasGroup[], gid: string): string {
  return groups.find((g) => g.id === gid)?.name ?? gid;
}
