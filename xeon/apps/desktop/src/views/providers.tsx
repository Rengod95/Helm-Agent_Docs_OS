import type { ReactNode } from "react";
import {
  EngineStoreContext,
  type EngineMirror,
  type ReadonlyStore,
} from "../state/engine/index.ts";
import { UiStoreContext, type UiState } from "../state/ui/index.ts";
import { CommandsContext, type Commands } from "./commands.ts";
import { ProposalPendingProvider } from "./proposal-pending-context.tsx";

// Context에는 스토어(읽기 면)와 명령만 넣는다. 상태 값을 넣지 않으므로 값이 바뀌어도 Provider 아래가 다시 그려지지 않는다(FS-05).
// 예외: 대기 제안 수(`ProposalPendingProvider`)는 상태를 든다. 자식은 props로 받은 같은 요소라 그 상태가 바뀌어도 값을 읽는 부품만 다시 그린다.
export function Providers(props: {
  readonly engine: ReadonlyStore<EngineMirror>;
  readonly ui: ReadonlyStore<UiState>;
  readonly commands: Commands;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <EngineStoreContext value={props.engine}>
      <UiStoreContext value={props.ui}>
        <CommandsContext value={props.commands}>
          <ProposalPendingProvider>{props.children}</ProposalPendingProvider>
        </CommandsContext>
      </UiStoreContext>
    </EngineStoreContext>
  );
}
