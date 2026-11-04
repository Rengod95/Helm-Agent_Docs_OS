// 구성기의 "새 그룹" 시작 화면(§6.28.1, §6.29). 이름과 놓을 폴더, 시작점(`ext.kinds`)을 고르고 `ext.scaffold`로 뼈대를 만든 뒤 `ext.validate`로 검사한다.
// 만든 뒤에는 검사 다시 돌리기와 설치 묶음 만들기를 둔다. 디스크에 쓰므로 엔진에 연결되어 있을 때만 만들기를 켠다.
// 예약 이름 같은 거절은 호스트가 정하고, 화면은 그 문장을 그대로 보인다(`issue`).
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  devkitSummaryOf,
  newGroupDraftOf,
  newGroupNameErrorOf,
  newGroupProblemOf,
  scaffoldInputOf,
  scaffoldInputWithComposition,
  startPointsOf,
  targetDirOf,
  type NewGroupDraft,
  type StartPoint,
  type TabLink,
  type TabRead,
} from "@fresnel/client/workbench";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { CompositionDecl } from "@fresnel/contracts/extensions";
import type {
  DevkitIssue,
  ExtensionKind,
  KindEntry,
  PackResult,
  ScaffoldInput,
} from "@fresnel/contracts/services";
import { Alert, Button, EmptyState, Field, Input, Skeleton } from "@caustic/react";
import { useCallback, useState, type ReactNode } from "react";
import { useCommands } from "../commands.ts";
import { InfoTip } from "../craft/info-tip.tsx";
import { useFolderPick } from "../folder-pick-context.ts";
import { pickWorkspaceFolder, type FolderPickInvoke } from "../folder-pick.ts";
import { useTabRead } from "../workbench/tab-read.ts";

const MUTED = "m-0 text-ui-sm text-text-tertiary";
const MONO = "m-0 break-all font-mono text-mono-sm text-text-secondary";

/** 새 그룹을 열 때 미리 채우는 값. 코드 보기의 "플러그인 빌더로 만들기"가 그룹 이름과 종류를 넘기고, 흐름 초안의 "새 그룹 만들기"는 구성 선언을 함께 넘긴다 */
export interface NewGroupPrefill {
  readonly name: string;
  readonly kind: ExtensionKind;
  /** 있으면 만들 때 `group.composition`으로 싣는다(플러그인 그룹일 때만) */
  readonly composition?: CompositionDecl;
}

/** 만들기 입력. 구성 선언이 있으면 그것을 싣고, 없으면 시작점만 본 입력이다 */
function createInputOf(
  draft: NewGroupDraft,
  composition: CompositionDecl | undefined,
): ScaffoldInput | null {
  return composition === undefined
    ? scaffoldInputOf(draft)
    : scaffoldInputWithComposition(draft, composition);
}

type DirCheck =
  | { readonly kind: "done"; readonly issues: readonly DevkitIssue[] }
  | { readonly kind: "failed" };

type PackRead =
  | { readonly kind: "idle" }
  | { readonly kind: "failed" }
  | { readonly kind: "done"; readonly result: PackResult };

/** 만든 뒤의 결과. 검사와 묶음은 같은 폴더를 가리킨다 */
interface MadeGroup {
  readonly kind: "made";
  readonly dir: string;
  readonly files: readonly string[];
  readonly check: DirCheck;
  readonly pack: PackRead;
}

type CreateResult = { readonly kind: "failed"; readonly issue: string | null } | MadeGroup;

/** 지금 보내고 있는 명령. 같은 명령의 단추에만 도는 표식을 단다 */
type Working = "create" | "recheck" | "pack" | null;

function run(work: Promise<void>): void {
  detach(work, rethrow);
}

function draftOf(prefill: NewGroupPrefill | null): NewGroupDraft {
  const base = newGroupDraftOf();
  return prefill === null ? base : { ...base, name: prefill.name, kind: prefill.kind };
}

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

