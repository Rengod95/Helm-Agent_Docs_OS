import { Alert, Badge, Button, Skeleton } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCustomCount, useLinkPhase, useOpenThreadId } from "../../state/engine/index.ts";
import { useCommands, type Commands } from "../commands.ts";
import { InfoTip } from "../craft/info-tip.tsx";
import { linkOf, type LinkState } from "../runtime/runtime-tab.tsx";
import { detachVoid, reloadOnExtChanges } from "../workbench/controller.ts";
import {
  HELM_CHANGE_KINDS,
  captionOf,
  findingsOf,
  helmResultsLabelsOf,
  inquiriesOf,
  markdownOf,
  sourceTextOf,
  type FindingsView,
  type HelmFindingView,
  type HelmResultsLabels,
  type HelmSourceView,
  type InquirySummary,
} from "./helm-results-model.ts";

// 대화 옆 Helm 패널의 "탐구 결과" 구역(플러그인 화면 목록 아래). 열린 대화의 탐구 목록을 읽고, 펼친 탐구의 발견을 읽어
// Markdown으로 클립보드에 복사한다. 파일로 저장하지 않는다. 대화 카드 "탐구 결과"(helm-finished)는 Helm의 Plugin UI 기여이고,
// 이 구역은 앱 쪽 보기다. 읽기는 `ext.helm.inquiries`와 `ext.helm.findings`를 연결으로 부른다(탐구의 단계 안내와 끝 안내가 대화에 쌓이면 목록을 다시 읽고, "다시 읽기"로도 읽는다).

/** Helm 확장의 이름. 패널 탭과 같다 */
const HELM_EXTENSION = "helm";

/** 탐구 목록 한 번 읽기. `loading`은 아직 못 읽었거나 다시 읽는 중이다 */
export type HelmResultsLoad =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly inquiries: readonly InquirySummary[] };

/** 펼친 탐구의 발견 읽기 */
export type FindingsLoad =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly findings: readonly HelmFindingView[] };

/** 마지막 복사 결과. 펼친 탐구 아래에 한 줄로 보인다. 펼치거나 접으면 지운다 */
interface CopyState {
  readonly inquiryId: string;
  readonly copied: boolean;
}

const LOADING_LIST: HelmResultsLoad = { kind: "loading" };
const FAILED_LIST: HelmResultsLoad = { kind: "error" };
const LOADING_FINDINGS: FindingsLoad = { kind: "loading" };
const FAILED_FINDINGS: FindingsLoad = { kind: "error" };

/** 안내 한 줄(시안의 intro와 빈 자리 글). 글 역할은 본문 보조다 */
const MUTED = "m-0 text-ui-dense text-text-secondary";
/** 행 아래 캡션 한 줄. 시안의 행 캡션 역할이다 */
const CAPTION = "m-0 text-ui-xs text-text-tertiary";

type PluginUi = Commands["pluginUi"];

/** `ext.helm.inquiries` 한 번 읽기. 연결이 없거나 호스트가 실패하거나 모양이 다르면 오류다 */
async function readInquiries(pluginUi: PluginUi, threadId: ThreadId): Promise<HelmResultsLoad> {
  const got = await pluginUi.withConnection((connection) =>
    connection.requestExtension(HELM_EXTENSION, "inquiries", { threadId }),
  );
  const view = got.ok ? inquiriesOf(got.value) : null;
  return view === null ? FAILED_LIST : { kind: "ready", inquiries: view.inquiries };
}

/** `ext.helm.findings` 한 번 읽기. 실패 모양은 목록과 같다 */
async function readFindings(
  pluginUi: PluginUi,
  threadId: ThreadId,
  inquiryId: string,
): Promise<FindingsLoad> {
  const got = await pluginUi.withConnection((connection) =>
    connection.requestExtension(HELM_EXTENSION, "findings", { threadId, inquiryId }),
  );
  const view: FindingsView | null = got.ok ? findingsOf(got.value) : null;
  return view === null ? FAILED_FINDINGS : { kind: "ready", findings: view.findings };
}

