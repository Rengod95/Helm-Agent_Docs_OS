// 프로젝트 설정(craft-flows C10의 "프로젝트 설정"). 한 가지 물음에 답한다: 이 프로젝트가 대화에 무엇을 주는가.
// 이름(바꾸기), 루트 폴더, 읽히는 지침 파일(`AGENTS.md`)의 유무, 승인을 기다리는 플러그인 수와 리뷰로 가는 길. 프로젝트 기본 프로필은 없다
// [결정: 2026-11-17 사용자, U5]: 프로필은 대화마다 고르므로 이 창에 프로필 칸을 두지 않는다. 긴 설명은 정보 아이콘 뒤에 둔다.
// "목록에서 빼기"는 `project.delete`이고 폴더와 대화를 지우지 않는다(확인 창이 사실대로 말한다).
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import {
  WIRE_ERRORS,
  type ProjectInstructionsResult,
  type ProjectListItem,
  type ReviewItem,
} from "@fresnel/contracts/wire";
import { Alert, Button, Dialog, Input, ListDescription, ListDescriptionRow } from "@caustic/react";
import { useEffect, useState, type ReactNode } from "react";
import { useShellActions } from "../../state/shell/index.ts";
import { useCommands, type CommandError } from "../commands.ts";
import { InfoTip } from "../craft/info-tip.tsx";
import { isCommitEnter } from "../ime-enter.ts";
import { checkProjectName } from "./project-model.ts";

/** 지침 파일 읽기. 실패는 따로 둔다(없음으로 그리지 않는다). `missing`은 엔진이 루트 폴더를 찾지 못했다는 뜻이다(`project.rootInvalid`) */
type InstructionsLoad =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "missing" }
  | { readonly status: "ready"; readonly value: ProjectInstructionsResult };

/** 루트 폴더 자신의 `AGENTS.md`(경로 `AGENTS.md`). 더 깊은 폴더의 것은 그 폴더에서 시작한 대화에만 읽힌다. 없으면 null */
export function rootInstructionsOf(
  value: ProjectInstructionsResult,
): { readonly bytes: number; readonly included: boolean } | null {
  const found = value.files.find((file) => file.path === "AGENTS.md");
  return found === undefined ? null : { bytes: found.bytes, included: found.included };
}

const EXISTS = WIRE_ERRORS["project.exists"].code;
const ROOT_INVALID = WIRE_ERRORS["project.rootInvalid"].code;

/** 프로젝트 쓰기 실패 문장 */
export function projectFailureText(error: CommandError): string {
  if (error.kind === "rejected" && error.code === EXISTS)
    return t("desktop.projects.failed.exists");
  if (error.kind === "rejected" && error.code === ROOT_INVALID)
    return t("desktop.projects.failed.root");
  if (error.kind === "offline") return t("desktop.projects.failed.offline");
  return t("desktop.projects.failed.other");
}

/** 이 프로젝트가 싣고 온, 리뷰를 기다리는 플러그인 이름(같은 이름은 한 번) */
function pendingNamesOf(
  items: readonly Pick<ReviewItem, "name" | "state" | "card">[],
  projectId: string,
): readonly string[] {
  const names = items
    .filter(
      (item) =>
        item.state === "pending" &&
        item.card.origin.kind === "project" &&
        item.card.origin.projectId === projectId,
    )
    .map((item) => item.name);
  return [...new Set(names)];
}

/** 바이트를 사람이 읽는 크기로(1 KB 미만은 바이트) */
function sizeText(bytes: number): string {
  if (bytes < 1024) return t("desktop.projects.settings.bytes", { count: bytes });
  return t("desktop.projects.settings.kb", { count: Math.round(bytes / 102.4) / 10 });
}

export function useOpenReview(): () => void {
  const shell = useShellActions();
  return () => {
    shell.switchArea("workbench");
    shell.updatePlace({ screen: "craftReview", scroll: 0 });
  };
}

