// P-19 고른 행 상세(같은 화면 아래, 나눔 창 대신 위아래 흐름 [gap:C-14]).
// - 테스트 대화: 실행 제어 띠(멈춤·한 단계씩·이어서), 턴 다시 보기 막대(§6.22.5, 계측이 꺼지면 잠김), 단계 사이 기록,
//   대상 자동 꺼짐으로 멈춘 테스트는 실패 기록(authoring §5).
// - replay: 배포 앱은 지난 결과 요약만 읽기 전용, "다시 실행"은 잠금 이유 툴팁. 개발 모드면 ReplayDriveReport 그대로
//   (절단 띠, 첫 차이, 효과 수 EffectCounts) + "JSON 복사"(결정 9).
import {
  Alert,
  Badge,
  Button,
  CodeDiff,
  CodeDiffLine,
  ListDescription,
  ListDescriptionRow,
  Progress,
  Tooltip,
} from "@caustic/react";
import type { ReactNode } from "react";
import {
  ArrowRightToLine,
  CircleAlert,
  Copy,
  extJ,
  extName,
  FlaskConical,
  josa,
  LoaderCircle,
  Lock,
  MessageSquare,
  Pause,
  Play,
  profiles,
  RotateCcw,
  T,
} from "../../_shell";
import { boundaries, replayReport, ticks, type Run } from "../../_wb-c/data";
import { DevLock, ExtName, Mono, ReadOnlyNote, SectionTitle } from "../../_wb-c/parts";
import { TurnReplayBar, TurnReplayLocked } from "../../_wb-c/turn-replay";
import { goFolder } from "../../_wb-c/frame";

const LD = "rounded-none [--cs-size-list-term:7.5rem] [&_[data-slot=list-description-row]]:px-0";

export const profileTitle = (id: string) => profiles.find((p) => p.id === id)?.title ?? id;

/** 입력창 위 테스트 띠와 같은 면(a01-trial-chat parts/trial-band). 상태 아이콘 하나 + 글 + 동작 둘까지. */
function Band({
  icon,
  tone,
  text,
  meta,
  children,
}: {
  icon: ReactNode;
  tone?: "danger";
  text: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-neutral-well px-3 py-1.5 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]">
      <span
        aria-hidden
        className={`inline-grid size-5 place-items-center rounded-sm [&_svg]:size-icon-sm ${tone === "danger" ? "bg-danger-soft text-danger-text" : "text-text-tertiary"}`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-ui-dense text-text-primary">
        {text}
        {meta !== undefined && (
          <span className="ms-2 text-text-tertiary max-compact:hidden">{meta}</span>
        )}
      </span>
      {children !== undefined && (
        <span className="flex flex-none items-center gap-1">{children}</span>
      )}
    </div>
  );
}

