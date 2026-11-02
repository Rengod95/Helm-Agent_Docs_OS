// S-04 토스트 목업. 대화를 고르지 않은 P-02 위 오른쪽 아래(상태 표시줄 위)에 쌓인 모습. ?state=S1..S5, ?theme=dark.
// 종류: 알림(notify.delivered, 동작 버튼 하나 "열기"), 동작 결과(복사됨·저장됨, 버튼 없음), 오류(tone danger, 닫지 않음, role=alert, 닫기 버튼).
// 목업 상태에서는 성공 토스트도 그대로 머물게 duration 0으로 그린다(실제는 4초 뒤 닫힘). caustic Toast·ToastViewport 그대로.
import { Toast, ToastViewport } from "@caustic/react";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import { QuietPage } from "../o07-new-thread/quiet-page";
import "./mockup.css";

loadCausticFonts();

const STATES = [
  { id: "S1", label: "S1 세 종류 함께" },
  { id: "S2", label: "S2 알림" },
  { id: "S3", label: "S3 동작 결과" },
  { id: "S4", label: "S4 오류" },
  { id: "S5", label: "S5 합친 알림" },
] as const;
type StateId = (typeof STATES)[number]["id"];

const notice = (
  <Toast
    key="notice"
    tone="success"
    duration={0}
    title="완료: 빌드 실패 분석"
    description="~/code/fresnel · 원인 2개를 정리했어요"
    actionLabel="열기"
  />
);
const agentNotice = (
  <Toast
    key="agent"
    tone="agent"
    duration={0}
    title="학습 검토 끝: 후보 3"
    description="grp.learning · 받은 요청에 올렸어요"
    actionLabel="열기"
  />
);
const result = <Toast key="result" tone="success" duration={0} title="진단을 복사했어요" />;
const failedNotice = (
  <Toast
    key="failed"
    tone="danger"
    statusLabel="실패"
    title="예약 실패: 매일 정리"
    description="rate_limited · 14:00에 다시 시도해요"
    actionLabel="열기"
    dismissLabel="닫기"
  />
);
const appError = (
  <Toast
    key="error"
    tone="danger"
    statusLabel="오류"
    title="기본 모델을 저장하지 못했어요"
    description="openai/gpt-6은 키가 등록된 제공자가 아니에요."
    dismissLabel="닫기"
  />
);
const merged = (
  <Toast
    key="merged"
    tone="success"
    duration={0}
    title="대화 3개가 끝났어요"
    description="빌드 실패 분석 외 2"
    actionLabel="열기"
  />
);

const STACKS: Record<StateId, ReactNode[]> = {
  S1: [agentNotice, result, failedNotice],
  S2: [notice],
  S3: [result],
  S4: [appError],
  S5: [merged],
};

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          <ShellStateProvider>
            <QuietPage onNew={() => {}} closeEnd>
              {/* 상태 표시줄(28px)과 오른쪽 떠 있는 막대를 피해 쌓는다. 새 토스트가 아래. */}
              <ToastViewport label="알림" className="bottom-10 end-14">
                {STACKS[state]}
              </ToastViewport>
            </QuietPage>
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
