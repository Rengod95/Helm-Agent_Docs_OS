import type {
  CapabilityApi,
  DialogAsk,
  DialogAttachments,
  DialogNotify,
  DialogStatus,
  NoticeFeed,
} from "@xeon/contracts/capabilities";
import { createAskService } from "./ask/service.ts";
import { createAttachmentsApi } from "./attachments/service.ts";
import {
  createCommandsService,
  type CommandsService,
  type CommandsServiceApi,
} from "./commands/service.ts";
import type { DialogDeps } from "./deps.ts";
import { createNotifyService, type NotifyService } from "./notify/service.ts";
import { createStatusService, type StatusService } from "./status/service.ts";

// 능력별 API 객체를 조립한다. 묶음(DialogService)은 Cordis에 등록하지 않는다. 등록은 plugin.ts가 능력마다 한다
// (L2.readme §5.6). M2는 ask, commands, status, attachments 넷이고, M3에서 notify가 더해진다. aside, styles는 2차다.

interface DialogApis {
  readonly ask: CapabilityApi<typeof DialogAsk>;
  readonly commands: CommandsServiceApi;
  readonly status: CapabilityApi<typeof DialogStatus>;
  readonly attachments: CapabilityApi<typeof DialogAttachments>;
  /** emit·list와 같은 프로세스 구독(NoticeFeed)을 함께 준다 */
  readonly notify: CapabilityApi<typeof DialogNotify> & NoticeFeed;
}

export interface DialogRuntime {
  readonly apis: DialogApis;
  /** 지점 핸들러와 피드가 쓰는 내부 입구 */
  readonly commands: CommandsService;
  readonly status: StatusService;
  /** 피드가 쓰는 내부 입구. 내구 이벤트 하나를 알림으로 바꿔 구독자에게 보낸다 */
  readonly notify: NotifyService;
  dispose(): void;
}

export function createDialogRuntime(deps: DialogDeps): DialogRuntime {
  const ask = createAskService(deps);
  const commands = createCommandsService(deps);
  const status = createStatusService(deps);
  const notify = createNotifyService(deps);
  return {
    apis: {
      ask: ask.api,
      commands: commands.api,
      status: status.api,
      attachments: createAttachmentsApi(deps),
      notify: notify.api,
    },
    commands,
    status,
    notify,
    dispose() {
      ask.dispose();
      status.dispose();
      notify.dispose();
    },
  };
}
