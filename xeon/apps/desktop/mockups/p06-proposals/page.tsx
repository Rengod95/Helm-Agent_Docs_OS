// P-06 제안. 무대 안 두 열: 왼쪽 목록(listbox) · 오른쪽 상세(region). 둘 다 투명 면 위에 있고 간격으로만 나눈다(DP-01·03).
// 상세: 제목(종류·대상) → 경고(untrusted·충돌) → ListDescription 한 목록(낸 쪽, 이유, 근거, 범위) → 읽기 전용 CodeDiff → 결정 줄.
// 낸 쪽은 L3 그룹(learning)이나 L2 기능(knowledge)이고, knowledge 제안이면 근거가 된 Helm 발견도 보인다.
import {
  Alert,
  Badge,
  Button,
  CodeDiff,
  CodeDiffLine,
  EmptyState,
  IconButton,
  ListDescription,
  ListDescriptionRow,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectOption,
  Skeleton,
  Textarea,
} from "@caustic/react";
import { useLayoutEffect, useState } from "react";
import {
  BAR_INSET,
  ChevronLeft,
  defaultStatusCells,
  PanelLeft,
  Shell,
  Sparkles,
  standardRightTabs,
  useShell,
  type StatusCell,
} from "../_shell";
import { proposals, STATUS_WORD, type Proposal } from "./fixtures";

export type ProposalState = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8" | "S9";

const LIST_DESC =
  "rounded-none [--cs-size-list-term:6rem] [&_[data-slot=list-description-row]]:px-0";

function Row({ p, selected, onSelect }: { p: Proposal; selected: boolean; onSelect: () => void }) {
  // 둘째 줄은 상태 말만 둔다. 대기 중인 것은 겹치는 스킬이 있을 때만 "충돌"을 단다.
  const note =
    p.status !== "pending" ? STATUS_WORD[p.status] : p.conflictsWith !== undefined ? "충돌" : null;
  return (
    <li role="option" aria-selected={selected}>
      <button
        type="button"
        onClick={onSelect}
        className={[
          "flex w-full min-w-0 items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-control focus-visible:focus-ring",
          selected
            ? "bg-control-raised shadow-[inset_0_0_0_1px_var(--cs-color-control-edge)]"
            : "hover:bg-fill-hover",
        ].join(" ")}
      >
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-ui-sm text-text-secondary">{p.kind}</span>
            <span className="min-w-0 truncate font-mono text-mono-sm text-text-primary">
              {p.target}
            </span>
          </span>
          {note !== null && (
            <span
              className={`min-w-0 truncate text-ui-xs ${p.conflictsWith !== undefined && p.status === "pending" ? "text-warning-text" : "text-text-tertiary"}`}
            >
              {note}
            </span>
          )}
        </span>
        <span className="shrink-0 whitespace-nowrap text-ui-xs tabular-nums text-text-tertiary">
          {p.at}
        </span>
      </button>
    </li>
  );
}

