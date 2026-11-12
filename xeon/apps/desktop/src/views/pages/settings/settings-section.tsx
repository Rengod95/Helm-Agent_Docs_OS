import { TriangleAlert } from "@caustic/react/icons";
import { useId, type ReactNode } from "react";
import { InfoTip } from "../../craft/info-tip.tsx";

// 설정과 폼 화면의 카드와 줄(DP-76~79, `_notes/design/dz/form-standard.md`). 앱의 설정 카드와 줄은 이 파일 하나다.
//   SettingSection  구역 제목(제목 2) + 카드 하나. 구역 위 40px(첫 구역 0), 제목과 카드 8px. 카드는 surface.base, 1px
//                   border.subtle, 반경 12. `body="rows"`(기본)는 줄 목록(줄 사이 1px 선), `"plain"`은 자유 배치(안쪽 16, 사이 8).
//   SettingRow      줄 하나. `inline`은 왼쪽 이름표 칸 + 오른쪽 조작부(최소 44px, 조작부 28px + 위아래 8px),
//                   `stacked`는 이름표 줄 아래 조작부 전폭(경로, 목록, 표, 코드). hover와 줄 안 초점에 옅은 면이 깔린다.
//   RowNote         줄 아래 경고 한 줄. 아이콘만 tone 색이고 문장은 text.secondary다(다크에서 노란 글이 본문보다 튀지 않게).
// 조작부에는 높이·패딩·글자 className을 주지 않는다. 높이는 size prop(설정 기본 sm = 28px), 폭은 FIELD_WIDTH 세 단계다.

/** 입력 폭 세 단계(DP-77). 짧은 값 96, 보통 224(select와 같다), 긴 값은 줄 전체(쌓는 줄). 그 밖의 폭은 쓰지 않는다 */
export const FIELD_WIDTH = {
  short: "w-24",
  medium: "w-56",
  full: "w-full",
} as const;

/** 표·목록이 주인인 구역. 본문 열이 720px이다(그 밖은 600px, DP-77) */
const WIDE_SECTIONS: ReadonlySet<string> = new Set([
  "secrets",
  "permissions",
  "tools",
  "connection",
]);

/**
 * 설정 본문 열의 최대 폭 클래스. 폼 구역은 600px(`max-w-150`), 표·목록 구역은 720px(`max-w-180`), 찾기 결과(`null`)는 600px.
 * 넓은 화면에서 이름표 왼쪽 끝과 조작부 오른쪽 끝이 600px 안에 들어 눈이 따라간다.
 */
export function formColumnOf(section: string | null): "max-w-150" | "max-w-180" {
  return section !== null && WIDE_SECTIONS.has(section) ? "max-w-180" : "max-w-150";
}

/** 설정·폼 조작부의 size. 같은 줄의 button·input·select·number·tag·segmented가 모두 28px이 된다(desktop density) */
export const FORM_CONTROL_SIZE = "sm";

export interface SettingSectionProps {
  readonly title?: ReactNode | undefined;
  /** 제목 아래 한 줄 설명(13, tertiary). 늘 보여야 하는 한 문장만. 긴 도움말은 정보 아이콘으로 */
  readonly description?: ReactNode | undefined;
  /** 제목이 없을 때 구역의 이름(aria-label) */
  readonly label?: string | undefined;
  /** 머리 오른쪽 끝 동작(ghost sm 단추나 링크) */
  readonly end?: ReactNode | undefined;
  /** `rows`: 줄 목록(기본). `plain`: 줄이 아닌 자유 배치. `bare`: 카드 없이 자식이 자기 면을 그린다(판정 표, 두 열 카드, DP-109) */
  readonly body?: "rows" | "plain" | "bare" | undefined;
  /** 제목 없이 앞 카드에 이어지는 카드. 위 간격이 8px이다 */
  readonly continues?: boolean | undefined;
  readonly children: ReactNode;
}

const CARD = "rounded-xl bg-surface-base shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]";

/** 줄 목록 카드에 줄(SettingRow, `data-layout`)이 아닌 것(목록, 빈 상태, 안내)이 들어오면 줄과 같은 좌우 16·위아래 12를 준다 */
const OTHER_CHILD = "[&>:not([data-layout])]:px-4 [&>:not([data-layout])]:py-3";

export function SettingSection(props: SettingSectionProps): ReactNode {
  const id = useId();
  const head = props.title !== undefined || props.end !== undefined;
  const body = props.body ?? "rows";
  const rows = body === "rows";
  return (
    <section
      data-slot="setting-section"
      aria-labelledby={props.title === undefined ? undefined : id}
      aria-label={props.title === undefined ? props.label : undefined}
      className={props.continues === true ? "pt-2" : "pt-10 first:pt-0"}
    >
      {head ? (
        <div className="mb-2 flex min-h-7 items-center gap-2">
          <h2 id={id} className="m-0 min-w-0 flex-1 text-title-2 text-text-primary">
            {props.title}
          </h2>
          {props.end}
        </div>
      ) : null}
      {props.description === undefined ? null : (
        <p className="m-0 -mt-1.5 mb-2 text-ui text-text-tertiary">{props.description}</p>
      )}
      {body === "bare" ? (
        <div data-slot="setting-bare" className="grid min-w-0">
          {props.children}
        </div>
      ) : (
        <div
          data-slot="setting-card"
          data-body={rows ? "rows" : "plain"}
          className={
            rows
              ? `@container grid overflow-hidden py-1 ${CARD} [&>*+*]:border-t [&>*+*]:border-border-subtle ${OTHER_CHILD}`
              : `@container grid gap-2 px-4 py-4 ${CARD}`
          }
        >
          {props.children}
        </div>
      )}
    </section>
  );
}

