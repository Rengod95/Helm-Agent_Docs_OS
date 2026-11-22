import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { LiveApprovalRequest } from "../../state/engine/input.ts";
import {
  Alert,
  Badge,
  ChoiceGroup,
  ChoiceGroupItem,
  Input,
  ListDescription,
  ListDescriptionRow,
  MessageCode,
} from "@caustic/react";
import { useEffect, useRef, type ReactNode } from "react";
import {
  QUESTION_TEXT_MAX,
  REVIEW_CHANGE_ID,
  fileChangeViewOf,
  mcpStartViewOf,
  mcpToolViewOf,
  setPickText,
  toolApprovalView,
  toolReplaceView,
  togglePick,
  type FileChangeView,
  type McpChangedField,
  type McpChangedView,
  type McpDeclaredKind,
  type McpSourceView,
  type McpStartView,
  type McpToolView,
  type QuestionDraft,
  type QuestionItem,
  type ToolApprovalBody,
  type ToolApprovalView,
  type ToolReplaceView,
} from "../approval-form.ts";
import { reviewTotalsOf, ruleTextIdOf } from "./card-model.ts";
import { questionPagedOf } from "./question-pages.ts";
import { FileChangeDiff } from "../file-change-view.tsx";
import { Collapse } from "../../lib/motion-presets.tsx";
import { InfoTip } from "../craft/info-tip.tsx";

// 승인 카드 본문(종류별). 상태와 단추는 approval-card.tsx가 맡는다. 본문은 값만 받고 응답을 보내지 않는다.

type ApprovalBody = LiveApprovalRequest["body"];
type ReviewView = Extract<ApprovalBody, { kind: "review" }>["review"];

// 공백 없는 긴 조각(주소, base64)도 카드 폭 안에서 끊는다. break-words는 최소 폭을 줄이지 못해 카드가 넓어진다(DP-180)
const BLOCK_CODE =
  "block max-h-40 min-w-0 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere]";

const RISK_TEXT: Readonly<Record<string, MessageId>> = {
  read: "desktop.approvals.risk.read",
  write: "desktop.approvals.risk.write",
  exec: "desktop.approvals.risk.exec",
  execute: "desktop.approvals.risk.exec",
};

/** 위험도 값(read·write·exec)을 카탈로그 문구로 바꾼다. 모르는 값은 그대로 보인다 (rtE R-10) */
function riskLabelOf(risk: string): string {
  const id = RISK_TEXT[risk];
  return id === undefined ? risk : t(id);
}

const TRUST_TEXT: Readonly<Record<NonNullable<ToolReplaceView["trust"]>, MessageId>> = {
  builtin: "desktop.approvals.replace.trust.builtin",
  user: "desktop.approvals.replace.trust.user",
  project: "desktop.approvals.replace.trust.project",
  untrusted: "desktop.approvals.replace.trust.untrusted",
};

/** 내장 도구 대체 승인(`tool_replace`). 누가 어떤 도구를 어떤 신뢰로 대체하는지와 경로 보호가 빠진다는 안내를 먼저 보인다 */
function ReplaceDetails(props: { readonly view: ToolReplaceView }): ReactNode {
  const { view } = props;
  return (
    <div className="grid gap-1.5">
      <div>{t("desktop.approvals.replace.heading")}</div>
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label={t("desktop.approvals.replace.heading")}
      >
        <ListDescriptionRow term={t("desktop.approvals.replace.extension")}>
          <code>{view.extension}</code>
        </ListDescriptionRow>
        <ListDescriptionRow term={t("desktop.approvals.replace.tool")}>
          <code>{view.tool}</code>
        </ListDescriptionRow>
        {view.trust === null ? null : (
          <ListDescriptionRow term={t("desktop.approvals.replace.trust")}>
            {t(TRUST_TEXT[view.trust])}
          </ListDescriptionRow>
        )}
        <ListDescriptionRow term={t("desktop.approvals.replace.risk")}>
          {view.originalRisk === view.effectiveRisk
            ? riskLabelOf(view.effectiveRisk)
            : t("desktop.approvals.replace.risk.value", {
                originalRisk: riskLabelOf(view.originalRisk),
                effectiveRisk: riskLabelOf(view.effectiveRisk),
              })}
        </ListDescriptionRow>
      </ListDescription>
      <Alert tone="warning" layout="inline">
        {t("desktop.approvals.replace.pathProtection")}
      </Alert>
      <div className="text-ui text-text-secondary">{t("desktop.approvals.replace.effect")}</div>
    </div>
  );
}

