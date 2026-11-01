// O-02 셸 명령 확인 · O-03 명령 결과 · O-04 프로젝트 신뢰 카드. 셋 다 대화(P-02) 위에서 열리므로 한 목업의 상태로 둔다.
// 바탕 대화는 P-02 시안(p02-opus)의 머리·읽기 열·입력창 치수를 그대로 따른 가벼운 복사본이다(그 폴더 store에 묶이지 않게).
// 명령과 결과에는 그 명령을 가진 쪽(ext:release-kit 확장, Helm 그룹)을, 신뢰 카드에는 프로젝트가 싣는 그룹·훅까지 보인다.
import {
  AgentRequest,
  Badge,
  Button,
  Composer,
  Dialog,
  EmptyState,
  IconButton,
  ListDescription,
  ListDescriptionRow,
  Message,
  ScrollArea,
  Sheet,
} from "@caustic/react";
import { useLayoutEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  defaultStatusCells,
  Ellipsis,
  Shell,
  standardRightTabs,
  Terminal,
  useShell,
} from "../_shell";

export type OverlayState = "S1" | "S2" | "S3" | "S4";

const READ_WIDTH = "mx-auto w-full max-w-[46rem] px-3";
const LIST_DESC = "rounded-none [&_[data-slot=list-description-row]]:px-0";

const helmJson = `{
  "group": "grp:helm",
  "phase": "explore",
  "lease": { "holder": "grp:helm", "state": "held", "turn": 1, "maxTurns": 4 },
  "lenses": [
    { "id": "ttl-경계", "state": "running" },
    { "id": "단위", "state": "running" },
    { "id": "경합", "state": "queued" }
  ],
  "discoveries": 0
}`;

function Head({ title, draft }: { title: string; draft?: boolean }) {
  return (
    <header className={`${READ_WIDTH} flex h-10 flex-none items-center gap-1`}>
      <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
        <h1 className="m-0 truncate font-ui text-ui-strong text-text-primary">{title}</h1>
        <span className="truncate font-mono text-mono-sm text-text-tertiary">~/code/xeon</span>
        {draft !== true && (
          <span className="shrink-0 text-ui-sm tabular-nums text-text-tertiary">목표 2/3</span>
        )}
      </div>
      <IconButton size="sm" variant="ghost" label="대화 메뉴">
        <Ellipsis />
      </IconButton>
    </header>
  );
}

function ChatComposer({ value, disabled }: { value: string; disabled?: boolean }) {
  return (
    <Composer
      value={value}
      onValueChange={() => {}}
      rows={2}
      inputLabel="메시지"
      sendLabel="보내기"
      stopLabel="중단"
      attachLabel="맥락 더하기"
      modelLabel="sonnet-5-5"
      usage={value === "" ? 0 : 41}
      usageLabel={(p) => `문맥 ${p}% 사용`}
      placeholder="메시지를 입력하세요"
      disabled={disabled === true}
      onAttach={() => {}}
      onSubmit={() => {}}
    />
  );
}

