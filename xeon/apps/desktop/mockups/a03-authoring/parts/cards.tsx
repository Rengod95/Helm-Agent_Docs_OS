// 제작 대화의 사람 확인 카드 다섯(N-09)과 결과 카드(N-10). 확인은 drive 원시 loop.ask가 낸 표준 승인 카드다(결정 캔버스 8):
// 고르기가 있으면 QuestionCard(question kind), 위험한 쓰기·비용이면 AgentRequest permission + ListDescription(DP-12). 출처는 grp:authoring(DP-33).
// 결과 카드는 card slot `authoring/result`(ADR-0021 §3.2): 셸 틀(PluginCard: 확장 이름 mono + "더 보기") 안에 확장 트리가 그린 모습.
import { AgentRequest, Button, ListDescription, ListDescriptionRow, Tooltip } from "@caustic/react";
import { useState } from "react";
import {
  Copy,
  FolderOpen,
  josa,
  Lock,
  QuestionCard,
  T,
  WandSparkles,
  type QuestionApproval,
} from "../../_shell";
import { PluginCard } from "../../_chat-rt";
import { DIR, DISPLAY, NAME, SRC, type AskState } from "../flow";

const LD = "rounded-none [--cs-size-list-term:7rem] [&_[data-slot=list-description-row]]:px-0";

/** 1. 종류·이름 확인(intent 단계). */
export function KindCard({
  state,
  blocked,
  onAnswer,
  onDeny,
}: {
  state: AskState;
  blocked: boolean;
  onAnswer: (kind: string) => void;
  onDeny: () => void;
}) {
  const q: QuestionApproval = {
    kind: "question",
    thread: "",
    at: "14:12",
    questions: [
      {
        id: "kind",
        header: `${T.kind}와 이름`,
        text: blocked
          ? `관찰 ${T.group} audit-trail로 만들까요? ${T.targetFolder}는 ~/code/fresnel-ext/audit-trail이에요.`
          : `${DISPLAY}(${NAME})를 의도 ${T.group}으로 만들까요? ${T.targetFolder}는 ${DIR}예요.`,
        multiSelect: false,
        allowFreeText: true,
        options: blocked
          ? [
              {
                id: "group.observe",
                label: "관찰 그룹 · group.observe",
                description: "tool.call.after를 보고 기록만 남겨요",
                recommended: true,
              },
              {
                id: "x.hook",
                label: `X 훅 · x.hook (${T.catalogBlocked})`,
                description: "외부 훅 규약이 정해지면 열려요",
              },
            ]
          : [
              {
                id: "group.drive",
                label: "플러그인 그룹 · group.drive",
                description: "정해진 시각에 턴을 직접 구동해요",
                recommended: true,
              },
              {
                id: "group.observe",
                label: "관찰 그룹 · group.observe",
                description: "요약을 기록만 하고 턴은 구동하지 않아요",
              },
            ],
      },
    ],
  };
  const [answer, setAnswer] = useState<{ pick: string | null; text: string }>({
    pick: blocked ? "group.observe" : "group.drive",
    text: "",
  });
  return (
    <QuestionCard
      approval={q}
      status={state === "pending" ? "pending" : state === "done" ? "answered" : "denied"}
      subtitle={`${SRC} · ${T.stageIntent} · 14:12`}
      answer={answer}
      onAnswerChange={setAnswer}
      onAnswer={() => onAnswer(answer.pick === "x.hook" ? "group.observe" : (answer.pick ?? ""))}
      onDeny={onDeny}
    />
  );
}

