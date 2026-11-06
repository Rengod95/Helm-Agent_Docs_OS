// P-05 정리: Helm well(helm/panel)은 그룹 자기 내용(주제, 단계, 렌즈, 발견)만 담는다. 주도·대기열·전환 기록·"이 대화의 그룹"은
// 런타임 탭으로 옮겼다(§4.9.8, DP-23). 렌즈 나무와 발견 목록은 p05-helm 부품을 그대로 쓴다.
import { Button, Stepper } from "@caustic/react";
import { T } from "../../_shell";
import { FindingList, LensTree, Section } from "../../p05-helm/helm";
import { findings, lensesExplore } from "../../p05-helm/fixtures";

export function HelmWell({ onRuntime }: { onRuntime: () => void }) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <div className="flex items-baseline gap-2">
          <h3 className="m-0 min-w-0 flex-1 truncate text-ui-strong text-text-primary">
            캐시 무효화 원인
          </h3>
          <Button size="xs" variant="ghost">
            멈춤
          </Button>
        </div>
        <p className="-mt-1.5 m-0 text-ui-xs text-text-tertiary">신호 stuck · 같은 오류 3번</p>
        <Stepper
          size="sm"
          value={3}
          steps={[{ label: "확산" }, { label: "탐색" }, { label: "수렴" }, { label: "적용" }]}
        />
      </div>
      <Section title={T.lens} count="3 · 실패 1">
        <LensTree lenses={lensesExplore} />
      </Section>
      <Section title={T.finding} count={findings.length}>
        <FindingList items={findings} />
      </Section>
      <p className="m-0 text-ui-xs text-text-tertiary">
        {T.lead}과 전환 기록은{" "}
        <button
          type="button"
          onClick={onRuntime}
          className="rounded-sm text-text-secondary underline underline-offset-2 outline-none hover:text-text-primary focus-visible:focus-ring"
        >
          {T.runtime} 탭
        </button>
        에 있어요.
      </p>
    </div>
  );
}
