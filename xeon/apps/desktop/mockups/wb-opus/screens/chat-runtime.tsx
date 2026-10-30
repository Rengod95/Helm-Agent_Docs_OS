// W5 대화 화면(P-02) 위 런타임 표시(§6.30). 대화 머리 둘째 줄 런타임 줄(DP-19), 트랜스크립트의 한 줄 런타임 행,
// Helm card 기여(helm/suggested, 셸 틀: 테두리 하나 + 확장 이름 연한 글자 + "더 보기"). 오른쪽 "런타임" well은 app.tsx가 연다.
// P-02 본문은 p02-opus를 기준으로 줄였다(이 화면의 주제는 런타임 표시다).
import { Button, Card, Composer, IconButton, Message, ToolCall } from "@caustic/react";
import type { ReactNode } from "react";
import { Compass, Layers, PanelLeft } from "../../_shell";
import { useMock } from "../store";

const READ_WIDTH = "mx-auto w-full max-w-[46rem] px-3";

/** DP-19: 런타임 행은 한 줄, muted 아이콘, secondary 글자, 동작 0~1개, 출처는 tertiary 메타(DP-33). 누르면 작업대 P-17 기록. */
function RuntimeRow({
  children,
  source,
  onOpen,
}: {
  children: ReactNode;
  source: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full min-w-0 items-center gap-1.5 rounded-sm text-start text-ui-dense text-text-secondary outline-none hover:text-text-primary focus-visible:focus-ring"
    >
      <Layers emphasis="muted" aria-hidden className="size-icon-xs flex-none text-text-tertiary" />
      <span className="truncate">{children}</span>
      <span className="flex-none text-ui-xs text-text-tertiary">{source}</span>
    </button>
  );
}

/** card 슬롯의 셸 틀(§6.25): 테두리 하나, 확장 이름 연한 글자, 높이 320 상한과 "더 보기". 안은 helm/suggested 트리. */
function PluginCard({
  ext,
  onMore,
  children,
}: {
  ext: string;
  onMore: () => void;
  children: ReactNode;
}) {
  return (
    <Card
      variant="outline"
      size="sm"
      className="grid max-h-80 gap-2 overflow-hidden p-3 hover:shadow-[inset_0_0_0_1px_var(--cs-color-border-default)]"
    >
      <div className="flex items-center gap-1.5 text-ui-xs text-text-tertiary">
        <Compass emphasis="muted" aria-hidden className="size-icon-xs" />
        <span className="font-mono text-mono-sm">{ext}</span>
        <Button
          size="xs"
          tone="neutral"
          variant="ghost"
          className="ms-auto -me-1.5 -my-1"
          onClick={onMore}
        >
          더 보기
        </Button>
      </div>
      {children}
    </Card>
  );
}

function Head() {
  const m = useMock();
  const drive = m.driveHolder;
  return (
    <header className={`${READ_WIDTH} grid flex-none pb-1`}>
      <div className="flex h-10 items-center gap-1">
        {!m.startOpen && (
          <IconButton
            size="sm"
            variant="ghost"
            label="사이드바 열기"
            onClick={() => m.setStartOpen(true)}
            className="-ms-1.5"
          >
            <PanelLeft />
          </IconButton>
        )}
        <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
          <h1 className="m-0 truncate font-ui text-ui-strong text-text-primary">
            캐시 무효화 조사
          </h1>
          <span className="truncate font-mono text-mono-sm text-text-tertiary">~/code/xeon</span>
          <button
            type="button"
            onClick={() => m.openEnd("work")}
            className="shrink-0 rounded-sm text-ui-dense tabular-nums text-text-tertiary outline-none hover:text-text-primary focus-visible:focus-ring"
          >
            목표 2/3
          </button>
        </div>
      </div>
      {/* 런타임 줄(DP-19): drive 보유 그룹과 단계(helm/phase status 기여 글자), 켜진 확장 수, 이 대화의 확장 실패. 누르면 런타임 탭. */}
      <button
        type="button"
        onClick={() => m.openEnd("runtime")}
        aria-label="런타임 탭 열기"
        className="-mt-1.5 flex min-w-0 items-center gap-1.5 justify-self-start rounded-sm text-ui-dense text-text-secondary outline-none hover:text-text-primary focus-visible:focus-ring"
      >
        <Layers emphasis="muted" aria-hidden className="size-icon-xs text-text-tertiary" />
        <span className="truncate">
          {drive === null ? "drive 없음" : `${drive} drive · 탐색 2/3 렌즈`} · 확장 5 · 실패 1
        </span>
      </button>
    </header>
  );
}

