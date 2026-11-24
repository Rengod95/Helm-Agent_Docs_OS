// 의존 때문에 거절된 일(`plugin.dependency` 3627, AGE-33)과 프로필 검사의 의존 이슈를 목록으로 보인다. 삭제 확인 상자, 리뷰의 승인 칸,
// 프로필 보기가 같이 쓴다.
// 알림 역할(`role="alert"`)은 부르는 쪽이 감싼다. 줄 하나는 "기대는 쪽 → 대상"과 문제 말이다. 이름 뒤에 조사를 붙이지 않으려고 문장 대신 두 이름과 화살표로 그린다.
import { t } from "@fresnel/client/i18n";
import { ArrowRight } from "@caustic/react/icons";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import type { ReactNode } from "react";
import { useInstalledEntries } from "../installed-entries.ts";
import type { DependencyRefusalView } from "../../commands.ts";
import { NoticeLine } from "../review/review-parts.tsx";
import type { DependencyKind } from "@fresnel/contracts/extensions";
import {
  dependencyIssueTextOf,
  KIND_WORD,
  partyNameOf,
  REFUSAL_TITLE,
  refusalProblemText,
  type PartyName,
} from "./deps-model.ts";

/** 이름 한 덩이: 플러그인의 보이는 이름과, 멤버면 "멤버 <id>" */
export function PartyLabel(props: { readonly name: PartyName }): ReactNode {
  const { name } = props;
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span className="min-w-0 truncate text-text-primary">{name.plugin}</span>
      {name.member !== null && (
        <span className="shrink-0 text-text-tertiary">
          {t("desktop.craft.deps.member", { id: name.member })}
        </span>
      )}
    </span>
  );
}

/** 목록이 아직 없으면(읽는 중) 이름을 그대로 보인다 */
function useEntries(): readonly ExtListEntry[] {
  return useInstalledEntries();
}

/** 의존 한 줄: 기대는 쪽, 대상, 종류, 문제 말 */
export interface DependencyLine {
  readonly key: string;
  readonly from: string;
  readonly target: string;
  readonly kind: DependencyKind;
  readonly text: string;
  /** 줄의 문제 코드. 시험과 측정이 줄을 고른다 */
  readonly code: string;
}

/** "기대는 쪽 → 대상 종류 문제" 줄 목록. 거절 목록과 프로필 검사의 의존 이슈가 같이 쓴다 */
export function DependencyLines(props: { readonly lines: readonly DependencyLine[] }): ReactNode {
  const entries = useEntries();
  if (props.lines.length === 0) return null;
  return (
    <ul className="m-0 grid list-none gap-1 p-0 ps-6 text-ui">
      {props.lines.map((line) => (
        <li
          key={line.key}
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
          data-dependency-item={line.code}
        >
          <PartyLabel name={partyNameOf(line.from, entries)} />
          <ArrowRight
            aria-label={t("desktop.craft.deps.arrow")}
            className="size-icon-md shrink-0 text-text-tertiary"
          />
          <PartyLabel name={partyNameOf(line.target, entries)} />
          <span className="shrink-0 text-text-tertiary">{t(KIND_WORD[line.kind])}</span>
          <span className="text-text-secondary">{line.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function DependencyRefusal(props: { readonly refusal: DependencyRefusalView }): ReactNode {
  const { refusal } = props;
  const lines = refusal.items.map((item): DependencyLine => {
    const problem = refusalProblemText(item.problem, item.range, item.found);
    return {
      key: `${item.from}->${item.target}:${item.problem}`,
      from: item.from,
      target: item.target,
      kind: item.kind,
      text: t(problem.id, problem.values),
      code: item.problem,
    };
  });
  return (
    <div className="grid gap-2" data-slot="dependency-refusal">
      <NoticeLine tone="danger">{t(REFUSAL_TITLE[refusal.reason])}</NoticeLine>
      <DependencyLines lines={lines} />
    </div>
  );
}

/** 프로필 검사의 의존 이슈(`dependency_*`)를 줄로. 종류는 심각도로 안다(꼭은 오류, 있으면 좋음은 경고) */
export function dependencyIssueLinesOf(
  issues: readonly {
    readonly code: string;
    readonly severity: "error" | "warning" | null;
    readonly plugin?: string | null;
    readonly other?: string | null;
  }[],
): readonly DependencyLine[] {
  const out: DependencyLine[] = [];
  for (const issue of issues) {
    const id = dependencyIssueTextOf(issue.code);
    const from = issue.plugin ?? null;
    const target = issue.other ?? null;
    if (id === null || from === null || target === null) continue;
    out.push({
      key: `${from}->${target}:${issue.code}`,
      from,
      target,
      kind: issue.severity === "warning" ? "soft" : "hard",
      text: t(id),
      code: issue.code,
    });
  }
  return out;
}
