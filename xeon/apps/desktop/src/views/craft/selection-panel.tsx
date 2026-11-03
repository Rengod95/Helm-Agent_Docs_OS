// 선택 패널(지도의 오른쪽). 위에서부터 이름과 표식, 켜짐 스위치 하나, 중요한 것(실패 알림, 구성), 하는 일 순서다.
// 스위치는 대상 하나다: 그룹 구성원이면 그룹 전체가, 그룹이면 그룹 전체가 함께 바뀐다(toggleTargets).
import {
  Alert,
  Badge,
  Button,
  CardHeader,
  CardHeading,
  CardTitle,
  Card,
  IconButton,
  List,
  ListRow,
  Switch,
} from "@caustic/react";
import { X } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import type { CanvasGroup, CanvasPlugin } from "@fresnel/client/workbench/canvas";
import { isOn } from "@fresnel/client/workbench/canvas";
import type { ReactNode } from "react";
import { useCraft } from "./craft-context.tsx";
import { groupOnCount } from "./orbit-model.ts";
import { layerName } from "./orbit-names.ts";
import { Mark, shapeOf } from "./marks.tsx";
import { useSwitch } from "./use-switch.ts";

/** 패널의 폭(화면 px). 지도는 이만큼 오른쪽을 비우고 맞춘다 */
export const PANEL_W = 340;

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
  return null;
}

interface SwitchRowProps {
  readonly name: string;
  readonly on: boolean;
  readonly partial: string;
  readonly disabled: boolean;
  readonly onChange: (next: boolean) => void;
}

function SwitchRow(props: SwitchRowProps): ReactNode {
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-body text-text-primary">
          {props.on ? t("desktop.craft.orbit.state.on") : t("desktop.craft.orbit.state.off")}
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
      className="craft-glass animate-enter absolute right-3 top-16 z-20 flex max-h-[calc(100%-120px)] flex-col gap-0 overflow-hidden"
      style={{ width: PANEL_W }}
    >
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
      </div>
      <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto pb-3">{props.children}</div>
      <div className="flex items-center gap-2 border-t border-divider-line pt-3">
        {props.action}
      </div>
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
  const inGroup = grouped
    ? t("desktop.craft.orbit.panel.groupWide", {
        group: groupName(source.snapshot.groups, plugin.group),
      })
    : "";
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
      onClose={() => dispatch({ t: "clear" })}
      action={
        <Button size="sm" variant="solid" onClick={() => dispatch({ t: "detail", id: plugin.id })}>
          {t("desktop.craft.orbit.panel.details")}
        </Button>
      }
    >
      <SwitchRow
        name={plugin.name}
        on={on}
        partial={health?.autoOff === true ? t("desktop.craft.orbit.state.autoOff") : inGroup}
        disabled={sw.pending !== null}
        onChange={(next) => sw.set(plugin.id, next)}
      />
      {sw.failure !== null && <SwitchFailed />}
      {health !== undefined && (
        <Alert tone="danger" size="sm" radius="md">
          <span className="block">
            {t("desktop.craft.orbit.panel.failed", {
              hook: health.hook,
              fails: health.fails,
              limit: health.limit,
            })}
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
        <h3 className="m-0 text-footnote text-text-tertiary">
          {t("desktop.craft.orbit.panel.does")}
        </h3>
        {plugin.role !== undefined && (
          <p className="m-0 text-body text-text-primary">{plugin.role}</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {plugin.hooks.map((h) => (
            <Badge key={h} mono size="sm">
              {h}
            </Badge>
          ))}
          {plugin.provides.map((c) => (
            <Badge key={c} mono size="sm" variant="outline">
              {c}
            </Badge>
          ))}
        </div>
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
      onClose={() => dispatch({ t: "clear" })}
      action={
        <Button size="sm" variant="solid" onClick={() => dispatch({ t: "detail", id: group.id })}>
          {t("desktop.craft.orbit.panel.details")}
        </Button>
      }
    >
      <SwitchRow
        name={group.name}
        on={all}
        partial={partial}
        disabled={sw.pending !== null}
        onChange={(next) => sw.set(group.id, next)}
      />
      {sw.failure !== null && <SwitchFailed />}
      {group.config !== undefined && (
        <div className="flex items-center gap-2">
          <span className="text-footnote text-text-tertiary">
            {t("desktop.craft.orbit.panel.config")}
          </span>
          <Badge size="xs" mono>
            {group.config}
          </Badge>
        </div>
      )}
      <section className="grid gap-1.5">
        <h3 className="m-0 text-footnote text-text-tertiary">
          {t("desktop.craft.orbit.panel.members")}
        </h3>
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
