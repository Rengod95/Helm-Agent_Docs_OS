// 크래프트 도구 막대(화면 위쪽 한 줄). 왼쪽은 보기 전환(Orbit·Strata·Link), 종류, 구성 요소 필터.
// 오른쪽은 플러그인 추가(고르기·새로 만들기)와 플러그인 수정이다. 부모는 위치 기준(relative)이어야 한다.
import {
  Alert,
  Badge,
  Button,
  Chip,
  FloatingBar,
  FloatingBarSeparator,
  Menu,
  MenuHeading,
  MenuItem,
  MenuSeparator,
  Popover,
  SegmentedControl,
  SegmentedControlItem,
} from "@caustic/react";
import { Filter, Link2, Pencil, Plus, Rows3, Target, X } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import {
  hasContrib,
  matchesKind,
  type Contrib,
  type KindFilter,
} from "@fresnel/client/workbench/canvas";
import type { ReactNode } from "react";
import { type CraftMode, useCraft } from "./craft-context.tsx";
import { useSwitch } from "./use-switch.ts";

/** 보기 전환의 값 순서 */
const MODES: readonly CraftMode[] = ["orbit", "strata", "link"];
/** 종류 거르기의 값 순서 */
const KINDS: readonly KindFilter[] = ["all", "group", "single", "external"];
/** 구성 요소 칩의 순서(훅 다음이 기능 제공 종류) */
const CONTRIBS: readonly Contrib[] = ["hook", "skill", "command", "tool", "mcp", "agent", "view"];

const isMode = (v: string): v is CraftMode => MODES.some((m) => m === v);
const isKind = (v: string): v is KindFilter => KINDS.some((k) => k === v);

function contribLabel(c: Contrib): string {
  switch (c) {
    case "hook":
      return t("term.hook");
    case "skill":
      return t("desktop.craft.orbit.contrib.skill");
    case "command":
      return t("desktop.craft.orbit.contrib.command");
    case "tool":
      return t("desktop.craft.orbit.contrib.tool");
    case "mcp":
      return t("desktop.craft.orbit.contrib.mcp");
    case "agent":
      return t("desktop.craft.orbit.contrib.agent");
    case "view":
      return t("desktop.craft.orbit.contrib.view");
    default:
      return assertNever(c, "contribLabel");
  }
}

function kindLabel(k: KindFilter): string {
  switch (k) {
    case "all":
      return t("desktop.craft.orbit.kind.all");
    case "group":
      return t("desktop.craft.orbit.kind.group");
    case "single":
      return t("desktop.craft.orbit.kind.single");
    case "external":
      return t("desktop.craft.orbit.kind.external");
    default:
      return assertNever(k, "kindLabel");
  }
}

function modeLabel(m: CraftMode): string {
  switch (m) {
    case "orbit":
      return t("desktop.craft.orbit.mode.orbit");
    case "strata":
      return t("desktop.craft.orbit.mode.strata");
    case "link":
      return t("desktop.craft.orbit.mode.link");
    default:
      return assertNever(m, "modeLabel");
  }
}

/** 구성 요소 거르기 팝오버. 고른 칩이 하나도 없는 종류의 칩은 누르기 전에 끈다 */
function ContribFilter(): ReactNode {
  const { source, state, dispatch } = useCraft();
  const pool = source.snapshot.plugins.filter((p) => matchesKind(p, state.kind));
  return (
    <Popover
      size="sm"
      radius="2xl"
      arrow={false}
      side="bottom"
      align="start"
      className="craft-glass"
      anchor={
        <Button
          size="sm"
          variant={state.contrib.length > 0 ? "soft" : "ghost"}
          iconStart={<Filter aria-hidden />}
        >
          {t("desktop.craft.orbit.contrib.button")}
          {state.contrib.length > 0 && <Badge size="xs">{state.contrib.length}</Badge>}
        </Button>
      }
    >
      <div
        role="group"
        aria-label={t("desktop.craft.orbit.contrib.label")}
        className="flex max-w-72 flex-wrap gap-1.5"
      >
        {CONTRIBS.map((c) => {
          const on = state.contrib.includes(c);
          const empty = !pool.some((p) => hasContrib(p, c));
          return (
            <Chip
              key={c}
              size="md"
              variant="outline"
              radius="md"
              pressed={on}
              disabled={empty && !on}
              onPressedChange={() => dispatch({ t: "contrib", contrib: c })}
            >
              {contribLabel(c)}
            </Chip>
          );
        })}
      </div>
    </Popover>
  );
}

