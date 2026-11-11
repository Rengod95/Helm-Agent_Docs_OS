// 외부 훅의 "끌까요" 질문과 꺼짐 알림(크래프트 선택 패널과 오른쪽 "플러그인" 탭). 확장의 `AutoOffNotice`와 같은 규칙을 쓴다:
// 질문은 경고로 바로 보이고(DP-58), 동작 설명은 정보 아이콘 뒤에 둔다. 답하면 질문 대신 결과 한 줄이 남는다.
import { t } from "@fresnel/client/i18n";
import { failureClockOf, type HookNotice } from "@fresnel/client/workbench";
import { Alert, Button } from "@caustic/react";
import { detach, rethrow } from "@fresnel/contracts";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useHandlerFailures, useLinkPhase } from "../../state/engine/index.ts";
import { useWorkbench } from "../../state/workbench/index.ts";
import { InfoTip } from "../craft/info-tip.tsx";
import { useSafeMode } from "../safe-mode-context.ts";
import { hookNoticeAfter, type HookNoticeMemo } from "./craft-parts.tsx";

/** 최근 실패 줄 수(U-05) */
const RECENT_FAILURES = 3;

/** 답을 보내는 쪽. 성공하면 true다(실패하면 알림이 한 줄 오류와 "다시 시도"를 보인다) */
export interface HookAnswers {
  readonly keepOn: (hook: string) => Promise<boolean>;
  readonly keepOff: (hook: string) => Promise<boolean>;
}

export const HookAnswersContext: React.Context<HookAnswers | null> =
  createContext<HookAnswers | null>(null);

function HookNoticeView(props: {
  readonly notice: HookNotice | undefined;
  readonly hook: string;
  readonly compact?: boolean | undefined;
  readonly answers: HookAnswers;
}): ReactNode {
  const { notice, hook, answers } = props;
  const online = useLinkPhase() === "live";
  const failures = useHandlerFailures();
  const asking = notice !== undefined && notice.question !== null;
  const off = notice?.off === true;
  const [memo, setMemo] = useState<HookNoticeMemo>({ asking, off, sent: false, answer: null });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<"keepOn" | "keepOff" | null>(null);
  const next = hookNoticeAfter(memo, { asking, off, busy });
  // 그리는 중에 기억을 고친다(React가 바로 다시 그린다). 효과에서 고치면 결과 줄이 한 장면 늦는다
  if (next !== memo) setMemo(next);

  const answer = async (which: "keepOn" | "keepOff"): Promise<void> => {
    setBusy(true);
    setFailed(null);
    const done = await answers[which](hook);
    // 성공 표를 먼저 세우고 보내는 중을 내린다. 그러면 질문이 사라진 그림은 결과를 "이 자리의 답"으로 고른다
    if (done) setMemo((m) => ({ ...m, sent: true }));
    setBusy(false);
    if (!done) setFailed(which);
  };
  const size = props.compact === true ? "sm" : undefined;
  const locked = busy || !online;
  const error =
    failed === null ? null : (
      <div className="flex flex-wrap items-center gap-2">
        <p role="alert" className="m-0 text-ui text-text-secondary">
          {t("desktop.workbench.hookOff.failed")}
        </p>
        <Button
          size="xs"
          variant="outline"
          disabled={locked}
          onClick={() => {
            detach(answer(failed), rethrow);
          }}
        >
          {t("desktop.workbench.hookOff.retry")}
        </Button>
      </div>
    );

  // 질문은 사라졌는데 이 자리의 답이 아직 가는 중이면 기다린다(결과 줄은 답이 끝나면 보인다)
  if (next.asking && !asking) return null;
  if (next.answer === "kept-on") {
    return (
      <p role="status" className="m-0 text-ui text-text-secondary">
        {t("desktop.workbench.hookOff.answer.on")}{" "}
        <InfoTip text={t("desktop.workbench.hookOff.info")} />
      </p>
    );
  }
  if (next.answer === "kept-off") {
    return (
      <div className="grid justify-items-start gap-2">
        <p role="status" className="m-0 text-ui text-text-secondary">
          {t("desktop.workbench.hookOff.answer.off")}
        </p>
        <Button
          size="xs"
          variant="outline"
          disabled={locked}
          onClick={() => detach(answer("keepOn"), rethrow)}
        >
          {t("desktop.workbench.reenable")}
        </Button>
        {error}
      </div>
    );
  }
  if (next.answer === "elsewhere") {
    return (
      <div className="grid justify-items-start gap-2">
        <p role="status" className="m-0 text-ui text-text-secondary">
          {t("desktop.workbench.hookOff.answer.elsewhere")}
        </p>
        {next.off && (
          <Button
            size="xs"
            variant="outline"
            disabled={locked}
            onClick={() => detach(answer("keepOn"), rethrow)}
          >
            {t("desktop.workbench.reenable")}
          </Button>
        )}
        {error}
      </div>
    );
  }
  if (notice !== undefined && notice.question !== null) {
    const { question } = notice;
    return (
      <Alert tone="warning" size={size}>
        <p className="flex items-center gap-1">
          {question.rule === "consecutive"
            ? t("desktop.workbench.hookOff.title.consecutive", {
                hook,
                count: question.consecutive,
              })
            : t("desktop.workbench.hookOff.title.rate", { hook, count: question.windowFailures })}
          <InfoTip text={t("desktop.workbench.hookOff.info")} />
        </p>
        <p className="text-ui-strong">{t("desktop.workbench.hookOff.body")}</p>
        <div
          className={online ? "mt-1 flex flex-wrap gap-2" : "mt-1 flex flex-wrap gap-2 opacity-60"}
        >
          <Button
            size="xs"
            variant="outline"
            disabled={locked}
            onClick={() => detach(answer("keepOn"), rethrow)}
          >
            {t("desktop.workbench.keepOff.keepOn")}
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={locked}
            onClick={() => detach(answer("keepOff"), rethrow)}
          >
            {t("desktop.workbench.keepOff.keepOff")}
          </Button>
        </div>
        {error}
      </Alert>
    );
  }
  if (off) {
    const recent = failures.filter((f) => f.owner === `hook:${hook}`).slice(-RECENT_FAILURES);
    return (
      <div className="grid gap-2">
        <Alert
          tone="danger"
          size={size}
          actions={[
            {
              label: t("desktop.workbench.reenable"),
              onClick: () => {
                if (!locked) detach(answer("keepOn"), rethrow);
              },
            },
          ]}
        >
          {t("desktop.workbench.hookOff.off", { hook })}
        </Alert>
        {recent.length > 0 && (
          <ul
            aria-label={t("desktop.workbench.hookOff.recent")}
            className="m-0 grid list-none gap-1 p-0"
          >
            {recent.map((f) => {
              // 시각은 기록에 있을 때만 앞에 둔다(없거나 날짜로 읽히지 않으면 글만 남는다)
              const time = failureClockOf(f.at);
              return (
                <li key={`${f.afterSeq}:${f.point}`} className="text-ui text-text-secondary">
                  {time !== null && (
                    <>
                      <span className="font-mono">{time}</span> ·{" "}
                    </>
                  )}
                  <span className="font-mono">{f.point}</span> · {f.message}
                </li>
              );
            })}
          </ul>
        )}
        {error}
      </div>
    );
  }
  return null;
}

