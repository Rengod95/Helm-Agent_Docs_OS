import { AgentRequest, Button, toast } from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { TrustChoice } from "@fresnel/contracts/wire";
import { useEffect, useState, type ReactNode } from "react";
import { useLinkPhase, useOpenThreadId, useThread } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import {
  trustCardOf,
  trustedToastOf,
  type TrustCardDetails,
  type TrustCardView,
} from "./trust-model.ts";

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
      <section aria-label={t("desktop.trust.card.title")}>
        <div className="text-ui-sm text-danger-text" role="alert">
          {t("desktop.trust.card.loadFailed")}
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
        // host가 저장한 뒤의 판정으로 카드를 바꾼다. 신뢰했다면 카드는 사라지고, 무엇을 신뢰했는지 토스트로 알린다
        setSending("idle");
        setLoaded({ workspace, card: trustCardOf(decided.value) });
        const message = trustedToastOf(decided.value, choice);
        if (message !== null) toast({ tone: "success", title: message });
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
  // 신뢰 카드는 caustic AgentRequest(permission: 방패 타일, 제목, 부제)다. 단추는 판정마다 꺼짐과 저장 위치 툴팁이 달라
  // AgentRequest의 actions 대신 아래 단추 줄에 caustic Button으로 둔다(approval-card와 같은 규칙, 오른쪽 정렬)
  return (
    <section aria-label={t("desktop.trust.card.title")}>
      <AgentRequest
        kind="permission"
        lead={t("desktop.trust.card.title")}
        title={
          card.state === "denied"
            ? t("desktop.trust.card.denied")
            : t("desktop.trust.card.undecided")
        }
        subtitle={card.projectRoot}
        actions={[]}
      >
        {card.details === null ? null : <TrustDetailRows details={card.details} />}
        {card.resources.length === 0 ? null : (
          <div className="grid gap-1">
            <div className="text-ui-sm text-text-secondary">
              {t("desktop.trust.card.resources.label")}
            </div>
            <ul className="m-0 list-disc pl-5">
              {card.resources.map((resource) => (
                <li key={resource}>
                  <code>{resource}</code>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="text-ui-sm text-text-secondary">{t("desktop.trust.card.warning")}</div>
        <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5">
          {sending === "sending" ? (
            <span className="text-ui-sm text-text-secondary">
              {t("desktop.trust.card.sendingStatus")}
            </span>
          ) : null}
          {sending === "failed" ? (
            <span className="text-ui-sm text-danger-text" role="alert">
              {t("desktop.trust.card.sendFailed")}
            </span>
          ) : null}
          {card.buttons.map((button) => (
            <Button
              key={`${button.choice.kind}:${button.choice.verdict}`}
              size="xs"
              variant={button.primary ? "solid" : "ghost"}
              disabled={sending === "sending"}
              title={button.savedPath ?? undefined}
              onClick={() => {
                props.onDecide(button.choice);
              }}
            >
              {button.text}
            </Button>
          ))}
        </div>
      </AgentRequest>
    </section>
  );
}

/**
 * 줄마다 키를 붙인다. 같은 줄이 여러 번 나와도(`review.md`와 `review.txt`가 둘 다 `review`) 키가 겹치지 않도록 같은 줄의 몇 번째인지 붙인다.
 * 키는 `줄#번호`라 줄 안에 `#`이 있어도 마지막 `#` 뒤만 번호다
 */
function keyedLines(
  items: readonly string[],
): readonly { readonly key: string; readonly text: string }[] {
  const seen = new Map<string, number>();
  return items.map((text) => {
    const count = (seen.get(text) ?? 0) + 1;
    seen.set(text, count);
    return { key: `${text}#${String(count)}`, text };
  });
}

/** 자원 이름 묶음. 비어 있지 않은 묶음만 보이고, 항목은 이름 그대로(MCP는 실행 명령 줄) 고정폭으로 보인다 */
function TrustDetailRows(props: { readonly details: TrustCardDetails }): ReactNode {
  const groups: readonly {
    readonly label: MessageId;
    readonly items: readonly string[];
  }[] = [
    { label: "desktop.trust.card.details.mcpServers", items: props.details.mcpServers },
    { label: "desktop.trust.card.details.hooks", items: props.details.hooks },
    { label: "desktop.trust.card.details.skills", items: props.details.skills },
    { label: "desktop.trust.card.details.commands", items: props.details.commands },
    { label: "desktop.trust.card.details.extensions", items: props.details.extensions },
  ];
  return (
    <>
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <div key={group.label} className="grid gap-1">
            <div className="text-ui-sm text-text-secondary">{t(group.label)}</div>
            <ul className="m-0 list-disc pl-5">
              {keyedLines(group.items).map((line) => (
                <li key={line.key}>
                  <code>{line.text}</code>
                </li>
              ))}
            </ul>
          </div>
        ))}
      {props.details.truncated === true ? (
        <div className="text-ui-sm text-text-secondary">
          {t("desktop.trust.card.details.truncated")}
        </div>
      ) : null}
    </>
  );
}
