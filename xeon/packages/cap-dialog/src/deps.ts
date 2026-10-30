import type { Logger } from "@xeon/contracts";
import type { CallContext } from "@xeon/contracts/capabilities";
import type { ApprovalsPortFactory } from "./ports/approvals.ts";
import type { AttachmentFiles } from "./ports/files.ts";
import type { ImagesPort } from "./ports/images.ts";
import type { BlobSink } from "./ports/blobs.ts";
import type { CommandFiles, CommandRoots } from "./ports/command-files.ts";
import type { NoticePort } from "./ports/notices.ts";
import type { ShellPort } from "./ports/shell.ts";
import type { DialogFeed, StatusPublisher } from "./ports/session.ts";
import type { Timers } from "./ports/timers.ts";
import type { DialogSettings } from "./settings.ts";

/** 서비스 조립에 필요한 의존. 플러그인이 포트에서 모아 넘기고, 시험은 대역을 넘긴다 */
export interface DialogDeps {
  readonly logger: Logger;
  readonly timers: Timers;
  /** 호출 한 번이 읽는 유효 설정. threadId가 있으면 세션 범위를 포함한다 */
  readonly settings: (threadId: string | undefined) => DialogSettings;
  /** 없으면 `ask`는 unavailable로 거부한다 */
  readonly approvals: ApprovalsPortFactory | undefined;
  /** 사람이 승인 요청에 답할 수 있는 호출인가. 알 수 없으면 참이다 */
  readonly interactive: (context: CallContext) => boolean;
  /** 사용자 개시 셸 실행. 없으면 셸 주입 명령은 unavailable로 거부한다 */
  readonly shell: ShellPort | undefined;
  /** 명령 파일을 읽는 원천 */
  readonly commandFiles: CommandFiles;
  readonly commandRoots: CommandRoots;
  /** 첨부 원천 파일 읽기 */
  readonly files: AttachmentFiles;
  /** `workspace.images`. 없으면 이미지를 원본 그대로 등록한다 */
  readonly images: ImagesPort | undefined;
  /** 첨부 바이트 저장소. 없으면 첨부는 unavailable이다 */
  readonly blobs: BlobSink | undefined;
  /** 휘발 상태 이벤트를 내보낸다. 없으면 `list`로만 읽힌다 */
  readonly status: StatusPublisher | undefined;
  /** 내구 이벤트 피드. 없으면 내장 세그먼트 `core.turn`·`core.usage`가 비어 있고 알림 구독도 비어 있다 */
  readonly feed: DialogFeed | undefined;
  /** 내구 알림 저장소(`dialog.notified` 기록과 당겨 읽기). 없으면 `emit`과 `list`는 unavailable이다 */
  readonly notices: NoticePort | undefined;
}
