// 확장 지우기(B-04, `ext.remove`)의 순수 판단: 어떤 행을 지울 수 있나, 결과를 어떤 문장으로 알리나.
import { assertNever } from "@fresnel/contracts";
import type { MessageId } from "@fresnel/client/i18n";
import type { Placement } from "@fresnel/contracts/extensions";
import type {
  ExtListEntry,
  ExtRemovePreviewResult,
  ExtRemoveResult,
  ExtUiEntry,
  Profile,
} from "@fresnel/contracts/wire";
import type { CommandError } from "../commands.ts";
import { stripUnsafeText } from "@fresnel/client/views/app";

/**
 * 이 확장을 쓰는 프로필의 제목. 프로필의 `enable`에 이름이 있는 것만 센다. `disable`에만 적힌 프로필은 이 확장을 끄는 것이라 쓰는 것이 아니다.
 * 목록 순서(`profile.list`의 순서)를 따른다
 */
export function profilesUsingOf(
  profiles: readonly Pick<Profile, "title" | "enable">[],
  name: string,
): readonly string[] {
  return profiles
    .filter((profile) => profile.enable.includes(name))
    .map((profile) => profile.title);
}

/** 확장이 낸 화면 항목 한 줄(지우면 빠지는 플러그인 뷰). 제목이 비면 화면 id를 쓴다 */
export interface PluginViewRow {
  readonly id: string;
  readonly title: string;
  readonly placement: Placement;
}

/** 이 확장이 낸 화면 항목(플러그인 뷰)을 항목 순서대로 준다. 확장이 꺼져 있거나 고장 난 항목도 지우면 빠지므로 넣는다 */
export function pluginViewsOf(
  entries: readonly Pick<ExtUiEntry, "extension" | "id" | "title" | "placement">[],
  name: string,
): readonly PluginViewRow[] {
  return entries
    .filter((entry) => entry.extension === name)
    .map((entry) => {
      const title = stripUnsafeText(entry.title, false).trim();
      return { id: entry.id, title: title === "" ? entry.id : title, placement: entry.placement };
    });
}

/** 배치 자리의 이름 문장(목록 한 줄 뒤에 붙는다) */
export function placementTextOf(placement: Placement): MessageId {
  switch (placement) {
    case "page":
      return "desktop.workbench.placement.page";
    case "panel":
      return "desktop.workbench.placement.panel";
    case "card":
      return "desktop.workbench.placement.card";
    case "status":
      return "desktop.workbench.placement.status";
    case "command":
      return "desktop.workbench.placement.command";
    case "settings":
      return "desktop.workbench.placement.settings";
    default:
      return assertNever(placement, "placementTextOf");
  }
}

/**
 * 지울 수 있는 확장인가. `ext.remove`는 사용자 확장 위치의 설치본 폴더를 지우므로 `origin`이 `user`인 것만 지운다.
 * 내장, 관리자(`managed`), 작업 폴더(`project`) 확장은 앱이 지우지 않는다. `origin`이 없는 옛 호스트의 행은 지우기를 막는다
 */
export function removableOf(entry: Pick<ExtListEntry, "origin">): boolean {
  return entry.origin === "user";
}

/** 지운 결과 문장. 로더가 내리면 `now`, 켜기가 경계로 미뤄졌으면 `nextStepBoundary`, 로더가 없으면 `restart`다 */
export function removeDoneText(appliesAt: ExtRemoveResult["appliesAt"]): MessageId {
  switch (appliesAt) {
    case "now":
      return "desktop.workbench.remove.done.now";
    case "nextStepBoundary":
      return "desktop.workbench.remove.done.boundary";
    case "restart":
      return "desktop.workbench.remove.done.restart";
    default:
      return assertNever(appliesAt, "removeDoneText");
  }
}

/** 이미 없는 이름(`extension.notFound`, 3401)을 지우려 했나. 목록이 낡았다는 뜻이라 문장이 다르다 */
const REMOVE_NOT_FOUND_CODE = 3401;

/**
 * 지우기 요청의 결과. `gone`은 이미 없는 이름(3401)이라 지울 것이 남지 않았다: 폴더와 데이터가 없으므로 "폴더는 남아 있어요"
 * 문구를 보이면 거짓이다. `failed`는 그 밖의 실패다
 */
export type RemoveOutcome = "removed" | "gone" | "failed";

/** 실패한 `ext.remove`의 오류 값에서 결과를 가른다 */
export function removeOutcomeOfError(error: CommandError): RemoveOutcome {
  return error.kind === "rejected" && error.code === REMOVE_NOT_FOUND_CODE ? "gone" : "failed";
}

/** 저장 데이터까지 지우다 실패해 상자를 열어 두고 "설치 폴더는 그대로 남아 있어요" 경고를 보이는가. `gone`은 닫는다 */
export function keepsDialogOpen(outcome: RemoveOutcome, dropData: boolean): boolean {
  return outcome === "failed" && dropData;
}

/** 확장이 소유한 저장 테이블 한 줄(`ext.removePreview`의 `tables`) */
export type StorageTable = ExtRemovePreviewResult["tables"][number];

/**
 * 지우기 상자가 읽은 저장 데이터. `ready`에서 `tables`가 비었으면 "확인된 저장 데이터가 없어요"다.
 * 장부가 비어 있어도 데이터가 없다는 뜻은 아니므로 문장도 그렇게 쓴다
 */
export type StoragePreview =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly tables: readonly StorageTable[] };

/** 저장 데이터 칸의 한 줄 문장. 표를 그릴 수 있을 때(`ready`이고 테이블이 있을 때)는 null이다 */
export function storageNoteOf(preview: StoragePreview): MessageId | null {
  switch (preview.kind) {
    case "loading":
      return "desktop.workbench.remove.storage.loading";
    case "failed":
      return "desktop.workbench.remove.storage.failed";
    case "ready":
      return preview.tables.length === 0 ? "desktop.workbench.remove.storage.none" : null;
    default:
      return assertNever(preview, "storageNoteOf");
  }
}

/** 행 수의 합계 */
export function totalRowsOf(tables: readonly StorageTable[]): number {
  return tables.reduce((sum, table) => sum + table.rows, 0);
}

/**
 * `ext.remove`에 `dropData`로 보낼 값. 칸을 켰고 지울 테이블이 실제로 보일 때만 참이다.
 * 표가 비었으면 칸이 없으므로 체크 상태와 무관하게 거짓이다
 */
export function dropDataOf(checked: boolean, tables: readonly StorageTable[]): boolean {
  return checked && tables.length > 0;
}

/**
 * 지운 뒤 알림 문장. 제목은 적용 시점 문장이고(`removeDoneText`), 저장 테이블을 함께 지웠으면(`dataDropped` > 0)
 * 그 수를 덧붙인 문장을 `data`로 준다. 적용 시점을 잃지 않으려고 제목을 바꾸지 않는다
 */
export function removeDoneCopyOf(
  appliesAt: ExtRemoveResult["appliesAt"],
  dataDropped: number | undefined,
): { readonly title: MessageId; readonly data: number | null } {
  return {
    title: removeDoneText(appliesAt),
    data: dataDropped !== undefined && dataDropped > 0 ? dataDropped : null,
  };
}
