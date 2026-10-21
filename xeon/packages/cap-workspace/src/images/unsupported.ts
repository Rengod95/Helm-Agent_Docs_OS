import { WorkspaceImages, type CapabilityApi } from "@xeon/contracts/capabilities";
import { guarded, WorkspaceFailure } from "../errors.ts";

// workspace.images는 M2(plan W7, dialog.attachments의 필수 의존)에서 들어온다. M1은 능력을 제공하지 않고(plugin.ts의
// 매니페스트 provides에 없다), WorkspaceService 묶음 타입의 모양만 맞추려고 unsupported로 거부하는 객체를 둔다.

type ImagesApi = CapabilityApi<typeof WorkspaceImages>;
type MethodName = "load" | "resize" | "register";

function notYet(method: MethodName): () => Promise<never> {
  return () =>
    guarded(WorkspaceImages.id, method, () =>
      Promise.reject(
        new WorkspaceFailure("unsupported", `workspace.images ${method} is not available yet.`, {
          detail: { milestone: "M2" },
        }),
      ),
    );
}

export function unsupportedImages(): ImagesApi {
  return { load: notYet("load"), resize: notYet("resize"), register: notYet("register") };
}
