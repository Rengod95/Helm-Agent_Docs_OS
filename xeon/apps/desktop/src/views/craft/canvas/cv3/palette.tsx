// cv3 왼쪽 패널(둘째 판 F의 판을 바탕으로): 보고 있는 프로필 고르기, 묶음과 종류별 설치된 플러그인 목록, 줄 끝의 넣기·빼기 단추.
// 줄은 대화 목록의 줄과 같은 부품 값을 쓴다: caustic `listNavigationLink`(sessions) + 앱의 `SIDE_ROW`(높이 control-md 32,
// 글자 ui-md 13.5/500, 모서리 rounded-lg = squircle). 줄 끝 단추도 같은 높이(IconButton md 32, ghost, rounded-lg)다.
// 줄을 누르면(Enter·Space도) 캔버스가 그 노드로 움직여 포커스가 간다. 줄을 캔버스로 끌어 놓으면 넣는다. 위·아래 화살표로 줄 사이를 옮긴다.
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  cn,
  IconButton,
  listNavigationHeading,
  listNavigationLabel,
  listNavigationLink,
  listNavigationMeta,
  Select,
  SelectOption,
} from "@caustic/react";
import type {
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
} from "react";
import { InfoTip } from "../../info-tip.tsx";
import type { SharedProfileId } from "../shared-sample.ts";
import { Icon, KIND_COLOR, KindTile, PartGlyph } from "./glyphs.tsx";
import { inProfile, INSTALLED, isBaseOf, type CanvasProfile, type Kind } from "./model.ts";
import { bundleMetaOf } from "../shared-meta.ts";
import { KIND_WORD } from "./words.ts";

const ORDER: readonly Kind[] = ["drive", "inject", "hook", "tool"];
/**
 * 앱 사이드 줄 크기(`views/side-row.ts`의 `SIDE_ROW`와 같은 값: 높이 control-md 32, 글자 ui-md 13.5, 아이콘 icon-md 16).
 * 세 단계 위 상대 경로 import는 lint(no-restricted-imports)가 막아 값을 옮겨 둔다. 저 값이 바뀌면 같이 바꾼다
 */
const SIDE_ROW =
  "h-control-md! text-ui-md! [&_[data-slot=list-navigation-icon]]:size-icon-md [&_[data-slot=list-navigation-status]]:size-icon-md";
const PALETTE_W = 256;
const RAIL_W = 52;

/** 대화 목록 줄과 같은 줄(크기·모서리·호버·고름 상태) */
const ROW = cn(
  listNavigationLink({ kind: "sessions", size: "sm" }),
  SIDE_ROW,
  "min-w-0 flex-1 touch-none",
);

const CHOICES: readonly { readonly id: SharedProfileId; readonly name: MessageId }[] = [
  { id: "dev", name: "desktop.craft.canvas.cv3.profile.dev" },
  { id: "empty", name: "desktop.craft.canvas.cv3.profile.empty" },
  { id: "scale", name: "desktop.craft.canvas.sample.scale" },
];

export interface PaletteProps {
  readonly profile: CanvasProfile;
  readonly current: SharedProfileId;
  readonly bundles: readonly { readonly id: string; readonly members: readonly string[] }[];
  readonly focused: string | null;
  readonly open: boolean;
  readonly onProfile: (id: SharedProfileId) => void;
  readonly onPick: (id: string) => void;
  readonly onAdd: (name: string) => void;
  readonly onRemove: (name: string) => void;
  readonly onRemoveBundle: (id: string) => void;
  readonly onPointerDown: (name: string, e: ReactPointerEvent<HTMLElement>) => void;
  readonly onToggle: () => void;
}

/** 위·아래 화살표: 패널 안의 다음 줄로. Enter·Space: 그 노드로 */
function rowKey(e: KeyboardEvent<HTMLElement>, id: string, props: PaletteProps): void {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    props.onPick(id);
    return;
  }
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const rows = [
    ...(e.currentTarget.closest("aside")?.querySelectorAll<HTMLElement>("[data-row]") ?? []),
  ];
  const i = rows.indexOf(e.currentTarget);
  rows[i + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
}

/** 묶음·종류 머리: caustic 목록 머리(11/500, tertiary) 앞에 종류 색 짧은 선, 끝에 수 */
function Heading(props: {
  readonly word: string;
  readonly count: number;
  readonly color?: string;
}): ReactElement {
  return (
    <div className={cn(listNavigationHeading({ kind: "sessions" }), "justify-start gap-1.5")}>
      <span
        aria-hidden="true"
        className="h-px w-2 shrink-0"
        style={{ background: props.color ?? "var(--cs-color-text-tertiary)" }}
      />
      <span>{props.word}</span>
      <span className="ms-auto text-hint text-text-placeholder normal-case tabular-nums">
        {props.count}
      </span>
    </div>
  );
}

