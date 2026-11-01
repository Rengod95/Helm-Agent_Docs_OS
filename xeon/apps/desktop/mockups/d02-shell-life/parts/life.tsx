// 셸 수명 부품(묶음 D): 엔진 재기동 띠(N-54), 안전 모드 시작 제안 카드(N-55, W-35·W-39), 안전 모드 문구(N-56, 결정 12),
// 백그라운드 작업 목록(N-58, 계획에 없음 10), 앱 업데이트 칸 본문·다시 시작 확인(계획에 없음 1, L4.release §5).
// caustic Alert·Card·Button·ListDescription·Progress·Dialog로 짜고 tone은 아이콘 면에만(DP-29).
import {
  Alert,
  Button,
  Card,
  Dialog,
  DialogClose,
  ListDescription,
  ListDescriptionRow,
  Progress,
} from "@caustic/react";
import { useState, type ReactNode } from "react";
import {
  CalendarClock,
  ChevronRight,
  CircleAlert,
  Download,
  extName,
  FlaskConical,
  MessageSquare,
  RotateCw,
  Shield,
  T,
  ToneIcon,
  WandSparkles,
  josa,
} from "../../_shell";

/** 안전 모드에서 싣지 않는 것(결정 12: X 훅 포함). 모든 안전 모드 문구가 이 한 줄을 쓴다. */
export const SAFE_OFF = `${T.group}, 사용자·프로젝트 ${T.extension}, ${T.xHook}`;

/** 엔진 다시 시작 중·실패 띠(무대 입력창 위). 대화와 쓰던 글은 남는다. */
export function EngineBand({
  phase,
  attempt,
  limit,
  web = false,
}: {
  phase: "restarting" | "starting-safe";
  attempt: number;
  limit: number;
  web?: boolean;
}) {
  return (
    <Alert tone="warning" emphasis="lead" icon={<RotateCw />} size="sm">
      {phase === "starting-safe" ? (
        <>
          <b>{T.safeMode}로 시작하는 중이에요.</b> {SAFE_OFF}를 싣지 않아요.
        </>
      ) : web ? (
        <>
          <b>
            서비스에 다시 연결하는 중이에요({attempt}/{limit}).
          </b>{" "}
          대화와 쓰던 글은 그대로예요.
        </>
      ) : (
        <>
          <b>
            {josa(T.engine, "이", "가")} 멈춰서 다시 시작하는 중이에요({attempt}/{limit}).
          </b>{" "}
          대화와 쓰던 글은 그대로예요.
        </>
      )}
    </Alert>
  );
}

