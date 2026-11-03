// N-12 "제작" well(authoring/panel)과 "제작" page(authoring/session, 크래프트 플러그인 화면).
// 둘 다 플러그인 빌더의 선언형 기여라 caustic 부품(Stepper, ListDescription)으로만 그린다(DP-22). 주도·전환은 런타임 탭에 두고 여기 두지 않는다(DP-23).
// 페이지 머리 첫 줄(확장 이름, 등급, 버전)은 셸 몫이고 동작은 "대화로" 하나(DP-42).
import {
  Button,
  ListDescription,
  ListDescriptionRow,
  Stepper,
  type StepperStep,
} from "@caustic/react";
import { CircleCheck, T, ToneIcon, TriangleAlert, WB_WIDTH, WorkbenchHead } from "../../_shell";
import { DIR, NAME, STAGES, type S } from "../flow";

const LD = "rounded-none [--cs-size-list-term:6rem] [&_[data-slot=list-description-row]]:px-0";

export function stageSteps(s: S): StepperStep[] {
  const order = STAGES.map((x) => x.id);
  const cur = s.stage === "fix" ? "validate" : s.stage;
  const at =
    s.stage === "done" ? order.length : s.stage === "idle" ? -1 : order.indexOf(cur as never);
  // 멈춘 곳: 고치기 한도면 검사, 아니면 뼈대 뒤.
  const stopAt = order.indexOf(s.fixes > 0 ? "validate" : "scaffold");
  return STAGES.map((x, i) => ({
    id: x.id,
    label: x.label,
    status:
      s.stage === "stopped"
        ? i < stopAt
          ? "done"
          : i === stopAt
            ? s.fixes >= 3
              ? "failed"
              : "now"
            : "todo"
        : i < at
          ? "done"
          : i === at
            ? "now"
            : "todo",
    ...(x.id === "validate" && s.fixes > 0 ? { detail: `${T.stageFix} ${s.fixes}/3` } : {}),
    ...(x.id === "trial" && s.asks.trial === "declined" ? { detail: "건너뜀" } : {}),
  }));
}

function Facts({ s }: { s: S }) {
  const failed = s.fixes >= 3;
  return (
    <ListDescription variant="ghost" size="xs" aria-label="제작 요약" className={LD}>
      <ListDescriptionRow term={T.kind} mono>
        {s.kind}
      </ListDescriptionRow>
      <ListDescriptionRow term={T.targetFolder} mono>
        {DIR}
      </ListDescriptionRow>
      <ListDescriptionRow term={T.stageValidate}>
        <span className="inline-flex items-center gap-1.5">
          {failed ? (
            <ToneIcon tone="danger">
              <TriangleAlert />
            </ToneIcon>
          ) : (
            <ToneIcon tone="success">
              <CircleCheck />
            </ToneIcon>
          )}
          {s.stage === "idle" ||
          s.stage === "intent" ||
          s.stage === "compose" ||
          s.stage === "scaffold"
            ? "아직"
            : failed
              ? "오류 1 · AU-003"
              : "12 통과 · 경고 2"}
        </span>
      </ListDescriptionRow>
      <ListDescriptionRow term={T.trial}>
        {s.items.some((i) => i.k === "row" && i.icon === "flask")
          ? `${T.step} 4 · 실패 0`
          : s.asks.trial === "declined"
            ? "건너뜀"
            : "아직"}
      </ListDescriptionRow>
      <ListDescriptionRow term={T.replay}>{T.devMode}에서만</ListDescriptionRow>
    </ListDescription>
  );
}

export function AuthoringWell({ s }: { s: S }) {
  return (
    <div className="grid gap-4">
      <p className="m-0 truncate text-ui-xs text-text-tertiary">
        {NAME} · {T.catalog} 2026.11
      </p>
      <Stepper size="sm" orientation="vertical" variant="ghost" steps={stageSteps(s)} />
      <Facts s={s} />
    </div>
  );
}

export function AuthoringPage({ s, onBack }: { s: S; onBack: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <WorkbenchHead
        title={`${T.authoring} · ${NAME}`}
        meta={`authoring · ${T.trustBuiltin} · 0.1.0`}
        actions={
          <Button size="xs" tone="neutral" variant="outline" onClick={onBack}>
            {T.thread}로
          </Button>
        }
        sub={
          <span className="text-ui-xs text-text-tertiary">
            {T.catalog} 2026.11 · catalogVersion 14 · 14:20 기준
          </span>
        }
      />
      <div className={`${WB_WIDTH} grid gap-6 pt-4 pb-8`}>
        <section className="grid gap-2" aria-label={`${T.authoring} ${T.step}`}>
          <h2 className="m-0 text-ui-strong text-text-primary">{T.step}</h2>
          <Stepper size="sm" steps={stageSteps(s)} />
        </section>
        <section className="grid gap-2" aria-label={T.authoringCheck}>
          <h2 className="m-0 text-ui-strong text-text-primary">{T.authoringCheck}</h2>
          <div role="table" className="grid text-ui-dense">
            {[
              ["AU-001", "이름 규칙과 예약 이름", "통과"],
              ["AU-003", "구성 초안과 매니페스트", "통과"],
              ["AU-004", "drive 블록 하나 · 기능 제공자", "통과"],
              ["AU-005", "화면 slot과 방식", "통과"],
              ["AU-009", "시크릿처럼 보이는 키", "통과"],
              ["AU-010", `외부 쓰기 ${T.step}에 ${T.humanGate} 없음`, "경고"],
              ["AU-011", "상태 스키마 마이그레이션 없음", "경고"],
              ["AU-012", "재생 규율", "통과"],
            ].map(([code, text, r]) => (
              <div
                role="row"
                key={code}
                className="grid min-h-7 grid-cols-[4.5rem_minmax(0,1fr)_4rem] items-center gap-3"
              >
                <span role="cell" className="font-mono text-mono-sm text-text-tertiary">
                  {code}
                </span>
                <span role="cell" className="truncate text-text-primary">
                  {text}
                </span>
                <span role="cell" className="flex items-center gap-1 text-text-secondary">
                  {r === "경고" && (
                    <ToneIcon tone="warning">
                      <TriangleAlert />
                    </ToneIcon>
                  )}
                  {r}
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="grid gap-2" aria-label="요약">
          <h2 className="m-0 text-ui-strong text-text-primary">요약</h2>
          <Facts s={s} />
        </section>
      </div>
    </div>
  );
}
