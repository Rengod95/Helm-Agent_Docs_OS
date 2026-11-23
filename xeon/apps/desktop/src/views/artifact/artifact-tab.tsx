import {
  Alert,
  IconButton,
  ScrollArea,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectOption,
  Skeleton,
} from "@caustic/react";
import { FolderOpen, Maximize2, Minimize2, RotateCw } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useOpenThread, useOpenThreadId, useOpenTranscript } from "../../state/engine/index.ts";
import { useEngineTarget } from "../../state/ui/index.ts";
import { InfoTip } from "../craft/info-tip.tsx";
import { useDesktopShell } from "../desktop-shell-context.ts";
import { MarkdownBody } from "../convo/markdown-body.tsx";
import { ListSkeleton } from "../pages/shared/panel-parts.tsx";
import { PanelEmpty } from "../panels/panel-kit.tsx";
import { ARTIFACT_TAB_ID } from "../panels/tab-ids.ts";
import { setWellWide, useWellWide } from "../shell/well-wide.ts";
import {
  artifactFrameRefusals,
  openArtifactFrame,
  revealArtifact,
  type ArtifactFrame,
  type ArtifactFrameErrorKind,
  type ArtifactFrameRequest,
  type FrameRefusal,
} from "./artifact-frames.ts";
import {
  artifactsOf,
  externalHostsOf,
  outsideRefsOf,
  type ArtifactEntry,
  type ArtifactKind,
  type ArtifactVersion,
} from "./artifact-model.ts";
import { pickArtifact, useArtifactPick } from "./artifact-store.ts";
import {
  ARTIFACT_FRAME_SANDBOX,
  ARTIFACT_KIND_LABEL,
  escapingRefsOf,
  FRAME_ERROR_NOTE,
  frameRequestOf,
  latestArtifactOf,
  versionOf,
  type FramePlan,
} from "./artifact-view-model.ts";

// 아티팩트 판(artView, AGE-77 질문 1, F-21·F-28). 이 대화에서 모델이 만든 HTML, SVG, 그림, 마크다운을 오른쪽 well에 그린다.
// 판의 출처는 대화 기록의 쓰기·고치기 도구 호출과 artifact_create·artifact_update다(새 저장소 없음, artifact-model.ts).
// 그리기는 셸의 `fresnel-artifact://` 프레임(가둔 iframe, allow-scripts만, CSP로 바깥 네트워크 막음)이 맡는다. 마크다운은 앱이 서식을 입혀 그린다.

type ViewMode = "preview" | "code";

export function ArtifactTab(): ReactNode {
  const threadId = useOpenThreadId();
  if (threadId === null) {
    return (
      <div className="px-3 pt-3">
        <PanelEmpty title={t("desktop.artifact.empty.noThread")} />
      </div>
    );
  }
  return <ThreadArtifacts key={threadId} threadId={threadId} />;
}

function ThreadArtifacts(props: { readonly threadId: ThreadId }): ReactNode {
  const transcript = useOpenTranscript(props.threadId);
  const workspace = useOpenThread()?.workspace ?? null;
  const artifacts = useMemo(
    () =>
      transcript.status === "ready"
        ? {
            list: artifactsOf({ itemIds: transcript.itemIds, items: transcript.items, workspace }),
            itemIds: transcript.itemIds,
          }
        : null,
    [transcript, workspace],
  );
  const picked = useArtifactPick();
  if (transcript.status === "error") {
    return (
      <div className="px-3 pt-3">
        <PanelEmpty title={t("desktop.artifact.error")} />
      </div>
    );
  }
  if (artifacts === null) {
    return (
      <div className="px-3 pt-3">
        <ListSkeleton label={t("desktop.artifact.loading")} />
      </div>
    );
  }
  const current =
    artifacts.list.find((entry) => entry.key === picked?.key) ??
    latestArtifactOf(artifacts.list, artifacts.itemIds);
  if (current === undefined) {
    return (
      <div className="px-3 pt-3">
        <PanelEmpty
          title={t("desktop.artifact.empty.message")}
          body={t("desktop.artifact.empty.body")}
        />
      </div>
    );
  }
  const wantVersion = picked?.key === current.key ? picked.version : null;
  return (
    <ArtifactBoard
      artifacts={artifacts.list}
      current={current}
      version={versionOf(current, wantVersion)}
      workspace={workspace}
    />
  );
}

