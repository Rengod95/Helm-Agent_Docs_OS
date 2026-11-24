// P-17 버전 탭(AGE-76, §6.24.1): 깃 커밋 이력 같은 그림. 왼쪽은 이력 줄(고르는 단추, 맨 위에 대기 중인 되돌리기),
// 오른쪽은 고른 판에서 바뀐 것(하는 일의 차이와 파일 차이). 되돌리기는 바로 바꾸지 않고 리뷰 요청을 만든 뒤 리뷰 화면에서 그 항목을 연다.
// 읽기와 명령은 `VersionsBody`가 맡고, 그림은 `VersionsPanel`이 읽은 값대로 그린다. 그림 계산은 `versions-model.ts`가 한다.
import { activeLocale, t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow, type Result } from "@fresnel/contracts";
import type { ExtListEntry, PluginHistoryEntry, WireResult } from "@fresnel/contracts/wire";
import {
  Alert,
  Badge,
  Button,
  cn,
  ListDescription,
  ListDescriptionRow,
  listNavigationLink,
  Skeleton,
  toast,
} from "@caustic/react";
import { RotateCcw } from "@caustic/react/icons";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useCommands, type CommandError } from "../commands.ts";
import { DoesChanges } from "../craft/review/review-detail.tsx";
import { FilesSection } from "../craft/review/review-files.tsx";
import type { ReviewData } from "../craft/review/review-source.ts";
import { useOpenReview } from "../craft/members/members-source.ts";
import { ColumnHead, MUTED, TwoColumns } from "./tab-body.tsx";
import { RollbackDialog } from "./rollback-dialog.tsx";
import {
  currentLabelOf,
  detailRead,
  droppedOf,
  entryKeyOf,
  hasChangesOf,
  historyLinesOf,
  pendingRollbackOf,
  rollbackStopOf,
  selectedIndexOf,
  stopWordOf,
  versionLabelOf,
  type DetailRead,
  type HistoryLine,
  type HistoryRead,
  type PendingRollback,
  type RollbackStop,
} from "./versions-model.ts";

/** 신뢰 수준(설치 등급)의 사람 말. 모르는 값은 그대로 */
const GRADE_TEXT: Readonly<Record<string, MessageId>> = {
  builtin: "desktop.workbench.grade.builtin",
  user: "desktop.workbench.grade.user",
  project: "desktop.workbench.grade.project",
  untrusted: "desktop.workbench.grade.untrusted",
};

function gradeText(grade: string): string {
  const id = GRADE_TEXT[grade];
  return id === undefined ? grade : t(id);
}

/**
 * 신뢰 수준 한 줄(AGE-76 plugMin: 상세 머리의 "요청 user 유효 user"를 사람 말로 옮겼다).
 * 요청한 수준보다 낮게 실렸으면 그 사실을 한 줄 더한다
 */
function TrustLine(props: {
  readonly entry: Pick<ExtListEntry, "requestedGrade" | "effectiveGrade">;
}): ReactNode {
  const { requestedGrade, effectiveGrade } = props.entry;
  return (
    <ListDescription
      variant="ghost"
      size="sm"
      aria-label={t("desktop.workbench.grade.title")}
      className="rounded-none [--cs-size-list-term:8rem] [&_[data-slot=list-description-row]]:px-0"
    >
      <ListDescriptionRow term={t("desktop.workbench.grade.title")}>
        <span className="text-text-primary">{gradeText(effectiveGrade)}</span>
        {requestedGrade !== effectiveGrade && requestedGrade !== "" ? (
          <span className="block text-ui text-text-tertiary">
            {t("desktop.workbench.grade.lowered", { requested: gradeText(requestedGrade) })}
          </span>
        ) : null}
      </ListDescriptionRow>
    </ListDescription>
  );
}

export function VersionsTab(props: {
  readonly entry: Pick<
    ExtListEntry,
    "name" | "version" | "origin" | "requestedGrade" | "effectiveGrade"
  >;
  readonly locked: boolean;
}): ReactNode {
  return (
    <div className="grid gap-4">
      <TrustLine entry={props.entry} />
      <VersionsBody entry={props.entry} locked={props.locked} />
    </div>
  );
}