/** 2. 고치기 한도(같은 검사 오류가 3번). */
export function FixCard({
  state,
  onStop,
  onRedo,
}: {
  state: AskState;
  onStop: () => void;
  onRedo: () => void;
}) {
  const q: QuestionApproval = {
    kind: "question",
    thread: "",
    at: "14:16",
    questions: [
      {
        id: "fix",
        header: `${T.stageFix} 한도 3/3`,
        text: "AU-003이 세 번 고쳐도 남았어요. 어떻게 할까요?",
        multiSelect: false,
        allowFreeText: true,
        options: [
          {
            id: "stop",
            label: "여기서 멈추기",
            description: `파일은 ${T.targetFolder}에 남겨요. 직접 고친 뒤 이어서 할 수 있어요`,
            recommended: true,
          },
          {
            id: "redo",
            label: `${T.stageCompose}부터 다시`,
            description: `drive ${T.block}의 points를 다시 맞춰요`,
          },
        ],
      },
    ],
  };
  const [answer, setAnswer] = useState<{ pick: string | null; text: string }>({
    pick: "stop",
    text: "",
  });
  return (
    <QuestionCard
      approval={q}
      status={state === "pending" ? "pending" : "answered"}
      subtitle={`${SRC} · AU-003 · 14:16`}
      answer={answer}
      onAnswerChange={setAnswer}
      onAnswer={() => (answer.pick === "redo" ? onRedo() : onStop())}
      onDeny={onStop}
    />
  );
}

/** 3. 테스트 비용(trial 단계 전). */
export function TrialCard({
  state,
  onYes,
  onNo,
}: {
  state: AskState;
  onYes: () => void;
  onNo: () => void;
}) {
  if (state !== "pending")
    return (
      <AgentRequest
        kind="permission"
        status={state === "done" ? "allowed" : "denied"}
        title={state === "done" ? `${T.trial}하기로 했어요` : `${T.trial}를 건너뛰었어요`}
        subtitle={`${T.trialThread} 1 · 예상 토큰 40k · ${SRC}`}
      />
    );
  return (
    <AgentRequest
      kind="permission"
      title={`${T.trialThread}를 열까요?`}
      subtitle={`${SRC} · 비용이 들어요 · 14:14`}
      shadow="none"
      className="shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]"
      actions={[
        { id: "no", label: "건너뛰기", tone: "danger" },
        { id: "yes", label: `${T.trial}하기`, tone: "primary" },
      ]}
      onAction={(id) => (id === "yes" ? onYes() : onNo())}
    >
      <ListDescription variant="ghost" size="xs" aria-label={`${T.trial} 비용`} className={LD}>
        <ListDescriptionRow term="대상">
          <span className="font-mono">{NAME}</span> · 이 {T.trialThread}에서만 켜요
        </ListDescriptionRow>
        <ListDescriptionRow term="모델">sonnet-5-5 · 예상 토큰 40k</ListDescriptionRow>
        <ListDescriptionRow term="보낼 입력">“오늘 아침 요약을 만들어 줘”</ListDescriptionRow>
        <ListDescriptionRow term="빠지는 것">
          학습 {T.group} 리뷰 · 실제 예약 실행
        </ListDescriptionRow>
      </ListDescription>
    </AgentRequest>
  );
}

const FILES: [string, string][] = [
  ["fresnel.extension.json", "9f2c…41ad"],
  ["src/index.ts", "c81e…0b7f"],
  ["src/drive.ts", "47aa…e912"],
  ["src/digest.ts", "1d03…5c2e"],
  ["src/state.ts", "b6f0…77a1"],
  ["views/well.json", "e2d9…3f48"],
  ["skills/digest.md", "08c7…aa10"],
  ["test/drive.test.ts", "5b1e…c9d4"],
  ["README.md", "f4a2…6e03"],
];