/**
 * 출처마다 값으로 정한 키. 같은 출처가 두 번 오면 몇 번째인지 붙여 키가 겹치지 않게 한다
 * (출처 목록은 발견마다 정해진 채 바뀌지 않는다)
 */
function keyedSourcesOf(
  sources: readonly HelmSourceView[],
): readonly { readonly key: string; readonly source: HelmSourceView }[] {
  const seen = new Map<string, number>();
  return sources.map((source) => {
    const base = `${source.origin}|${source.ref}|${source.title ?? ""}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { key: `${base}#${count}`, source };
  });
}

/** 탐구 하나를 Markdown으로 바꿔 복사한다. 결과는 복사 상태 한 줄이다 */
async function copyInquiry(
  copy: (text: string) => Promise<boolean>,
  inquiry: InquirySummary,
  findings: readonly HelmFindingView[],
): Promise<CopyState> {
  const copied = await copy(markdownOf(inquiry, findings));
  return { inquiryId: inquiry.inquiryId, copied };
}

export interface HelmResultsBodyProps {
  /** 열린 대화가 있는가. 없으면 안내 한 줄이다 */
  readonly threadOpen: boolean;
  readonly link: LinkState;
  readonly list: HelmResultsLoad;
  readonly expandedId: string | null;
  /** 탐구 id마다 발견 읽기 상태. 펼친 탐구만 값이 있다 */
  readonly findings: Readonly<Record<string, FindingsLoad>>;
  readonly copied: CopyState | null;
  readonly onToggle: (inquiryId: string) => void;
  readonly onRetryFindings: (inquiryId: string) => void;
  readonly onCopy: (inquiryId: string) => void;
  readonly onReload: () => void;
}

/**
 * 탐구 결과 구역의 그림. 대화가 없으면 안내 한 줄, 연결이 끊기면 끊김 글 한 줄, 목록을 읽는 중이면 Skeleton,
 * 읽기가 실패하면 오류 한 줄과 "다시 읽기"다. 발견은 펼친 탐구에서만 읽어 그린다.
 */
export function HelmResultsBody(props: HelmResultsBodyProps): ReactNode {
  const labels = helmResultsLabelsOf();
  const title = t("desktop.helm.results.title");
  const section = (content: ReactNode): ReactNode => (
    <section
      aria-label={title}
      className="grid content-start gap-2 border-b border-border-subtle p-3 pe-12"
    >
      {/* 구역 머리는 본문 크기 굵은 글이고, 설명은 아이콘 뒤에 둔다 */}
      <div className="flex items-center gap-1">
        <h3 className="m-0 text-ui-dense font-semibold text-text-primary">{title}</h3>
        <InfoTip text={t("desktop.helm.results.intro")} />
      </div>
      {content}
    </section>
  );
  if (!props.threadOpen) {
    return section(<p className={MUTED}>{t("desktop.helm.results.noThread")}</p>);
  }
  if (props.link === "offline") {
    return section(<p className={MUTED}>{t("desktop.runtime.offline")}</p>);
  }
  const list = props.list;
  if (list.kind === "error") {
    return section(
      <div className="grid justify-items-start gap-2">
        <Alert tone="danger" layout="inline">
          {t("desktop.helm.results.loadFailed")}
        </Alert>
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            props.onReload();
          }}
        >
          {t("desktop.helm.results.retry")}
        </Button>
      </div>,
    );
  }
  if (list.kind !== "ready") {
    return section(<Skeleton height={24} />);
  }
  if (list.inquiries.length === 0) {
    return section(<p className={MUTED}>{t("desktop.helm.results.empty")}</p>);
  }
  return section(
    <ul className="m-0 grid list-none p-0">
      {list.inquiries.map((inquiry) => (
        <InquiryItem key={inquiry.inquiryId} inquiry={inquiry} labels={labels} body={props} />
      ))}
    </ul>,
  );
}