/** 이력과 대기 목록 읽기를 버전 탭의 상태로 바꾼다. 이력이 없는 엔진(`unsupported`)과 읽기 실패를 가른다. 대기 목록을 못 읽으면 대기 줄만 없다 */
function historyReadOf(
  name: string,
  history: Result<WireResult<"pluginReview.history">, CommandError>,
  listed: Result<WireResult<"pluginReview.list">, CommandError>,
): HistoryRead {
  if (!history.ok) {
    return history.error.kind === "unsupported" ? { kind: "unsupported" } : { kind: "error" };
  }
  return {
    kind: "ready",
    entries: history.value.entries,
    blocked: history.value.blocked,
    pending: listed.ok ? pendingRollbackOf(listed.value.items, name) : null,
  };
}

/** 읽기와 명령을 맡는다. 리뷰에서 승인하면 이력이 바뀌므로 알림마다 다시 읽는다 */
function VersionsBody(props: {
  readonly entry: Pick<ExtListEntry, "name" | "version">;
  readonly locked: boolean;
}): ReactNode {
  const commands = useCommands();
  const openReview = useOpenReview();
  const { name } = props.entry;
  const [read, setRead] = useState<HistoryRead>({ kind: "loading" });
  // 고른 줄은 키로 든다(이력이 바뀌어도 같은 판을 가리킨다). 없으면 맨 앞(최신)이다
  const [picked, setPicked] = useState<string | null>(null);
  // 고른 줄의 변경 내용. 다른 줄을 고른 뒤 늦게 온 응답이 그림을 덮지 않게 항목 id를 같이 든다
  const [detail, setDetail] = useState<{
    readonly itemId: string;
    readonly read: DetailRead;
  } | null>(null);
  // 읽기가 겹치면 마지막에 시작한 것만 그린다(review-source.ts의 차례 번호와 같다)
  const turn = useRef(0);

  const load = useCallback((): void => {
    turn.current += 1;
    const mine = turn.current;
    detach(
      Promise.all([commands.pluginReview.history(name), commands.pluginReview.list()]).then(
        ([history, listed]) => {
          if (mine === turn.current) setRead(historyReadOf(name, history, listed));
          return undefined;
        },
      ),
      rethrow,
    );
  }, [commands, name]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => commands.pluginReview.onChanged(load), [commands, load]);

  const ready = read.kind === "ready" ? read : null;
  const selected = ready === null ? 0 : selectedIndexOf(ready.entries, picked);
  const itemId = ready?.entries[selected]?.itemId ?? null;

  useEffect(() => {
    if (itemId === null) return undefined;
    let live = true;
    detach(
      commands.pluginReview.get(itemId).then((got) => {
        if (live) {
          setDetail({
            itemId,
            read: got.ok ? { kind: "ready", item: got.value.item } : { kind: "failed" },
          });
        }
        return undefined;
      }),
      rethrow,
    );
    return () => {
      live = false;
    };
  }, [commands, itemId]);

  const onPick = (index: number): void => {
    const entry = ready?.entries[index];
    if (entry !== undefined) setPicked(entryKeyOf(entry));
  };

  const onRollback = (entry: PluginHistoryEntry): void => {
    detach(
      commands.pluginReview.requestRollback(name, entry.contentHash).then((sent) => {
        if (!sent.ok) {
          toast({ tone: "danger", title: t("desktop.workbench.history.rollback.failed") });
          return undefined;
        }
        toast({ tone: "success", title: t("desktop.workbench.history.rollback.sent") });
        openReview(sent.value.itemId);
        return undefined;
      }),
      rethrow,
    );
  };

  return (
    <VersionsPanel
      installed={props.entry.version}
      read={read}
      locked={props.locked}
      selected={selected}
      detail={detailRead(itemId, detail)}
      files={commands.pluginReview}
      onPick={onPick}
      onRollback={onRollback}
      onOpenReview={openReview}
    />
  );
}