/** 4. 묶기 전 경고(파일 목록과 SHA-256). */
export function PackageCard({
  state,
  onYes,
  onNo,
}: {
  state: AskState;
  onYes: () => void;
  onNo: () => void;
}) {
  if (state !== "pending")
    return (
      <AgentRequest
        kind="permission"
        status={state === "done" ? "allowed" : "denied"}
        title={state === "done" ? "묶었어요" : "묶지 않았어요"}
        subtitle={`${NAME}-0.1.0.tgz · 파일 9 · ${SRC}`}
      />
    );
  return (
    <AgentRequest
      kind="permission"
      title={`${NAME}-0.1.0으로 묶을까요?`}
      subtitle={`${SRC} · 경고 2 · 14:19`}
      shadow="none"
      className="shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]"
      actions={[
        { id: "no", label: "취소", tone: "danger" },
        { id: "yes", label: T.stagePackage, tone: "primary" },
      ]}
      onAction={(id) => (id === "yes" ? onYes() : onNo())}
    >
      <ListDescription variant="ghost" size="xs" aria-label="묶기 전 경고" className={LD}>
        <ListDescriptionRow term="경고">
          <span className="grid gap-0.5">
            <span>
              <span className="font-mono">AU-010</span> 외부 쓰기 {T.step}에 {T.humanGate}이 없어요
            </span>
            <span>
              <span className="font-mono">AU-011</span> 상태 스키마 마이그레이션이 없어요
            </span>
          </span>
        </ListDescriptionRow>
        <ListDescriptionRow term="빼는 파일">
          .env 같은 시크릿 파일은 넣지 않아요
        </ListDescriptionRow>
        <ListDescriptionRow term={`파일 ${FILES.length} · SHA-256`}>
          <span className="grid gap-0.5 font-mono text-mono-sm">
            {FILES.map(([f, h]) => (
              <span key={f} className="flex min-w-0 flex-wrap gap-x-3">
                <span className="min-w-0 flex-1 truncate">{f}</span>
                <span className="flex-none text-text-tertiary">{h}</span>
              </span>
            ))}
          </span>
        </ListDescriptionRow>
      </ListDescription>
    </AgentRequest>
  );
}

/** 5. 연결 전(사용자 확장 위치). */
export function LinkCard({
  state,
  onYes,
  onNo,
}: {
  state: AskState;
  onYes: () => void;
  onNo: () => void;
}) {
  if (state !== "pending")
    return (
      <AgentRequest
        kind="permission"
        status={state === "done" ? "allowed" : "denied"}
        title={state === "done" ? `${T.installLink}했어요` : `${T.installLink}하지 않았어요`}
        subtitle={`~/.fresnel/extensions/${NAME} · ${SRC}`}
      />
    );
  return (
    <AgentRequest
      kind="permission"
      title={`${T.userExtDir}에 ${T.installLink}할까요?`}
      subtitle={`${SRC} · 14:20`}
      shadow="none"
      className="shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]"
      actions={[
        { id: "no", label: "나중에", tone: "danger" },
        { id: "yes", label: T.installLink, tone: "primary" },
      ]}
      onAction={(id) => (id === "yes" ? onYes() : onNo())}
    >
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label={`${T.installLink} 내용`}
        className={LD}
      >
        <ListDescriptionRow term="위치" mono>
          ~/.fresnel/extensions/{NAME}
        </ListDescriptionRow>
        <ListDescriptionRow term={T.trust}>
          {T.trustUser} · 켤 때 {T.trust} 확인을 한 번 더 받아요
        </ListDescriptionRow>
        <ListDescriptionRow term="켜짐">꺼진 채로 들어가요</ListDescriptionRow>
        <ListDescriptionRow term={T.extensionPoint}>
          drive · session.start · turn.end
        </ListDescriptionRow>
      </ListDescription>
    </AgentRequest>
  );
}

const CHECKS: { code: string; text: string; level: "ok" | "warn" | "info" }[] = [
  { code: "AU-001", text: "이름 규칙", level: "ok" },
  { code: "AU-003", text: "구성 초안과 매니페스트", level: "ok" },
  { code: "AU-005", text: "화면 slot과 방식", level: "ok" },
  { code: "AU-010", text: `외부 쓰기 ${T.step}에 ${T.humanGate} 없음`, level: "warn" },
  { code: "AU-011", text: "상태 마이그레이션 없음", level: "warn" },
  { code: "AU-012", text: "재생 규율(scanDriveSource)", level: "ok" },
];

