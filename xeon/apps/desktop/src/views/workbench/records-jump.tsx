// 대화 화면의 "기록 보기" 다리. 대화 화면은 워크벤치 스토어를 직접 읽지 않으므로 등록부가 스토어와 함께 감싸 준다.
// 동작은 `recordsJumpOf`(`extension-records-link.ts`)가 정한다.
import { useMemo, type ReactNode } from "react";
import { useShellActions } from "../../state/shell/index.ts";
import {
  useWorkbenchActions,
  WorkbenchStoreContext,
  type WorkbenchStore,
} from "../../state/workbench/index.ts";
import { OpenExtensionRecordsContext, recordsJumpOf } from "../extension-records-link.ts";

function RecordsJump(props: { readonly children: ReactNode }): ReactNode {
  const shell = useShellActions();
  const workbench = useWorkbenchActions();
  const open = useMemo(() => recordsJumpOf(shell, workbench), [shell, workbench]);
  return <OpenExtensionRecordsContext value={open}>{props.children}</OpenExtensionRecordsContext>;
}

/** 대화 화면을 워크벤치 스토어와 "기록 보기" 문맥으로 감싼다. 등록부가 대화 화면을 그릴 때 쓴다 */
export function ChatWithRecords(props: {
  readonly store: WorkbenchStore;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <WorkbenchStoreContext value={props.store}>
      <RecordsJump>{props.children}</RecordsJump>
    </WorkbenchStoreContext>
  );
}