/** 버전 탭의 그림. 읽은 값과 명령은 바깥이 맡고, 여기서는 값대로 그린다 */
export function VersionsPanel(props: {
  /** 설치본의 버전. 이력이 없을 때 지금 판으로 보인다 */
  readonly installed: string;
  readonly read: HistoryRead;
  readonly locked: boolean;
  /** 고른 줄의 자리(이력 안) */
  readonly selected: number;
  readonly detail: DetailRead;
  readonly files: Pick<ReviewData, "file">;
  readonly onPick: (index: number) => void;
  readonly onRollback: (entry: PluginHistoryEntry) => void;
  readonly onOpenReview: (itemId: string) => void;
}): ReactNode {
  const [asking, setAsking] = useState(false);
  const { read } = props;
  if (read.kind === "loading") return <Skeleton height={24} />;
  if (read.kind === "error") {
    return <Alert tone="danger">{t("desktop.workbench.detail.load.failed")}</Alert>;
  }
  if (read.kind === "unsupported") {
    return (
      <HistoryPart
        installed={props.installed}
        lines={[]}
        pending={null}
        emptyText="desktop.workbench.versions.noHistory"
        onPick={props.onPick}
        onOpenReview={props.onOpenReview}
      />
    );
  }
  const { entries, blocked, pending } = read;
  const picked = entries[props.selected];
  if (picked === undefined) {
    return (
      <HistoryPart
        installed={props.installed}
        lines={[]}
        pending={pending}
        emptyText="desktop.workbench.history.empty"
        onPick={props.onPick}
        onOpenReview={props.onOpenReview}
      />
    );
  }
  const stop = rollbackStopOf({ blocked, locked: props.locked, entry: picked });
  const to = versionLabelOf(picked);
  return (
    <>
      <TwoColumns
        start={
          <HistoryPart
            installed={props.installed}
            lines={historyLinesOf(entries, props.selected)}
            pending={pending}
            emptyText="desktop.workbench.history.empty"
            onPick={props.onPick}
            onOpenReview={props.onOpenReview}
          />
        }
        end={
          <ChangesPart
            title={t("desktop.workbench.history.changesTitle", { version: to })}
            stop={stop}
            detail={props.detail}
            files={props.files}
            onRollback={() => {
              setAsking(true);
            }}
          />
        }
      />
      <RollbackDialog
        open={asking}
        from={currentLabelOf(entries, props.installed)}
        to={to}
        dropped={droppedOf(entries, props.selected)}
        onConfirm={() => {
          setAsking(false);
          props.onRollback(picked);
        }}
        onCancel={() => {
          setAsking(false);
        }}
      />
    </>
  );
}