/** 안전 모드 시작 제안 카드(N-55). host.status.suggestSafeMode가 참이고 safeModeCause가 있으면 무대 가운데에. */
export function SafeSuggestCard({
  onSafe,
  onRetry,
  onCopy,
  busy,
}: {
  onSafe: () => void;
  onRetry: () => void;
  onCopy: () => void;
  busy: "safe" | "retry" | null;
}) {
  const [log, setLog] = useState(false);
  return (
    <Card
      variant="surface"
      role="alert"
      aria-labelledby="safe-title"
      className="grid gap-3 rounded-2xl bg-surface-base px-inset-compact-x py-inset-compact-y shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]"
    >
      <div className="flex items-start gap-3">
        <ToneIcon tone="danger">
          <CircleAlert />
        </ToneIcon>
        <div className="grid min-w-0 gap-0.5">
          <h2 id="safe-title" className="m-0 text-ui-strong font-semibold text-text-primary">
            {josa(T.engine, "이", "가")} 3번 연속 시작하지 못했어요
          </h2>
          <p className="m-0 text-ui-sm text-text-secondary">
            {T.safeMode}로 시작하면 {SAFE_OFF}를 싣지 않고 기본 에이전트만 띄워요. 원인을 끄거나
            고친 뒤 다시 켤 수 있어요.
          </p>
        </div>
      </div>
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label="시작 실패 원인"
        className="rounded-none [--cs-size-list-term:7rem] [&_[data-slot=list-description-row]]:px-0"
      >
        <ListDescriptionRow term="원인">
          {extName("acme-notes")}{" "}
          <span className="font-mono text-text-tertiary">ext:acme-notes</span> · 시작 중 오류
        </ListDescriptionRow>
        <ListDescriptionRow term="safeModeCause" mono>
          ext.load_failed
        </ListDescriptionRow>
        <ListDescriptionRow term="연속 실패">3 / 3 · 10분 안</ListDescriptionRow>
        <ListDescriptionRow term="마지막 종료">종료 코드 1 · 14:05:12</ListDescriptionRow>
      </ListDescription>
      {log && (
        <pre className="m-0 max-h-40 overflow-auto rounded-lg bg-bg-inset p-2 font-mono text-mono-sm text-text-secondary">
          {`[ext-host] loading ext:acme-notes@0.3.1
[ext-host] on("tool.call.after") registered
TypeError: Cannot read properties of undefined (reading 'vault')
    at activate (acme-notes/index.ts:41:18)
[host] startup failed: ext.load_failed (ext:acme-notes)
[host] exit 1`}
        </pre>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" tone="neutral" variant="ghost" onClick={() => setLog(!log)}>
          {log ? "로그 접기" : "stderr 마지막 20줄"}
        </Button>
        <Button size="sm" tone="neutral" variant="ghost" onClick={onCopy}>
          진단 복사
        </Button>
        <span aria-hidden className="flex-1" />
        <Button
          size="sm"
          tone="neutral"
          variant="outline"
          loading={busy === "retry"}
          disabled={busy !== null}
          onClick={onRetry}
        >
          그대로 다시 시작
        </Button>
        <Button
          size="sm"
          tone="neutral"
          loading={busy === "safe"}
          disabled={busy !== null}
          onClick={onSafe}
        >
          {T.safeMode}로 시작
        </Button>
      </div>
    </Card>
  );
}

/** 안전 모드 칩 Popover 본문(§4-5 계획에 없음 5, N-56): 왜 Helm이 없는지. */
export function SafeBody() {
  return (
    <ListDescription
      variant="ghost"
      size="xs"
      aria-label="안전 모드에서 빠진 것"
      className="rounded-none [--cs-size-list-term:4.5rem] [&_[data-slot=list-description-row]]:px-0"
    >
      <ListDescriptionRow term={`${T.group}`}>Helm, 학습, 리뷰</ListDescriptionRow>
      <ListDescriptionRow term={T.extension}>Acme 노트, 웹 검색(Exa)</ListDescriptionRow>
      <ListDescriptionRow term={T.xHook}>감사 기록 훅 외 1</ListDescriptionRow>
      <ListDescriptionRow term="원인" mono>
        ext.load_failed · ext:acme-notes
      </ListDescriptionRow>
    </ListDescription>
  );
}

export interface BgItem {
  kind: "thread" | "trial" | "schedule" | "authoring";
  id: string;
  title: string;
  note: string;
  failed?: boolean;
}

const BG_ICON: Record<BgItem["kind"], ReactNode> = {
  thread: <MessageSquare emphasis="muted" />,
  trial: <FlaskConical emphasis="muted" />,
  schedule: <CalendarClock emphasis="muted" />,
  authoring: <WandSparkles emphasis="muted" />,
};
const BG_HEAD: Record<BgItem["kind"], string> = {
  thread: T.thread,
  trial: T.trialThread,
  schedule: T.schedules,
  authoring: T.authoringSession,
};

/** "진행 중 n" Popover 본문(N-58, 계획에 없음 10): 종류별 한곳 목록. 행을 누르면 그곳으로. */
export function BgWorkBody({ items, onGo }: { items: BgItem[]; onGo: (it: BgItem) => void }) {
  const kinds = (["thread", "trial", "schedule", "authoring"] as const).filter((k) =>
    items.some((i) => i.kind === k),
  );
  return (
    <div className="grid gap-2">
      {kinds.map((k) => (
        <section key={k} aria-label={BG_HEAD[k]} className="grid gap-0.5">
          <h3 className="m-0 text-ui-xs font-normal text-text-tertiary">{BG_HEAD[k]}</h3>
          {items
            .filter((i) => i.kind === k)
            .map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => onGo(i)}
                className="-mx-1.5 flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-start outline-none hover:bg-fill-hover focus-visible:focus-ring"
              >
                {i.failed === true ? (
                  <ToneIcon tone="danger">
                    <CircleAlert />
                  </ToneIcon>
                ) : (
                  <span
                    aria-hidden
                    className="inline-grid size-5 place-items-center [&_svg]:size-icon-xs"
                  >
                    {BG_ICON[k]}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-ui-sm text-text-primary">
                  {i.title}
                </span>
                <span className="flex-none text-ui-xs text-text-tertiary">{i.note}</span>
                <ChevronRight aria-hidden className="size-icon-xs flex-none text-text-tertiary" />
              </button>
            ))}
        </section>
      ))}
    </div>
  );
}

export type Upd =
  | "none"
  | "available"
  | "downloading"
  | "ready"
  | "applying"
  | "done"
  | "failDownload"
  | "failSignature";

/** 업데이트 칸 Popover 본문: 버전, 바뀐 점 세 줄, 진행, 실패 이유. */
export function UpdateBody({ u, pct }: { u: Upd; pct: number }) {
  return (
    <div className="grid gap-2">
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label="버전"
        className="rounded-none [--cs-size-list-term:5rem] [&_[data-slot=list-description-row]]:px-0"
      >
        <ListDescriptionRow term="지금" mono>
          0.4.1
        </ListDescriptionRow>
        <ListDescriptionRow term="새 버전" mono>
          0.4.2 · 38 MB
        </ListDescriptionRow>
      </ListDescription>
      {(u === "available" || u === "ready") && (
        <ul className="m-0 grid gap-0.5 ps-4 text-ui-sm text-text-secondary">
          <li>
            {T.trialThread} 멈춤이 다음 {T.stepBoundary}에서 바로 멈춰요
          </li>
          <li>
            {T.safeMode}에서 {T.xHook}을 싣지 않아요
          </li>
          <li>승인 카드 키 Y·N이 받은 요청에서도 돼요</li>
        </ul>
      )}
      {u === "downloading" && (
        <div className="grid gap-1">
          <Progress value={pct} size="xs" label="내려받는 중" />
          <span className="text-ui-xs text-text-tertiary tabular-nums">
            {pct}% · 서명 확인은 받은 뒤에 해요
          </span>
        </div>
      )}
      {u === "failDownload" && (
        <Alert tone="danger" size="sm">
          내려받지 못했어요 · 연결이 끊겼어요(21%에서). 지금 버전은 그대로예요.
        </Alert>
      )}
      {u === "failSignature" && (
        <Alert tone="danger" size="sm">
          서명이 맞지 않아 설치하지 않았어요. 받은 파일은 지웠어요. 지금 버전은 그대로예요.
        </Alert>
      )}
    </div>
  );
}

/** 다시 시작 확인(진행 중 턴이 있으면). 기본 초점은 "나중에". */
export function RestartDialog({
  onLater,
  onAfterTurn,
  onNow,
}: {
  onLater: () => void;
  onAfterTurn: () => void;
  onNow: () => void;
}) {
  return (
    <Dialog
      open
      kind="alert"
      size="sm"
      tone="neutral"
      onOpenChange={(o) => !o && onLater()}
      icon={<Download />}
      title={`다시 시작해서 0.4.2로 바꿀까요?`}
      description={`진행 중인 ${T.turn} 1개가 멈춰요. 다시 시작한 뒤 "${T.resume}"로 이어갈 수 있어요.`}
      footer={
        <>
          <DialogClose asChild>
            <Button size="sm" tone="neutral" variant="outline" autoFocus>
              나중에
            </Button>
          </DialogClose>
          <Button size="sm" tone="neutral" variant="outline" onClick={onAfterTurn}>
            {T.turn}이 끝나면
          </Button>
          <Button size="sm" tone="neutral" onClick={onNow}>
            지금 다시 시작
          </Button>
        </>
      }
    >
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label="멈추는 것"
        className="rounded-none [--cs-size-list-term:7rem] [&_[data-slot=list-description-row]]:px-0"
      >
        <ListDescriptionRow term={`진행 중 ${T.turn}`}>
          캐시 무효화 조사 · {T.turn} 3
        </ListDescriptionRow>
        <ListDescriptionRow term={T.trialThread}>
          렌즈 5개로 넓히기 · 다음 {T.stepBoundary}에서 멈춤
        </ListDescriptionRow>
        <ListDescriptionRow term={T.schedules}>다음 실행 09:00 · 영향 없음</ListDescriptionRow>
      </ListDescription>
    </Dialog>
  );
}

/** 업데이트 적용 중·WebView 다시 붙는 중: 창 전체를 덮는 짧은 화면. */
export function Relaunch({ text }: { text: string }) {
  return (
    <div
      role="status"
      className="fixed inset-0 z-[60] grid place-items-center bg-bg-app animate-enter"
    >
      <div className="grid justify-items-center gap-3">
        <Shield aria-hidden className="size-6 text-text-tertiary" />
        <p className="m-0 text-ui-sm text-text-secondary">{text}</p>
        <Progress decorative size="xs" className="w-40" />
      </div>
    </div>
  );
}