export function ProjectSettingsDialog(props: {
  readonly project: ProjectListItem;
  /** 리뷰 대기 수. 읽지 못했으면 undefined(0으로 채우지 않는다) */
  readonly pending: number | undefined;
  readonly onClose: () => void;
  readonly onRemove: () => void;
}): ReactNode {
  const commands = useCommands();
  const openReview = useOpenReview();
  const [text, setText] = useState(props.project.name);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<InstructionsLoad>({ status: "loading" });
  // 리뷰 대기 항목 가운데 이 프로젝트 출처(`card.origin.projectId`)의 이름. 읽지 못하면 null(수만 보인다)
  const [names, setNames] = useState<readonly string[] | null>(null);
  const root = props.project.root;
  useEffect(() => {
    let live = true;
    const run = async (): Promise<void> => {
      const got = await commands.projects.instructions(root);
      if (!live) return;
      setInstructions(
        got.ok
          ? { status: "ready", value: got.value }
          : got.error.kind === "rejected" && got.error.code === ROOT_INVALID
            ? { status: "missing" }
            : { status: "failed" },
      );
    };
    detach(run(), rethrow);
    return () => {
      live = false;
    };
  }, [commands, root]);
  const projectId = props.project.projectId;
  const pendingCount = props.pending;
  useEffect(() => {
    let live = true;
    const run = async (): Promise<void> => {
      // 대기가 없으면 읽지 않는다. 수가 바뀌면(리뷰에서 결정하면) 다시 읽는다
      if (pendingCount === 0) {
        setNames([]);
        return;
      }
      const listed = await commands.pluginReview.list();
      if (!live) return;
      setNames(listed.ok ? pendingNamesOf(listed.value.items, projectId) : null);
    };
    detach(run(), rethrow);
    return () => {
      live = false;
    };
  }, [commands, projectId, pendingCount]);

  const name = checkProjectName(text);
  const changed = name !== null && name !== props.project.name;
  const rename = async (to: string): Promise<void> => {
    setBusy(true);
    setFailure(null);
    const renamed = await commands.projects.rename(props.project.projectId, to);
    setBusy(false);
    if (!renamed.ok) setFailure(projectFailureText(renamed.error));
  };
  const save = (): void => {
    if (name === null || !changed || busy) return;
    detach(rename(name), rethrow);
  };

  const agents = instructions.status === "ready" ? rootInstructionsOf(instructions.value) : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      size="sm"
      title={t("desktop.projects.settings.title")}
      footer={
        <>
          <Button size="sm" variant="ghost" data-project-remove="" onClick={props.onRemove}>
            {t("desktop.projects.menu.remove")}
          </Button>
          <span aria-hidden className="flex-1" />
          <Button size="sm" variant="outline" onClick={props.onClose}>
            {t("desktop.projects.settings.close")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {instructions.status === "missing" ? (
          <Alert tone="warning" layout="inline" size="sm" data-project-root-missing="">
            {t("desktop.projects.settings.rootMissing")}
          </Alert>
        ) : null}
        {failure === null ? null : (
          <Alert tone="danger" layout="inline" size="sm">
            {failure}
          </Alert>
        )}
        <ListDescription aria-label={t("desktop.projects.settings.title")}>
          <ListDescriptionRow term={t("desktop.projects.settings.name")}>
            <span className="flex min-w-0 items-center gap-2">
              <Input
                size="sm"
                value={text}
                invalid={name === null}
                aria-label={t("desktop.projects.settings.name")}
                className="min-w-0 flex-1"
                onValueChange={setText}
                onKeyDown={(event) => {
                  if (isCommitEnter(event)) save();
                }}
              />
              <Button
                size="sm"
                variant="outline"
                loading={busy}
                disabled={!changed || busy}
                onClick={save}
              >
                {t("desktop.projects.settings.save")}
              </Button>
            </span>
          </ListDescriptionRow>
          <ListDescriptionRow term={t("desktop.projects.settings.root")}>
            {/* 앞을 줄여 끝의 폴더 이름이 보이게 한다. 전체 경로는 title */}
            <span
              dir="rtl"
              title={root}
              className="block min-w-0 truncate text-left font-mono text-mono-sm text-text-secondary"
            >
              <bdi dir="ltr">{root}</bdi>
            </span>
          </ListDescriptionRow>
          <ListDescriptionRow
            term={
              <span className="inline-flex items-center gap-1">
                {t("desktop.projects.settings.instructions")}
                <InfoTip text={t("desktop.projects.settings.instructionsInfo")} />
              </span>
            }
          >
            <span data-project-agents={instructions.status} className="text-text-secondary">
              {instructions.status === "loading"
                ? null
                : instructions.status !== "ready"
                  ? t("desktop.projects.settings.instructionsFailed")
                  : agents === null
                    ? t("desktop.projects.settings.agentsNone")
                    : agents.included
                      ? t("desktop.projects.settings.agentsFound", { size: sizeText(agents.bytes) })
                      : t("desktop.projects.settings.agentsTooLarge", {
                          size: sizeText(agents.bytes),
                        })}
            </span>
          </ListDescriptionRow>
          <ListDescriptionRow
            term={
              <span className="inline-flex items-center gap-1">
                {t("desktop.projects.settings.pending")}
                <InfoTip text={t("desktop.projects.settings.pendingInfo")} />
              </span>
            }
          >
            <span className="flex min-w-0 items-center justify-between gap-2">
              <span className="grid min-w-0 gap-1">
                <span data-project-pending="" className="text-text-secondary tabular-nums">
                  {props.pending === undefined
                    ? t("desktop.projects.settings.pendingUnknown")
                    : props.pending === 0
                      ? t("desktop.projects.settings.pendingNone")
                      : t("desktop.projects.settings.pendingCount", { count: props.pending })}
                </span>
                {names === null || names.length === 0 ? null : (
                  <span
                    className="flex min-w-0 flex-wrap gap-x-2 gap-y-1"
                    data-project-pending-names=""
                  >
                    {names.map((n) => (
                      <span key={n} className="font-mono text-mono-sm text-text-primary">
                        {n}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              {props.pending === undefined || props.pending === 0 ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    props.onClose();
                    openReview();
                  }}
                >
                  {t("desktop.projects.openReview")}
                </Button>
              )}
            </span>
          </ListDescriptionRow>
        </ListDescription>
      </div>
    </Dialog>
  );
}

/** 목록에서 빼기 확인. 폴더와 대화는 남고, 그 폴더에서 새 대화를 시작하면 엔진이 프로젝트를 다시 만든다(§4.4.3) */
export function RemoveProjectDialog(props: {
  readonly project: ProjectListItem;
  readonly onDone: () => void;
}): ReactNode {
  const commands = useCommands();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const remove = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    const removed = await commands.projects.remove(props.project.projectId);
    setBusy(false);
    if (!removed.ok) {
      setFailure(projectFailureText(removed.error));
      return;
    }
    props.onDone();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onDone();
      }}
      size="sm"
      title={t("desktop.projects.remove.title")}
      footer={
        <>
          <span aria-hidden className="flex-1" />
          <Button size="sm" variant="ghost" onClick={props.onDone}>
            {t("desktop.projects.remove.cancel")}
          </Button>
          <Button
            size="sm"
            variant="solid"
            loading={busy}
            disabled={busy}
            onClick={() => {
              detach(remove(), rethrow);
            }}
          >
            {t("desktop.projects.remove.confirm")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {failure === null ? null : (
          <Alert tone="danger" layout="inline" size="sm">
            {failure}
          </Alert>
        )}
        <p className="m-0 text-ui text-text-secondary">
          {t("desktop.projects.remove.body", { name: props.project.name })}
        </p>
      </div>
    </Dialog>
  );
}