export interface SettingRowProps {
  /** 이름표(13/500). 조작부의 접근성 이름과 같은 글을 쓴다 */
  readonly label: ReactNode;
  /** 이름표 요소의 id. 조작부가 aria-labelledby로 가리킬 때 준다 */
  readonly labelId?: string | undefined;
  /** 정보 아이콘 뒤 설명. 비면 아이콘을 그리지 않는다 */
  readonly info?: string | readonly string[] | undefined;
  /** 정보 아이콘의 이름. 기본은 "설명 보기" */
  readonly infoLabel?: string | undefined;
  /** 이름표 줄 끝의 배지·상태(Badge size="sm", "저장됨") */
  readonly badges?: ReactNode | undefined;
  /** 이름표 아래 보조 글(13, tertiary). 상태처럼 늘 보여야 하는 것만. 설명은 `info`로 */
  readonly description?: ReactNode | undefined;
  /** 조작부. inline이면 오른쪽, stacked이면 이름표 줄 아래 전폭 */
  readonly control?: ReactNode | undefined;
  /** 조작부 앞(오른쪽 칸)에 놓는 것: 되돌리기, 보조 단추 */
  readonly lead?: ReactNode | undefined;
  /** 줄 아래 메시지(오류, 잠금, RowNote, 저장 줄) */
  readonly notes?: ReactNode | undefined;
  readonly layout?: "inline" | "stacked" | undefined;
  /** 줄을 묶음(role="group")으로 그릴 때 주는 속성 */
  readonly group?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly describedBy?: string | undefined;
  /** data-key 등 시험·측정용 표지 */
  readonly dataKey?: string | undefined;
  readonly slot?: string | undefined;
}

/** 이름표 칸: 이름표 · 4px · 정보 아이콘 · 6px · 배지, 그 아래 보조 글 */
function RowLabel(props: SettingRowProps): ReactNode {
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
      <div className="flex min-h-5 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className="inline-flex min-w-0 items-center gap-1">
          <span id={props.labelId} className="min-w-0 text-ui font-medium text-text-primary">
            {props.label}
          </span>
          {props.info === undefined ? null : (
            <InfoTip
              text={props.info}
              {...(props.infoLabel === undefined ? {} : { label: props.infoLabel })}
            />
          )}
        </span>
        {props.badges}
      </div>
      {props.description === undefined || props.description === null ? null : (
        <div className="min-w-0 text-ui text-text-tertiary">{props.description}</div>
      )}
    </div>
  );
}

export function SettingRow(props: SettingRowProps): ReactNode {
  const layout = props.layout ?? "inline";
  const right =
    props.lead === undefined && (layout === "stacked" || props.control === undefined) ? null : (
      <div className="flex flex-none items-center gap-2">
        {props.lead}
        {layout === "inline" ? props.control : null}
      </div>
    );
  return (
    <div
      data-slot={props.slot ?? "setting-row"}
      data-layout={layout}
      data-key={props.dataKey}
      role={props.group === true ? "group" : undefined}
      aria-labelledby={props.group === true ? props.labelId : undefined}
      aria-disabled={props.disabled === true ? true : undefined}
      aria-describedby={props.describedBy}
      className={`group/field grid gap-2 px-4 transition-colors hover:bg-neutral-hover focus-within:bg-neutral-hover ${layout === "inline" ? "py-2" : "py-3"}`}
    >
      <div className="flex min-h-7 min-w-0 items-center gap-6">
        <RowLabel {...props} />
        {right}
      </div>
      {layout === "stacked" && props.control !== undefined ? (
        <div className="min-w-0">{props.control}</div>
      ) : null}
      {props.notes === undefined || props.notes === null ? null : (
        <div className="grid min-w-0 gap-1 empty:hidden">{props.notes}</div>
      )}
    </div>
  );
}

/** 줄 아래 경고 한 줄(DP-59 계열): 경고 아이콘 14(tone) + 13 text.secondary 문장. 동작은 `actions`(xs 단추) */
export function RowNote(props: {
  readonly tone?: "warning" | "danger" | undefined;
  readonly children: ReactNode;
  readonly actions?: ReactNode | undefined;
  readonly slot?: string | undefined;
}): ReactNode {
  const icon = props.tone === "danger" ? "text-danger-text" : "text-warning-text";
  return (
    <div data-slot={props.slot ?? "setting-row-note"} role="note" className="grid min-w-0 gap-1.5">
      <p className="m-0 flex min-w-0 items-start gap-1.5 text-ui text-text-secondary">
        <TriangleAlert aria-hidden className={`mt-0.5 size-icon-sm flex-none ${icon}`} />
        <span className="min-w-0">{props.children}</span>
      </p>
      {props.actions === undefined ? null : (
        <div className="flex flex-wrap gap-2 ps-5">{props.actions}</div>
      )}
    </div>
  );
}
