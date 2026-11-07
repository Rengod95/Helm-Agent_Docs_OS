import { detach, rethrow } from "@fresnel/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Context,
  type ReactNode,
} from "react";
import { useLinkPhase } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import { readPendingCount, watchPendingCount } from "./proposal-pending.ts";

// 대기 제안 수를 한 곳에서만 읽는다(사이드바 배지와 받은 요청 제안 줄이 같은 값을 쓴다). `Providers`가 감싼다.
// 연결이 살아 있을 때만 다시 읽고, 끊기면 마지막 수를 둔다. 문맥이 없으면 0이고 `refresh`는 아무 일도 하지 않는다.

export interface ProposalPending {
  /** 대기 제안 수. 학습 꺼짐과 목록 실패는 0이다 */
  readonly count: number;
  /** 지금 다시 읽는다. 제안 화면은 결정을 보낸 뒤에 부른다 */
  readonly refresh: () => void;
}

const NO_PENDING: ProposalPending = { count: 0, refresh: () => {} };

export const ProposalPendingContext: Context<ProposalPending> =
  createContext<ProposalPending>(NO_PENDING);

export function useProposalPending(): ProposalPending {
  return useContext(ProposalPendingContext);
}

export function ProposalPendingProvider(props: { readonly children: ReactNode }): ReactNode {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const [count, setCount] = useState(0);
  // 늦게 온 읽기가 새 읽기의 값을 덮지 않도록 읽기마다 번호를 매긴다
  const latest = useRef(0);

  const read = useCallback((): void => {
    if (!live) return;
    latest.current += 1;
    const seq = latest.current;
    const run = async (): Promise<void> => {
      const next = await readPendingCount({
        proposals: (params) => commands.proposals.list(params),
        extensions: () => commands.workbench.list(),
      });
      if (seq === latest.current) setCount(next);
    };
    detach(run(), rethrow);
  }, [commands, live]);

  // 한 주기 호출(setInterval)만 세우고 언마운트나 연결이 끊기면 모두 끊는다
  useEffect(() => {
    if (!live) return undefined;
    return watchPendingCount({
      read,
      every: (ms, listener) => {
        const id = setInterval(listener, ms);
        return () => {
          clearInterval(id);
        };
      },
      onFocus: (listener) => {
        window.addEventListener("focus", listener);
        return () => {
          window.removeEventListener("focus", listener);
        };
      },
      onWorkbench: (listener) => commands.workbench.onChanged(listener),
      onNotice: (listener) =>
        commands.notices.onDelivered((delivered) => {
          listener(delivered.notice.kind);
        }),
    });
  }, [commands, live, read]);

  const value = useMemo<ProposalPending>(() => ({ count, refresh: read }), [count, read]);
  return <ProposalPendingContext value={value}>{props.children}</ProposalPendingContext>;
}
