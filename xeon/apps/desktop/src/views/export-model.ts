import type { MessageId } from "@fresnel/client/i18n";
import { err, ok, repeatAsync, type Result } from "@fresnel/contracts";
import type { ItemId } from "@fresnel/contracts/conversation";
import type { WireResult } from "@fresnel/contracts/wire";
import type { CommandError, ExportDocument, ExportFormat } from "./commands.ts";
import { saveExport, type FileSaveInvoke } from "./file-save.ts";

// 대화 내보내기의 순수 부분(L4.desktop-ux O-13). `thread.export` 쪽을 `next`가 없을 때까지 이어 붙이고, 읽기와 저장 실패를
// 문장 id로 가르고, 읽은 뒤 저장까지 한 번에 돌린다. 쪽을 읽는 함수와 저장 함수는 넘겨받아 시험은 가짜로 돌린다.

/** 쪽 수 상한. 이보다 많은 쪽이 나오면 host가 끝내지 않는 것으로 보고 실패한다 */
export const EXPORT_PAGE_LIMIT = 5000;

const RUNAWAY: CommandError = { kind: "failed" };

/** 쪽 하나를 읽는다. 운영은 `thread.export`를 `after`로 부르는 자리다(첫 쪽은 `after`가 없다) */
export type ExportPageFetch = (
  after: ItemId | undefined,
) => Promise<Result<WireResult<"thread.export">, CommandError>>;

/**
 * 쪽을 `next`가 없을 때까지 이어 읽어 한 문서로 만든다. 쪽의 `chunk`를 받은 순서대로 이어 붙이고 `itemCount`를 더한다.
 * 쪽이 실패하면 그 오류를 그대로 돌려준다. `next`가 요청한 `after`와 같거나 쪽 수가 상한을 넘으면 `failed`다.
 */
export async function collectExport(
  fetchPage: ExportPageFetch,
): Promise<Result<ExportDocument, CommandError>> {
  let joined: ExportDocument | undefined;
  let after: ItemId | undefined;
  let pages = 0;
  return repeatAsync<Result<ExportDocument, CommandError>>(async () => {
    if (pages >= EXPORT_PAGE_LIMIT) return { value: err(RUNAWAY) };
    pages += 1;
    const got = await fetchPage(after);
    if (!got.ok) return { value: got };
    const page = got.value;
    joined =
      joined === undefined
        ? { filename: page.filename, content: page.chunk, itemCount: page.itemCount }
        : {
            filename: joined.filename,
            content: joined.content + page.chunk,
            itemCount: joined.itemCount + page.itemCount,
          };
    if (page.next === undefined) return { value: ok(joined) };
    if (page.next === after) return { value: err(RUNAWAY) };
    after = page.next;
    return undefined;
  });
}

/** 내보내기 읽기 실패 문장. 엔진이 없거나 host가 `thread.export`를 모르면 그 이유를, 그 밖은 읽기 실패다 */
export function exportFailureId(error: CommandError): MessageId {
  if (error.kind === "offline") return "desktop.threads.menu.failed.offline";
  if (error.kind === "unsupported") return "desktop.threads.export.unsupported";
  return "desktop.threads.export.failed.read";
}

/** 대화 내보내기 대화 상자의 상태. `running`에는 닫을 수 없다 */
export type ExportPhase = "idle" | "running" | "failed";

/** 읽고 저장한 결과. `saved`는 파일 이름과 item 수를, `failed`는 보여 줄 문장 id를 싣는다 */
export type ExportOutcome =
  | { readonly kind: "saved"; readonly filename: string; readonly itemCount: number }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly message: MessageId };

/**
 * 대화를 읽고 저장한다. 읽기가 실패하면 읽기 문장, 저장이 실패하면 저장 문장이다. 저장 창에서 취소하면 `cancelled`이고
 * 오류가 아니다. `fileSave`가 `null`이면(웹) 브라우저 내려받기로 보낸다.
 */
export async function exportAndSave(input: {
  readonly exportThread: (format: ExportFormat) => Promise<Result<ExportDocument, CommandError>>;
  readonly format: ExportFormat;
  readonly fileSave: FileSaveInvoke | null;
}): Promise<ExportOutcome> {
  const exported = await input.exportThread(input.format);
  if (!exported.ok) return { kind: "failed", message: exportFailureId(exported.error) };
  const saved = await saveExport(input.fileSave, exported.value.filename, exported.value.content);
  if (!saved.ok) return { kind: "failed", message: "desktop.threads.export.failed.save" };
  if (saved.value === "cancelled") return { kind: "cancelled" };
  return { kind: "saved", filename: exported.value.filename, itemCount: exported.value.itemCount };
}

/** 저장 단추의 문장. 데스크톱은 "저장…", 웹은 "내려받기"이고, 실패 뒤에는 "다시 시도"다 */
export function primaryLabelOf(desktop: boolean, failed: boolean): MessageId {
  if (failed) return "desktop.threads.export.retry";
  return desktop ? "desktop.threads.export.save" : "desktop.threads.export.download";
}
