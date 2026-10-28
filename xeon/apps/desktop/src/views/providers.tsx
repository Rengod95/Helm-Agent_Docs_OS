import type { ReactNode } from "react";
import {
  EngineStoreContext,
  type EngineMirror,
  type ReadonlyStore,
} from "../state/engine/index.ts";
import { UiStoreContext, type UiState } from "../state/ui/index.ts";
import { CommandsContext, type Commands } from "./commands.ts";

// Context에는 스토어(읽기 면)와 명령만 넣는다. 상태 값을 넣지 않으므로 값이 바뀌어도 Provider 아래가 다시 그려지지 않는다(FS-05).
export function Providers(props: {
  readonly engine: ReadonlyStore<EngineMirror>;
  readonly ui: ReadonlyStore<UiState>;
  readonly commands: Commands;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <EngineStoreContext value={props.engine}>
      <UiStoreContext value={props.ui}>
        <CommandsContext value={props.commands}>{props.children}</CommandsContext>
      </UiStoreContext>
    </EngineStoreContext>
  );
}