export function ChatRuntime() {
  const m = useMock();
  const noDrive = m.driveHolder === null;
  return (
    <>
      <Head />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div role="log" aria-label="대화 기록" className={`${READ_WIDTH} grid gap-4 pt-1 pb-3`}>
          <Message author="user">무효화 시험이 계속 실패해. 원인 찾아줘</Message>
          <Message>
            <p>먼저 실패하는 시험을 돌려 볼게요.</p>
          </Message>
          <ToolCall
            name="bash"
            detail="bun test cache"
            status="failed"
            duration="1.2s"
            failedLabel="실패 · 1.2s"
          />
          <div className="grid gap-1.5">
            <RuntimeRow source="grp:helm" onOpen={() => m.openDetail("helm", "log")}>
              Helm이 막힘 신호를 봤어요 · 같은 오류 3번
            </RuntimeRow>
          </div>
          <PluginCard ext="helm" onMore={m.openView}>
            {/* helm/suggested 트리: Text, Text, Button(command /helm start). 이미 시작해서 결과 글로 바뀜. */}
            <div className="grid gap-1">
              <span className="text-ui-dense font-medium text-text-primary">
                캐시 무효화를 렌즈 3개로 넓게 볼까요?
              </span>
              <span className="text-ui-dense text-text-secondary">
                같은 오류가 3번 나왔어요 · 실패 사례, 기본 원리, 다른 분야 유사
              </span>
              <span className="pt-1 text-ui-xs text-text-tertiary">14:02에 시작했어요</span>
            </div>
          </PluginCard>
          <div className="grid gap-1.5">
            <RuntimeRow source="grp:helm" onOpen={() => m.openDetail("helm", "lease")}>
              helm이 drive 임대를 받았어요 · 턴 7 · 상한 턴 4
            </RuntimeRow>
            <RuntimeRow source="grp:work" onOpen={() => m.openDetail("helm", "log")}>
              work의 drive 요청을 거부했어요 · helm 보유 중
            </RuntimeRow>
            <RuntimeRow source="ext:acme-notes" onOpen={() => m.openDetail("acme-notes", "log")}>
              acme-notes 실패 2번 · tool.call.before
            </RuntimeRow>
          </div>
          <Message>
            <p>렌즈 3개를 띄웠어요. 실패 사례 렌즈가 비슷한 TTL 경계 버그를 찾고 있어요.</p>
          </Message>
          {noDrive && (
            <>
              <RuntimeRow source="grp:helm" onOpen={() => m.openDetail("helm", "lease")}>
                helm이 drive 임대를 놓았어요 · 턴 9 · 상한 턴 4/4
              </RuntimeRow>
              <Message>
                <p>탐구가 상한에 닿아 멈췄어요. 찾은 두 가지를 정리해 둘게요.</p>
              </Message>
            </>
          )}
        </div>
      </div>
      <div className={`${READ_WIDTH} flex-none pb-1.5`}>
        <Composer
          rows={2}
          inputLabel="메시지"
          sendLabel="보내기"
          stopLabel="중단"
          attachLabel="맥락 더하기"
          modeLabel="실행 중 보낸 입력"
          modes={["steer", "followUp"]}
          defaultMode="steer"
          modelLabel="sonnet-5-5"
          usage={41}
          usageLabel={(p) => `문맥 ${p}% 사용`}
          placeholder="메시지를 입력하세요"
          running={!noDrive}
          onAttach={() => {}}
          onStop={() => {}}
          onSubmit={() => {}}
        />
      </div>
    </>
  );
}