function TrustCard() {
  const [done, setDone] = useState<string | null>(null);
  if (done !== null)
    return (
      <AgentRequest
        kind="permission"
        status={done === "deny" ? "denied" : "allowed"}
        title={done === "deny" ? "프로젝트 설정 없이 시작해요" : "이 폴더를 신뢰했어요"}
        subtitle="~/code/xeon · 설정 › 프로젝트 신뢰에서 바꿀 수 있어요"
      />
    );
  return (
    <AgentRequest
      kind="permission"
      title="이 프로젝트의 설정을 신뢰할까요?"
      subtitle="~/code/xeon · 처음 여는 폴더예요"
      shadow="none"
      className="shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]"
      actions={[
        { id: "deny", label: "신뢰하지 않음", tone: "danger" },
        { id: "once", label: "이번 실행만", tone: "secondary" },
        { id: "parent", label: "~/code 전체", tone: "secondary" },
        { id: "folder", label: "이 폴더 신뢰", tone: "primary" },
      ]}
      onAction={setDone}
    >
      {/* 불러오려는 자원을 종류별로 한 목록에(DP-12). 그룹은 대화 루프에 훅을 거는 L3 의도 그룹이라 따로 짚는다. */}
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label="불러오려는 자원"
        className={`${LIST_DESC} [--cs-size-list-term:6rem]`}
      >
        <ListDescriptionRow term="그룹" mono>
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            groups/cache-guard
            <Badge size="xs" tone="warning">
              on · post 훅
            </Badge>
          </span>
        </ListDescriptionRow>
        <ListDescriptionRow term="MCP 서버" mono>
          .mcp.json · github, postgres
        </ListDescriptionRow>
        <ListDescriptionRow term="스킬" mono>
          cache-debug, release
        </ListDescriptionRow>
        <ListDescriptionRow term="설정" mono>
          .fresnel/settings.json · 키 3
        </ListDescriptionRow>
      </ListDescription>
    </AgentRequest>
  );
}