/** 왼쪽 단: 이력 머리, 대기 중인 되돌리기 줄, 이력 줄 목록. 이력이 없으면 한 줄 말과 지금 판 한 줄 */
function HistoryPart(props: {
  readonly installed: string;
  readonly lines: readonly HistoryLine[];
  readonly pending: PendingRollback | null;
  /** 이력 줄이 없을 때 보이는 말 */
  readonly emptyText: MessageId;
  readonly onPick: (index: number) => void;
  readonly onOpenReview: (itemId: string) => void;
}): ReactNode {
  return (
    <div className="grid gap-4">
      <ColumnHead title={t("desktop.workbench.history.title")} />
      {props.pending === null ? null : (
        <PendingRow pending={props.pending} onOpenReview={props.onOpenReview} />
      )}
      {props.lines.length === 0 ? (
        <div className="grid gap-2">
          <p className={MUTED}>{t(props.emptyText)}</p>
          <div className="flex min-h-control-sm items-center gap-2">
            <span className="font-mono text-mono text-text-primary">{props.installed}</span>
            <Badge size="md" variant="solid">
              {t("desktop.workbench.versions.current")}
            </Badge>
          </div>
        </div>
      ) : (
        <ol aria-label={t("desktop.workbench.history.title")} className="m-0 grid p-0">
          {props.lines.map((line, index) => (
            <HistoryRow
              key={line.key}
              line={line}
              first={index === 0}
              last={index === props.lines.length - 1}
              onPick={() => {
                props.onPick(line.index);
              }}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

/** 대기 중인 되돌리기 줄: 되돌릴 판, "리뷰 대기" 꼬리표, 리뷰에서 보기 단추 */
function PendingRow(props: {
  readonly pending: PendingRollback;
  readonly onOpenReview: (itemId: string) => void;
}): ReactNode {
  return (
    <div className="flex min-h-control-sm items-center gap-2 px-2">
      <span className="font-mono text-mono text-text-primary">{props.pending.to}</span>
      <Badge size="md" variant="soft">
        {t("desktop.workbench.history.pending")}
      </Badge>
      <Button
        size="sm"
        variant="outline"
        className="ms-auto"
        onClick={() => {
          props.onOpenReview(props.pending.itemId);
        }}
      >
        {t("desktop.workbench.history.openReview")}
      </Button>
    </div>
  );
}

/**
 * 이력 줄 하나: 왼쪽 세로 선과 점(타임라인), 첫 줄은 버전, "지금" 꼬리표, 사건 꼬리표, 시각, 둘째 줄은 요약 또는 승인한 쪽의 말.
 * 줄 전체가 고르는 단추다. 점과 첫 줄은 같은 높이 칸 안에서 세로 가운데로 맞춘다
 */
function HistoryRow(props: {
  readonly line: HistoryLine;
  readonly first: boolean;
  readonly last: boolean;
  readonly onPick: () => void;
}): ReactNode {
  const { line } = props;
  const note = line.note.kind === "summary" ? line.note.text : t(line.note.word);
  return (
    <li className="list-none">
      <button
        type="button"
        aria-current={line.selected ? "page" : undefined}
        onClick={props.onPick}
        className={cn(
          listNavigationLink({ kind: "sessions", size: "sm" }),
          // 두 줄(버전 줄과 요약 줄)이 모두 보이게 고정 높이를 풀고, 줄 사이 선이 끊기지 않게 위아래 여백은 안쪽 글이 갖는다
          "h-auto min-w-0 items-stretch gap-3 border-0",
          line.selected ? null : "bg-transparent",
        )}
      >
        {/* 타임라인: 위 선(h-2.5)과 점(size-2)을 더하면 14로 첫 줄 높이(control-sm 28)의 가운데에 점이 선다. 첫 줄은 위 선을, 끝 줄은 아래 선을 비운다 */}
        <span aria-hidden="true" className="flex w-3 shrink-0 flex-col items-center">
          <span className={cn("h-2.5 w-px", props.first ? null : "bg-border-default")} />
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              line.current ? "bg-accent-solid" : "bg-text-tertiary",
            )}
          />
          <span className={cn("w-px flex-1", props.last ? null : "bg-border-default")} />
        </span>
        <span className="grid min-w-0 flex-1 pb-2">
          <span className="flex min-h-control-sm min-w-0 items-center gap-1.5">
            <span className="shrink-0 font-mono text-mono text-text-primary">{line.label}</span>
            {line.current ? (
              <Badge size="md" variant="solid">
                {t("desktop.workbench.versions.current")}
              </Badge>
            ) : null}
            <Badge size="md" variant="outline">
              {t(line.event)}
            </Badge>
            <span className="ms-auto shrink-0 text-ui-sm text-text-tertiary">
              {installedAtText(line.at)}
            </span>
          </span>
          <span
            className={cn(
              "min-w-0 truncate text-ui-sm",
              line.note.kind === "summary" ? "text-text-secondary" : "text-text-tertiary",
            )}
            title={note}
          >
            {note}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * 오른쪽 단: 고른 판에서 바뀐 것. 머리 오른쪽 끝에 되돌리기 단추(막히면 disabled)와 까닭 한 줄을 둔다.
 * 바뀐 내용은 고른 줄의 항목을 읽어 보인다(하는 일의 차이, 파일)
 */
function ChangesPart(props: {
  readonly title: string;
  readonly stop: RollbackStop | null;
  readonly detail: DetailRead;
  readonly files: Pick<ReviewData, "file">;
  readonly onRollback: () => void;
}): ReactNode {
  return (
    <div className="grid gap-4">
      <ColumnHead
        title={props.title}
        end={
          <Button
            size="sm"
            variant="outline"
            iconStart={<RotateCcw />}
            disabled={props.stop !== null}
            onClick={props.onRollback}
          >
            {t("desktop.workbench.history.rollbackAction")}
          </Button>
        }
      />
      <div className="grid gap-3">
        {props.stop === null ? null : <p className={MUTED}>{t(stopWordOf(props.stop))}</p>}
        <ChangesBody detail={props.detail} files={props.files} />
      </div>
    </div>
  );
}

function ChangesBody(props: {
  readonly detail: DetailRead;
  readonly files: Pick<ReviewData, "file">;
}): ReactNode {
  const { detail } = props;
  switch (detail.kind) {
    case "none":
      return <p className={MUTED}>{t("desktop.workbench.history.noItem")}</p>;
    case "loading":
      return <Skeleton height={24} />;
    case "failed":
      return <Alert tone="danger">{t("desktop.workbench.detail.load.failed")}</Alert>;
    case "ready": {
      const { item } = detail;
      return (
        <div className="grid gap-4">
          {hasChangesOf(item.diff) ? (
            <DoesChanges diff={item.diff} />
          ) : (
            <p className={MUTED}>{t("desktop.workbench.history.noChanges")}</p>
          )}
          <FilesSection item={item} data={props.files} fileRef={null} />
        </div>
      );
    }
    default:
      return assertNever(detail, "ChangesBody");
  }
}

/** 설치 시각의 글. 엔진이 준 ISO 시각을 앱의 다른 화면과 같은 로케일의 날짜와 시간 짧은 형식으로 쓴다. 읽을 수 없는 값은 그대로 둔다 */
export function installedAtText(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return new Intl.DateTimeFormat(activeLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(at);
}
