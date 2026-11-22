// cv6 표식: 종류 그림(D의 넷을 이어받는다: Inject 들어가는 화살, Hook 문, Drive 겹 갈매기, 도구 플러그), 구성 요소 그림, 공용 선 그림.
// 종류 색은 종류를 가르는 데만 쓴다. 값은 `cv6.css`의 카드 탭과 같은 한 벌이다: 글·그림·선은 탭 글 색(`--cv6-<종류>-text`),
// 타일의 면은 탭 면(`--cv6-<종류>-tab`). 왼쪽 목록의 타일이 카드의 탭을 작게 옮긴 모양이 된다.
import type { CSSProperties, ReactElement } from "react";
import type { Kind } from "./model.ts";

/** 종류의 글·그림·선 색(탭 글 색) */
export const KIND_COLOR: Readonly<Record<Kind, string>> = {
  inject: "var(--cv6-inject-text)",
  hook: "var(--cv6-hook-text)",
  drive: "var(--cv6-drive-text)",
  tool: "var(--cv6-tool-text)",
};

/** 종류의 먹 색(탭 면 위의 그림과 글) */
const KIND_INK: Readonly<Record<Kind, string>> = {
  inject: "var(--cv6-inject-ink)",
  hook: "var(--cv6-hook-ink)",
  drive: "var(--cv6-drive-ink)",
  tool: "var(--cv6-tool-ink)",
};

/** 종류의 면 색(탭 면) */
const KIND_FACE: Readonly<Record<Kind, string>> = {
  inject: "var(--cv6-inject-tab)",
  hook: "var(--cv6-hook-tab)",
  drive: "var(--cv6-drive-tab)",
  tool: "var(--cv6-tool-tab)",
};

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function KindGlyph(props: { readonly kind: Kind; readonly size?: number }): ReactElement {
  const s = props.size ?? 12;
  return (
    <svg width={s} height={s} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      {props.kind === "inject" && (
        <g {...STROKE}>
          <path d="M1.5 6h6" />
          <path d="M5 3.5 7.5 6 5 8.5" />
          <path d="M10.25 2v8" />
        </g>
      )}
      {props.kind === "hook" && (
        <g {...STROKE}>
          <path d="M6 1.6 10.4 6 6 10.4 1.6 6Z" />
          <path d="M6 4.4v3.2" />
        </g>
      )}
      {props.kind === "drive" && (
        <g {...STROKE}>
          <path d="M2.2 2.6 5.6 6 2.2 9.4" />
          <path d="M6.4 2.6 9.8 6 6.4 9.4" />
        </g>
      )}
      {props.kind === "tool" && (
        <g {...STROKE}>
          <path d="M4.2 1.6v2.6M7.8 1.6v2.6" />
          <path d="M2.6 4.2h6.8v1.6a3.4 3.4 0 0 1-6.8 0Z" />
          <path d="M6 9.2v1.6" />
        </g>
      )}
    </svg>
  );
}

/** 종류 색의 아이콘 타일: 탭 면 + 탭 글 색의 그림(카드의 탭과 같은 두 색). 드래프트는 점선 테두리 */
export function KindTile(props: {
  readonly kind: Kind;
  readonly size: number;
  readonly draft?: boolean;
}): ReactElement {
  const color = KIND_INK[props.kind];
  const style: CSSProperties = {
    width: props.size,
    height: props.size,
    color,
    borderRadius: Math.round(props.size * 0.28),
    background: KIND_FACE[props.kind],
    boxShadow: props.draft === true ? `inset 0 0 0 1px ${color}` : undefined,
    outline: props.draft === true ? `1px dashed ${color}` : undefined,
    outlineOffset: props.draft === true ? 2 : undefined,
  };
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center"
      style={style}
    >
      <KindGlyph kind={props.kind} size={Math.round(props.size * 0.56)} />
    </span>
  );
}

/** 구성 요소 그림(16 격자): 지침, 스킬, 기억, MCP 서버, 도구, Hook 처리기, 단계, 설정, 권한, 기록, 기능, 빌더, 패키지 */
export type PartIcon =
  | "instruction"
  | "skill"
  | "memory"
  | "mcp"
  | "tool"
  | "handler"
  | "stage"
  | "setting"
  | "permission"
  | "record"
  | "capability"
  | "builder"
  | "package"
  | "clock"
  | "hash"
  | "lock"
  | "layers";