/** 탐구 한 줄. 주제 단추를 누르면 펼쳐 발견을 보인다 */
function InquiryItem(props: {
  readonly inquiry: InquirySummary;
  readonly labels: HelmResultsLabels;
  readonly body: HelmResultsBodyProps;
}): ReactNode {
  const { inquiry, labels, body } = props;
  const expanded = body.expandedId === inquiry.inquiryId;
  const topic = inquiry.topic.trim() === "" ? labels.untitled : inquiry.topic;
  return (
    <li className="grid gap-1.5 border-b border-border-subtle py-2.5 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="ghost"
          size="xs"
          aria-expanded={expanded}
          className="min-w-0 flex-1 justify-start"
          onClick={() => {
            body.onToggle(inquiry.inquiryId);
          }}
        >
          <span className="min-w-0 truncate text-ui font-medium text-text-primary">{topic}</span>
        </Button>
        <Badge size="sm">{labels.statuses[inquiry.status]}</Badge>
      </div>
      <p className={CAPTION}>{captionOf(inquiry, labels)}</p>
      {expanded && <FindingsBlock inquiry={inquiry} labels={labels} body={body} />}
    </li>
  );
}

/** 펼친 탐구의 발견과 복사 단추. 발견을 읽는 동안은 Skeleton, 읽지 못하면 오류와 "다시 읽기"다 */
function FindingsBlock(props: {
  readonly inquiry: InquirySummary;
  readonly labels: HelmResultsLabels;
  readonly body: HelmResultsBodyProps;
}): ReactNode {
  const { inquiry, labels, body } = props;
  const loaded = body.findings[inquiry.inquiryId] ?? LOADING_FINDINGS;
  const copied =
    body.copied !== null && body.copied.inquiryId === inquiry.inquiryId ? body.copied : null;
  return (
    <div className="grid gap-2 rounded-md bg-control-raised p-2">
      {loaded.kind === "loading" && <Skeleton height={24} />}
      {loaded.kind === "error" && (
        <div className="grid justify-items-start gap-2">
          <Alert tone="danger" layout="inline">
            {t("desktop.helm.results.loadFailed")}
          </Alert>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              body.onRetryFindings(inquiry.inquiryId);
            }}
          >
            {t("desktop.helm.results.retry")}
          </Button>
        </div>
      )}
      {loaded.kind === "ready" && (
        <>
          {loaded.findings.length === 0 ? (
            <p className={MUTED}>{labels.noFindings}</p>
          ) : (
            <ol className="m-0 grid list-decimal gap-2 ps-5">
              {loaded.findings.map((finding) => (
                <li key={finding.id} className="grid gap-1 text-ui-dense text-text-primary">
                  <span>{finding.claim}</span>
                  <span
                    className={CAPTION}
                  >{`${labels.confidence}: ${labels.confidences[finding.confidence]}`}</span>
                  {finding.sources.length > 0 && (
                    <ul className="m-0 grid list-none gap-0.5 p-0">
                      {keyedSourcesOf(finding.sources).map(({ key, source }) => (
                        <li key={key} className={CAPTION}>
                          {sourceTextOf(source, labels)}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                body.onCopy(inquiry.inquiryId);
              }}
            >
              {t("desktop.helm.results.copy")}
            </Button>
            {copied !== null && (
              <span role="status" className={CAPTION}>
                {copied.copied
                  ? t("desktop.helm.results.copied")
                  : t("desktop.helm.results.copyFailed")}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** 구역의 상태와 읽기를 가진다. 열린 대화가 바뀌면 `key`로 새로 마운트해 이전 대화의 값을 버린다 */
function HelmResultsSection(props: {
  readonly threadId: ThreadId | null;
  readonly link: LinkState;
}): ReactNode {
  const commands = useCommands();
  const { threadId, link } = props;
  const live = link === "live";
  const [list, setList] = useState<HelmResultsLoad>(LOADING_LIST);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [findings, setFindings] = useState<Readonly<Record<string, FindingsLoad>>>({});
  const [copied, setCopied] = useState<CopyState | null>(null);
  // 읽기가 겹치면 마지막에 시작한 읽기의 값만 쓴다(먼저 끝난 오래된 값이 새 값을 덮지 않는다)
  const started = useRef(0);

  const reload = useCallback(async (): Promise<void> => {
    if (threadId === null) return;
    started.current += 1;
    const attempt = started.current;
    const next = await readInquiries(commands.pluginUi, threadId);
    if (attempt === started.current) setList(next);
  }, [commands, threadId]);

  // 연결이 살아 있으면 읽고, 확장 목록이 바뀔 때(켜기, 끄기)마다 다시 읽는다. 주기적으로 읽지 않는다
  useEffect(() => {
    if (!live || threadId === null) return undefined;
    detachVoid(reload());
    return reloadOnExtChanges(commands.workbench, reload);
  }, [commands, live, reload, threadId]);

  const loadFindings = useCallback(
    async (inquiryId: string): Promise<void> => {
      if (threadId === null) return;
      setFindings((current) => ({ ...current, [inquiryId]: LOADING_FINDINGS }));
      const next = await readFindings(commands.pluginUi, threadId, inquiryId);
      setFindings((current) => ({ ...current, [inquiryId]: next }));
    },
    [commands, threadId],
  );

  // 탐구의 단계 안내와 끝 안내가 대화에 쌓이면 목록(과 펼친 탐구의 발견)을 다시 읽는다. 처음 본 수는 기준으로만 삼는다
  const changes = useCustomCount(HELM_CHANGE_KINDS);
  const seenChanges = useRef<{ readonly threadId: ThreadId | null; readonly count: number } | null>(
    null,
  );
  useEffect(() => {
    const before = seenChanges.current;
    seenChanges.current = { threadId, count: changes };
    if (!live || threadId === null || before === null || before.threadId !== threadId) return;
    if (before.count === changes) return;
    detachVoid(reload());
    if (expandedId === null) return;
    // 펼친 탐구의 발견은 읽는 중 표시로 바꾸지 않고 읽은 값이 오면 바꾼다
    detachVoid(
      readFindings(commands.pluginUi, threadId, expandedId).then((next) => {
        setFindings((current) => ({ ...current, [expandedId]: next }));
        return undefined;
      }),
    );
  }, [changes, commands, expandedId, live, reload, threadId]);

  const onToggle = (inquiryId: string): void => {
    setCopied(null);
    if (expandedId === inquiryId) {
      setExpandedId(null);
      return;
    }
    // 발견은 펼칠 때마다 다시 읽는다. 펼치기 전에는 읽지 않는다
    setExpandedId(inquiryId);
    detachVoid(loadFindings(inquiryId));
  };

  const onCopy = (inquiryId: string): void => {
    const inquiry =
      list.kind === "ready"
        ? list.inquiries.find((item) => item.inquiryId === inquiryId)
        : undefined;
    const loaded = findings[inquiryId];
    if (inquiry === undefined || loaded?.kind !== "ready") return;
    detachVoid(
      copyInquiry((text) => commands.copyText(text), inquiry, loaded.findings).then(setCopied),
    );
  };

  return (
    <HelmResultsBody
      threadOpen={threadId !== null}
      link={link}
      list={list}
      expandedId={expandedId}
      findings={findings}
      copied={copied}
      onToggle={onToggle}
      onRetryFindings={(inquiryId) => {
        detachVoid(loadFindings(inquiryId));
      }}
      onCopy={onCopy}
      onReload={() => {
        detachVoid(reload());
      }}
    />
  );
}

/** 대화 옆 Helm 패널의 "탐구 결과" 구역. 열린 대화의 탐구 목록과 발견을 보이고 Markdown으로 복사한다 */
export function HelmResults(): ReactNode {
  const threadId = useOpenThreadId();
  const link = linkOf(useLinkPhase());
  return <HelmResultsSection key={threadId ?? ""} threadId={threadId} link={link} />;
}
