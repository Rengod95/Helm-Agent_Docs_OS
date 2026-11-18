// cvC 오른쪽 가벼운 상세(떠 있는 판). 고른 노드에 필요한 것만: 어디에 어떻게 붙나(그림 한 줄), 종류별 한 가지(결정·넣는 것·자기 루프),
// 출처, 최근 사용 한 줄. 할 일은 내부 열기, 순서 바꾸기, 빼기. 베이스는 프로필에서 뺄 수 없고 그 이유는 정보 아이콘 뒤에 있다.
import { Button, IconButton } from "@caustic/react";
import { ArrowDown, ArrowUp, X } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { InfoTip } from "../../info-tip.tsx";
import {
  decisionLabel,
  giveLabel,
  kindLabel,
  lastUsedLabel,
  pointLabel,
  sideLabel,
  stepLabel,
} from "./labels.ts";
import { KindWell, Mark } from "./marks.tsx";
import type { Member, Place } from "./model.ts";
import { StepStrip } from "./nodes.tsx";
import { pluginOf, type SampleGroup } from "./sample.ts";

const PANEL =
  "pointer-events-auto absolute top-3 right-3 z-20 flex w-[288px] flex-col rounded-[22px] bg-material-regular shadow-3";

function Row(props: { readonly label: string; readonly children: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-9 items-center gap-3 border-t border-border-subtle px-4 py-2">
      <span className="w-[72px] shrink-0 text-ui-sm text-text-tertiary">{props.label}</span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-ui text-text-primary">
        {props.children}
      </span>
    </div>
  );
}

