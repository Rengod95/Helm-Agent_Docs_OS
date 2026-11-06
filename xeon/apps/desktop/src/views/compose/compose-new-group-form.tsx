// "새 그룹" 화면의 입력 부품(§6.28.1, §6.29): 이름과 놓을 폴더, 시작점 격자와 그 읽기 상태. 명령은 부르지 않고 글과 짜임만 그린다.
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  newGroupNameErrorOf,
  startPointsOf,
  targetDirOf,
  type NewGroupDraft,
  type StartPoint,
  type TabRead,
} from "@fresnel/client/workbench";
import { assertNever } from "@fresnel/contracts";
import type { ExtensionKind, KindEntry } from "@fresnel/contracts/services";
import { Alert, Button, EmptyState, Field, Input, Skeleton } from "@caustic/react";
import type { ReactNode } from "react";

export const MUTED = "m-0 text-ui-sm text-text-tertiary";
export const MONO = "m-0 break-all font-mono text-mono-sm text-text-secondary";

function statusTextOf(status: StartPoint["status"]): MessageId | null {
  switch (status) {
    case "stable":
      return null;
    case "preview":
      return "desktop.compose.newGroup.start.preview";
    case "blocked":
      return "desktop.compose.newGroup.start.blocked";
    case "deprecated":
      return "desktop.compose.newGroup.start.deprecated";
    default:
      return assertNever(status, "KindStatus");
  }
}

/** 이름과 놓을 폴더, 그리고 읽기 전용 만들 위치. 폴더 고르기는 창을 열 수 있을 때만 그린다 */
export function PlaceFields(props: {
  readonly draft: NewGroupDraft;
  readonly onName: (name: string) => void;
  readonly onParent: (parentDir: string) => void;
  readonly canPick: boolean;
  readonly pickFailed: boolean;
  readonly onPick: () => void;
}): ReactNode {
  const { draft } = props;
  const nameError = newGroupNameErrorOf(draft.name);
  return (
    <div className="grid gap-3 compact:grid-cols-2">
      <Field
        label={t("desktop.compose.newGroup.name.label")}
        error={nameError === null ? undefined : t("desktop.compose.newGroup.name.pattern")}
      >
        <Input
          size="sm"
          value={draft.name}
          placeholder="lens-review"
          onValueChange={props.onName}
        />
      </Field>
      <div className="grid content-start gap-1.5">
        <Field label={t("desktop.compose.newGroup.parent.label")}>
          <div className="flex items-center gap-2">
            <Input
              size="sm"
              className="min-w-0 flex-1"
              value={draft.parentDir}
              placeholder={t("desktop.compose.newGroup.parent.placeholder")}
              onValueChange={props.onParent}
            />
            {props.canPick ? (
              <Button size="sm" variant="outline" onClick={props.onPick}>
                {t("desktop.compose.newGroup.pick")}
              </Button>
            ) : null}
          </div>
        </Field>
        {props.pickFailed ? (
          <p role="alert" className={MUTED}>
            {t("desktop.workspace.pickFailed")}
          </p>
        ) : null}
      </div>
      <Field label={t("desktop.compose.newGroup.target.label")}>
        <Input size="sm" readOnly className="font-mono" value={targetDirOf(draft)} />
      </Field>
    </div>
  );
}

function StatusNote(props: { readonly status: StartPoint["status"] }): ReactNode {
  const id = statusTextOf(props.status);
  return id === null ? null : <span className="text-footnote text-text-tertiary">{t(id)}</span>;
}

/** 시작점 격자 한 장. 고를 수 없는 종류는 aria-disabled이고 누를 수 없으며 Tab 순서에서도 뺀다 */
export function StartGrid(props: {
  readonly points: readonly StartPoint[];
  readonly selected: ExtensionKind | null;
  readonly onPick: (id: ExtensionKind) => void;
}): ReactNode {
  return (
    <div
      role="radiogroup"
      aria-label={t("desktop.compose.newGroup.start.head")}
      className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle compact:grid-cols-3"
    >
      {props.points.map((point) => {
        const on = point.id === props.selected;
        return (
          <button
            key={point.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-disabled={!point.selectable}
            tabIndex={point.selectable ? 0 : -1}
            onClick={() => {
              if (point.selectable) props.onPick(point.id);
            }}
            className={`grid min-h-20 content-start gap-1 p-3 text-start outline-none focus-visible:shadow-focus ${on ? "bg-neutral-soft" : "bg-surface-base"} ${point.selectable ? "cursor-pointer hover:bg-neutral-soft" : "cursor-not-allowed"}`}
          >
            <span
              className={`text-ui-strong ${point.selectable ? "text-text-primary" : "text-text-tertiary"}`}
            >
              {point.title}
            </span>
            <StatusNote status={point.status} />
          </button>
        );
      })}
    </div>
  );
}

/** 시작점 읽기 상태: 읽는 중, 오프라인, 오류(다시 읽기), 빈 목록, 격자 */
export function StartPicker(props: {
  readonly read: TabRead<readonly KindEntry[]>;
  readonly selected: ExtensionKind | null;
  readonly onPick: (id: ExtensionKind) => void;
  readonly onRetry: () => void;
}): ReactNode {
  const { read } = props;
  switch (read.kind) {
    case "loading":
      return (
        <div role="status" aria-busy="true" className="grid grid-cols-2 gap-2 compact:grid-cols-3">
          <span className="sr-only">{t("desktop.compose.loading")}</span>
          {[0, 1, 2].map((slot) => (
            <Skeleton key={slot} height={80} />
          ))}
        </div>
      );
    case "offline":
      return <p className={MUTED}>{t("desktop.compose.offline")}</p>;
    case "error":
      return (
        <Alert
          tone="danger"
          action={
            <Button size="xs" variant="outline" onClick={props.onRetry}>
              {t("desktop.compose.retry")}
            </Button>
          }
        >
          {t("desktop.compose.newGroup.start.failed")}
        </Alert>
      );
    case "ready":
      return (
        <div className="grid gap-2">
          {read.stale ? <p className={MUTED}>{t("desktop.compose.stale")}</p> : null}
          {read.value.length === 0 ? (
            <EmptyState
              size="sm"
              surface="none"
              title={t("desktop.compose.newGroup.start.empty.title")}
              description={t("desktop.compose.newGroup.start.empty.body")}
            />
          ) : (
            <StartGrid
              points={startPointsOf(read.value)}
              selected={props.selected}
              onPick={props.onPick}
            />
          )}
        </div>
      );
    default:
      return assertNever(read, "TabRead");
  }
}