/**
 * 훅 하나의 알림. 스토어에 질문이나 꺼짐이 있는 훅이면 그린다. 답을 보낼 곳이 없으면 아무것도 그리지 않는다.
 * 안전 모드(`useSafeMode()`가 켜짐)면 질문도 꺼짐도 그리지 않는다.
 */
export function HookNoticeFor(props: {
  readonly hook: string;
  readonly compact?: boolean | undefined;
}): ReactNode {
  const answers = useContext(HookAnswersContext);
  const safe = useSafeMode()?.active === true;
  const notice = useWorkbench((s) => s.hookNotices.find((n) => n.hook === props.hook));
  if (answers === null || safe) return null;
  return (
    <HookNoticeView
      key={props.hook}
      notice={notice}
      hook={props.hook}
      compact={props.compact}
      answers={answers}
    />
  );
}

/** 오른쪽 "플러그인" 탭 맨 위: 질문이나 꺼짐이 있는 훅마다 알림 하나. 답한 뒤의 결과 줄이 남도록 훅 목록이 비어도 이미 그려진 것은 유지된다 */
export function HookNoticeList(props: { readonly compact?: boolean | undefined }): ReactNode {
  const hooks = useWorkbench((s) => s.hookNotices);
  const safe = useSafeMode()?.active === true;
  // 답하면 질문이 목록에서 사라지므로, 본 훅의 이름을 기억해 결과 줄이 남게 한다
  const [seen, setSeen] = useState<readonly string[]>([]);
  const names = [...new Set([...seen, ...hooks.map((n) => n.hook)])];
  if (names.length !== seen.length) setSeen(names);
  // 안전 모드에서는 기억한 이름이 있어도 아무것도 그리지 않는다
  if (safe) return null;
  return (
    <>
      {names.map((hook) => (
        <HookNoticeFor key={hook} hook={hook} compact={props.compact} />
      ))}
    </>
  );
}