function kindText(kind: ArtifactKind): string {
  return t(ARTIFACT_KIND_LABEL[kind]);
}

function ArtifactBoard(props: {
  readonly artifacts: readonly ArtifactEntry[];
  readonly current: ArtifactEntry;
  readonly version: ArtifactVersion | undefined;
  readonly workspace: string | null;
}): ReactNode {
  const { current, version } = props;
  const shell = useDesktopShell();
  const target = useEngineTarget();
  const wide = useWellWide() === ARTIFACT_TAB_ID;
  const [mode, setMode] = useState<ViewMode>("preview");
  const [reload, setReload] = useState(0);
  const plan = frameRequestOf({
    entry: current,
    version,
    workspace: props.workspace,
    local: target.kind === "local" && shell !== null,
  });
  const frame = useArtifactFrame(plan, reload);
  const latest = current.versions.length;
  const text = version?.text ?? null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pt-3 pb-3">
      <div className="flex min-w-0 items-center gap-2">
        <Select
          size="sm"
          aria-label={t("desktop.artifact.picker.label")}
          value={current.key}
          onValueChange={(key) => {
            pickArtifact({ key, version: null });
          }}
          className="min-w-0 flex-1"
        >
          {props.artifacts.map((entry) => (
            <SelectOption key={entry.key} value={entry.key}>
              {entry.title}
            </SelectOption>
          ))}
        </Select>
        {latest <= 1 || version === undefined ? null : (
          <Select
            size="sm"
            aria-label={t("desktop.artifact.version.label")}
            value={String(version.number)}
            onValueChange={(value) => {
              const number = Number(value);
              pickArtifact({ key: current.key, version: number === latest ? null : number });
            }}
            className="w-32 flex-none"
          >
            {current.versions.toReversed().map((entry) => (
              <SelectOption key={entry.number} value={String(entry.number)}>
                {entry.number === latest
                  ? t("desktop.artifact.version.latest", { number: entry.number })
                  : t("desktop.artifact.version.option", { number: entry.number })}
              </SelectOption>
            ))}
          </Select>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <SegmentedControl
          size="sm"
          aria-label={t("desktop.artifact.mode.label")}
          value={mode}
          onValueChange={(next) => {
            setMode(next === "code" ? "code" : "preview");
          }}
        >
          <SegmentedControlItem value="preview">
            {t("desktop.artifact.mode.preview")}
          </SegmentedControlItem>
          <SegmentedControlItem value="code">
            {t("desktop.artifact.mode.code")}
          </SegmentedControlItem>
        </SegmentedControl>
        <span className="flex min-w-0 flex-1 items-center gap-1 text-footnote text-text-tertiary">
          <span className="truncate">{kindText(current.kind)}</span>
          <InfoTip text={t("desktop.artifact.sandbox.info")} />
        </span>
        <IconButton
          size="xs"
          variant="ghost"
          label={t("desktop.artifact.reload")}
          onClick={() => {
            setReload((n) => n + 1);
          }}
        >
          <RotateCw />
        </IconButton>
        {frame.kind === "open" && plan.kind === "frame" && plan.request.root !== null ? (
          <IconButton
            size="xs"
            variant="ghost"
            label={t("desktop.artifact.reveal")}
            onClick={() => {
              if (shell === null) return;
              detach(revealArtifact(shell.invoke, frame.frame.token), rethrow);
            }}
          >
            <FolderOpen />
          </IconButton>
        ) : null}
        <IconButton
          size="xs"
          variant="ghost"
          label={wide ? t("desktop.artifact.narrow") : t("desktop.artifact.wide")}
          aria-pressed={wide}
          onClick={() => {
            setWellWide(wide ? null : ARTIFACT_TAB_ID);
          }}
        >
          {wide ? <Minimize2 /> : <Maximize2 />}
        </IconButton>
      </div>
      <Warnings
        kind={current.kind}
        text={text}
        source={plan.kind === "frame" ? plan.request : { root: null, entry: "" }}
        refusals={frame.kind === "open" ? frame.refusals : []}
      />
      <div
        data-artifact-body={mode}
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border-subtle"
      >
        {mode === "code" ? (
          <CodeView text={text} />
        ) : (
          <PreviewView
            entry={current}
            version={version}
            plan={plan}
            frame={frame}
            onLoad={frame.kind === "open" ? frame.checkRefusals : undefined}
          />
        )}
      </div>
    </div>
  );
}

/** 바깥 주소와 폴더 밖 자원 경고. 막힌 것은 보이게 둔다(경고는 접지 않는다) */
function Warnings(props: {
  readonly kind: ArtifactKind;
  readonly text: string | null;
  readonly source: { readonly root: string | null; readonly entry: string };
  readonly refusals: readonly FrameRefusal[];
}): ReactNode {
  const scanned = props.kind === "html" || props.kind === "svg";
  const hosts = scanned && props.text !== null ? externalHostsOf(props.text) : [];
  const outside = new Set<string>([
    ...(scanned && props.text !== null
      ? escapingRefsOf(outsideRefsOf(props.text), props.source)
      : []),
    ...props.refusals
      .filter((refusal) => refusal.kind === "outside_root")
      .map((refusal) => refusal.path),
  ]);
  if (hosts.length === 0 && outside.size === 0) return null;
  return (
    <div className="grid min-w-0 gap-2" data-artifact-warnings="">
      {hosts.length === 0 ? null : (
        <Alert tone="warning" variant="outline" size="sm">
          <span className="grid min-w-0 gap-0.5">
            <span>{t("desktop.artifact.warn.network", { count: hosts.length })}</span>
            <span className="truncate font-mono text-footnote text-text-tertiary">
              {hosts.join(", ")}
            </span>
          </span>
        </Alert>
      )}
      {outside.size === 0 ? null : (
        <Alert tone="warning" variant="outline" size="sm">
          <span className="grid min-w-0 gap-0.5">
            <span>{t("desktop.artifact.warn.outside", { count: outside.size })}</span>
            <span className="truncate font-mono text-footnote text-text-tertiary">
              {[...outside].join(", ")}
            </span>
          </span>
        </Alert>
      )}
    </div>
  );
}

function CodeView(props: { readonly text: string | null }): ReactNode {
  if (props.text === null) {
    return <Note text={t("desktop.artifact.note.noText")} />;
  }
  return (
    <ScrollArea label={t("desktop.artifact.mode.code")} className="min-h-0 flex-1 bg-neutral-well">
      <pre
        tabIndex={0}
        className="m-0 px-3 py-2 font-mono text-footnote whitespace-pre text-text-secondary select-text"
      >
        {props.text}
      </pre>
    </ScrollArea>
  );
}

function Note(props: { readonly text: string }): ReactNode {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-6">
      <p className="m-0 text-center text-ui text-text-secondary">{props.text}</p>
    </div>
  );
}