export function ProposalsPage({ state }: { state: ProposalState }) {
  const shell = useShell();
  useLayoutEffect(() => shell.setEndOpen(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const empty = state === "S6";
  const loading = state === "S7";
  const failed = state === "S8";
  const offline = state === "S9";
  const [filter, setFilter] = useState(state === "S5" ? "applied" : "pending");
  const [kind, setKind] = useState("all");
  const [source, setSource] = useState("all");
  const [selectedId, setSelectedId] = useState(
    state === "S2" ? "p3" : state === "S5" ? "p4" : "p1",
  );
  const [mode, setMode] = useState<"view" | "edit" | "reject">(
    state === "S3" ? "edit" : state === "S4" ? "reject" : "view",
  );
  const [scope, setScope] = useState("user");
  const [showList, setShowList] = useState(false);

  const rows = proposals
    .filter((p) => filter === "all" || p.status === filter)
    .filter((p) => kind === "all" || p.kind === kind)
    .filter((p) => source === "all" || p.source.id === source)
    .filter((p) => !failed || p.source.id === "grp:learning");
  const p = rows.find((r) => r.id === selectedId) ?? rows[0];
  const compact = shell.layout === "compact";
  const listVisible = !compact || showList;
  const detailVisible = !compact || !showList;

  const link: StatusCell | undefined = offline
    ? {
        id: "link",
        text: "끊김",
        dot: "danger",
        title: "연결 끊김",
        description: "엔진과 연결이 끊겼어요.",
      }
    : undefined;

  const decision = p !== undefined && !empty && !loading && (
    <div className="flex min-h-11 flex-none flex-wrap items-center gap-1.5 py-1">
      {mode === "edit" ? (
        <>
          <span aria-hidden className="flex-1" />
          <Button size="sm" tone="neutral" variant="ghost" onClick={() => setMode("view")}>
            취소
          </Button>
          <Button
            size="sm"
            tone="neutral"
            variant="solid"
            disabled={offline}
            onClick={() => setMode("view")}
          >
            저장
          </Button>
        </>
      ) : mode === "reject" ? (
        <>
          <span aria-hidden className="flex-1" />
          <Button size="sm" tone="neutral" variant="ghost" onClick={() => setMode("view")}>
            취소
          </Button>
          <Button size="sm" tone="danger" variant="solid" disabled={offline}>
            거절
          </Button>
        </>
      ) : p.status === "applied" ? (
        <>
          <span aria-hidden className="flex-1" />
          <Button size="sm" tone="danger" variant="ghost" disabled={offline}>
            되돌리기
          </Button>
        </>
      ) : p.status === "rejected" ? null : (
        <>
          <Button
            size="sm"
            tone="neutral"
            variant="ghost"
            disabled={offline}
            onClick={() => setMode("reject")}
          >
            거절
          </Button>
          <span aria-hidden className="flex-1" />
          <Button
            size="sm"
            tone="neutral"
            variant="outline"
            disabled={offline}
            onClick={() => setMode("edit")}
          >
            수정
          </Button>
          <Button size="sm" tone="neutral" variant="solid" disabled={offline}>
            승인
          </Button>
        </>
      )}
    </div>
  );

  return (
    <Shell
      activeNav="proposals"
      stageLabel="제안"
      threads={{ currentId: null, onSelect: () => {}, onNew: () => {} }}
      rightTabs={standardRightTabs({ inboxBadge: 10, only: ["inbox"] })}
      status={defaultStatusCells({
        layout: shell.layout,
        thread: false,
        pendingApprovals: 5,
        openEnd: shell.openEnd,
        link,
      })}
    >
      <header
        className={`flex min-h-10 flex-none flex-wrap items-center gap-x-2 gap-y-1 px-1.5 py-1 ${BAR_INSET}`}
      >
        {!shell.startOpen && (
          <IconButton
            size="sm"
            variant="ghost"
            label="사이드바 열기"
            aria-expanded={false}
            onClick={() => shell.setStartOpen(true)}
          >
            <PanelLeft />
          </IconButton>
        )}
        <h1 className="m-0 me-1 font-ui text-ui-strong text-text-primary">제안</h1>
        <SegmentedControl size="xs" aria-label="상태" value={filter} onValueChange={setFilter}>
          <SegmentedControlItem value="pending">대기</SegmentedControlItem>
          <SegmentedControlItem value="applied">적용됨</SegmentedControlItem>
          <SegmentedControlItem value="all">모두</SegmentedControlItem>
        </SegmentedControl>
        <span aria-hidden className="flex-1" />
        <Select size="xs" aria-label="종류" value={kind} onValueChange={setKind} className="w-32">
          <SelectOption value="all">모든 종류</SelectOption>
          <SelectOption value="스킬 생성">스킬 생성</SelectOption>
          <SelectOption value="스킬 수정">스킬 수정</SelectOption>
          <SelectOption value="메모리 추가">메모리 추가</SelectOption>
          <SelectOption value="피드백">피드백</SelectOption>
        </Select>
        <Select
          size="xs"
          aria-label="낸 쪽"
          value={source}
          onValueChange={setSource}
          className="w-36"
        >
          <SelectOption value="all">모든 출처</SelectOption>
          <SelectOption value="grp:learning">learning 그룹</SelectOption>
          <SelectOption value="L2 knowledge">knowledge 기능</SelectOption>
        </Select>
      </header>

      {empty ? (
        <div className="grid min-h-0 flex-1 place-items-center">
          <EmptyState icon={<Sparkles />} surface="none" title="대기 중인 제안이 없어요" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-4">
          {listVisible && (
            <div
              className={`flex min-h-0 flex-col gap-1.5 ${compact ? "flex-1" : "w-80 flex-none"}`}
            >
              {failed && <Alert tone="warning">일부 제안을 읽지 못했어요</Alert>}
              <ScrollArea label="제안 목록" className="min-h-0 flex-1">
                {loading ? (
                  <div className="grid gap-4 px-2.5 py-2">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className="grid gap-1.5">
                        <Skeleton width="70%" height={14} />
                        <Skeleton width="40%" height={10} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <ul
                    role="listbox"
                    aria-label="제안"
                    className="m-0 grid list-none gap-0.5 p-0 pb-2"
                  >
                    {rows.map((r) => (
                      <Row
                        key={r.id}
                        p={r}
                        selected={r.id === p?.id}
                        onSelect={() => {
                          setSelectedId(r.id);
                          setMode("view");
                          setShowList(false);
                        }}
                      />
                    ))}
                  </ul>
                )}
                {!loading && filter === "all" && (
                  <Button size="xs" tone="neutral" variant="ghost" className="ms-1">
                    더 보기
                  </Button>
                )}
              </ScrollArea>
            </div>
          )}

          {detailVisible && (
            <section aria-label="제안 상세" className="flex min-h-0 min-w-0 flex-1 flex-col pe-1.5">
              {loading || p === undefined ? (
                <div className="grid gap-2 pt-1">
                  <Skeleton width="45%" height={18} />
                  <Skeleton height={80} />
                  <Skeleton height={160} radius="xl" />
                </div>
              ) : (
                <>
                  <div className="flex min-h-8 flex-none items-center gap-2">
                    {compact && (
                      <IconButton
                        size="sm"
                        variant="ghost"
                        label="제안 목록"
                        onClick={() => setShowList(true)}
                        className="-ms-1.5"
                      >
                        <ChevronLeft />
                      </IconButton>
                    )}
                    <h2 className="m-0 flex min-w-0 items-baseline gap-2 text-ui-strong font-semibold text-text-primary">
                      {p.kind}
                      <span className="truncate font-mono text-mono-md font-medium">
                        {p.target}
                      </span>
                    </h2>
                    {p.status !== "pending" && (
                      <Badge size="xs" tone={p.status === "applied" ? "success" : "neutral"}>
                        {STATUS_WORD[p.status]}
                      </Badge>
                    )}
                  </div>
                  <ScrollArea label="제안 내용" className="min-h-0 flex-1">
                    <div className="grid gap-3 pt-1 pb-2">
                      {failed && (
                        <Alert tone="danger">다른 곳에서 바뀌었어요. 목록을 다시 읽었어요.</Alert>
                      )}
                      {offline && <Alert tone="warning">엔진에 연결되면 결정할 수 있어요</Alert>}
                      {p.afterUntrusted === true && (
                        <Alert tone="warning">웹 결과를 읽은 뒤 만든 후보예요.</Alert>
                      )}
                      {p.conflictsWith !== undefined && (
                        <Alert tone="warning">
                          {p.conflictsWith.owner}의 {p.conflictsWith.name} 스킬과 겹쳐요. 승인하면
                          이 스킬이 먼저 쓰여요.
                        </Alert>
                      )}
                      <ListDescription
                        variant="ghost"
                        size="xs"
                        aria-label="제안 정보"
                        className={LIST_DESC}
                      >
                        <ListDescriptionRow term="낸 쪽">
                          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                            {p.source.name}
                            {p.source.via !== undefined && (
                              <span className="text-text-secondary">· {p.source.via}에서</span>
                            )}
                          </span>
                        </ListDescriptionRow>
                        <ListDescriptionRow term="이유">{p.rationale}</ListDescriptionRow>
                        <ListDescriptionRow term="근거">
                          <span className="flex items-center gap-2">
                            <Button size="xs" tone="neutral" variant="ghost">
                              대화에서 보기
                            </Button>
                          </span>
                        </ListDescriptionRow>
                        {p.scopeChoice === true && p.status === "pending" && (
                          <ListDescriptionRow term="범위">
                            <RadioGroup
                              size="sm"
                              orientation="horizontal"
                              aria-label="범위"
                              value={scope}
                              onValueChange={setScope}
                              disabled={offline}
                            >
                              <RadioGroupItem value="user">사용자</RadioGroupItem>
                              <RadioGroupItem value="project">프로젝트</RadioGroupItem>
                            </RadioGroup>
                          </ListDescriptionRow>
                        )}
                      </ListDescription>
                      {mode === "edit" ? (
                        <Textarea
                          size="sm"
                          rows={12}
                          aria-label={`${p.file} 본문`}
                          className="font-mono text-mono-sm"
                          defaultValue={p.diff
                            .filter((l) => l.kind !== "remove")
                            .map((l) => l.text)
                            .join("\n")}
                        />
                      ) : (
                        <CodeDiff
                          aria-label={`${p.file} 변경`}
                          filename={p.file}
                          actions={false}
                          size="sm"
                          radius="xl"
                        >
                          {p.diff.map((l, i) => (
                            <CodeDiffLine key={i} kind={l.kind} number={l.n}>
                              {l.text}
                            </CodeDiffLine>
                          ))}
                        </CodeDiff>
                      )}
                      {mode === "reject" && (
                        <Textarea
                          size="sm"
                          rows={2}
                          autoFocus
                          aria-label="거절 메모"
                          placeholder="거절 이유(선택, 500자)"
                        />
                      )}
                    </div>
                  </ScrollArea>
                  {decision}
                </>
              )}
            </section>
          )}
        </div>
      )}
    </Shell>
  );
}