function CheckGlyph(): ReactElement {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 8.4 6.6 11.5 12.5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 줄 하나와 줄 끝 단추(같은 높이 32) */
function Row(props: {
  readonly id: string;
  readonly label: string;
  readonly leading: ReactNode;
  readonly name: string;
  readonly on: boolean;
  readonly meta: ReactNode;
  readonly current: boolean;
  readonly toggle: ReactNode;
  readonly palette: PaletteProps;
  readonly draggable: boolean;
}): ReactElement {
  return (
    <li className="flex items-center gap-0.5">
      <button
        type="button"
        data-slot="cv3-button"
        data-row=""
        data-palette={props.id}
        aria-current={props.current ? "page" : undefined}
        aria-label={props.label}
        className={ROW}
        onPointerDown={
          props.draggable ? (e) => props.palette.onPointerDown(props.id, e) : undefined
        }
        onClick={() => props.palette.onPick(props.id)}
        onKeyDown={(e) => rowKey(e, props.id, props.palette)}
      >
        <span className="inline-grid size-icon-md shrink-0 place-items-center">
          {props.leading}
        </span>
        <span
          className={cn(listNavigationLabel(), props.on ? "" : "font-normal text-text-tertiary")}
        >
          {props.name}
        </span>
        {props.meta === null ? null : <span className={listNavigationMeta()}>{props.meta}</span>}
      </button>
      {props.toggle}
    </li>
  );
}

export function Palette(props: PaletteProps): ReactElement {
  if (!props.open) return <PaletteRail {...props} />;
  const count = INSTALLED.filter((p) => inProfile(props.profile, p.name)).length;
  return (
    <aside
      aria-label={t("desktop.craft.canvas.cv3.palette.label")}
      className="cv3-palette flex shrink-0 flex-col"
      style={{ width: PALETTE_W }}
    >
      <div className="flex flex-col gap-1.5 px-3 pt-2.5 pb-3">
        <div className="flex items-center justify-between ps-1">
          <span className="text-caption text-text-tertiary">
            {t("desktop.craft.canvas.cv3.profile")}
          </span>
          <IconButton
            size="xs"
            variant="ghost"
            label={t("desktop.craft.canvas.cv3.palette.collapse")}
            onClick={props.onToggle}
          >
            <Icon name="left" size={14} />
          </IconButton>
        </div>
        <Select
          size="md"
          aria-label={t("desktop.craft.canvas.cv3.profile")}
          value={props.current}
          onValueChange={(v) => {
            const hit = CHOICES.find((c) => c.id === v);
            if (hit !== undefined) props.onProfile(hit.id);
          }}
          className="w-full"
        >
          {CHOICES.map((c) => (
            <SelectOption key={c.id} value={c.id}>
              {t(c.name)}
            </SelectOption>
          ))}
        </Select>
      </div>
      <div className="mx-3 h-px bg-border-subtle" />
      <div className="flex items-center gap-1 ps-4 pe-3 pt-3">
        <span className="text-ui-sm text-text-secondary">
          {t("desktop.craft.canvas.cv3.palette.plugins")}
        </span>
        <InfoTip text={t("desktop.craft.canvas.cv3.palette.hint")} />
        <span className="ms-auto text-hint text-text-tertiary tabular-nums">
          {t("desktop.craft.canvas.cv3.palette.inCount", { n: count, of: INSTALLED.length })}
        </span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {props.bundles.length > 0 ? (
          <li>
            <Heading
              word={t("desktop.craft.canvas.cv3.bundle.word")}
              count={props.bundles.length}
            />
            <ul className="grid gap-px">
              {props.bundles.map((b) => {
                const name = bundleMetaOf(b.id).displayName;
                return (
                  <Row
                    key={b.id}
                    id={`bundle:${b.id}`}
                    label={t("desktop.craft.canvas.cv3.palette.bundleRow", {
                      name,
                      n: b.members.length,
                    })}
                    leading={
                      <span className="text-text-secondary">
                        <PartGlyph name="package" size={16} />
                      </span>
                    }
                    name={name}
                    on
                    meta={<span className="tabular-nums">{String(b.members.length)}</span>}
                    current={props.focused === `bundle:${b.id}`}
                    palette={props}
                    draggable={false}
                    toggle={
                      <IconButton
                        size="md"
                        variant="ghost"
                        label={t("desktop.craft.canvas.cv3.act.removeBundleNamed", { name })}
                        title={t("desktop.craft.canvas.cv3.act.removeBundle")}
                        tabIndex={-1}
                        onClick={() => props.onRemoveBundle(b.id)}
                        className="text-text-tertiary"
                      >
                        <CheckGlyph />
                      </IconButton>
                    }
                  />
                );
              })}
            </ul>
          </li>
        ) : null}
        {ORDER.map((kind) => {
          const rows = INSTALLED.filter((p) => p.kind === kind);
          return (
            <li key={kind}>
              <Heading word={t(KIND_WORD[kind])} count={rows.length} color={KIND_COLOR[kind]} />
              <ul className="grid gap-px">
                {rows.map((p) => {
                  const inside = inProfile(props.profile, p.name);
                  const base = isBaseOf(props.profile, p.name);
                  const draft = p.meta.review.state === "draft";
                  const pending = !draft && p.meta.pending !== null;
                  const toggleLabel = base
                    ? t("desktop.craft.canvas.cv3.act.baseFixed")
                    : inside
                      ? t("desktop.craft.canvas.cv3.act.removeNamed", { name: p.name })
                      : t("desktop.craft.canvas.cv3.act.addNamed", { name: p.name });
                  return (
                    <Row
                      key={p.name}
                      id={p.name}
                      label={t(
                        inside
                          ? "desktop.craft.canvas.cv3.palette.rowIn"
                          : "desktop.craft.canvas.cv3.palette.row",
                        { name: p.name, kind: t(KIND_WORD[p.kind]) },
                      )}
                      leading={<KindTile kind={p.kind} size={18} draft={draft || pending} />}
                      name={p.name}
                      on={inside}
                      meta={
                        draft ? (
                          <span className="text-warning-text">
                            {t("desktop.craft.canvas.cv3.review.draft")}
                          </span>
                        ) : pending ? (
                          <span className="text-warning-text">
                            {t("desktop.craft.canvas.cv3.review.pendingShort")}
                          </span>
                        ) : null
                      }
                      current={props.focused === p.name}
                      palette={props}
                      draggable
                      toggle={
                        <IconButton
                          size="md"
                          variant="ghost"
                          label={toggleLabel}
                          title={toggleLabel}
                          tabIndex={-1}
                          disabled={base}
                          className={inside ? "text-text-tertiary" : ""}
                          onClick={() => {
                            if (inside) props.onRemove(p.name);
                            else props.onAdd(p.name);
                          }}
                        >
                          {base ? (
                            <PartGlyph name="lock" size={14} />
                          ) : inside ? (
                            <CheckGlyph />
                          ) : (
                            <Icon name="plus" size={16} />
                          )}
                        </IconButton>
                      }
                    />
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

/** 접힌 패널: 종류 타일만 세로로 선다. 누르기·끌기는 그대로 된다 */
function PaletteRail(props: PaletteProps): ReactElement {
  return (
    <aside
      aria-label={t("desktop.craft.canvas.cv3.palette.label")}
      className="cv3-palette flex shrink-0 flex-col items-center gap-px py-2.5"
      style={{ width: RAIL_W }}
    >
      <IconButton
        size="md"
        variant="ghost"
        label={t("desktop.craft.canvas.cv3.palette.expand")}
        onClick={props.onToggle}
        className="mb-1.5"
      >
        <Icon name="right" size={16} />
      </IconButton>
      {ORDER.map((kind) => (
        <ul
          key={kind}
          className="grid gap-px border-t border-border-subtle pt-1.5 pb-1 first-of-type:border-t-0"
        >
          {INSTALLED.filter((p) => p.kind === kind).map((p) => {
            const inside = inProfile(props.profile, p.name);
            return (
              <li key={p.name}>
                <button
                  type="button"
                  data-slot="cv3-button"
                  data-row=""
                  data-palette={p.name}
                  title={p.name}
                  aria-current={props.focused === p.name ? "page" : undefined}
                  aria-label={t(
                    inside
                      ? "desktop.craft.canvas.cv3.palette.rowIn"
                      : "desktop.craft.canvas.cv3.palette.row",
                    { name: p.name, kind: t(KIND_WORD[p.kind]) },
                  )}
                  onPointerDown={(e) => props.onPointerDown(p.name, e)}
                  onClick={() => props.onPick(p.name)}
                  onKeyDown={(e) => rowKey(e, p.name, props)}
                  className={cn(
                    listNavigationLink({ kind: "sessions", size: "sm" }),
                    "size-control-md justify-center px-0",
                  )}
                  style={{ opacity: inside ? 1 : 0.5 }}
                >
                  <KindTile kind={p.kind} size={20} draft={p.meta.review.state === "draft"} />
                </button>
              </li>
            );
          })}
        </ul>
      ))}
    </aside>
  );
}