function PreviewView(props: {
  readonly entry: ArtifactEntry;
  readonly version: ArtifactVersion | undefined;
  readonly plan: FramePlan;
  readonly frame: FrameState;
  readonly onLoad: (() => void) | undefined;
}): ReactNode {
  const { plan, frame } = props;
  if (props.version === undefined) {
    return <Note text={t("desktop.artifact.note.pending")} />;
  }
  if (props.entry.kind === "markdown") {
    return props.version.text === null ? (
      <Note text={t("desktop.artifact.note.noText")} />
    ) : (
      <ScrollArea label={t("desktop.artifact.mode.preview")} className="min-h-0 flex-1">
        <div className="px-4 py-3">
          <MarkdownBody text={props.version.text} size="compact" />
        </div>
      </ScrollArea>
    );
  }
  if (plan.kind === "none") return <Note text={t(plan.reason)} />;
  if (frame.kind === "opening") {
    return (
      <div className="flex-1 p-3">
        <Skeleton className="size-full" />
      </div>
    );
  }
  if (frame.kind === "failed") return <Note text={t(FRAME_ERROR_NOTE[frame.reason])} />;
  if (frame.kind === "idle") return <Note text={t("desktop.artifact.note.noPreview")} />;
  return (
    <iframe
      // 새 주소마다 새 iframe이다. 셸의 이동 막기(`artifactNavigationAllowed`)는 프레임이 자기 토큰 밖으로 가는 것을 막으므로 src만 바꾸지 않는다
      key={frame.frame.url}
      src={frame.frame.url}
      sandbox={ARTIFACT_FRAME_SANDBOX}
      referrerPolicy="no-referrer"
      title={t("desktop.artifact.frame.title", { name: props.entry.title })}
      onLoad={props.onLoad}
      data-artifact-frame=""
      className="block size-full flex-1 border-0 [color-scheme:dark]"
    />
  );
}