function summaryTextOf(errors: number, warnings: number): string {
  if (errors === 0 && warnings === 0) return t("desktop.compose.newGroup.check.passed");
  const parts: string[] = [];
  if (errors > 0) parts.push(t("desktop.compose.newGroup.check.errors", { count: errors }));
  if (warnings > 0) parts.push(t("desktop.compose.newGroup.check.warnings", { count: warnings }));
  return parts.join(" ");
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
    <div className="grid gap-3 sm:grid-cols-2">
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
      className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle sm:grid-cols-3"
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
        <div role="status" aria-busy="true" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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

/** `ext.validate` 결과: 개수로 요약하는 띠 하나와 문제 줄들. 오류는 danger, 경고만 있으면 warning, 없으면 success */
export function CheckNotice(props: { readonly check: DirCheck }): ReactNode {
  const { check } = props;
  if (check.kind === "failed") {
    return <Alert tone="warning">{t("desktop.compose.newGroup.check.failed")}</Alert>;
  }
  const { errors, warnings } = devkitSummaryOf(check.issues);
  const tone = errors > 0 ? "danger" : warnings > 0 ? "warning" : "success";
  return (
    <div className="grid gap-2">
      <Alert tone={tone}>{summaryTextOf(errors, warnings)}</Alert>
      {check.issues.length === 0 ? null : (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {check.issues.map((issue) => (
            <li
              key={`${issue.code}:${issue.path}:${issue.message}`}
              className="text-ui-sm text-text-secondary"
            >
              <span className="font-mono">{issue.code}</span> {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 만들지 못한 까닭. 호스트가 준 거절 문장이 있으면 그대로 보이고, 없으면 일반 문장이다 */
export function FailedNotice(props: { readonly issue: string | null }): ReactNode {
  return <Alert tone="danger">{props.issue ?? t("desktop.compose.newGroup.failed")}</Alert>;
}

function PackNote(props: { readonly pack: PackRead }): ReactNode {
  const { pack } = props;
  switch (pack.kind) {
    case "idle":
      return null;
    case "failed":
      return <Alert tone="danger">{t("desktop.compose.newGroup.pack.failed")}</Alert>;
    case "done":
      return (
        <dl className="m-0 grid gap-2 text-ui-sm">
          <div className="grid gap-0.5">
            <dt className="text-text-tertiary">{t("desktop.compose.newGroup.pack.path")}</dt>
            <dd className={MONO}>{pack.result.path}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-text-tertiary">{t("desktop.compose.newGroup.pack.hash")}</dt>
            <dd className={MONO}>{pack.result.sha256}</dd>
          </div>
        </dl>
      );
    default:
      return assertNever(pack, "PackRead");
  }
}

/** 만든 뒤의 결과: 위치, 만든 파일, 검사, 그리고 다시 돌리기와 묶음 만들기 */
export function MadeResult(props: {
  readonly made: MadeGroup;
  readonly working: Working;
  readonly onRecheck: () => void;
  readonly onPack: () => void;
}): ReactNode {
  const { made, working } = props;
  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <span className="text-ui-sm font-semibold text-text-primary">
          {t("desktop.compose.newGroup.made.dir")}
        </span>
        <p className={MONO}>{made.dir}</p>
      </div>
      <div className="grid gap-1">
        <span className="text-ui-sm font-semibold text-text-primary">
          {t("desktop.compose.newGroup.made.files")}
        </span>
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {made.files.map((file) => (
            <li key={file} className="truncate font-mono text-mono-sm text-text-secondary">
              {file}
            </li>
          ))}
        </ul>
      </div>
      <CheckNotice check={made.check} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={working !== null}
          loading={working === "recheck"}
          onClick={props.onRecheck}
        >
          {t("desktop.compose.newGroup.recheck")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={working !== null}
          loading={working === "pack"}
          onClick={props.onPack}
        >
          {t("desktop.compose.newGroup.pack")}
        </Button>
      </div>
      <PackNote pack={made.pack} />
    </div>
  );
}

/** "새 그룹" 시작 화면. 쓰기는 `ext.scaffold`와 `ext.validate`, 묶음 만들기(`ext.package`)뿐이다 */
export function NewGroupScreen(props: {
  readonly link: TabLink;
  readonly prefill: NewGroupPrefill | null;
  readonly onBack: () => void;
}): ReactNode {
  const commands = useCommands();
  const folderPick = useFolderPick();
  const [draft, setDraft] = useState<NewGroupDraft>(() => draftOf(props.prefill));
  const [version, setVersion] = useState(0);
  const loadKinds = useCallback(() => commands.workbench.kinds(), [commands]);
  const kinds = useTabRead(`compose-kinds:${version}`, props.link, loadKinds);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [working, setWorking] = useState<Working>(null);
  const [pickFailed, setPickFailed] = useState(false);

  // 시작점은 읽힌 종류 가운데 고를 수 있는 것이어야 만들 수 있다
  const chosen =
    kinds.kind === "ready"
      ? startPointsOf(kinds.value).find((point) => point.id === draft.kind)
      : undefined;
  const ready =
    props.link === "live" && newGroupProblemOf(draft) === null && chosen?.selectable === true;

  // 입력이 바뀌면 지난 결과(만든 곳과 검사)는 더 이상 맞지 않으니 치운다
  const edit = (patch: Partial<NewGroupDraft>): void => {
    setDraft((current) => ({ ...current, ...patch }));
    setResult(null);
  };

  const pick = async (invoke: FolderPickInvoke): Promise<void> => {
    const picked = await pickWorkspaceFolder(invoke);
    if (!picked.ok) {
      setPickFailed(true);
      return;
    }
    setPickFailed(false);
    if (picked.value !== undefined) edit({ parentDir: picked.value });
  };

  const create = async (): Promise<void> => {
    const input = createInputOf(draft, props.prefill?.composition);
    if (input === null) return;
    setWorking("create");
    setResult(null);
    const made = await commands.workbench.scaffold(input);
    if (!made.ok) {
      setWorking(null);
      setResult({
        kind: "failed",
        issue: made.error.kind === "rejected" ? (made.error.issue ?? null) : null,
      });
      return;
    }
    const checked = await commands.workbench.validateDir(made.value.dir);
    setWorking(null);
    setResult({
      kind: "made",
      dir: made.value.dir,
      files: made.value.files,
      check: checked.ok ? { kind: "done", issues: checked.value.issues } : { kind: "failed" },
      pack: { kind: "idle" },
    });
  };

  const recheck = async (dir: string): Promise<void> => {
    setWorking("recheck");
    const checked = await commands.workbench.validateDir(dir);
    setWorking(null);
    const check: DirCheck = checked.ok
      ? { kind: "done", issues: checked.value.issues }
      : { kind: "failed" };
    setResult((current) =>
      current !== null && current.kind === "made" && current.dir === dir
        ? { ...current, check }
        : current,
    );
  };

  const pack = async (dir: string): Promise<void> => {
    setWorking("pack");
    const packed = await commands.workbench.packDir(dir);
    setWorking(null);
    const next: PackRead = packed.ok ? { kind: "done", result: packed.value } : { kind: "failed" };
    setResult((current) =>
      current !== null && current.kind === "made" && current.dir === dir
        ? { ...current, pack: next }
        : current,
    );
  };

  return (
    <section aria-labelledby="compose-new-group-title" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="compose-new-group-title" className="m-0 text-ui-strong text-text-primary">
          {t("desktop.compose.newGroup.title")}
        </h2>
        <Button size="sm" variant="outline" onClick={props.onBack}>
          {t("desktop.compose.newGroup.back")}
        </Button>
      </div>
      {props.prefill?.composition === undefined ? null : (
        <p className={MUTED}>{t("desktop.compose.flow.draft.newGroupNote")}</p>
      )}
      <div className="grid gap-2">
        <p className="m-0 flex items-center gap-1 text-ui-sm font-semibold text-text-primary">
          {t("desktop.compose.newGroup.place.head")}
          <InfoTip text={t("desktop.compose.newGroup.place.info")} />
        </p>
        <PlaceFields
          draft={draft}
          onName={(name) => edit({ name })}
          onParent={(parentDir) => edit({ parentDir })}
          canPick={folderPick !== null}
          pickFailed={pickFailed}
          onPick={() => {
            if (folderPick !== null) run(pick(folderPick));
          }}
        />
      </div>
      <div className="grid gap-2">
        <p className="m-0 flex items-center gap-1 text-ui-sm font-semibold text-text-primary">
          {t("desktop.compose.newGroup.start.head")}
          <InfoTip text={t("desktop.compose.newGroup.start.info")} />
        </p>
        <StartPicker
          read={kinds}
          selected={draft.kind}
          onPick={(kind) => edit({ kind })}
          onRetry={() => {
            setVersion((current) => current + 1);
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          loading={working === "create"}
          disabled={!ready || working !== null}
          onClick={() => run(create())}
        >
          {t("desktop.compose.newGroup.make")}
        </Button>
        {props.link !== "live" ? (
          <p className={MUTED}>{t("desktop.compose.newGroup.offline")}</p>
        ) : ready ? null : (
          <p className={MUTED}>{t("desktop.compose.newGroup.hint")}</p>
        )}
      </div>
      {result === null ? null : result.kind === "failed" ? (
        <FailedNotice issue={result.issue} />
      ) : (
        <MadeResult
          made={result}
          working={working}
          onRecheck={() => run(recheck(result.dir))}
          onPack={() => run(pack(result.dir))}
        />
      )}
    </section>
  );
}
