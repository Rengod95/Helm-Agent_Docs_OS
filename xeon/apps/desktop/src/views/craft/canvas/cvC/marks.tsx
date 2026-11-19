// cvC의 표식. 색 없이 선 하나 굵기(1.5)로 그리는 작은 기하 기호다: 종류는 색이 아니라 모양으로 갈린다.
// Inject = 받침에 떨어지는 화살(넣는다), Hook = 흐름 선 위의 문(지점에서 막고 바꾼다), Drive = 도는 화살(루프를 쥔다), 도구 = 꽂는 단자.
// 내부 화면의 구성 요소(지침, 스킬, 메모리, 도구, MCP 서버, 설정, 권한)도 같은 문법이다. 장식이라 보조 기술에서 숨긴다.
import { assertNever } from "@fresnel/contracts";
import type { ReactNode } from "react";
import type { PluginKind } from "./sample.ts";

export type PartMark =
  | "instructions"
  | "skill"
  | "memory"
  | "tool"
  | "mcp"
  | "settings"
  | "permission"
  | "handoff"
  | "group"
  | "point";

type MarkName = PluginKind | PartMark;

function paths(name: MarkName): ReactNode {
  switch (name) {
    case "inject":
      return (
        <>
          <path d="M8 2.2v6.6" />
          <path d="M5.2 6.2 8 9l2.8-2.8" />
          <path d="M2.8 9.8v2.4c0 .7.5 1.2 1.2 1.2h8c.7 0 1.2-.5 1.2-1.2V9.8" />
        </>
      );
    case "hook":
      return (
        <>
          <path d="M1.4 8h3.8M10.8 8h3.8" />
          <rect x="5.6" y="3" width="4.8" height="10" rx="1.4" />
        </>
      );
    case "drive":
      return (
        <>
          <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.8" />
          <path d="M12.2 1.8v2.8H9.4" />
        </>
      );
    case "tool":
      return (
        <>
          <path d="M6 2.2v2.6M10 2.2v2.6" />
          <rect x="3.2" y="4.8" width="9.6" height="6.4" rx="2" />
          <path d="M8 11.2v2.8" />
        </>
      );
    case "instructions":
      return (
        <>
          <rect x="3" y="2" width="10" height="12" rx="1.8" />
          <path d="M5.6 5.6h4.8M5.6 8h4.8M5.6 10.4h2.8" />
        </>
      );
    case "skill":
      return (
        <>
          <path d="M8 4.2C6.6 3 4.6 2.8 2.6 3.2v9.2c2-.4 4-.2 5.4 1 1.4-1.2 3.4-1.4 5.4-1V3.2c-2-.4-4-.2-5.4 1Z" />
          <path d="M8 4.2v9.2" />
        </>
      );
    case "memory":
      return (
        <>
          <ellipse cx="8" cy="4" rx="5" ry="1.8" />
          <path d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4" />
          <path d="M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8" />
        </>
      );
    case "mcp":
      return (
        <>
          <rect x="2.6" y="2.6" width="10.8" height="4.4" rx="1.4" />
          <rect x="2.6" y="9" width="10.8" height="4.4" rx="1.4" />
          <path d="M5 4.8h.01M5 11.2h.01" />
        </>
      );
    case "settings":
      return (
        <>
          <path d="M2.6 5h10.8M2.6 11h10.8" />
          <circle cx="6" cy="5" r="1.6" fill="var(--cs-color-surface-raised)" />
          <circle cx="10.4" cy="11" r="1.6" fill="var(--cs-color-surface-raised)" />
        </>
      );
    case "permission":
      return (
        <>
          <path d="M8 1.8 13 3.8v3.8c0 3-2.2 5.4-5 6.6-2.8-1.2-5-3.6-5-6.6V3.8Z" />
          <path d="M5.8 8 7.4 9.6l2.8-3" />
        </>
      );
    case "handoff":
      return (
        <>
          <path d="M9.6 2.8H12c.7 0 1.2.5 1.2 1.2v8c0 .7-.5 1.2-1.2 1.2H9.6" />
          <path d="M2.4 8h7.6M7.2 5.2 10 8l-2.8 2.8" />
        </>
      );
    case "group":
      return (
        <>
          <rect x="4.6" y="2.4" width="9" height="7.6" rx="1.8" />
          <path d="M2.4 6v6.2c0 .8.6 1.4 1.4 1.4H10" />
        </>
      );
    case "point":
      return <rect x="5" y="5" width="6" height="6" rx="1.2" />;
    default:
      return assertNever(name, "paths");
  }
}

/** 종류·구성 요소의 표식 하나. 크기는 px */
export function Mark(props: { readonly name: MarkName; readonly size?: number }): ReactNode {
  const size = props.size ?? 16;
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {paths(props.name)}
    </svg>
  );
}

/** 종류 표식이 드는 우물. 모양이 종류를 한 번 더 가른다: Drive는 둥근 우물, 나머지는 모서리가 있는 우물 */
export function KindWell(props: {
  readonly kind: PluginKind;
  readonly muted?: boolean;
}): ReactNode {
  const round = props.kind === "drive";
  return (
    <span
      aria-hidden
      className={`flex size-7 shrink-0 items-center justify-center border border-border-subtle ${
        round ? "rounded-full" : "rounded-lg"
      } ${props.muted === true ? "bg-transparent text-text-tertiary" : "bg-bg-inset text-text-secondary"}`}
    >
      <Mark name={props.kind} size={15} />
    </span>
  );
}
