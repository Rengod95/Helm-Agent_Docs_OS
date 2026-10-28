import type {
  CapabilityApi,
  DialogAsk,
  DialogAttachments,
  DialogStatus,
} from "@xeon/contracts/capabilities";
import { createAskService } from "./ask/service.ts";
import { createAttachmentsApi } from "./attachments/service.ts";
import {
  createCommandsService,
  type CommandsService,
  type CommandsServiceApi,
} from "./commands/service.ts";
import type { DialogDeps } from "./deps.ts";
import { createStatusService, type StatusService } from "./status/service.ts";

// 능력별 API 객체를 조립한다. 묶음(DialogService)은 Cordis에 등록하지 않는다. 등록은 plugin.ts가 능력마다 한다
// (L2.readme §5.6). M2는 ask, commands, status, attachments 넷이다. aside, styles는 2차, notify는 M3다.

interface DialogApis {
  readonly ask: CapabilityApi<typeof DialogAsk>;
  readonly commands: CommandsServiceApi;
  readonly status: CapabilityApi<typeof DialogStatus>;
  readonly attachments: CapabilityApi<typeof DialogAttachments>;
}

export interface DialogRuntime {
  readonly apis: DialogApis;
  /** 지점 핸들러와 피드가 쓰는 내부 입구 */
  readonly commands: CommandsService;
  readonly status: StatusService;
  dispose(): void;
}

export function createDialogRuntime(deps: DialogDeps): DialogRuntime {
  const ask = createAskService(deps);
  const commands = createCommandsService(deps);
  const status = createStatusService(deps);
  return {
    apis: {
      ask: ask.api,
      commands: commands.api,
      status: status.api,
      attachments: createAttachmentsApi(deps),
    },
    commands,
    status,
    dispose() {
      ask.dispose();
      status.dispose();
    },
  };
}
