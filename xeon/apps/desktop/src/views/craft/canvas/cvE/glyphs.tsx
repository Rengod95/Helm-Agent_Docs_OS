// cvE의 표식. 한 가지 선 굵기(1.5)와 글자색 하나로 그린다(색은 노드가 정한다). 붙는 방식의 표식은 은유를 그린다:
// Inject는 고리 안으로 드는 화살, Hook은 길 위의 문, 도구는 소켓, Drive는 자기 고리다.
import { assertNever } from "@fresnel/contracts";
import type { ReactNode } from "react";
import type { Decision, Kind, PartKind } from "./model.ts";

interface GlyphProps {
  readonly size?: number;
  readonly className?: string;
}

function Frame(props: GlyphProps & { readonly children: ReactNode }): ReactNode {
  const s = props.size ?? 16;
  return (
    <svg
      aria-hidden
      width={s}
      height={s}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
    >
      {props.children}
    </svg>
  );
}

export function KindGlyph(props: GlyphProps & { readonly kind: Kind | "bundle" }): ReactNode {
  switch (props.kind) {
    case "inject":
      return (
        <Frame {...props}>
          <path d="M13.5 8a5.5 5.5 0 1 1-3-4.9" />
          <path d="M14 2.5 8.2 8.3M8.2 5v3.3h3.3" />
        </Frame>
      );
    case "hook":
      return (
        <Frame {...props}>
          <path d="M1.5 8h3.5M11 8h3.5" />
          <rect x="5" y="3.5" width="6" height="9" rx="1.5" />
        </Frame>
      );
    case "tool":
      return (
        <Frame {...props}>
          <rect x="3" y="5.5" width="10" height="8" rx="2" />
          <path d="M6 5.5V2.5M10 5.5V2.5M6.5 9.5h3" />
        </Frame>
      );
    case "drive":
      return (
        <Frame {...props}>
          <path d="M13 8a5 5 0 1 1-1.6-3.7" />
          <path d="M13.2 2.6v2.6h-2.6" />
          <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
        </Frame>
      );
    case "bundle":
      return (
        <Frame {...props}>
          <rect x="2.5" y="5.5" width="9" height="8" rx="2" />
          <path d="M5 3h7.5a1.5 1.5 0 0 1 1.5 1.5V11" />
        </Frame>
      );
    default:
      return assertNever(props.kind, "cvE KindGlyph");
  }
}

export function PartGlyph(
  props: GlyphProps & { readonly kind: PartKind | "stage" | "handoff" | "port" },
): ReactNode {
  switch (props.kind) {
    case "instruction":
      return (
        <Frame {...props}>
          <path d="M3 4h10M3 8h10M3 12h6" />
        </Frame>
      );
    case "skill":
      return (
        <Frame {...props}>
          <path d="M4 2.5h7.5v11L7.75 11 4 13.5z" />
        </Frame>
      );
    case "tool":
      return (
        <Frame {...props}>
          <path d="m9.5 6.5-6 6M10.5 2.5a3 3 0 0 0-1 4l3 3a3 3 0 0 0 4-1l-2-.5-.5-2-2-.5z" />
        </Frame>
      );
    case "mcp":
      return (
        <Frame {...props}>
          <rect x="3" y="2.5" width="10" height="5" rx="1.5" />
          <rect x="3" y="8.5" width="10" height="5" rx="1.5" />
          <path d="M5.5 5h.01M5.5 11h.01" />
        </Frame>
      );
    case "memory":
      return (
        <Frame {...props}>
          <ellipse cx="8" cy="4" rx="5" ry="1.8" />
          <path d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8" />
        </Frame>
      );
    case "handler":
      return (
        <Frame {...props}>
          <path d="M1.5 8h3.5M11 8h3.5" />
          <rect x="5" y="3.5" width="6" height="9" rx="1.5" />
        </Frame>
      );
    case "setting":
      return (
        <Frame {...props}>
          <path d="M2.5 5h11M2.5 11h11" />
          <circle cx="10" cy="5" r="1.6" fill="var(--cs-color-surface-raised)" />
          <circle cx="6" cy="11" r="1.6" fill="var(--cs-color-surface-raised)" />
        </Frame>
      );
    case "permission":
      return (
        <Frame {...props}>
          <path d="M8 1.8 13 3.8v4c0 3-2.2 5.2-5 6.4-2.8-1.2-5-3.4-5-6.4v-4z" />
        </Frame>
      );
    case "stage":
      return (
        <Frame {...props}>
          <circle cx="8" cy="8" r="5" />
          <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
        </Frame>
      );
    case "handoff":
      return (
        <Frame {...props}>
          <path d="M2 8c2.5-4 6.5-4 9 0" strokeDasharray="2 2" />
          <path d="M14 8 11 5.5v5z" fill="currentColor" stroke="none" />
        </Frame>
      );
    case "port":
      return (
        <Frame {...props}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 2.5v3" />
        </Frame>
      );
    default:
      return assertNever(props.kind, "cvE PartGlyph");
  }
}

/** Hook의 결정: 막기는 길을 가로지르는 벽, 대체는 바꿔 끼우기, 묻기는 말풍선 */
export function DecisionGlyph(props: GlyphProps & { readonly decision: Decision }): ReactNode {
  switch (props.decision) {
    case "block":
      return (
        <Frame {...props}>
          <path d="M1.5 8H7M11 3.5v9" />
          <path d="M14.5 8H11" strokeDasharray="1 2" />
        </Frame>
      );
    case "replace":
      return (
        <Frame {...props}>
          <path d="M2.5 5.5h9l-2-2M13.5 10.5h-9l2 2" />
        </Frame>
      );
    case "ask":
      return (
        <Frame {...props}>
          <path d="M3 3.5h10v7H8l-3 2.5v-2.5H3z" />
        </Frame>
      );
    default:
      return assertNever(props.decision, "cvE DecisionGlyph");
  }
}
