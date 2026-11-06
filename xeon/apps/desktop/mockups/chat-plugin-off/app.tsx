// A5 대화 영역 오른쪽 "플러그인" 탭의 "이 대화에서 끄기" 스위치. 이 시안은 탭 하나와 그 상태만 그린다(대화 본문은 자리 표시).
// 행마다 스위치 하나(켜짐 = 이 대화에서 쓴다). 끄면 이 대화에만 적용되고 전역 설정은 그대로다.
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Message,
  Switch,
  Toaster,
  Tooltip,
  toast,
} from "@caustic/react";
import { useEffect, useState } from "react";
import {
  chatRightTabs,
  defaultStatusCells,
  josa,
  MessageSquare,
  Shell,
  T,
  useShell,
} from "../_shell";
import { BASE, PRESET, patchRow, type PluginRow, type PS, type StateId } from "./model";

function Row({
  row,
  running,
  onToggle,
}: {
  row: PluginRow;
  running: boolean;
  onToggle: (next: boolean) => void;
}) {
  const locked = row.here === "off-all";
  const checked = row.here === "on" ? row.pending !== "turning-off" : row.pending === "turning-on";
  const sw = (
    <Switch
      size="sm"
      aria-label={`${row.display} 이 대화에서 쓰기`}
      checked={checked}
      disabled={locked || row.pending !== undefined}
      onCheckedChange={onToggle}
    />
  );
  return (
    <li className="grid gap-1 border-b border-border-subtle py-2.5 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-text-primary">
          {row.display}
        </span>
        {row.here === "off-here" && row.pending === undefined && (
          <Badge size="sm" tone="neutral">
            이 {T.thread}에서 꺼짐
          </Badge>
        )}
        {locked ? (
          <Tooltip side="left" content="전역에서 꺼져 있어요. 크래프트에서 켜면 쓸 수 있어요.">
            <span>{sw}</span>
          </Tooltip>
        ) : (
          sw
        )}
      </div>
      <div className="flex items-baseline gap-2 text-ui-dense text-text-secondary">
        <span className="min-w-0 flex-1 truncate">{row.note}</span>
        <span className="font-mono text-mono-sm text-text-tertiary">{row.id}</span>
      </div>
      {locked && <span className="text-ui-xs text-text-tertiary">전역에서 꺼져 있어요</span>}
      {row.pending !== undefined && (
        <span className="text-ui-xs text-text-tertiary" role="status">
          {running
            ? `이번 ${T.step}이 끝나면 ${row.pending === "turning-off" ? "꺼져요" : "켜져요"}`
            : "적용하는 중이에요"}
        </span>
      )}
    </li>
  );
}

function PluginsTab({
  s,
  onToggle,
  onRetry,
}: {
  s: PS;
  onToggle: (id: string, next: boolean) => void;
  onRetry: () => void;
}) {
  const off = s.rows.filter((r) => r.here === "off-here").length;
  return (
    <div className="grid gap-2">
      <p className="m-0 text-ui-dense text-text-secondary">
        여기서 끄면 이 {T.thread}에만 적용돼요. 전역 설정은 그대로예요.
        {off > 0 && ` 지금 ${off}개가 꺼져 있어요.`}
      </p>
      {s.failed !== null && (
        <Alert
          tone="danger"
          layout="inline"
          action={
            <Button size="xs" variant="outline" onClick={onRetry}>
              다시 시도
            </Button>
          }
        >
          저장하지 못했어요. 스위치를 원래대로 돌려놨어요.
        </Alert>
      )}
      <ul className="m-0 grid list-none p-0">
        {s.rows.map((r) => (
          <Row key={r.id} row={r} running={s.running} onToggle={(n) => onToggle(r.id, n)} />
        ))}
      </ul>
    </div>
  );
}

export function App({ state }: { state: StateId }) {
  const shell = useShell();
  const [s, setS] = useState<PS>(() => ({ ...BASE, ...PRESET[state] }));
  useEffect(() => {
    if (s.openTab !== null) shell.openEnd(s.openTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string, next: boolean) => {
    // 요청 즉시 pending을 보이고, 진행 중인 턴이 없으면 곧 적용된다(목업은 타이머로 흉내).
    setS((x) => ({
      ...x,
      failed: null,
      rows: patchRow(x.rows, id, { pending: next ? "turning-on" : "turning-off" }),
    }));
    if (s.running) return;
    window.setTimeout(() => {
      setS((x) => ({
        ...x,
        rows: patchRow(x.rows, id, { here: next ? "on" : "off-here", pending: undefined }),
      }));
      toast({
        title: next ? "이 대화에서 켰어요" : "이 대화에서 껐어요",
        description: "다음 턴부터 적용돼요",
      });
    }, 500);
  };

  const off = s.rows.filter((r) => r.here === "off-here").length;
  const rightTabs = chatRightTabs({
    inbox: <EmptyState size="sm" surface="none" title="기다리는 요청이 없어요" />,
    runtime: <EmptyState size="sm" surface="none" title="실행 기록은 런타임 탭에 있어요" />,
    work: <EmptyState size="sm" surface="none" title="진행 중인 작업이 없어요" />,
    plugins: [],
  });
  const tabs = [
    ...rightTabs,
    {
      id: "plugins",
      label: T.plugin,
      icon: <MessageSquare />,
      badge: off > 0 ? off : undefined,
      content: s.thread ? (
        <PluginsTab s={s} onToggle={toggle} onRetry={() => setS((x) => ({ ...x, failed: null }))} />
      ) : (
        <EmptyState size="sm" surface="none" title="열린 대화가 없어요" />
      ),
    },
  ];
  const base = defaultStatusCells({});

  return (
    <>
      <Shell
        activeNav="chat"
        stageLabel={T.thread}
        threads={{ currentId: s.thread ? "t1" : null, onSelect: () => {}, onNew: () => {} }}
        rightTabs={tabs}
        status={{ start: base.start, end: base.end }}
      >
        <div className="mx-auto grid w-full max-w-[46rem] gap-4 px-3 pt-4">
          <h1 className="m-0 font-ui text-ui-strong text-text-primary">캐시 무효화 조사</h1>
          <Message author="user">무효화 테스트가 계속 실패해. 원인 찾아줘</Message>
          <Message>
            <p>
              오른쪽 {T.plugin} 탭에서 이 {T.thread}에서 쓸 {josa(T.plugin, "을", "를")} 고를 수
              있어요.
            </p>
          </Message>
        </div>
      </Shell>
      <Toaster label="알림" />
    </>
  );
}
