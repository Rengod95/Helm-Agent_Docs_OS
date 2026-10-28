import { detach, rethrow } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { TrustChoice } from "@xeon/contracts/wire";
import { useEffect, useState, type ReactNode } from "react";
import { useLinkPhase, useOpenThreadId, useThread } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import { trustCardOf, type TrustCardView } from "./trust-model.ts";

// 프로젝트 신뢰 확인(G1-03). 열린 대화의 작업 폴더가 신뢰가 필요한 자원(`.mcp.json`, 프로젝트 스킬·명령·설정)을 갖고
// 결정이 없을 때 승인 대기열과 같은 모양의 카드를 보인다. 판정은 `trust.get`의 요청 결과라 거울에 넣지 않고
// 이 부품의 로컬 상태에 둔다(FS-03, FS-04). host에 `trust.get`이 없으면(unsupported) 아무것도 그리지 않는다.

type Sending = "idle" | "sending" | "failed";
type Loaded =
  | { readonly workspace: string; readonly card: TrustCardView | null }
  | { readonly workspace: string; readonly failed: true };

export function TrustCard(): ReactNode {
  const threadId = useOpenThreadId();
  if (threadId === null) return null;
  return <TrustCardFor key={threadId} threadId={threadId} />;
}

function TrustCardFor(props: { readonly threadId: ThreadId }): ReactNode {
  const commands = useCommands();
  const phase = useLinkPhase();
  const workspace = useThread(props.threadId)?.workspace ?? null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [sending, setSending] = useState<Sending>("idle");

  // 연결이 살아나면 읽는다. 작업 폴더가 없는 대화는 신뢰 대상이 없다
  useEffect(() => {
    let stale = false;
    if (phase === "live" && workspace !== null) {
      detach(
        commands.trust.status(workspace).then((status) => {
          if (stale) return undefined;
          if (status.ok) setLoaded({ workspace, card: trustCardOf(status.value) });
          else if (status.error.kind === "unsupported") setLoaded(null);
          else setLoaded({ workspace, failed: true });
          return undefined;
        }),
        rethrow,
      );
    }
    return () => {
      stale = true;
    };
  }, [commands, phase, workspace]);

  if (workspace === null || loaded === null || loaded.workspace !== workspace) return null;
  if ("failed" in loaded) {
    return (
      <section className="approvals" aria-label="프로젝트 신뢰">
        <div className="error" role="alert">
          프로젝트 신뢰 상태를 읽지 못했습니다.
        </div>
      </section>
    );
  }
  if (loaded.card === null) return null;

  const decide = (choice: TrustChoice): void => {
    setSending("sending");
    detach(
      commands.trust.decide(workspace, choice).then((decided) => {
        if (!decided.ok) {
          setSending("failed");
          return undefined;
        }
        // host가 저장한 뒤의 판정으로 카드를 바꾼다. 신뢰했다면 카드는 사라진다
        setSending("idle");
        setLoaded({ workspace, card: trustCardOf(decided.value) });
        return undefined;
      }),
      rethrow,
    );
  };

  return <TrustCardBody card={loaded.card} sending={sending} onDecide={decide} />;
}

/** 카드 하나. 상태 없이 props만 그린다(서버 렌더 시험이 이 부품을 직접 그린다) */
export function TrustCardBody(props: {
  readonly card: TrustCardView;
  readonly sending: Sending;
  readonly onDecide: (choice: TrustChoice) => void;
}): ReactNode {
  const { card, sending } = props;
  return (
    <section className="approvals" aria-label="프로젝트 신뢰">
      <h2>프로젝트 신뢰</h2>
      <div className="approval">
        <div className="approval-title">
          {card.state === "denied"
            ? "이 프로젝트를 신뢰하지 않도록 정해 두었습니다."
            : "이 프로젝트의 설정을 신뢰할까요?"}
        </div>
        <div className="dim">{card.projectRoot}</div>
        {card.resources.length === 0 ? null : (
          <>
            <div>이 프로젝트가 불러오려는 자원</div>
            <ul className="trust-resources">
              {card.resources.map((resource) => (
                <li key={resource}>
                  <code>{resource}</code>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="dim">
          신뢰하면 이 자원의 지시문, 명령, MCP 서버가 사용자 권한으로 쓰입니다. 신뢰하지 않으면 읽지
          않습니다.
        </div>
        <div className="approval-actions">
          {card.buttons.map((button) => (
            <button
              key={`${button.choice.kind}:${button.choice.verdict}`}
              type="button"
              className={button.primary ? "primary" : undefined}
              disabled={sending === "sending"}
              title={button.savedPath ?? undefined}
              onClick={() => {
                props.onDecide(button.choice);
              }}
            >
              {button.text}
            </button>
          ))}
          {sending === "sending" ? <span className="dim">보내는 중…</span> : null}
          {sending === "failed" ? (
            <span className="error" role="alert">
              보내지 못했습니다. 다시 눌러 보세요.
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
