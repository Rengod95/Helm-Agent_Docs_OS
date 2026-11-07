import { Alert } from "@caustic/react";
import { TriangleAlert } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { useEffect, useState, type ReactNode } from "react";
import { useLinkPhase, useOpenThreadId, useThread } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";

// 작업 폴더가 없는 대화의 띠(입력창 위). 대화를 열 때와 연결이 살아날 때 `workspace.status`로 묻고, 폴더가 없으면 경로와 함께 보인다.
// 입력은 막지 않는다(폴더를 다시 만들면 그대로 쓸 수 있다). 구형 host(`unsupported`)나 읽지 못한 경우에는 아무것도 그리지 않는다.

/** 띠를 그릴 경로. 폴더가 있으면 `null`이라 띠는 없다 */
export function WorkFolderBandBody(props: { readonly path: string | null }): ReactNode {
  if (props.path === null) return null;
  return (
    <Alert tone="warning" size="sm" icon={<TriangleAlert />}>
      <span className="font-medium">{t("desktop.workspace.missing.message")}</span>{" "}
      <code className="break-all">{props.path}</code>
    </Alert>
  );
}

export function WorkFolderBand(): ReactNode {
  const threadId = useOpenThreadId();
  if (threadId === null) return null;
  return <WorkFolderBandFor key={threadId} threadId={threadId} />;
}

/** 이 대화의 작업 폴더가 없는 것으로 확인된 경로. 다른 폴더의 확인 결과는 쓰지 않는다 */
interface Missing {
  readonly workspace: string;
  readonly path: string;
}

function WorkFolderBandFor(props: { readonly threadId: ThreadId }): ReactNode {
  const commands = useCommands();
  const phase = useLinkPhase();
  const workspace = useThread(props.threadId)?.workspace ?? null;
  const [missing, setMissing] = useState<Missing | null>(null);

  // 연결이 살아나면 다시 묻는다(대화를 열 때는 이 부품이 새로 만들어져 같은 효과가 돈다)
  useEffect(() => {
    let stale = false;
    if (phase === "live" && workspace !== null) {
      detach(
        commands.workspace.status(workspace).then((status) => {
          if (stale) return undefined;
          // 있거나, 확인하지 못했으면(구형 host, 읽기 실패) 띠는 없다
          if (status.ok && !status.value.exists) {
            setMissing({ workspace, path: status.value.path });
          } else {
            setMissing(null);
          }
          return undefined;
        }),
        rethrow,
      );
    }
    return () => {
      stale = true;
    };
  }, [commands, phase, workspace]);

  if (workspace === null || missing === null || missing.workspace !== workspace) return null;
  return <WorkFolderBandBody path={missing.path} />;
}
