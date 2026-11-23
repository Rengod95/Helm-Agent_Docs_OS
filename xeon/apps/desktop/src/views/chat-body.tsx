import type { ReactNode } from "react";
import { useOpenThread, useTranscriptStatus } from "../state/engine/index.ts";
import { ApprovalQueue } from "./approvals.tsx";
import { ChatLoadError } from "./chat-load-error.tsx";
import { Composer } from "./composer.tsx";
import { ComposerBeam } from "./effects/convo-beam.tsx";
import { NowStrip } from "./now/now-strip.tsx";
import { ProjectNotices } from "./project/project-notices.tsx";
import { SafeModeCard } from "./safe-mode-card.tsx";
import { SetupBanner } from "./setup-banner.tsx";
import { SpawnedNotice } from "./spawned-notice.tsx";
import { StoreReplacedBanner } from "./store-replaced-banner.tsx";
import { ThreadContextBar } from "./thread-context-bar.tsx";
import { Transcript } from "./transcript.tsx";
import { TrustCard } from "./trust.tsx";

/**
 * 대화 본문(머리 줄 아래). 입력창 위 쌓임(DP-100 [결정: 2026-11-11 사용자]), 위에서 아래로:
 * 1. 행동 카드(신뢰 확인, 승인 대기열, 안전 모드): 사용자가 답해야 하는 것. 승인 대기열은 화면 높이의 50%까지, 넘치면 안쪽 스크롤(approvals.tsx).
 * 2. 지금 띠: 목표·할 일·하위 에이전트·주도의 한 줄. 펼치면 본문 240px까지.
 * 3. 대화 맥락 줄(DP-71): 입력창 바로 위에 붙는다.
 * 4. 입력창(그 안의 대기 입력·재시도·오류 줄은 입력창에 붙는다).
 * 1·2는 한 그릇(`data-chat-stack`)에 쌓이고 사이 간격은 그릇의 gap 하나(8px)다(DP-225 [결정: 2026-11-20 사용자, AGE-65]): 부품은 바깥 여백을
 * 갖지 않아 몇 개가 어떤 조합으로 와도 간격이 같고 서로 겹치지 않는다. 높이가 모자라면 승인 대기열만 줄고(카드 안쪽이 스크롤),
 * 대화 기록은 128px 아래로 밀리지 않는다.
 * 대화를 읽지 못했으면 대화 기록 자리에 오류 상태(`ChatLoadError`)를 그린다(DP-102)
 */
export function ChatBody(): ReactNode {
  const spawned = useOpenThread()?.spawnedBy !== undefined;
  const transcript = useTranscriptStatus();
  return (
    <>
      <SetupBanner />
      <StoreReplacedBanner />
      {/* 대화 기록의 바닥 높이(128px): 입력창 위 쌓임이 커져도 대화 내용이 0이 되도록 밀리지 않는다(DP-225) */}
      <div data-chat-rail-gap="" className="flex min-h-32 flex-1 flex-col">
        {transcript === "error" ? <ChatLoadError /> : <Transcript />}
      </div>
      {/* 대화 열 폭(시안 46rem)에 맞춰 입력창 위 카드들을 같은 가운데 열에 둔다. 무대가 좁으면 대화 기록처럼 오른쪽 막대 자리를 비운다(`data-chat-rail-gap`, DP-135) */}
      {/* 토스트는 이 묶음(카드와 입력창) 위에 선다. 묶음의 위쪽 끝을 알려 입력창 모델 고르기 단추를 가리지 않게 한다(shell.tsx useToastBottom) */}
      <div data-toast-avoid data-chat-rail-gap="" className="flex min-h-0 flex-col">
        <div className="mx-auto flex min-h-0 w-full max-w-184 flex-col">
          {/* 쌓임 그릇(DP-225): 부품 사이와 맥락 줄 위가 모두 8px다. 줄어드는 것은 승인 대기열 하나이고 나머지는 제 높이를 지킨다 */}
          <div
            data-chat-stack=""
            className="flex min-h-0 flex-col gap-2 px-3 pb-2 empty:hidden [&>*]:shrink-0 [&>:has(>[data-approval-band])]:shrink"
          >
            <TrustCard />
            <ApprovalQueue />
            <SafeModeCard />
            {spawned ? null : <ProjectNotices />}
            {spawned ? null : <NowStrip />}
          </div>
          {/* 대화 맥락 줄(DP-71)은 입력창 바로 위에 붙는다. 폴더가 없어졌다는 경고도 이 줄의 폴더 칸이 보인다 */}
          <ThreadContextBar />
        </div>
        {/* 턴이 도는 동안 입력창 테두리를 빛이 돈다(DP-107) */}
        <ComposerBeam>{spawned ? <SpawnedNotice /> : <Composer />}</ComposerBeam>
      </div>
    </>
  );
}