/** 플러그인 추가: 꺼진 것 고르기, 명령 하나 연결(준비 중), 새로 만들기 */
function AddMenu(): ReactNode {
  const { source, dispatch } = useCraft();
  const sw = useSwitch();
  const off = source.snapshot.plugins.filter((p) => !p.on || p.health?.autoOff === true);
  return (
    <>
      <Menu
        size="sm"
        className="craft-glass"
        trigger={
          <Button size="sm" variant="ghost" iconStart={<Plus aria-hidden />}>
            {t("desktop.craft.orbit.add.button")}
          </Button>
        }
      >
        {off.length > 0 && <MenuHeading>{t("desktop.craft.orbit.add.off")}</MenuHeading>}
        {off.map((p) => (
          <MenuItem
            key={p.id}
            disabled={sw.pending !== null}
            onSelect={() => {
              sw.set(p.id, true);
              dispatch({ t: "selectPlugin", id: p.id });
            }}
          >
            {p.name}
          </MenuItem>
        ))}
        {off.length > 0 && <MenuSeparator />}
        <MenuItem disabled onSelect={() => {}}>
          {t("desktop.craft.orbit.add.connect")}
        </MenuItem>
        <MenuItem onSelect={() => source.openBuilder(null)}>
          {t("desktop.craft.orbit.add.new")}
        </MenuItem>
      </Menu>
      {sw.failure !== null && (
        <Alert tone="danger" size="sm" radius="md" role="alert">
          {t("desktop.craft.orbit.panel.switchFailed")}
        </Alert>
      )}
    </>
  );
}

export function CraftToolbar(): ReactNode {
  const { state, dispatch } = useCraft();
  const filtering = state.kind !== "all" || state.contrib.length > 0;
  const picked = state.sel.k === "plugin" || state.sel.k === "group";
  return (
    <div className="pointer-events-none absolute left-3 right-14 top-3 z-20 flex items-start justify-between gap-3">
      <FloatingBar
        label={t("desktop.craft.orbit.bar.view")}
        size="md"
        className="craft-glass pointer-events-auto min-w-0"
      >
        <SegmentedControl
          size="sm"
          radius="lg"
          aria-label={t("desktop.craft.orbit.mode.label")}
          value={state.mode}
          onValueChange={(v) => {
            if (isMode(v)) dispatch({ t: "mode", mode: v });
          }}
        >
          <SegmentedControlItem value="orbit" icon={<Target aria-hidden />}>
            {modeLabel("orbit")}
          </SegmentedControlItem>
          <SegmentedControlItem value="strata" icon={<Rows3 aria-hidden />}>
            {modeLabel("strata")}
          </SegmentedControlItem>
          <SegmentedControlItem value="link" icon={<Link2 aria-hidden />}>
            {modeLabel("link")}
          </SegmentedControlItem>
        </SegmentedControl>
        <FloatingBarSeparator />
        <SegmentedControl
          size="sm"
          radius="lg"
          variant="soft"
          aria-label={t("desktop.craft.orbit.kind.label")}
          value={state.kind}
          onValueChange={(v) => {
            if (isKind(v)) dispatch({ t: "kind", kind: v });
          }}
        >
          {KINDS.map((k) => (
            <SegmentedControlItem key={k} value={k}>
              {kindLabel(k)}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <FloatingBarSeparator />
        <ContribFilter />
        {filtering && (
          <Button
            size="sm"
            variant="ghost"
            iconStart={<X aria-hidden />}
            onClick={() => {
              // 거르기 상태는 토글 값이라, 고른 것을 하나씩 끈다
              dispatch({ t: "kind", kind: "all" });
              for (const c of state.contrib) dispatch({ t: "contrib", contrib: c });
            }}
          >
            {t("desktop.craft.orbit.contrib.clear")}
          </Button>
        )}
      </FloatingBar>
      <FloatingBar
        label={t("desktop.craft.orbit.bar.plugin")}
        size="md"
        className="craft-glass pointer-events-auto flex-none"
      >
        <AddMenu />
        <Button
          size="sm"
          variant="ghost"
          iconStart={<Pencil aria-hidden />}
          disabled={!picked}
          onClick={() => {
            if (state.sel.k === "plugin" || state.sel.k === "group")
              dispatch({ t: "detail", id: state.sel.id });
          }}
        >
          {t("desktop.craft.orbit.edit.button")}
        </Button>
      </FloatingBar>
    </div>
  );
}