export function TrialDetail({
  run,
  traceOff,
  evicted,
  onPause,
  onStep,
  onResume,
  onTraceSettings,
}: {
  run: Run;
  traceOff: boolean;
  /** 이 테스트의 턴 기록이 버퍼 밖으로 밀려났다(N-39). */
  evicted: boolean;
  onPause: () => void;
  onStep: () => void;
  onResume: () => void;
  onTraceSettings: () => void;
}) {
  const [step, total] = run.steps ?? [0, 6];
  const stopped = run.result === "stopped";
  const fresh = run.steps?.[0] === 0;
  const band = (() => {
    switch (run.result) {
      case "running":
        return (
          <Band
            icon={<FlaskConical emphasis="muted" />}
            text={`${T.trial} 실행 중`}
            meta={`${T.step} ${step}/${total}`}
          >
            <Button
              size="xs"
              tone="neutral"
              variant="outline"
              iconStart={<Pause />}
              onClick={onPause}
            >
              멈춤
            </Button>
          </Band>
        );
      case "pausing":
        return (
          <Band
            icon={<LoaderCircle className="animate-spin" />}
            text="멈추는 중"
            meta={`이번 ${josa(T.step, "이", "가")} 끝나면 멈춰요`}
          />
        );
      case "paused":
        return (
          <Band
            icon={<Pause emphasis="muted" />}
            text={`${T.stepBoundary}에서 멈춤`}
            meta={`${T.step} ${step}/${total} · ${T.lead} ${extName(run.target)} 유지`}
          >
            <Button
              size="xs"
              tone="neutral"
              variant="ghost"
              iconStart={<ArrowRightToLine />}
              onClick={onStep}
            >
              {T.stepOnce}
            </Button>
            <Button
              size="xs"
              tone="neutral"
              variant="outline"
              iconStart={<Play />}
              onClick={onResume}
            >
              이어서
            </Button>
          </Band>
        );
      case "stopped":
        return (
          <Band
            icon={<CircleAlert />}
            tone="danger"
            text={`${extJ(run.target, "이", "가")} ${josa(T.autoDisabled, "이라", "라")} ${josa(T.trial, "을", "를")} 멈췄어요`}
            meta={`${T.step} ${step}/${total} · 연속 실패 5`}
          >
            <Button
              size="xs"
              tone="neutral"
              variant="outline"
              onClick={() => goFolder("c03-ext-list")}
            >
              다시 켜고 이어서
            </Button>
          </Band>
        );
      default:
        return (
          <Band
            icon={<FlaskConical emphasis="muted" />}
            text={`${T.trial} 끝`}
            meta={`${T.step} ${total}/${total} · 실패 0`}
          />
        );
    }
  })();

  return (
    <div className="grid gap-4">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="m-0 truncate text-ui-strong text-text-primary">{run.title}</h2>
        <Badge size="xs" tone="neutral" icon={<FlaskConical />} className="shrink-0">
          {T.trial}
        </Badge>
        <Button
          size="xs"
          tone="neutral"
          variant="ghost"
          iconStart={<MessageSquare />}
          className="ms-auto"
          onClick={() => goFolder("a01-trial-chat", "state=paused")}
        >
          대화로 열기
        </Button>
      </div>
      {band}
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label={`${T.trialThread} 정보`}
        className={LD}
      >
        <ListDescriptionRow term="대상">
          <ExtName id={run.target} />
        </ListDescriptionRow>
        <ListDescriptionRow term={T.profile}>
          {profileTitle(run.profile ?? "")}{" "}
          <span className="text-text-tertiary">· 이 {T.thread}에만 적용</span>
        </ListDescriptionRow>
        <ListDescriptionRow term="시작">
          {run.at} <span className="text-text-tertiary">· 소요 {run.took}</span>
        </ListDescriptionRow>
      </ListDescription>

      {!fresh && (
        <section className="grid gap-1.5">
          <SectionTitle end={`${T.turn} 2 · 대화마다 최근 8${T.turn}`}>{T.turnReplay}</SectionTitle>
          {traceOff ? (
            <TurnReplayLocked onSettings={onTraceSettings} />
          ) : evicted ? (
            <TurnReplayLocked evicted />
          ) : (
            <TurnReplayBar ticks={ticks} turn={2} />
          )}
        </section>
      )}

      {stopped ? (
        <section className="grid gap-1">
          <SectionTitle end="연속 5 · 최근 50번 중 5">실패 기록</SectionTitle>
          <ol className="m-0 grid list-none gap-0.5 p-0" aria-label="실패 기록">
            {["14:40:12", "14:40:09", "14:40:05", "14:39:58", "14:39:51"].map((at, i) => (
              <li
                key={at}
                className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-3 text-ui-dense"
              >
                <Mono>{at}</Mono>
                <span className="truncate text-text-secondary">
                  boundary.settle.after · threw <Mono>src/review/settle.ts:88</Mono>
                  {i === 0 && (
                    <span className="text-text-tertiary"> · 5번째, {T.autoDisabled}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <section className="grid gap-1">
          <SectionTitle end={fresh ? undefined : `${T.lead} ${extName(run.target)}`}>
            {T.boundaryLog}
          </SectionTitle>
          {fresh ? (
            <p className="m-0 text-ui-sm text-text-tertiary">
              첫 {T.stepBoundary}에 닿으면 여기에 쌓여요.
            </p>
          ) : (
            <ol className="m-0 grid list-none gap-0.5 p-0" aria-label={T.boundaryLog}>
              {boundaries.map((b) => (
                <li
                  key={b.n}
                  className="grid grid-cols-[1.5rem_4.5rem_minmax(0,1fr)_auto] items-baseline gap-3 text-ui-dense"
                >
                  <span className="text-end tabular-nums text-text-tertiary">{b.n}</span>
                  <Mono>{b.at}</Mono>
                  <span className="truncate text-text-primary">{b.text}</span>
                  <span className="text-ui-xs text-text-tertiary">
                    {b.stop === true && run.result !== "done" ? "여기서 멈춤 · " : ""}
                    {T.turn} {b.turn} · seq {b.seq}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}

/** 절단 띠: 커밋 시점마다 한 칸. 같으면 연한 칸, 다르면 danger 칸(tone은 칸 면에만, DP-29). done까지만 채움(다시 실행 중). */
function CutStrip({ done }: { done: number }) {
  const diff = replayReport.cuts.filter((c) => !c.equal).map((c) => c.n);
  return (
    <div className="grid gap-1">
      <div
        role="img"
        aria-label={`커밋 시점 ${replayReport.commits}개를 모두 끊어 다시 돌렸어요. ${diff.join(", ")}번이 달랐어요.`}
        className="flex flex-wrap gap-0.5"
      >
        {replayReport.cuts.map((c) => (
          <span
            key={c.n}
            title={`절단 ${c.n}${c.equal ? " 같음" : " 다름"}`}
            className={`h-3.5 w-2 rounded-[2px] ${c.n > done ? "bg-neutral-soft" : c.equal ? "bg-neutral-graphic/45" : "bg-danger-graphic"}`}
          />
        ))}
      </div>
      <p className="m-0 text-ui-xs tabular-nums text-text-tertiary">
        1 · · · 17 · 18 · · · 41 · 다른 절단 {diff.length}개
      </p>
    </div>
  );
}

const EFFECT_KEYS = ["turn", "spawn", "delegate", "post"] as const;

export function ReplayDetail({
  run,
  dev,
  web,
  tip,
  rerun,
  onRerun,
  onLockedClick,
  onDevMode,
  onCopy,
}: {
  run: Run;
  dev: boolean;
  web: boolean;
  tip: boolean;
  rerun: number | null;
  onRerun: () => void;
  onLockedClick: () => void;
  onDevMode: () => void;
  onCopy: () => void;
}) {
  const running = rerun !== null;
  const failed = run.target === "review";
  const head = (
    <div className="flex min-w-0 items-baseline gap-2">
      <h2 className="m-0 truncate text-ui-strong text-text-primary">
        {extName(run.target)} {T.replay}
      </h2>
      <span className="text-ui-sm text-text-tertiary">
        {run.at} · {run.took}
      </span>
    </div>
  );
  const lockReason = web
    ? `원격 컴퓨터 build-box가 배포 형태라 잠겨 있어요. 그 컴퓨터에서 ${josa(T.devMode, "을", "를")} 켜야 해요.`
    : `배포 앱이라 잠겨 있어요. ${josa(T.devMode, "을", "를")} 켜면 ${T.repoPath}의 테스트 도구로 돌려요.`;

  if (!dev)
    return (
      <div className="grid gap-3">
        {head}
        <ListDescription
          variant="ghost"
          size="xs"
          aria-label={`${T.pastResult} 요약`}
          className={LD}
        >
          <ListDescriptionRow term="판정">
            {failed ? (
              <Badge size="xs" tone="danger">
                digest 다름
              </Badge>
            ) : (
              <Badge size="xs" tone="success">
                통과
              </Badge>
            )}
          </ListDescriptionRow>
          <ListDescriptionRow term="절단">
            {failed ? `${run.commits}개 중 2개 다름 · 17, 18` : `${run.commits}개 모두 같음`}
          </ListDescriptionRow>
          {failed && (
            <ListDescriptionRow term={T.firstDiff}>
              seq {replayReport.firstDiff.seq} <Mono>{replayReport.firstDiff.kind}</Mono>
            </ListDescriptionRow>
          )}
        </ListDescription>
        <ReadOnlyNote>
          {`${T.pastResult} · 읽기 전용. ${T.cutStrip}, 효과 수, JSON은 ${T.devMode}에서 보여요.`}
        </ReadOnlyNote>
        <div className="flex flex-wrap items-center gap-1.5">
          <Tooltip
            content={<span className="block max-w-64 whitespace-normal">{lockReason}</span>}
            side="top"
            open={tip}
          >
            <Button
              size="sm"
              tone="neutral"
              variant="soft"
              iconStart={<Lock />}
              aria-disabled
              aria-describedby="replay-lock"
              onClick={onLockedClick}
              className="text-text-tertiary"
            >
              다시 실행
            </Button>
          </Tooltip>
          <span id="replay-lock" className="sr-only">
            {lockReason}
          </span>
          {!web && (
            <Button size="sm" tone="neutral" variant="ghost" onClick={onDevMode}>
              {T.devMode} 켜기…
            </Button>
          )}
        </div>
      </div>
    );

  const done = running ? rerun : replayReport.commits;
  return (
    <div className="grid gap-3">
      {head}
      {running ? (
        <div className="flex items-center gap-2 text-ui-dense text-text-secondary">
          <Progress
            size="xs"
            value={Math.round((done / 41) * 100)}
            label={`${T.replay} 진행`}
            className="w-40"
          />
          절단 {done}/41 다시 돌리는 중
        </div>
      ) : (
        failed && (
          <Alert tone="danger" layout="inline" size="sm">
            {`절단 ${run.commits}개 중 17·18번에서 이벤트열이 달라요. 실패 종류는 없고 ok: false예요.`}
          </Alert>
        )
      )}
      <ListDescription variant="ghost" size="xs" aria-label={T.replayReport} className={LD}>
        <ListDescriptionRow term="판정">
          {running ? (
            <span className="text-text-tertiary">돌리는 중</span>
          ) : (
            <Badge size="xs" tone={failed ? "danger" : "success"}>
              {failed ? "digest 다름" : "통과"}
            </Badge>
          )}
        </ListDescriptionRow>
        <ListDescriptionRow term={T.cutStrip}>
          <CutStrip done={done} />
        </ListDescriptionRow>
        <ListDescriptionRow term={T.firstDiff}>
          {done >= 17 ? (
            <span className="tabular-nums">
              절단 17 · seq {replayReport.firstDiff.seq} <Mono>{replayReport.firstDiff.kind}</Mono>
            </span>
          ) : (
            <span className="text-text-tertiary">아직 없음</span>
          )}
        </ListDescriptionRow>
        <ListDescriptionRow term="효과 수">
          <span className="inline-flex flex-wrap items-baseline gap-x-3 gap-y-0.5 tabular-nums">
            {EFFECT_KEYS.map((k) => (
              <span
                key={k}
                className={replayReport.cut17[k] > 0 ? "text-text-primary" : "text-text-tertiary"}
              >
                {k} {replayReport.cut17[k]}
                <span className="text-text-tertiary">/{replayReport.baseline[k]}</span>
              </span>
            ))}
            <span className="text-ui-xs text-text-tertiary">절단 17 / 기준 실행 · 참고 값</span>
          </span>
        </ListDescriptionRow>
        <ListDescriptionRow term="옵션">
          <Mono dim={false}>maxCommits 200 · 기록 review-0429.jsonl</Mono>
        </ListDescriptionRow>
      </ListDescription>
      {done >= 17 && (
        <CodeDiff
          actions={false}
          aria-label={`seq ${replayReport.firstDiff.seq} 이벤트 비교`}
          filename={`seq ${replayReport.firstDiff.seq} · 기록 ↔ 절단 17 재개 뒤`}
          added={1}
          removed={1}
        >
          {replayReport.diffLines.map((l, i) => (
            <CodeDiffLine key={i} number={210 + i} kind={l.kind}>
              {l.text}
            </CodeDiffLine>
          ))}
        </CodeDiff>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" tone="neutral" variant="soft" disabled={running}>
          이벤트 비교 열기
        </Button>
        <Button
          size="sm"
          tone="neutral"
          variant="ghost"
          iconStart={<RotateCcw />}
          disabled={running}
          onClick={onRerun}
        >
          다시 실행
        </Button>
        <Button
          size="sm"
          tone="neutral"
          variant="ghost"
          iconStart={<Copy />}
          disabled={running}
          onClick={onCopy}
        >
          JSON 복사
        </Button>
      </div>
    </div>
  );
}

export function OtherDetail({ run, dev }: { run: Run; dev: boolean }) {
  const isBench = run.kind === "bench";
  return (
    <div className="grid gap-3">
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className="m-0 truncate text-ui-strong text-text-primary">
          {isBench ? T.benchmark : T.coreDiff}
        </h2>
        <Mono>{run.target}</Mono>
        <span className="text-ui-sm text-text-tertiary">
          {run.at} · {run.took}
        </span>
      </div>
      <ListDescription variant="ghost" size="xs" aria-label="결과" className={LD}>
        {isBench ? (
          <>
            <ListDescriptionRow term="판정">예산 미정 · 값만 기록</ListDescriptionRow>
            <ListDescriptionRow term="확장 디스패치">p50 0.8ms · p95 2.1ms</ListDescriptionRow>
            <ListDescriptionRow term="주도 교대">p50 4ms · p95 11ms</ListDescriptionRow>
          </>
        ) : (
          <>
            <ListDescriptionRow term="판정">보호 경로 변경 없음 · 종료 0</ListDescriptionRow>
            <ListDescriptionRow term="범위">
              <Mono dim={false}>main..HEAD · contracts, ext-host, platform-*, core-*</Mono>
            </ListDescriptionRow>
          </>
        )}
      </ListDescription>
      {!dev && <ReadOnlyNote>{`${T.pastResult} · 읽기 전용`}</ReadOnlyNote>}
      {!dev && (
        <div>
          <DevLock
            reason={`배포 앱이라 잠겨 있어요. ${josa(T.devMode, "을", "를")} 켜면 다시 돌릴 수 있어요.`}
          />
        </div>
      )}
    </div>
  );
}
