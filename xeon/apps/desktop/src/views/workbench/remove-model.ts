// 확장 지우기(B-04)의 순수 판단: 어떤 행을 지울 수 있나, 결과를 어떤 문장으로 알리나.
// M5c-1부터 지우기는 `plugin.requestRemove`가 검토 항목을 만든다(바로 지우지 않는다). 저장 데이터는 엔진에 목록도 지우기도 없어 다루지 않는다.
import { assertNever } from "@fresnel/contracts";
import { activeLocale, type MessageId } from "@fresnel/client/i18n";
import type { Placement } from "@fresnel/contracts/extensions";
import type { ExtListEntry, ExtUiEntry, Profile } from "@fresnel/contracts/wire";
import type { CommandError, DependencyRefusalView } from "../commands.ts";
import { profileTitleOf } from "../convo/profile-chip-model.ts";
import { stripUnsafeText } from "@fresnel/client/views/app";
import { extMessageOf } from "@fresnel/client/views/native";

/**
 * 이 확장을 쓰는 프로필의 화면 이름. 프로필의 `plugins` 목록에 이름이 있는 것만 센다(목록에 없으면 그 프로필은 이 확장을 쓰지 않는다).
 * 목록 순서(`profile.list`의 순서)를 따른다. 기본 프로필은 "기본"으로 센다(profileTitleOf)
 */
export function profilesUsingOf(
  profiles: readonly Pick<Profile, "id" | "title" | "plugins">[],
  name: string,
): readonly string[] {
  return profiles
    .filter((profile) => profile.plugins.some((plugin) => plugin.name === name))
    .map((profile) => profileTitleOf(profile.id, profile.title));
}

/** 확장이 낸 화면 항목 한 줄(지우면 빠지는 플러그인 뷰). 제목이 비면 화면 id를 쓴다 */
export interface PluginViewRow {
  readonly id: string;
  readonly title: string;
  readonly placement: Placement;
}

/** 이 확장이 낸 화면 항목(플러그인 뷰)을 항목 순서대로 준다. 확장이 꺼져 있거나 고장 난 항목도 지우면 빠지므로 넣는다 */
export function pluginViewsOf(
  entries: readonly Pick<ExtUiEntry, "extension" | "id" | "title" | "placement" | "messages">[],
  name: string,
): readonly PluginViewRow[] {
  return entries
    .filter((entry) => entry.extension === name)
    .map((entry) => {
      const title = stripUnsafeText(
        extMessageOf(entry.messages, activeLocale(), entry.title),
        false,
      ).trim();
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

/** 지우기 확인 상자의 본문. 확인하면 리뷰로 간다는 것, 승인 뒤에 지워진다는 것을 적는다 */
export const REMOVE_BODY_TEXT: MessageId = "desktop.workbench.remove.body";

/** 지우기 요청을 보냈을 때의 문장. 지우는 것은 검토가 승인한 뒤이므로 "바로 지웠다"고 쓰지 않는다 */
export const REMOVE_REQUESTED_TEXT: MessageId = "desktop.workbench.remove.requested";

/** 이미 없는 이름(`extension.notFound`, 3401)을 지우려 했나. 목록이 낡았다는 뜻이라 문장이 다르다 */
const REMOVE_NOT_FOUND_CODE = 3401;

/**
 * 지우기 요청의 결과. `gone`은 이미 없는 이름(3401)이라 지울 것이 남지 않았다: 폴더와 데이터가 없으므로 "폴더는 남아 있어요"
 * 문구를 보이면 거짓이다. `refused`는 이 플러그인에 꼭 기대는 쪽이 있어 엔진이 거절했다(`plugin.dependency` 3627, AGE-33).
 * `failed`는 그 밖의 실패다
 */
export type RemoveOutcome = "removed" | "gone" | "refused" | "failed";

/** 지우기 요청의 결과와, 의존 때문에 거절됐으면 그 목록 */
export interface RemoveResult {
  readonly outcome: RemoveOutcome;
  readonly refusal: DependencyRefusalView | null;
}

/** 실패한 `plugin.requestRemove`의 오류 값에서 결과를 가른다 */
export function removeOutcomeOfError(error: CommandError): RemoveOutcome {
  if (error.kind !== "rejected") return "failed";
  if (error.code === REMOVE_NOT_FOUND_CODE) return "gone";
  if (error.dependency !== undefined) return "refused";
  return "failed";
}

/**
 * 상자를 열어 둘까. 의존 때문에 거절됐으면 그 목록을 상자 안에 보인다. 그 밖의 결과는 닫는다(실패는 토스트로 알린다)
 */
export function keepsDialogOpen(outcome: RemoveOutcome): boolean {
  return outcome === "refused";
}