/** 기동 승인의 출처 글. 프로젝트 파일, 사용자 설정, 확장 이름은 뜻으로, 모르는 값은 원문으로 보인다 */
function mcpSourceTextOf(source: McpSourceView): string {
  switch (source.kind) {
    case "project":
      return t("desktop.approvals.mcpStart.source.project");
    case "user":
      return t("desktop.approvals.mcpStart.source.user");
    case "extension":
      return t("desktop.approvals.mcpStart.source.extension", { name: source.name });
    case "raw":
      return source.value;
    default:
      return assertNever(source, "mcp start source");
  }
}

const MCP_REASON_TEXT: Readonly<Record<McpStartView["reason"], MessageId>> = {
  secret: "desktop.approvals.mcpStart.reason.secret",
  project: "desktop.approvals.mcpStart.reason.project",
  other: "desktop.approvals.mcpStart.reason.other",
};

const MCP_FIELD_TEXT: Readonly<Record<McpChangedField, MessageId>> = {
  command: "desktop.approvals.mcpStart.field.command",
  args: "desktop.approvals.mcpStart.field.args",
  cwd: "desktop.approvals.mcpStart.field.cwd",
  source: "desktop.approvals.mcpStart.field.source",
  env: "desktop.approvals.mcpStart.field.env",
  secretEnv: "desktop.approvals.mcpStart.field.secretEnv",
};

/** 기동 승인이 직전에 허용한 정의와 달라졌을 때: 바뀜 표식, 바뀐 곳, 이전과 지금의 명령 줄 */
function McpChangedBlock(props: {
  readonly changed: McpChangedView;
  readonly commandLine: string;
}): ReactNode {
  const { changed } = props;
  const fields = changed.fields.map((field) => t(MCP_FIELD_TEXT[field])).join(", ");
  return (
    <div className="grid gap-1">
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <Badge size="xs" className="bg-warning-tint text-warning-text">
          {t("desktop.approvals.mcpStart.changed.badge")}
        </Badge>
        {changed.fields.length === 0 ? null : (
          <span className="text-ui text-text-secondary">
            {t("desktop.approvals.mcpStart.changed.fields", { fields })}
          </span>
        )}
      </div>
      <div className="text-ui text-text-secondary break-all">
        {t("desktop.approvals.mcpStart.changed.line", {
          before: changed.beforeCommandLine,
          after: props.commandLine,
        })}
      </div>
    </div>
  );
}

/** 도구 인자(원시 JSON). 카드 단추 줄의 "인자 보기"가 연다(DP-134). 인자가 별도 저장소에 있으면 그 안내 한 줄이 늘 보인다 */
function ArgsFold(props: {
  readonly view: ToolApprovalView;
  readonly open: boolean;
  readonly id: string;
}): ReactNode {
  const { view } = props;
  if (view.argsStored)
    return (
      <div className="text-ui text-text-secondary">
        {t("desktop.approvals.args.storedElsewhere")}
      </div>
    );
  return (
    <div id={props.id} data-slot="approval-args">
      <Collapse open={props.open}>
        <MessageCode className={BLOCK_CODE}>
          {view.argsText}
          {view.argsTruncated ? `\n${t("desktop.approvals.args.truncationNotice")}` : ""}
        </MessageCode>
      </Collapse>
    </div>
  );
}

/** 카드에 "인자 보기" 펼침 단추를 둘 것인가: 인자가 카드에 실려 있을 때다 */
export function toolHasArgs(body: ToolApprovalBody): boolean {
  return !toolApprovalView(body).argsStored;
}

/** 위험도 배지(카드 머리 오른쪽 끝): 읽기는 회색, 쓰기는 경고, 실행은 위험 색. 규칙 이름은 바로 뒤 정보 아이콘(4px) 안에 있다 */
export function RiskBadge(props: { readonly body: ToolApprovalBody }): ReactNode {
  const view = toolApprovalView(props.body);
  const { ruleId } = props.body;
  const mcp = mcpStartViewOf(props.body);
  return (
    <span data-slot="approval-risk" className="inline-flex items-center gap-1">
      <Badge size="sm" className={riskToneOf(view.risk)}>
        {riskLabelOf(view.risk)}
      </Badge>
      {mcp !== null || ruleId === null ? null : (
        <InfoTip text={t(ruleTextIdOf(ruleId), { id: ruleId })} />
      )}
    </span>
  );
}

/** 위험도 배지의 색(Badge의 tone prop은 폐기 표시라 같은 면 색을 클래스로 준다. McpChangedBlock의 바뀜 배지와 같다) */
function riskToneOf(risk: string): string {
  if (risk === "write") return "bg-warning-tint text-warning-text";
  if (risk === "exec" || risk === "execute") return "bg-danger-tint text-danger-text";
  return "";
}

