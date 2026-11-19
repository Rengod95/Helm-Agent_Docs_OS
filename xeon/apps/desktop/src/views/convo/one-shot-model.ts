import { resolveSlashName } from "@fresnel/client";
import { t } from "@fresnel/client/i18n";
import type { DraftInfo, InvocableEntry, OverlayRef } from "@fresnel/contracts/wire";

// 원샷(lcM6a, L4 desktop-ux §6.6.1, craft-flows T2): 프로필 밖의 리뷰된 플러그인 항목을 이 턴에만 얹는다.
// 목록은 `plugin.invocables`에서 프로필(과 공통 묶음)에 든 플러그인과 drive 항목을 뺀 것이다. Drive 플러그인의 원샷은 그 Drive가
// 끝날 때까지 남는다. 드래프트는 플러그인마다 가장 새 것 하나를 "드래프트"로 보이고, 호출마다 승인을 받는다.
// 친 글 `/이름 나머지`는 보낼 때 `resolveSlashName`(CLI와 같은 규칙)으로 푼다. 순수 함수만 있다.

/** 한 턴에 얹을 수 있는 원샷 수(wire `overlay` 상한) */
export const ONE_SHOT_MAX = 4;
/** 드래프트를 읽는 플러그인 수 상한 [제안] */
const DRAFT_PLUGINS_MAX = 16;

/** 고를 수 있는 원샷 하나 */
export type OneShotPick = {
  readonly key: string;
  readonly plugin: string;
  /** 항목 이름. 입력창에 `/name`으로 보인다 */
  readonly name: string;
  readonly title: string;
  /** turn: 이 턴만. release: Drive가 끝날 때까지 */
  readonly until: "turn" | "release";
  /** 드래프트면 그 id */
  readonly draftId: string | null;
  /** 플러그인 전체를 얹는다(항목 없이) */
  readonly whole: boolean;
};

/** Drive를 맡을 수 있는 플러그인(drive 항목이 있다) */
function drivePluginsOf(entries: readonly InvocableEntry[]): ReadonlySet<string> {
  return new Set(entries.filter((entry) => entry.kind === "drive").map((entry) => entry.plugin));
}

/** 드래프트를 읽을 플러그인. 이름 순, 상한까지 */
export function draftPluginsOf(entries: readonly InvocableEntry[]): readonly string[] {
  return [...new Set(entries.map((entry) => entry.plugin))].toSorted().slice(0, DRAFT_PLUGINS_MAX);
}

/**
 * 목록. `typed`는 `/` 뒤에 친 글이고 그 글로 시작하는 이름만 남긴다. 프로필에 든 플러그인의 항목은 이미 쓸 수 있으므로 빼고,
 * 드래프트는 프로필 안팎을 가리지 않는다(리뷰된 판과 같은 내용이면 뺀다). Drive 플러그인의 드래프트는 테스트 런에서만 돈다(AGE-56)
 */