type FrameState =
  | { readonly kind: "idle" }
  | { readonly kind: "opening" }
  | { readonly kind: "failed"; readonly reason: ArtifactFrameErrorKind }
  | {
      readonly kind: "open";
      readonly frame: ArtifactFrame;
      readonly refusals: readonly FrameRefusal[];
      /** 프레임이 다 불러온 뒤 셸이 거절한 자원(폴더 밖, 없는 파일)을 다시 읽는다 */
      readonly checkRefusals: () => void;
    };

type Opened =
  | { readonly key: string; readonly kind: "failed"; readonly reason: ArtifactFrameErrorKind }
  | { readonly key: string; readonly kind: "open"; readonly frame: ArtifactFrame };

function requestKeyOf(request: ArtifactFrameRequest, reload: number, stamp: string): string {
  return JSON.stringify([request.root, request.entry, request.text, request.wrap, reload, stamp]);
}

/** 판 하나의 셸 프레임을 연다. 요청이나 새로 고침 수가 바뀌면 새 프레임(새 토큰)을 연다 */
function useArtifactFrame(plan: FramePlan, reload: number): FrameState {
  const shell = useDesktopShell();
  const [opened, setOpened] = useState<Opened | null>(null);
  const [refusals, setRefusals] = useState<{
    readonly token: string;
    readonly list: readonly FrameRefusal[];
  } | null>(null);
  const key = plan.kind === "frame" ? requestKeyOf(plan.request, reload, plan.stamp) : null;
  // 효과는 요청의 글 값(폴더, 파일, 본문, 감싸기)과 표지, 새로 고침 수로만 다시 돈다. 요청 객체는 그릴 때마다 새로 만들어진다
  const request = plan.kind === "frame" ? plan.request : null;
  const root = request?.root ?? null;
  const entry = request?.entry ?? null;
  const text = request?.text ?? null;
  const wrap = request?.wrap ?? null;
  useEffect(() => {
    if (shell === null || key === null || entry === null || wrap === null) return undefined;
    let live = true;
    detach(
      openArtifactFrame(shell.invoke, { root, entry, text, wrap }).then((result) => {
        if (!live) return undefined;
        setOpened(
          result.ok
            ? { key, kind: "open", frame: result.value }
            : { key, kind: "failed", reason: result.error.kind },
        );
        return undefined;
      }),
      rethrow,
    );
    return () => {
      live = false;
    };
  }, [shell, key, root, entry, text, wrap]);
  if (shell === null || key === null) return { kind: "idle" };
  if (opened === null || opened.key !== key) return { kind: "opening" };
  if (opened.kind === "failed") return { kind: "failed", reason: opened.reason };
  const token = opened.frame.token;
  return {
    kind: "open",
    frame: opened.frame,
    refusals: refusals?.token === token ? refusals.list : [],
    checkRefusals: () => {
      detach(
        artifactFrameRefusals(shell.invoke, token).then((result) => {
          if (result.ok) setRefusals({ token, list: result.value });
          return undefined;
        }),
        rethrow,
      );
    },
  };
}
