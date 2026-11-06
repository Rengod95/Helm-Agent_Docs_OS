// P-04 변경 검토. 무대를 채우는 화면: 머리(돌아가기, 리뷰 제목, 라운드, 원인 대화) · 파일 열 + diff 열 · 제출 줄.
// 경로(breadcrumb)는 두지 않고 돌아가기 IconButton 하나로 받은 요청에 돌아간다(DP-05). 파일 열은 caustic ListNavigation(sessions)이고
// 가운데는 투명 면 그대로다(DP-01). hunk 카드는 parts/hunk-review.tsx(C-08 빈틈).
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  IconButton,
  ListDescription,
  ListDescriptionRow,
  ListNavigation,
  ListNavigationGroup,
  ListNavigationItem,
  ScrollArea,
  Select,
  SelectOption,
  Skeleton,
} from "@caustic/react";
import { useLayoutEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  CircleCheck,
  defaultStatusCells,
  PanelLeft,
  Shell,
  standardRightTabs,
  useShell,
  type StatusCell,
} from "../_shell";
import {
  comments as baseComments,
  deliveredComments,
  extraFiles,
  files as baseFiles,
  meta,
  submitResult,
  type HunkDecision,
  type ReviewFile,
} from "./fixtures";
import { HunkReview } from "./parts/hunk-review";

export type ReviewState = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8";

const CHANGE_WORD = { M: "수정", A: "추가", D: "삭제" } as const;
const CHANGE_TONE = {
  M: "text-warning-text",
  A: "text-success-text",
  D: "text-danger-text",
} as const;