export function oneShotRowsOf(input: {
  readonly entries: readonly InvocableEntry[];
  readonly inSet: ReadonlySet<string>;
  readonly drafts: ReadonlyMap<string, readonly DraftInfo[]>;
  readonly typed: string;
}): readonly OneShotPick[] {
  const drive = drivePluginsOf(input.entries);
  const rows: OneShotPick[] = input.entries
    .filter((entry) => entry.kind !== "drive" && !input.inSet.has(entry.plugin))
    .map((entry) => ({
      key: `${entry.plugin}:${entry.entry}`,
      plugin: entry.plugin,
      name: entry.entry,
      title: entry.title,
      until: drive.has(entry.plugin) ? "release" : "turn",
      draftId: null,
      whole: entry.kind === "plugin",
    }));
  for (const [plugin, drafts] of input.drafts) {
    if (drive.has(plugin)) continue;
    const reviewed = input.entries.find((entry) => entry.plugin === plugin)?.reviewedHash;
    const newest = drafts[0];
    if (newest === undefined || newest.contentHash === reviewed) continue;
    rows.push({
      key: `${plugin}@${newest.draftId}`,
      plugin,
      name: plugin,
      title: newest.label ?? plugin,
      until: "turn",
      draftId: newest.draftId,
      whole: true,
    });
  }
  return rows
    .filter((row) => row.name.startsWith(input.typed))
    .toSorted((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

/** wire `OverlayRef`. 플러그인 전체면 항목을 싣지 않는다 */
export function overlayRefOf(pick: OneShotPick): OverlayRef {
  return {
    plugin: pick.plugin,
    ...(pick.whole ? {} : { entry: pick.name }),
    ...(pick.draftId === null ? {} : { draftId: pick.draftId }),
  };
}

/** 고른 원샷을 더한다. 같은 것은 한 번, 상한을 넘으면 더하지 않는다 */
export function addPick(
  picks: readonly OneShotPick[],
  pick: OneShotPick,
): { readonly picks: readonly OneShotPick[]; readonly full: boolean } {
  if (picks.some((known) => known.key === pick.key)) return { picks, full: false };
  if (picks.length >= ONE_SHOT_MAX) return { picks, full: true };
  return { picks: [...picks, pick], full: false };
}

/** 보낼 때의 판단 */
export type OneShotSend =
  | {
      readonly kind: "send";
      readonly text: string;
      readonly overlay: readonly OverlayRef[];
      readonly notice: string | null;
    }
  | { readonly kind: "problem"; readonly text: string };

function sameRef(a: OverlayRef, b: OverlayRef): boolean {
  return a.plugin === b.plugin && a.entry === b.entry && a.draftId === b.draftId;
}

/**
 * 고른 원샷과 친 `/이름`을 합쳐 보낼 글과 덧씌우기를 정한다. `entries`가 null이면(목록을 못 읽음, 엔진이 모름) 친 글은 풀지 않는다.
 * `slashFree`가 거짓이면 첫 토큰이 엔진 명령·스킬이라 원샷으로 풀지 않는다
 */
export function oneShotSendOf(input: {
  readonly text: string;
  readonly picks: readonly OneShotPick[];
  readonly entries: readonly InvocableEntry[] | null;
  readonly inSet: ReadonlySet<string>;
  readonly slashFree: boolean;
  readonly hasAttachments: boolean;
}): OneShotSend {
  const overlay: OverlayRef[] = input.picks.map(overlayRefOf);
  let text = input.text;
  let notice: string | null = null;
  if (input.entries !== null && input.slashFree) {
    const resolved = resolveSlashName(input.text, input.entries, input.inSet);
    if (resolved.kind === "ambiguous") {
      const candidates = resolved.candidates
        .map((c) => (c.kind === "plugin" ? `/plugin:${c.plugin}` : `/${c.plugin}:${c.entry}`))
        .join(", ");
      return {
        kind: "problem",
        text: t("desktop.oneShot.ambiguous", { name: resolved.name, candidates }),
      };
    }
    if (resolved.kind === "resolved") {
      // 모두 프로필에 이미 들었으면 글을 그대로 보낸다(그 이름은 프로필이 받는다)
      if (resolved.overlay.some((item) => !item.alreadyInProfile)) text = resolved.rest;
      for (const item of resolved.overlay) {
        if (item.alreadyInProfile) {
          notice = t("desktop.oneShot.inProfile", { name: item.entry ?? item.plugin });
          continue;
        }
        const ref: OverlayRef =
          item.entry === undefined
            ? { plugin: item.plugin }
            : { plugin: item.plugin, entry: item.entry };
        if (!overlay.some((known) => sameRef(known, ref))) overlay.push(ref);
      }
    }
  }
  if (overlay.length > ONE_SHOT_MAX) {
    return { kind: "problem", text: t("desktop.oneShot.limit", { max: ONE_SHOT_MAX }) };
  }
  if (overlay.length > 0 && text.trim() === "" && !input.hasAttachments) {
    return { kind: "problem", text: t("desktop.oneShot.needsInput") };
  }
  return { kind: "send", text, overlay, notice };
}
