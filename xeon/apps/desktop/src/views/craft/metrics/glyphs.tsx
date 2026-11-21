// 종류 그림 넷(Inject·Hook·Drive·도구)과 그 타일. 색은 종류를 가르는 데만 쓴다(`viz.css`의 `--viz-<종류>`).
// 프로필 캔버스(cv3)와 같은 그림 말: Inject는 들어가는 화살, Hook은 문, Drive는 겹 갈매기, 도구는 플러그.
import { assertNever } from "@fresnel/contracts";
import type { HookOutcomeOrSkipped } from "@fresnel/contracts/extensions";
import type { SubjectKind } from "@fresnel/contracts/wire";
import type { CSSProperties, ReactNode } from "react";
import { LINE_GLYPH } from "../../illustrations/line-glyph.ts";
import { KIND_PATHS, type GlyphKind } from "../kind-paths.ts";

export type Kind = GlyphKind;

export const KIND_COLOR: Readonly<Record<Kind, string>> = {
  inject: "var(--viz-inject)",
  hook: "var(--viz-hook)",
  drive: "var(--viz-drive)",
  tool: "var(--viz-tool)",
  block: "var(--cs-color-text-secondary)",
};

export function kindOfSubject(kind: SubjectKind): Kind {
  switch (kind) {
    case "instruction":
    case "skill":
      return "inject";
    case "tool":
      return "tool";
    case "hook":
      return "hook";
    case "drive":
      return "drive";
    case "block":
      return "block";
    default:
      return assertNever(kind, "SubjectKind");
  }
}

/** 종류 그림 하나. 획은 리뷰 화면과 같은 `kind-paths.ts`, 선은 `LINE_GLYPH`(화면 1px, m6R7)다 */
export function KindGlyph(props: { readonly kind: Kind; readonly size?: number }): ReactNode {
  const s = props.size ?? 12;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
      data-kind-glyph={props.kind}
      {...LINE_GLYPH}
    >
      {KIND_PATHS[props.kind].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * 28px 아이콘 타일(받은 요청 카드의 타일 크기). 넷째 판(AGE-36): 프로필 캔버스 G5의 탭과 같은 진한 종류 면 + 종류의 글 색 그림이다.
 * 셋째 판의 옅은 섞음(종류 색 14%)은 거의 무채색으로 보였다
 */
export function KindTile(props: { readonly kind: Kind; readonly size?: number }): ReactNode {
  const size = props.size ?? 28;
  const style: CSSProperties = {
    width: size,
    height: size,
    color: `var(--viz-${props.kind}-tab-text)`,
    background: `var(--viz-${props.kind}-tab)`,
  };
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-lg"
      style={style}
    >
      <KindGlyph kind={props.kind} size={Math.round(size * 0.5)} />
    </span>
  );
}

// ───────── Hook 결정의 표 ─────────
// 결정 종류(막음·물음·고침·통과·시간 초과·오류·건너뜀)를 글자 없이 가르는 3×3 점 구슬 그림. 앱의 점 구슬(진행 구슬)과 같은 말로,
// 점의 배치가 뜻을 진다: 막음은 꽉 찬 벽, 물음은 멈춤의 두 기둥, 고침은 꺾인 대각, 통과는 가로지르는 한 줄,
// 시간 초과는 시계 바늘, 오류는 엇갈린 X, 건너뜀은 가운데가 빈 줄. 먹은 막음이 가장 진하고 고장(오류·시간 초과)만 위험 글자색이다.
// 날별 흐름의 쌓은 기둥(`DECISION_TEXTURE`)과 트레이스의 결정 표·칩이 이 한 문법을 쓴다.

export type Decision = HookOutcomeOrSkipped;

/** 3×3 칸의 점 자리(행, 열) */
const DECISION_DOTS: Readonly<Record<Decision, readonly (readonly [number, number])[]>> = {
  blocked: [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 1],
    [1, 2],
    [2, 0],
    [2, 1],
    [2, 2],
  ],
  asked: [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 2],
    [1, 2],
    [2, 2],
  ],
  modified: [
    [2, 0],
    [1, 1],
    [0, 2],
    [1, 0],
  ],
  pass: [
    [1, 0],
    [1, 1],
    [1, 2],
  ],
  timeout: [
    [0, 1],
    [1, 1],
    [1, 2],
  ],
  error: [
    [0, 0],
    [0, 2],
    [1, 1],
    [2, 0],
    [2, 2],
  ],
  skipped: [
    [1, 0],
    [1, 2],
  ],
};

/** 결정의 먹(색). 막음이 가장 진하고 통과·건너뜀이 가장 옅다. 고장만 위험 글자색 */
export const DECISION_INK: Readonly<Record<Decision, string>> = {
  blocked: "var(--viz-blocked)",
  asked: "var(--viz-asked)",
  modified: "var(--viz-modified)",
  pass: "var(--viz-pass)",
  skipped: "var(--viz-pass)",
  error: "var(--viz-fault)",
  timeout: "var(--viz-fault)",
};

export function isFaultDecision(decision: Decision): boolean {
  return decision === "error" || decision === "timeout";
}

/**
 * 결정 하나의 그림. `size`는 한 변(px). 점은 칸의 0.19배 반지름이라 10px에서도 아홉 점이 떨어져 보인다.
 * 점은 그 결정의 누른 색(`DECISION_INK`)으로 칠한다. 통과·건너뜀은 흐린 글자색, 고장(오류·시간 초과)은
 * 부르는 쪽 글자색(`currentColor`, 대개 위험 글자색)을 따른다. 그래서 모양과 색이 날별 흐름·최근 턴·트레이스에서 같다
 */
export function DecisionGlyph(props: {
  readonly decision: Decision;
  readonly size?: number;
}): ReactNode {
  const s = props.size ?? 12;
  const dots = DECISION_DOTS[props.decision];
  const fill = glyphInk(props.decision);
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      {dots.map(([r, c]) => (
        <circle
          key={`${String(r)}${String(c)}`}
          cx={2.4 + c * 3.6}
          cy={2.4 + r * 3.6}
          r={1.45}
          fill={fill}
        />
      ))}
    </svg>
  );
}

/** 그림의 점 색. 통과의 막대 먹은 점으로는 너무 옅어 흐린 글자색을 쓴다 */
function glyphInk(decision: Decision): string {
  switch (decision) {
    case "blocked":
    case "asked":
    case "modified":
      return DECISION_INK[decision];
    case "pass":
    case "skipped":
      return "var(--cs-color-text-tertiary)";
    case "error":
    case "timeout":
      return "currentColor";
    default:
      return assertNever(decision, "Decision");
  }
}

/** 쌓은 기둥의 결 이름. 막음은 꽉 찬 먹, 물음은 촘촘한 점, 고침은 성긴 점이다(그림 표의 점 배치와 같은 순서의 밀도) */
export const DECISION_TEXTURE = {
  blocked: "solid",
  asked: "dense",
  modified: "sparse",
} as const;