/** 파일 변경 승인의 머리(수정 또는 파일 쓰기 글과 경로)와 그림 */
function FileChangeBlock(props: { readonly view: FileChangeView }): ReactNode {
  const { view } = props;
  return (
    <div className="grid gap-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <span className="text-ui text-text-secondary">
          {view.kind === "edit"
            ? t("desktop.approvals.diff.editLabel")
            : t("desktop.approvals.diff.writeLabel")}
        </span>
        <code className="min-w-0 break-all">{view.path}</code>
      </div>
      <FileChangeDiff view={view} />
    </div>
  );
}

const MCP_DECLARED_TEXT: Readonly<Record<McpDeclaredKind, MessageId>> = {
  readOnly: "desktop.approvals.mcpTool.hint.readOnly",
  destructive: "desktop.approvals.mcpTool.hint.destructive",
  idempotent: "desktop.approvals.mcpTool.hint.idempotent",
  openWorld: "desktop.approvals.mcpTool.hint.openWorld",
};

/**
 * MCP 서버 도구 승인의 머리: 서버 이름 칩, 서버가 알린 성질(있을 때 한 줄), 그 성질을 믿을 수 없다는 경고.
 * 경고는 정보 아이콘 뒤에 숨기지 않고 성질 줄과 함께 늘 보인다. 승인 결정은 이 값과 상관없다(정책 불변).
 */
function McpToolBlock(props: { readonly view: McpToolView }): ReactNode {
  const { view } = props;
  const hasDeclared = view.declared.length > 0;
  const hints = view.declared.map((kind) => t(MCP_DECLARED_TEXT[kind])).join(", ");
  return (
    <div className="grid gap-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <Badge size="xs">{t("desktop.approvals.mcpTool.server", { server: view.server })}</Badge>
        {hasDeclared ? (
          <span className="text-ui text-text-secondary">
            {t("desktop.approvals.mcpTool.declared", { hints })}
          </span>
        ) : null}
      </div>
      {hasDeclared ? (
        <Alert tone="warning" layout="inline">
          {t("desktop.approvals.mcpTool.untrusted")}
        </Alert>
      ) : null}
    </div>
  );
}

export function ToolBody(props: {
  readonly body: ToolApprovalBody;
  readonly argsOpen: boolean;
  readonly argsId: string;
}): ReactNode {
  const view = toolApprovalView(props.body);
  const replace = toolReplaceView(props.body);
  const mcp = mcpStartViewOf(props.body);
  const mcpTool = mcpToolViewOf(props.body);
  const change = fileChangeViewOf(props.body);
  // 기동 승인은 명령에 인자를 붙인 한 줄을 보인다. `command`만으로는 실행될 것이 다 보이지 않는다
  const command = mcp === null ? view.command : mcp.commandLine;
  // 위험도와 규칙은 카드 머리의 배지(RiskBadge)다. 목록은 실행될 것(명령, 출처, 폴더, 환경 이름, 시크릿)만 담고, 없으면 그리지 않는다
  const listed = command !== null || mcp !== null || view.secrets.length > 0;
  return (
    <>
      {replace === null ? null : <ReplaceDetails view={replace} />}
      {mcpTool === null ? null : <McpToolBlock view={mcpTool} />}
      {mcp === null || mcp.changed === null ? null : (
        <McpChangedBlock changed={mcp.changed} commandLine={mcp.commandLine} />
      )}
      {listed ? (
        <ListDescription
          variant="ghost"
          size="xs"
          aria-label={t("desktop.approvals.tool.summary", {
            toolName: view.toolName,
            risk: riskLabelOf(view.risk),
          })}
          className="rounded-none [--cs-size-list-term:6rem] [&_[data-slot=list-description-row]]:px-0"
        >
          {command === null ? null : (
            <ListDescriptionRow term={t("desktop.approvals.command.label")} mono>
              <span className="whitespace-pre-wrap break-all">{command}</span>
            </ListDescriptionRow>
          )}
          {mcp === null ? null : (
            <ListDescriptionRow term={t("desktop.approvals.mcpStart.field.source")}>
              {mcpSourceTextOf(mcp.source)}
            </ListDescriptionRow>
          )}
          {mcp === null || mcp.cwd === null ? null : (
            <ListDescriptionRow term={t("desktop.approvals.mcpStart.field.cwd")} mono>
              <span className="break-all">{mcp.cwd}</span>
            </ListDescriptionRow>
          )}
          {mcp === null || mcp.envNames.length === 0 ? null : (
            <ListDescriptionRow term={t("desktop.approvals.mcpStart.field.env")} mono>
              <span className="break-all">{mcp.envNames.join(", ")}</span>
            </ListDescriptionRow>
          )}
          {view.secrets.map((secret) => (
            <ListDescriptionRow key={secret.name} term={t("desktop.approvals.secret.term")} mono>
              <span className="break-all">
                {secret.name}
                {secret.handle === null
                  ? ` ${t("desktop.approvals.secret.invalidHandle")}`
                  : ` ← ${secret.handle}`}
              </span>
            </ListDescriptionRow>
          ))}
        </ListDescription>
      ) : null}
      {/* 기동 승인은 규칙 id 대신 묻는 까닭을 사람 말로 보인다 */}
      {mcp === null ? null : (
        <div className="text-ui text-text-secondary">{t(MCP_REASON_TEXT[mcp.reason])}</div>
      )}
      {change === null ? null : <FileChangeBlock view={change} />}
      <ArgsFold view={view} open={props.argsOpen} id={props.argsId} />
    </>
  );
}

