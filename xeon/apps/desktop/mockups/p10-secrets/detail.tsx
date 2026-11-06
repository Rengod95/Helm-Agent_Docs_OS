// 고른 시크릿의 상세: 이름 줄(동작) + ListDescription 한 목록(DP-12). 값 행이 값 보기 상태기계(§7.6)를 그린다:
//   hidden(가림 + 값 보기) · reauth(O-05 열림) · revealed(값 + 복사 + 지금 가리기 + 남은 시간) · not_started(이 연결에서는 못 봄) · 실패
// 가린 값과 남은 시간 표시는 caustic에 없어(C-12) Progress와 글로 조합한다.
import {
  Alert,
  Badge,
  Button,
  ListDescription,
  ListDescriptionRow,
  Progress,
} from "@caustic/react";
import { useEffect, useState, type ReactNode } from "react";
import { CircleCheck } from "../_shell";
import type { Secret } from "./fixtures";

export type Reveal = "hidden" | "reauth" | "revealed" | "not_started" | "reauth_denied";

const VISIBLE_S = 30;
const FAKE = "sk-ant-api03-Xk2mQ9vLr7TfB1nWc8ZpYd4HsJ6uE0aGq3iKoV5xN";

function Countdown({ onDone }: { onDone: () => void }) {
  // 30초 중 남은 시간. 목업은 24초에서 시작해 스크린숏(가상 6초)에 18초쯤이 보인다.
  const [left, setLeft] = useState(24);
  useEffect(() => {
    if (left <= 0) {
      onDone();
      return;
    }
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left, onDone]);
  return (
    <div className="flex items-center gap-2">
      <Progress
        aria-label="자동 가림까지 남은 시간"
        value={(left / VISIBLE_S) * 100}
        size="sm"
        className="w-28"
      />
      {/* 화면 낭독기에는 10초마다만 알린다. */}
      <span className="text-ui-sm tabular-nums text-text-tertiary">{left}초 뒤 가려요</span>
      <span className="sr-only" aria-live="polite">
        {left % 10 === 0 ? `${left}초 뒤 가려요` : ""}
      </span>
    </div>
  );
}

function ValueCell({
  reveal,
  onReveal,
  onHide,
}: {
  reveal: Reveal;
  onReveal: () => void;
  onHide: () => void;
}): ReactNode {
  if (reveal === "revealed")
    return (
      <span className="grid gap-1.5 py-1">
        <span className="break-all font-mono text-mono text-text-primary">{FAKE}</span>
        <span className="flex flex-wrap items-center gap-1">
          <Button size="xs" variant="outline">
            복사
          </Button>
          <Button size="xs" variant="ghost" onClick={onHide}>
            지금 가리기
          </Button>
          <span className="ms-2">
            <Countdown onDone={onHide} />
          </span>
        </span>
      </span>
    );
  if (reveal === "not_started")
    return (
      <span className="grid gap-1.5 py-1">
        <span className="text-ui-sm text-text-secondary">
          이 연결(앱 안 엔진)에서는 값 보기를 아직 쓸 수 없어요.
        </span>
      </span>
    );
  return (
    <span className="flex items-center gap-2">
      <span
        aria-label="값 가려짐"
        className="font-mono text-mono tracking-widest text-text-tertiary"
      >
        ••••••••••••
      </span>
      <Button size="xs" variant="outline" onClick={onReveal} disabled={reveal === "reauth"}>
        값 보기
      </Button>
    </span>
  );
}

export function SecretDetail({
  secret,
  reveal,
  tested,
  onReveal,
  onHide,
  actions,
}: {
  secret: Secret;
  reveal: Reveal;
  tested: boolean;
  onReveal: () => void;
  onHide: () => void;
  actions: ReactNode;
}) {
  return (
    <section aria-label={`${secret.name} 상세`} className="grid gap-1">
      <div className="flex min-h-8 items-center gap-2">
        <h2 className="m-0 min-w-0 flex-1 truncate font-mono text-mono text-text-primary">
          {secret.name}
        </h2>
        <div className="flex flex-none items-center gap-0.5">{actions}</div>
      </div>
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label={`${secret.name} 메타`}
        className="rounded-none [--cs-size-list-term:7rem] [&_[data-slot=list-description-row]]:px-0"
      >
        <ListDescriptionRow term="값">
          <ValueCell reveal={reveal} onReveal={onReveal} onHide={onHide} />
        </ListDescriptionRow>
        <ListDescriptionRow term="설명">{secret.desc}</ListDescriptionRow>
        <ListDescriptionRow term="허용 호스트" mono>
          {secret.hosts.join(", ")}
        </ListDescriptionRow>
        <ListDescriptionRow term="승인">{secret.approval}</ListDescriptionRow>
        <ListDescriptionRow term="만료">
          {secret.status === "expiring" ? (
            <Badge size="sm" tone="warning">
              {secret.expires}
            </Badge>
          ) : secret.status === "expired" ? (
            <Badge size="sm" tone="danger">
              {secret.expires}
            </Badge>
          ) : (
            secret.expires
          )}
        </ListDescriptionRow>
      </ListDescription>
      {reveal === "reauth_denied" && (
        <Alert
          tone="danger"
          layout="inline"
          action={
            <Button size="xs" variant="outline" onClick={onReveal}>
              다시 시도
            </Button>
          }
        >
          인증이 거부돼서 값을 보여 주지 않았어요.
        </Alert>
      )}
      {tested && (
        <p
          role="status"
          className="m-0 flex items-center gap-1.5 pt-1 text-ui-sm text-text-secondary"
        >
          <CircleCheck aria-hidden className="size-icon-sm text-success-text" />
          테스트: 복호화됨 <span className="text-text-tertiary">· 방금</span>
        </p>
      )}
    </section>
  );
}
