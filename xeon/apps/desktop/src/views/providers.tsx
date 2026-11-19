import type { ReactNode } from "react";
import {
  EngineStoreContext,
  type EngineMirror,
  type ReadonlyStore,
} from "../state/engine/index.ts";
import { UiStoreContext, type UiState } from "../state/ui/index.ts";
import { CommandsContext, type Commands } from "./commands.ts";
import { ProposalPendingProvider } from "./proposal-pending-context.tsx";
import { MotionRoot } from "../lib/motion-presets.tsx";

// Context에는 스토어(읽기 면)와 명령만 넣는다. 상태 값을 넣지 않으므로 값이 바뀌어도 Provider 아래가 다시 그려지지 않는다(FS-05).
// motion 부품은 `MotionRoot`가 정한 "움직임 줄이기"를 따른다(DP-108).
// 예외: 대기 제안 수(`ProposalPendingProvider`)는 상태를 든다. 자식은 props로 받은 같은 요소라 그 상태가 바뀌어도 값을 읽는 부품만 다시 그린다.
export function Providers(props: {
  readonly engine: ReadonlyStore<EngineMirror>;
  readonly ui: ReadonlyStore<UiState>;
  readonly commands: Commands;
  /** 기다리는 제안 수의 바닥. 개발 빌드의 표본 보기만 준다(`app/dev-sample.ts`) */
  readonly sampleProposals?: number;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <EngineStoreContext value={props.engine}>
      <UiStoreContext value={props.ui}>
        <CommandsContext value={props.commands}>
          <ProposalPendingProvider
            {...(props.sampleProposals === undefined ? {} : { floor: props.sampleProposals })}
          >
            <MotionRoot>{props.children}</MotionRoot>
          </ProposalPendingProvider>
        </CommandsContext>
      </UiStoreContext>
    </EngineStoreContext>
  );
}