function QuestionField(props: {
  readonly question: QuestionItem;
  readonly draft: QuestionDraft;
  readonly disabled: boolean;
  readonly onChange: (next: (prev: QuestionDraft) => QuestionDraft) => void;
  /** 포인터로 눌러 선택을 새로 만들었을 때(해제가 아니고, 화살표 키로 옮긴 것이 아님). 저절로 넘김을 정한다 */
  readonly onPointerPick: () => void;
}): ReactNode {
  const { question, draft, disabled, onChange } = props;
  const pick = draft[question.id];
  const selected = pick?.selected ?? [];
  // 제목(header)과 질문 글은 따로 둔다. 제목은 흐린 글색으로 앞에 놓고 간격으로 가른다
  const questionText: ReactNode =
    question.header === undefined ? (
      question.text
    ) : (
      <span className="inline-flex min-w-0 flex-wrap items-baseline gap-2">
        <span className="text-text-secondary">{question.header}</span> <span>{question.text}</span>
      </span>
    );
  const choose = (optionId: string): void => {
    onChange((prev) => togglePick(prev, question, optionId));
  };
  return (
    <div className="flex flex-col gap-1.5">
      {question.options.length === 0 ? (
        <div>{questionText}</div>
      ) : (
        <ChoiceGroup
          appearance="answer"
          type={question.multiSelect ? "multiple" : "single"}
          value={question.multiSelect ? [...selected] : (selected[0] ?? "")}
          disabled={disabled}
          question={questionText}
          onValueChange={(value) => {
            // 한 줄 선택지는 화살표 키로 옮길 때 이 값으로 온다. 클릭은 아래 onClick이 받는다
            if (!question.multiSelect && typeof value === "string" && value !== "") choose(value);
          }}
        >
          {question.options.map((option) => (
            <ChoiceGroupItem
              key={option.id}
              value={option.id}
              title={
                <>
                  {option.label}
                  {option.recommended === true ? (
                    <span className="text-ui text-text-secondary">
                      {" "}
                      {t("desktop.approvals.option.recommended")}
                    </span>
                  ) : null}
                </>
              }
              description={option.description}
              onClick={(event) => {
                // 선택 상태는 draft가 정한다. 그래서 기본 선택 동작을 막고 토글만 한다
                event.preventDefault();
                const was = selected.includes(option.id);
                choose(option.id);
                // detail 0은 글쇠(Space·Enter)로 누른 것이다. 포인터 누름만 저절로 넘김의 대상이다
                if (!was && event.detail > 0) props.onPointerPick();
              }}
            />
          ))}
        </ChoiceGroup>
      )}
      {question.allowFreeText ? (
        <Input
          type="text"
          aria-label={
            question.options.length === 0 ? question.text : t("cli.render.approval.how.freeText")
          }
          placeholder={question.options.length === 0 ? "" : t("cli.render.approval.how.freeText")}
          maxLength={QUESTION_TEXT_MAX}
          disabled={disabled}
          value={pick?.text ?? ""}
          onValueChange={(value) => {
            onChange((prev) => setPickText(prev, question.id, value));
          }}
        />
      ) : null}
    </div>
  );
}

/** 새로 보인 질문에서 초점을 둘 곳: 고른 선택지, 없으면 첫 선택지, 선택지가 없으면 입력 칸 */
function firstFieldOf(page: HTMLElement): HTMLElement | null {
  const chosen = page.querySelector<HTMLElement>(
    '[role="radio"][aria-checked="true"], [role="checkbox"][aria-checked="true"]',
  );
  if (chosen !== null) return chosen;
  return page.querySelector<HTMLElement>('[role="radio"], [role="checkbox"], input');
}