/** N-10 결과 카드(card slot authoring/result). */
export function ResultCard({
  view,
  web,
  trialSkipped,
  linked,
  onTrial,
  onLink,
  onReplay,
  onMore,
}: {
  view: "declarative" | "frame";
  /** 웹·원격: 편집기 열기 대신 경로 복사. */
  web: boolean;
  trialSkipped: boolean;
  linked: boolean;
  onTrial: () => void;
  onLink: () => void;
  onReplay: () => void;
  onMore: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <PluginCard ext="authoring" icon={<WandSparkles />} onMore={onMore} moreLabel="제작 화면">
      <div className="grid gap-0.5">
        <div className="text-ui-strong font-semibold text-text-primary">
          {DISPLAY} <span className="font-mono text-mono-sm text-text-tertiary">{NAME}</span>
          {josa(NAME, "을", "를").slice(NAME.length)} 만들었어요
        </div>
        <div className="text-ui-xs text-text-tertiary">
          group.drive · 0.1.0 · {T.catalog} 2026.11 · {DIR}
        </div>
      </div>
      <ListDescription variant="ghost" size="xs" aria-label="제작 결과" className={LD}>
        <ListDescriptionRow term={T.viewMode}>
          {view === "declarative" ? (
            <span className="grid gap-0.5">
              <span>
                {T.viewDeclarative} · {T.slotWell}
              </span>
              <span className="text-text-tertiary">목록과 버튼뿐이라 기본 부품으로 충분해요</span>
            </span>
          ) : (
            <span className="grid gap-0.5">
              <span>
                {T.viewFrame} · {T.slotPage} <span className="font-mono">frame.reason</span>
              </span>
              <span className="text-text-tertiary">
                시간대별 막대 차트가 기본 부품에 없어요 · 대체 트리 있음
              </span>
            </span>
          )}
        </ListDescriptionRow>
        <ListDescriptionRow term={T.authoringCheck}>
          <span className="grid gap-0.5">
            <span>
              12 통과 · 경고 2 · 오류 0
              {view === "frame" && (
                <span className="text-text-tertiary"> · AU-008 정보: 트리 후보 있음</span>
              )}
            </span>
            {CHECKS.filter((c) => c.level !== "ok").map((c) => (
              <span key={c.code} className="text-text-secondary">
                <span className="font-mono">{c.code}</span> {c.text}
              </span>
            ))}
          </span>
        </ListDescriptionRow>
        <ListDescriptionRow term={T.trial}>
          {trialSkipped ? (
            "건너뜀"
          ) : (
            <>
              아침 요약 {T.trial} · {T.step} 4 · 실패 0 · 토큰 31k
            </>
          )}
        </ListDescriptionRow>
        <ListDescriptionRow term={T.replay}>
          <span className="inline-flex items-center gap-1 text-text-tertiary">
            <Lock aria-hidden emphasis="muted" className="size-icon-xs" />
            {T.devMode}에서만
          </span>
        </ListDescriptionRow>
      </ListDescription>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="xs" tone="neutral" variant="solid" onClick={onTrial}>
          {T.trialThread}에서 켜기
        </Button>
        {web ? (
          <Button
            size="xs"
            tone="neutral"
            variant="outline"
            iconStart={<Copy />}
            onClick={() => setCopied(true)}
          >
            {copied ? "경로 복사함" : "경로 복사"}
          </Button>
        ) : (
          <Button size="xs" tone="neutral" variant="outline" iconStart={<FolderOpen />}>
            편집기에서 열기
          </Button>
        )}
        <Button size="xs" tone="neutral" variant="outline" disabled={linked} onClick={onLink}>
          {linked ? `${T.installLink}됨` : `${T.userExtDir}에 ${T.installLink}`}
        </Button>
        <Tooltip content={`${T.devMode}에서만 돌아요. 배포 앱은 ${T.trialThread}로 확인해요`}>
          <span className="ms-auto">
            <Button
              size="xs"
              tone="neutral"
              variant="ghost"
              iconStart={<Lock />}
              aria-disabled
              onClick={onReplay}
            >
              {T.replay}
            </Button>
          </span>
        </Tooltip>
      </div>
      {web && (
        <p className="m-0 text-ui-xs text-text-tertiary">
          웹에서는 파일을 열 수 없어요. 경로를 복사해 {T.thread}가 도는 컴퓨터에서 여세요.
        </p>
      )}
    </PluginCard>
  );
}