/** 붙는 곳을 그림 한 줄로: [지점] › 앞 › 2 */
function PlaceLine(props: {
  readonly place: Place;
  readonly index: number;
  readonly start: boolean;
}): ReactNode {
  const { place } = props;
  if (place.lane === "drive") {
    return (
      <span className="flex items-center gap-1.5">
        <Mark name="drive" size={13} />
        {props.start
          ? t("desktop.craft.canvas.cvC.startDrive")
          : t("desktop.craft.canvas.cvC.detail.driveLane")}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <span className="rounded-md border border-border-subtle px-1.5 text-ui-sm">
        {pointLabel(place.point)}
      </span>
      <span className="text-text-tertiary">›</span>
      <span className="text-ui-sm text-text-secondary">{sideLabel(place.side)}</span>
      <span className="text-text-tertiary">›</span>
      <span className="font-mono text-mono-sm tabular-nums text-text-secondary">
        {String(props.index + 1)}
      </span>
    </span>
  );
}

export interface DetailProps {
  readonly member: Member;
  readonly place: Place;
  readonly index: number;
  readonly start: boolean;
  readonly canUp: boolean;
  readonly canDown: boolean;
  readonly group: SampleGroup | null;
  readonly onClose: () => void;
  readonly onOpen: () => void;
  readonly onRemove: () => void;
  readonly onNudge: (delta: -1 | 1) => void;
}

export function Detail(props: DetailProps): ReactNode {
  const m = props.member;
  const plugin = pluginOf(m.name);
  if (plugin === undefined) return null;
  const base = m.source === "base";
  return (
    <aside
      aria-label={t("desktop.craft.canvas.cvC.detail.label", { name: m.name })}
      className={PANEL}
    >
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <KindWell kind={m.kind} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="m-0 truncate text-title-4 text-text-primary">{m.name}</h2>
          <span className="text-ui-sm text-text-tertiary">{kindLabel(m.kind)}</span>
        </div>
        <IconButton
          size="sm"
          variant="ghost"
          label={t("desktop.craft.canvas.cvC.detail.close")}
          onClick={props.onClose}
        >
          <X aria-hidden />
        </IconButton>
      </div>
      <Row label={t("desktop.craft.canvas.cvC.detail.place")}>
        <PlaceLine place={props.place} index={props.index} start={props.start} />
      </Row>
      {plugin.decision !== undefined && (
        <Row label={t("desktop.craft.canvas.cvC.detail.decision")}>
          {decisionLabel(plugin.decision)}
          {plugin.guard === true && (
            <span className="rounded-md bg-fill-hover px-1.5 text-ui-sm text-text-secondary">
              {t("desktop.craft.canvas.cvC.guard")}
            </span>
          )}
        </Row>
      )}
      {plugin.gives !== undefined && (
        <Row label={t("desktop.craft.canvas.cvC.detail.gives")}>
          {plugin.gives.map(giveLabel).join(" · ")}
        </Row>
      )}
      {plugin.inside.steps !== undefined && (
        <Row label={t("desktop.craft.canvas.cvC.detail.loop")}>
          <StepStrip steps={plugin.inside.steps} />
          <span className="text-ui-sm text-text-secondary">
            {plugin.inside.steps.map((s) => stepLabel(s.id)).join(" → ")}
          </span>
        </Row>
      )}
      {plugin.handoffTo !== undefined && (
        <Row label={t("desktop.craft.canvas.cvC.handoff")}>
          <Mark name="handoff" size={13} />
          {plugin.handoffTo.join(", ")}
        </Row>
      )}
      <Row label={t("desktop.craft.canvas.cvC.detail.source")}>
        {base
          ? t("desktop.craft.canvas.cvC.source.base")
          : m.source === "draft"
            ? t("desktop.craft.canvas.cvC.detail.draft")
            : t("desktop.craft.canvas.cvC.source.profile")}
        {props.group !== null && (
          <span className="flex items-center gap-1 rounded-md border border-border-subtle px-1.5 text-ui-sm text-text-secondary">
            <Mark name="group" size={11} />
            {props.group.name}
          </span>
        )}
      </Row>
      <Row label={t("desktop.craft.canvas.cvC.detail.lastUsed")}>
        <span className="text-text-secondary">{lastUsedLabel(plugin.lastUsedMin)}</span>
      </Row>
      <div className="flex items-center gap-1.5 border-t border-border-subtle px-3 py-3">
        <Button size="sm" variant="solid" onClick={props.onOpen}>
          {t("desktop.craft.canvas.cvC.detail.open")}
        </Button>
        <span className="flex-1" />
        <IconButton
          size="sm"
          variant="ghost"
          label={t("desktop.craft.canvas.cvC.detail.up")}
          disabled={!props.canUp}
          onClick={() => props.onNudge(-1)}
        >
          <ArrowUp aria-hidden />
        </IconButton>
        <IconButton
          size="sm"
          variant="ghost"
          label={t("desktop.craft.canvas.cvC.detail.down")}
          disabled={!props.canDown}
          onClick={() => props.onNudge(1)}
        >
          <ArrowDown aria-hidden />
        </IconButton>
        <Button size="sm" variant="ghost" disabled={base} onClick={props.onRemove}>
          {t("desktop.craft.canvas.cvC.detail.remove")}
        </Button>
        {base && <InfoTip text={t("desktop.craft.canvas.cvC.detail.baseHelp")} />}
      </div>
    </aside>
  );
}

/** 접힌 묶음을 골랐을 때 */
export function GroupDetail(props: {
  readonly group: SampleGroup;
  readonly onClose: () => void;
  readonly onToggle: () => void;
}): ReactNode {
  return (
    <aside
      aria-label={t("desktop.craft.canvas.cvC.detail.label", { name: props.group.name })}
      className={PANEL}
    >
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <span className="flex size-7 items-center justify-center rounded-lg border border-border-subtle bg-bg-inset text-text-secondary">
          <Mark name="group" size={15} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="m-0 truncate text-title-4 text-text-primary">{props.group.name}</h2>
          <span className="text-ui-sm text-text-tertiary">
            {t("desktop.craft.canvas.cvC.group.kind")}
          </span>
        </div>
        <IconButton
          size="sm"
          variant="ghost"
          label={t("desktop.craft.canvas.cvC.detail.close")}
          onClick={props.onClose}
        >
          <X aria-hidden />
        </IconButton>
      </div>
      {props.group.members.map((name) => {
        const p = pluginOf(name);
        return (
          <Row key={name} label={p === undefined ? "" : kindLabel(p.kind)}>
            {name}
          </Row>
        );
      })}
      <div className="flex border-t border-border-subtle px-3 py-3">
        <Button size="sm" variant="outline" onClick={props.onToggle}>
          {t("desktop.craft.canvas.cvC.group.expand")}
        </Button>
      </div>
    </aside>
  );
}