export function PartGlyph(props: {
  readonly name: PartIcon;
  readonly size?: number;
}): ReactElement {
  const s = props.size ?? 14;
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <g {...STROKE} strokeWidth={1.35}>
        {props.name === "instruction" && (
          <>
            <path d="M4 2.5h5.5L12 5v8.5H4Z" />
            <path d="M6 7.5h4M6 10h4" />
          </>
        )}
        {props.name === "skill" && (
          <>
            <path d="M3 4.5 8 2l5 2.5L8 7Z" />
            <path d="M3 8l5 2.5L13 8M3 11.5 8 14l5-2.5" />
          </>
        )}
        {props.name === "memory" && (
          <>
            <ellipse cx="8" cy="4" rx="4.5" ry="1.8" />
            <path d="M3.5 4v8c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8V4M3.5 8c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8" />
          </>
        )}
        {props.name === "mcp" && (
          <>
            <rect x="2.5" y="3" width="11" height="4" rx="1" />
            <rect x="2.5" y="9" width="11" height="4" rx="1" />
            <path d="M5 5h.01M5 11h.01" strokeWidth={2} />
          </>
        )}
        {props.name === "tool" && (
          <path d="M10.5 2.5a3 3 0 0 0-2.8 4.1L2.8 11.5l1.7 1.7 4.9-4.9a3 3 0 0 0 4.1-2.8l-1.8 1.8-1.7-.4-.4-1.7Z" />
        )}
        {props.name === "handler" && (
          <>
            <path d="M8 2 14 8 8 14 2 8Z" />
            <path d="M5.5 8h5" />
          </>
        )}
        {props.name === "stage" && (
          <>
            <circle cx="4" cy="8" r="1.8" />
            <circle cx="12" cy="8" r="1.8" />
            <path d="M5.8 8h4.4" />
          </>
        )}
        {props.name === "setting" && (
          <>
            <path d="M3 4.5h10M3 11.5h10" />
            <circle cx="6" cy="4.5" r="1.6" />
            <circle cx="10" cy="11.5" r="1.6" />
          </>
        )}
        {props.name === "permission" && <path d="M8 2 13 4v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4Z" />}
        {props.name === "record" && (
          <>
            <rect x="3" y="2.5" width="10" height="11" rx="1.5" />
            <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" />
          </>
        )}
        {props.name === "capability" && (
          <>
            <circle cx="8" cy="8" r="5" />
            <circle cx="8" cy="8" r="1.8" />
          </>
        )}
        {props.name === "builder" && (
          <>
            <path d="M3 13 9.5 6.5" />
            <path d="M8.5 3.5 12.5 7.5 14 6 10 2Z" />
          </>
        )}
        {props.name === "package" && (
          <>
            <path d="M2.5 5 8 2.5 13.5 5v6L8 13.5 2.5 11Z" />
            <path d="M2.5 5 8 7.5 13.5 5M8 7.5v6" />
          </>
        )}
        {props.name === "clock" && (
          <>
            <circle cx="8" cy="8" r="5.5" />
            <path d="M8 5v3.2l2 1.3" />
          </>
        )}
        {props.name === "layers" && (
          <>
            <path d="M8 2.2 14 5.2 8 8.2 2 5.2Z" fill="currentColor" />
            <path d="M2 8.1 8 11.1l6-3" />
            <path d="M2 10.9 8 13.9l6-3" />
          </>
        )}
        {props.name === "hash" && <path d="M6 2.5 5 13.5M11 2.5l-1 11M3 6h10.5M2.5 10H13" />}
        {props.name === "lock" && (
          <>
            <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
            <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
          </>
        )}
      </g>
    </svg>
  );
}

export type LineIcon =
  | "close"
  | "back"
  | "plus"
  | "minus"
  | "fit"
  | "left"
  | "right"
  | "up"
  | "down"
  | "enter"
  | "play"
  | "remove"
  | "fold"
  | "unfold"
  | "links"
  | "grip"
  | "search"
  | "more";

export function Icon(props: { readonly name: LineIcon; readonly size?: number }): ReactElement {
  const s = props.size ?? 14;
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <g {...STROKE}>
        {props.name === "close" && <path d="M4 4l8 8M12 4l-8 8" />}
        {props.name === "back" && <path d="M9.5 3.5 5 8l4.5 4.5" />}
        {props.name === "left" && <path d="M9.5 4 5.5 8l4 4" />}
        {props.name === "right" && <path d="M6.5 4l4 4-4 4" />}
        {props.name === "up" && <path d="M4 9.5 8 5.5l4 4" />}
        {props.name === "down" && <path d="M4 6.5 8 10.5l4-4" />}
        {props.name === "plus" && <path d="M8 3.5v9M3.5 8h9" />}
        {props.name === "minus" && <path d="M3.5 8h9" />}
        {props.name === "fit" && <path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3" />}
        {props.name === "enter" && <path d="M6 3.5h6.5V10M12.5 3.5 5 11" />}
        {props.name === "play" && <path d="M5 3.5v9l7-4.5Z" />}
        {props.name === "remove" && (
          <>
            <circle cx="8" cy="8" r="5.5" />
            <path d="M5.5 8h5" />
          </>
        )}
        {props.name === "fold" && <path d="M4 6.5 8 3l4 3.5M4 9.5 8 13l4-3.5" />}
        {props.name === "unfold" && <path d="M4 3.5 8 7l4-3.5M4 12.5 8 9l4 3.5" />}
        {props.name === "links" && (
          <>
            <rect x="2" y="3" width="5" height="4" rx="1" />
            <rect x="9" y="9" width="5" height="4" rx="1" />
            <path d="M7 5h2.5v6H9" />
          </>
        )}
        {props.name === "grip" && (
          <path d="M6 4v.1M10 4v.1M6 8v.1M10 8v.1M6 12v.1M10 12v.1" strokeWidth={2} />
        )}
        {props.name === "more" && <path d="M8 3.4v.1M8 8v.1M8 12.6v.1" strokeWidth={2.4} />}
        {props.name === "search" && (
          <>
            <circle cx="7" cy="7" r="4" />
            <path d="M10 10l3 3" />
          </>
        )}
      </g>
    </svg>
  );
}
