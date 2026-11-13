import { t, type MessageId } from "@fresnel/client/i18n";
import { Alert, ListDescription, ListDescriptionRow } from "@caustic/react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import {
  WRITE_PATHS_FOLDED,
  pathPartsOf,
  type WriteAccessTool,
  type WriteAccessView,
} from "./write-access-model.ts";

// 샌드박스 밖 쓰기 승인의 본문(DP-204). 카드 틀·단추는 approval-card.tsx가 맡는다.
// 무엇이(명령 또는 도구) 어디에(쓰려던 곳) 쓰려 했고, 허용하면 어디가 열리는지(허용 범위)를 기존 도구 카드와 같은 설명 목록
// (ListDescription ghost xs, 이름 열 6rem)으로 보인다. 접힌 상태는 명령 한 줄 말줄임, 경로는 폴더 부분만 말줄임(마지막 이름은
// 늘 보임) 3개까지이고 단추 줄의 "전체 보기"가 펼친다. 폭 때문에 잘린 것이 있으면 `onClipped`로 알려 펼침 단추를 세운다. 홈 폴더 전체가 열리면 값과 경고 줄을 경고 색으로 둔다.

const TOOL_TEXT: Readonly<Record<Exclude<WriteAccessTool, "other">, MessageId>> = {
  bash: "desktop.approvals.writeAccess.tool.bash",
  write: "desktop.approvals.writeAccess.tool.write",
  edit: "desktop.approvals.writeAccess.tool.edit",
};

/**
 * 경로 하나. 접힌 상태는 폴더 부분(줄어듦)과 마지막 이름(줄지 않되 칸보다 길면 끝 말줄임)을 한 줄에 두고 전체는 title에 둔다.
 * 펼치면 전문을 줄바꿈한다
 */
function PathText(props: { readonly path: string; readonly open: boolean }): ReactNode {
  if (props.open) return <span className="block whitespace-pre-wrap break-all">{props.path}</span>;
  const { dir, base } = pathPartsOf(props.path);
  return (
    <span data-clip className="flex min-w-0 whitespace-pre" title={props.path}>
      {dir === "" ? null : <span className="min-w-0 truncate">{dir}</span>}
      <span className="max-w-full shrink-0 truncate">{base}</span>
    </span>
  );
}

function PathList(props: {
  readonly paths: readonly string[];
  readonly open: boolean;
  /** 홈 폴더 전체로 보일 경로(허용 범위에서만). 그 줄은 앞에 "홈 폴더 전체"를 경고 색으로 붙인다 */
  readonly home?: string | null;
}): ReactNode {
  const shown = props.open ? props.paths : props.paths.slice(0, WRITE_PATHS_FOLDED);
  const more = props.paths.length - shown.length;
  return (
    <span className="grid min-w-0 gap-0.5">
      {shown.map((path) =>
        path === props.home ? (
          <span key={path} className="flex min-w-0 items-baseline gap-1.5">
            <span
              data-slot="write-access-home"
              className="shrink-0 font-ui font-medium text-warning-text"
            >
              {t("desktop.approvals.writeAccess.home")}
            </span>
            <span className="min-w-0 text-text-tertiary">
              <PathText path={path} open={props.open} />
            </span>
          </span>
        ) : (
          <PathText key={path} path={path} open={props.open} />
        ),
      )}
      {more > 0 ? (
        <span className="font-ui text-ui-sm text-text-tertiary">
          {t("desktop.approvals.writeAccess.more", { count: more })}
        </span>
      ) : null}
    </span>
  );
}

export function WriteAccessBody(props: {
  readonly view: WriteAccessView;
  /** "전체 보기"로 펼쳤다 */
  readonly open: boolean;
  readonly id: string;
  /** 접힌 상태에서 폭 때문에 잘린 값이 있는지 알린다(그리고 크기가 바뀔 때마다 다시) */
  readonly onClipped: (clipped: boolean) => void;
}): ReactNode {
  const { view, open, onClipped } = props;
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (root === null || open) return undefined;
    const check = (): void => {
      const clipped = [
        ...root.querySelectorAll<HTMLElement>("[data-clip] > span, [data-clip]"),
      ].some((el) => el.scrollWidth > el.clientWidth + 1);
      onClipped(clipped);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(root);
    return () => {
      observer.disconnect();
    };
  }, [open, onClipped]);
  // 홈 폴더로 보이는 루트를 고를 수 없으면 허용 범위 맨 앞에 "홈 폴더 전체" 줄을 따로 둔다
  const homeLine = view.homeWide && view.homeRoot === null;
  return (
    <div ref={ref} id={props.id} data-slot="write-access" className="grid min-w-0 gap-2">
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label={t("desktop.approvals.writeAccess.summary")}
        className="rounded-none [--cs-size-list-term:6rem] [&_[data-slot=list-description-row]]:px-0"
      >
        {view.command === null ? (
          <ListDescriptionRow term={t("desktop.approvals.writeAccess.toolTerm")}>
            {view.tool === "other" ? view.toolName : t(TOOL_TEXT[view.tool])}
          </ListDescriptionRow>
        ) : (
          <ListDescriptionRow term={t("desktop.approvals.command.label")} mono>
            {open ? (
              <span className="block whitespace-pre-wrap break-all">{view.command}</span>
            ) : (
              <span
                data-slot="write-access-command"
                data-clip
                className="block truncate"
                title={view.command}
              >
                {view.command.split("\n")[0]}
              </span>
            )}
          </ListDescriptionRow>
        )}
        <ListDescriptionRow term={t("desktop.approvals.writeAccess.paths")} mono>
          {view.writePaths.length === 0 ? (
            <span className="font-ui text-text-tertiary">
              {t("desktop.approvals.writeAccess.unknown")}
            </span>
          ) : (
            <PathList paths={view.writePaths} open={open} />
          )}
        </ListDescriptionRow>
        <ListDescriptionRow term={t("desktop.approvals.writeAccess.roots")} mono>
          {homeLine ? (
            <span className="block font-ui font-medium text-warning-text">
              {t("desktop.approvals.writeAccess.home")}
            </span>
          ) : null}
          {view.allowRoots.length === 0 && !homeLine ? (
            <span className="font-ui text-text-tertiary">
              {t("desktop.approvals.writeAccess.unknown")}
            </span>
          ) : (
            <PathList paths={view.allowRoots} open={open} home={view.homeRoot} />
          )}
        </ListDescriptionRow>
      </ListDescription>
      {view.homeWide ? (
        <Alert tone="warning" layout="inline" data-slot="write-access-home-warning">
          {t("desktop.approvals.writeAccess.homeWarning")}
        </Alert>
      ) : null}
      {view.offersThread ? (
        <p data-slot="write-access-thread-note" className="m-0 text-ui-sm text-text-tertiary">
          {t("desktop.approvals.writeAccess.threadNote")}
        </p>
      ) : null}
    </div>
  );
}