export function OverlayPage({ state }: { state: OverlayState }) {
  const shell = useShell();
  // 대화 위 표면만 보이게 오른쪽 well은 닫아 둔다(막대는 남는다).
  useLayoutEffect(() => shell.setEndOpen(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [confirmOpen, setConfirmOpen] = useState(state === "S1");
  const [sheetOpen, setSheetOpen] = useState(state === "S2" || state === "S3");
  const [jsonOpen, setJsonOpen] = useState(state === "S3");
  const trust = state === "S4";

  return (
    <>
      <Shell
        activeNav="chat"
        stageLabel="대화"
        modalOpen={confirmOpen || sheetOpen}
        threads={{
          currentId: trust ? null : "t1",
          draft: trust,
          onSelect: () => {},
          onNew: () => {},
        }}
        rightTabs={standardRightTabs({ inboxBadge: 10 })}
        status={defaultStatusCells({
          layout: shell.layout,
          thread: !trust,
          pendingApprovals: 5,
          openEnd: shell.openEnd,
        })}
      >
        <Head title={trust ? "새 대화" : "캐시 무효화 조사"} draft={trust} />
        {trust ? (
          <div className="flex min-h-0 flex-1 flex-col justify-end overflow-auto">
            <div className={`${READ_WIDTH} grid gap-4 pb-3`}>
              <EmptyState variant="agent" surface="none" size="sm" title="무엇부터 할까요?" />
              <TrustCard />
            </div>
          </div>
        ) : (
          <ScrollArea label="대화 내용" className="min-h-0 flex-1">
            <div role="log" aria-label="대화 기록" className={`${READ_WIDTH} grid gap-4 pt-1 pb-3`}>
              <Message author="user">ttl 단위 수정 끝났으면 배포까지 해 줘</Message>
              <Message>
                <p>시험이 모두 통과했어요. 배포는 /deploy 로 할 수 있어요.</p>
              </Message>
              {state !== "S1" && (
                <>
                  <Message author="user">/helm status</Message>
                  <button
                    type="button"
                    onClick={() => setSheetOpen(true)}
                    className="flex min-w-0 items-center gap-2 justify-self-start rounded-lg px-2 py-1 text-ui-sm text-text-secondary outline-none hover:bg-fill-hover focus-visible:focus-ring"
                  >
                    <Terminal
                      aria-hidden
                      emphasis="muted"
                      className="size-icon-sm text-text-tertiary"
                    />
                    <span className="font-mono text-mono-sm text-text-primary">/helm status</span>
                    <span className="text-text-tertiary">Helm 그룹 · 탐구 중, 렌즈 3</span>
                    <ChevronRight aria-hidden className="size-icon-sm text-text-tertiary" />
                  </button>
                </>
              )}
            </div>
          </ScrollArea>
        )}
        <div className={`${READ_WIDTH} grid flex-none gap-1 pb-1.5`}>
          <ChatComposer value={state === "S1" ? "/deploy" : ""} />
        </div>
      </Shell>

      {/* O-02: 명령이 셸을 실행하기 전 확인. 기본 초점은 "취소". */}
      <Dialog
        kind="alert"
        size="sm"
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        icon={<Terminal />}
        title="/deploy가 셸 명령을 실행해요"
        description="release-kit 확장(ext:release-kit)의 명령이에요."
        footer={
          <>
            <span aria-hidden className="flex-1" />
            <Button
              size="sm"
              tone="neutral"
              variant="outline"
              autoFocus
              onClick={() => setConfirmOpen(false)}
            >
              취소
            </Button>
            <Button size="sm" tone="neutral" variant="solid" onClick={() => setConfirmOpen(false)}>
              실행
            </Button>
          </>
        }
      >
        <pre className="m-0 overflow-x-auto rounded-lg bg-neutral-track px-3 py-2 font-mono text-mono-sm text-text-primary">
          {"$ git push origin main\n$ ./scripts/release.sh"}
        </pre>
        <ListDescription
          variant="ghost"
          size="xs"
          aria-label="실행 정보"
          className={`${LIST_DESC} mt-1 [--cs-size-list-term:4.5rem]`}
        >
          <ListDescriptionRow term="위치" mono>
            ~/code/xeon
          </ListDescriptionRow>
          <ListDescriptionRow term="대상">로컬 사이드카</ListDescriptionRow>
        </ListDescription>
      </Dialog>

      {/* O-03: 명령 결과. 결과를 낸 그룹을 머리에, 사실은 한 목록으로, 원본 JSON은 접어 둔다. */}
      <Sheet
        side="right"
        size="sm"
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="/helm status"
        description="Helm 그룹(grp:helm) · 방금"
        closeLabel="닫기"
        footer={
          <>
            <Button size="sm" tone="neutral" variant="ghost" iconStart={<Copy />}>
              복사
            </Button>
            <span aria-hidden className="flex-1" />
            <Button size="sm" tone="neutral" variant="solid" onClick={() => setSheetOpen(false)}>
              닫기
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <p className="m-0 text-ui-sm text-text-primary">
            탐구 중이에요. 렌즈 2개가 돌고 1개는 기다려요.
          </p>
          <ListDescription
            variant="ghost"
            size="xs"
            aria-label="상태"
            className={`${LIST_DESC} [--cs-size-list-term:6rem]`}
          >
            <ListDescriptionRow term="단계">explore</ListDescriptionRow>
            <ListDescriptionRow term="드라이브 임대">Helm 그룹이 가짐 · 턴 1/4</ListDescriptionRow>
            <ListDescriptionRow term="렌즈">
              <span className="grid gap-0.5">
                <span>
                  <span className="font-mono text-mono-sm">ttl-경계</span>{" "}
                  <span className="text-text-tertiary">실행 중</span>
                </span>
                <span>
                  <span className="font-mono text-mono-sm">단위</span>{" "}
                  <span className="text-text-tertiary">실행 중</span>
                </span>
                <span>
                  <span className="font-mono text-mono-sm">경합</span>{" "}
                  <span className="text-text-tertiary">대기</span>
                </span>
              </span>
            </ListDescriptionRow>
            <ListDescriptionRow term="발견">0</ListDescriptionRow>
          </ListDescription>
          <div className="grid gap-1.5">
            <Button
              size="xs"
              tone="neutral"
              variant="ghost"
              aria-expanded={jsonOpen}
              iconStart={jsonOpen ? <ChevronDown /> : <ChevronRight />}
              onClick={() => setJsonOpen(!jsonOpen)}
              className="-ms-2 justify-self-start"
            >
              결과 JSON
            </Button>
            {jsonOpen && (
              <pre className="m-0 overflow-x-auto rounded-lg bg-neutral-track px-3 py-2 font-mono text-mono-sm text-text-primary">
                {helmJson}
              </pre>
            )}
          </div>
        </div>
      </Sheet>
    </>
  );
}