/**
 * 질문 본문(DP-224). 질문이 둘 이상이면 모든 질문을 한 칸에 겹쳐 두고 지금 질문만 보인다: 카드 높이는 가장 긴 질문의 높이로 고정되어
 * 넘길 때 출렁이지 않는다. 보이지 않는 질문은 `inert`라 초점과 화면 낭독에서 빠진다. 넘김은 150ms 옆으로 8px 미끄러지는 교차 전환이고(들어오는 질문은 바로 보이게 되어 초점을 받을 수 있고, 나가는 질문만 전환이 끝난 뒤 숨는다)
 * 움직임 줄이기(앱 설정·운영체제)면 바로 바뀐다. `focusTick`이 바뀌면(사용자가 넘김) 새 질문의 첫 선택지로 초점을 옮긴다
 */
export function QuestionBody(props: {
  readonly questions: readonly QuestionItem[];
  readonly draft: QuestionDraft;
  readonly disabled: boolean;
  readonly onChange: (next: (prev: QuestionDraft) => QuestionDraft) => void;
  /** 지금 보이는 질문(범위 안으로 맞춘 값) */
  readonly page: number;
  /** 사용자가 넘길 때마다 오르는 수. 처음 그릴 때는 초점을 옮기지 않는다 */
  readonly focusTick: number;
  readonly onPointerPick: (index: number) => void;
}): ReactNode {
  const { questions, page } = props;
  const paged = questionPagedOf(questions.length);
  const pages = useRef<HTMLDivElement | null>(null);
  const tick = useRef(props.focusTick);
  useEffect(() => {
    if (tick.current === props.focusTick) return;
    tick.current = props.focusTick;
    const current = pages.current?.querySelector<HTMLElement>('[data-question-page="current"]');
    if (current === null || current === undefined) return;
    firstFieldOf(current)?.focus({ preventScroll: true });
  }, [props.focusTick]);
  if (!paged) {
    return (
      <>
        {questions.map((question, index) => (
          <QuestionField
            key={question.id}
            question={question}
            draft={props.draft}
            disabled={props.disabled}
            onChange={props.onChange}
            onPointerPick={() => {
              props.onPointerPick(index);
            }}
          />
        ))}
      </>
    );
  }
  return (
    <div ref={pages} data-slot="question-pages" className="grid min-w-0">
      {questions.map((question, index) => {
        const side = index < page ? "before" : index > page ? "after" : "current";
        const shown = side === "current";
        return (
          <div
            key={question.id}
            role="group"
            aria-label={t("desktop.approvals.question.position", {
              n: index + 1,
              total: questions.length,
            })}
            aria-hidden={shown ? undefined : true}
            inert={!shown}
            data-question-page={side}
            className="min-w-0 transition-[opacity,translate,visibility] duration-150 ease-out [grid-area:1/1] motion-reduce:transition-none data-[question-page=current]:transition-[opacity,translate] data-[question-page=after]:invisible data-[question-page=after]:translate-x-2 data-[question-page=after]:opacity-0 data-[question-page=before]:invisible data-[question-page=before]:-translate-x-2 data-[question-page=before]:opacity-0"
          >
            <QuestionField
              question={question}
              draft={props.draft}
              disabled={props.disabled}
              onChange={props.onChange}
              onPointerPick={() => {
                props.onPointerPick(index);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** 검토 본문: 파일 합계와 파일마다 변경 종류, hunk 수. hunk 본문은 싣지 않는다(검토 열기는 P-04가 맡는다) */
export function ReviewBody(props: { readonly review: ReviewView }): ReactNode {
  const { review } = props;
  const totals = reviewTotalsOf(review.files);
  return (
    <>
      <div className="text-ui text-text-secondary">
        {t("desktop.approvals.review.totals", { files: totals.files, hunks: totals.hunks })}
      </div>
      <div
        role="list"
        aria-label={t("desktop.approvals.review.files.label")}
        className="flex max-h-48 flex-col gap-1 overflow-y-auto"
      >
        {review.files.map((file) => (
          <div key={file.path} role="listitem" className="flex flex-wrap items-baseline gap-2">
            <span className="text-ui text-text-secondary">{t(REVIEW_CHANGE_ID[file.change])}</span>
            <MessageCode>{file.path}</MessageCode>
            <span className="text-ui text-text-secondary">
              {file.binary
                ? t("desktop.approvals.review.binary")
                : t("desktop.approvals.review.hunks", { count: file.hunks })}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