export function ReviewPage({ state }: { state: ReviewState }) {
  const shell = useShell();
  useLayoutEffect(() => shell.setEndOpen(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const round2 = state === "S5";
  const submitted = state === "S3";
  const offline = state === "S8";
  const loading = state === "S6";
  const empty = state === "S7";
  const files: ReviewFile[] = state === "S4" ? [...baseFiles, ...extraFiles] : baseFiles;

  const [current, setCurrent] = useState(state === "S4" ? "assets/cache-flow.png" : "src/cache.ts");
  const [decisions, setDecisions] = useState<Record<string, HunkDecision>>(() => {
    const all: Record<string, HunkDecision> = {};
    for (const f of baseFiles)
      for (const h of f.hunks)
        all[h.id] = round2
          ? "pending"
          : submitted
            ? h.decision === "pending"
              ? "approved"
              : h.decision
            : h.decision;
    return all;
  });
  const [fileDecisions, setFileDecisions] = useState<Record<string, HunkDecision>>({});
  const [draft, setDraft] = useState<{ hunk: string; at: number | "hunk" } | null>(
    state === "S2" ? { hunk: "f0h1", at: 45 } : null,
  );
  const [approveRest, setApproveRest] = useState(false);
  const comments = round2 ? [] : baseComments;

  const file = files.find((f) => f.path === current) ?? files[0];
  const allHunks = files.flatMap((f) => f.hunks);
  const count = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0 };
    for (const h of allHunks) c[decisions[h.id] ?? "pending"] += 1;
    for (const f of files) if (f.hunks.length === 0) c[fileDecisions[f.path] ?? "pending"] += 1;
    return c;
  }, [allHunks, decisions, fileDecisions, files]);
  const canSubmit = !offline && !submitted && (count.pending === 0 || approveRest);

  const decideFile = (f: ReviewFile, d: HunkDecision) => {
    if (f.hunks.length === 0) setFileDecisions((x) => ({ ...x, [f.path]: d }));
    else setDecisions((x) => ({ ...x, ...Object.fromEntries(f.hunks.map((h) => [h.id, d])) }));
  };
  const decidedOf = (f: ReviewFile) =>
    f.hunks.length === 0
      ? `${(fileDecisions[f.path] ?? "pending") === "pending" ? 0 : 1}/1`
      : `${f.hunks.filter((h) => decisions[h.id] !== "pending").length}/${f.hunks.length}`;

  const link: StatusCell | undefined = offline
    ? {
        id: "link",
        text: "끊김",
        dot: "danger",
        title: "연결 끊김",
        description: "엔진과 연결이 끊겼어요.",
      }
    : undefined;

  const fileColumn = shell.layout !== "compact";

  return (
    <Shell
      activeNav="inbox"
      stageLabel="변경 검토"
      threads={{ currentId: "t1", onSelect: () => {}, onNew: () => {} }}
      rightTabs={standardRightTabs({ inboxBadge: 10, only: ["inbox"] })}
      status={defaultStatusCells({
        layout: shell.layout,
        thread: false,
        pendingApprovals: 5,
        openEnd: shell.openEnd,
        link,
      })}
    >
      {/* 머리 한 줄: 돌아가기 · 제목 · 라운드 · 원인 대화 */}
      <header className="flex h-10 flex-none items-center gap-1 px-1.5">
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
        <IconButton size="sm" variant="ghost" label="받은 요청으로 돌아가기">
          <ChevronLeft />
        </IconButton>
        <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
          <h1 className="m-0 shrink-0 font-ui text-ui-strong text-text-primary">{meta.title}</h1>
          <span className="shrink-0 text-ui-sm tabular-nums text-text-secondary">
            라운드 {round2 ? 2 : meta.round}
          </span>
          <span className="truncate text-ui-sm text-text-tertiary">{meta.thread}</span>
        </div>
      </header>

      {empty ? (
        <div className="grid min-h-0 flex-1 place-items-center">
          <EmptyState
            icon={<CircleCheck />}
            surface="none"
            title="바뀐 내용이 없어요"
            actions={
              <Button size="sm" variant="outline">
                검토 닫기
              </Button>
            }
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3">
          {fileColumn && (
            <ScrollArea label="파일과 의견" className="w-60 flex-none">
              <ListNavigation
                aria-label="바뀐 파일"
                kind="sessions"
                size="sm"
                as="div"
                className="w-60 pb-2 [&_[data-slot=list-navigation-group]]:grid-cols-1 [&_[data-slot=list-navigation-label]]:min-w-0 [&_[data-slot=list-navigation-label]]:truncate"
              >
                <ListNavigationGroup heading="파일">
                  {files.map((f) =>
                    loading ? (
                      <li key={f.path} className="px-2 py-2">
                        <Skeleton width="80%" height={12} />
                      </li>
                    ) : (
                      <ListNavigationItem
                        key={f.path}
                        current={f.path === file?.path}
                        leading={
                          <span
                            aria-label={CHANGE_WORD[f.change]}
                            className={`w-3 text-center font-mono text-mono-sm ${CHANGE_TONE[f.change]}`}
                          >
                            {f.change}
                          </span>
                        }
                        count={decidedOf(f)}
                        onSelect={() => setCurrent(f.path)}
                        className="[&_[data-slot=list-navigation-label]]:font-mono [&_[data-slot=list-navigation-label]]:text-mono-sm"
                      >
                        {f.path}
                      </ListNavigationItem>
                    ),
                  )}
                </ListNavigationGroup>
                {!loading && (comments.length > 0 || round2) && (
                  <ListNavigationGroup heading={round2 ? "지난 라운드 의견" : "의견"}>
                    {(round2 ? deliveredComments : comments).map((c) => (
                      <ListNavigationItem
                        key={c.id}

                        onSelect={() => setCurrent(c.file)}
                        className={
                          round2
                            ? "[&_[data-slot=list-navigation-label]]:text-text-tertiary"
                            : undefined
                        }
                      >
                        {c.text}
                      </ListNavigationItem>
                    ))}
                  </ListNavigationGroup>
                )}
              </ListNavigation>
            </ScrollArea>
          )}

          <ScrollArea label="diff" className="min-h-0 min-w-0 flex-1">
            <div className="grid gap-3 pe-1.5 pb-3">
              {offline && <Alert tone="warning">엔진에 연결되면 제출할 수 있어요.</Alert>}
              {round2 && <Alert tone="info">고친 변경이 왔어요.</Alert>}
              {submitted && (
                <section aria-label="제출 결과" className="grid gap-1.5">
                  <Alert tone="danger">충돌 1개는 직접 고쳐야 해요.</Alert>
                  <ListDescription
                    variant="ghost"
                    size="xs"
                    aria-label="hunk별 결과"
                    className="rounded-none [--cs-size-list-term:12rem] [&_[data-slot=list-description-row]]:px-0"
                  >
                    {submitResult.rows.map((r) => (
                      <ListDescriptionRow
                        key={r.hunk}
                        term={<span className="font-mono">{r.path}</span>}
                      >
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <Badge size="xs" tone={r.tone}>
                            {r.outcome}
                          </Badge>
                          {r.detail !== "" && (
                            <span
                              className={
                                r.tone === "danger"
                                  ? "text-text-primary"
                                  : "font-mono text-mono-sm text-text-secondary"
                              }
                            >
                              {r.detail}
                            </span>
                          )}
                          {r.tone === "danger" && (
                            <Button size="xs" variant="outline">
                              파일 열기
                            </Button>
                          )}
                        </span>
                      </ListDescriptionRow>
                    ))}
                  </ListDescription>
                </section>
              )}

              {!fileColumn && (
                <Select
                  size="xs"
                  aria-label="파일"
                  value={current}
                  onValueChange={setCurrent}
                  className="w-full"
                >
                  {files.map((f) => (
                    <SelectOption key={f.path} value={f.path}>
                      {`${f.change} ${f.path} · ${decidedOf(f)}`}
                    </SelectOption>
                  ))}
                </Select>
              )}

              {loading ? (
                <div className="grid gap-2">
                  <Skeleton width="40%" height={16} />
                  <Skeleton height={140} radius="xl" />
                  <Skeleton height={96} radius="xl" />
                </div>
              ) : (
                file !== undefined && (
                  <>
                    {/* 파일 머리: 경로, +/−, 파일 단위 결정 */}
                    <div className="flex min-h-8 flex-wrap items-center gap-x-2.5 gap-y-1">
                      <h2 className="m-0 min-w-0 truncate font-mono text-mono-md font-medium text-text-primary">
                        {file.path}
                      </h2>
                      {file.added > 0 && (
                        <span className="font-mono text-mono-sm text-diff-add-text">
                          +{file.added}
                        </span>
                      )}
                      {file.removed > 0 && (
                        <span className="font-mono text-mono-sm text-diff-remove-text">
                          −{file.removed}
                        </span>
                      )}
                      <span aria-hidden className="flex-1" />
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={submitted || offline}
                        onClick={() => decideFile(file, "rejected")}
                      >
                        파일 거절
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={submitted || offline}
                        onClick={() => decideFile(file, "approved")}
                      >
                        파일 승인
                      </Button>
                    </div>

                    {file.binary === true || file.unreadable === true ? (
                      <div className="flex items-center gap-2.5 rounded-xl px-3 py-3 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]">
                        <span className="flex-1 text-ui-sm text-text-secondary">
                          {file.binary === true ? "바이너리 파일이에요." : "본문을 읽지 못했어요."}
                        </span>
                        {file.unreadable === true && (
                          <Button size="xs" variant="ghost">
                            다시 읽기
                          </Button>
                        )}
                        <Badge
                          size="xs"
                          tone={
                            (fileDecisions[file.path] ?? "pending") === "approved"
                              ? "success"
                              : (fileDecisions[file.path] ?? "pending") === "rejected"
                                ? "danger"
                                : "neutral"
                          }
                        >
                          {
                            { pending: "대기", approved: "승인함", rejected: "거절함" }[
                              fileDecisions[file.path] ?? "pending"
                            ]
                          }
                        </Badge>
                      </div>
                    ) : (
                      file.hunks.map((h) => (
                        <HunkReview
                          key={h.id}
                          hunk={h}
                          decision={decisions[h.id] ?? "pending"}
                          onDecide={(d) => setDecisions((x) => ({ ...x, [h.id]: d }))}
                          comments={comments.filter((c) => c.hunk === h.id)}
                          draftAt={draft?.hunk === h.id ? draft.at : undefined}
                          onComment={() => setDraft({ hunk: h.id, at: "hunk" })}
                          onDraftDone={() => setDraft(null)}
                          locked={submitted || offline}
                          delivered={
                            round2 && deliveredComments.some((c) => c.hunk === h.id) ? (
                              <p className="m-0 border-b border-border-subtle px-3 py-1.5 font-ui text-ui-xs text-text-tertiary">
                                지난 라운드 의견 전달됨 ·{" "}
                                {deliveredComments.find((c) => c.hunk === h.id)?.text}
                              </p>
                            ) : undefined
                          }
                        />
                      ))
                    )}
                  </>
                )
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* 제출 줄: 결정 집계 · 막힌 이유 · 남은 것 모두 승인 · 검토 닫기 · 제출. 선이나 상자 없이 간격으로만. */}
      {!empty && (
        <div className="flex min-h-11 flex-none flex-wrap items-center gap-x-3 gap-y-1 px-1.5 py-1">
          {submitted ? (
            <>
              <span aria-hidden className="flex-1" />
              <Button size="sm" variant="solid">
                받은 요청으로
              </Button>
            </>
          ) : (
            <>
              <span className="text-ui-sm tabular-nums text-text-primary">
                대기 {count.pending} · 승인 {count.approved} · 거절 {count.rejected}
              </span>
              {!canSubmit && !offline && count.pending > 0 && (
                <span className="text-ui-sm text-text-tertiary">
                  대기 hunk {count.pending}개를 먼저 정해요
                </span>
              )}
              <span aria-hidden className="flex-1" />
              <label className="flex items-center gap-2 text-ui-sm text-text-primary">
                <Checkbox
                  size="sm"
                  checked={approveRest}
                  onCheckedChange={(v) => setApproveRest(v === true)}
                  disabled={loading || offline}
                />
                남은 것 모두 승인
              </label>
              <Button size="sm" variant="ghost" disabled={offline}>
                검토 닫기
              </Button>
              <Button size="sm" variant="solid" disabled={!canSubmit || loading}>
                제출
              </Button>
            </>
          )}
        </div>
      )}
    </Shell>
  );
}
