// 플러그인 상세 "의존" 탭의 실제 원천(m6Mb, AGE-33). 엔진 호출만 하고 그리지 않는다.
// 읽기: `plugin.get`(카드의 `dependencies`와 원본 폴더) → 원본 폴더가 있으면 `ext.dependencies.read`(고치는 중인 선언).
// 원본 폴더가 없거나 엔진이 거절하면 카드 값만 보이고 잠긴다. 리뷰 대기: `pluginReview.list`에서 이 플러그인의 대기 항목.
// 쓰기: `ext.dependencies.edit { dir, ops }`(원본 폴더의 매니페스트만 고친다). "리뷰로 보내기"는 구성원 탭과 같은 길이다
// (`plugin.draft.create` 다음 `pluginReview.submitDraft`). 승인 전에는 승인본이 그대로 돈다.
import type { MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { CardDependencies } from "@fresnel/contracts/extensions";
import type { DependencyInfo, DependencyOp } from "@fresnel/contracts/services";
import type { ExtListEntry, HostConnection, ReviewItem } from "@fresnel/contracts/wire";
import { useCallback, useEffect, useState } from "react";
import { useLinkPhase } from "../../../state/engine/index.ts";
import { useCommands } from "../../commands.ts";
import { accessOf, isDenied, pendingItemOf, type MembersAccess } from "../members/members-model.ts";
import { submitDirForReview, useOpenReview, type SendOutcome } from "../members/members-source.ts";
import { depsEditFailureText } from "./deps-model.ts";

export type DepsLoad =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "offline" }
  | {
      readonly status: "ready";
      /** 카드 값(설치본 기준). 문제와 기대는 쪽은 엔진이 계산한다 */
      readonly card: CardDependencies;
      /** 원본 폴더의 선언. 원본 폴더가 없거나 읽지 못했으면 null(카드 값을 보인다) */
      readonly source: readonly DependencyInfo[] | null;
      readonly access: MembersAccess;
      readonly matchesReviewed: boolean;
      readonly pending: ReviewItem | null;
    };

type DepsEditOutcome = { readonly ok: true } | { readonly ok: false; readonly text: MessageId };

/** 탭이 그리는 데 쓰는 값과 동작. 개발 빌드의 표본도 같은 모양을 준다 */
export interface DepsData {
  readonly load: DepsLoad;
  /** 이 플러그인 이름(자기 자신은 대상에서 뺀다) */
  readonly name: string;
  /** 의존을 걸 수 있는 구성원 id(설치본 기준) */
  readonly members: readonly string[];
  /** 대상 고르기와 이름 보이기에 쓰는 설치 목록 */
  readonly entries: readonly ExtListEntry[];
  /** 이 화면에서 보낸 뒤 또 고쳤는가 */
  readonly editedSinceSend: boolean;
  readonly edit: (ops: readonly DependencyOp[]) => Promise<DepsEditOutcome>;
  readonly send: () => Promise<SendOutcome>;
  readonly openReview: (itemId: string) => void;
}

const EMPTY: CardDependencies = { dependsOn: [], dependents: [] };

interface Read {
  readonly card: CardDependencies;
  readonly source: readonly DependencyInfo[] | null;
  readonly access: MembersAccess;
  readonly matchesReviewed: boolean;
}

export function useDepsSource(entry: ExtListEntry, entries: readonly ExtListEntry[]): DepsData {
  const commands = useCommands();
  const phase = useLinkPhase();
  const openReview = useOpenReview();
  const [read, setRead] = useState<Read | null | "failed">(null);
  const [pending, setPending] = useState<ReviewItem | null>(null);
  const [editedSinceSend, setEditedSinceSend] = useState(false);
  const [tick, setTick] = useState(0);
  const name = entry.name;

  const pluginUi = commands.pluginUi;
  const run = useCallback(
    <T>(work: (connection: HostConnection) => Promise<T>) => pluginUi.withConnection(work),
    [pluginUi],
  );

  const readAll = useCallback(async (): Promise<Read | "failed"> => {
    const got = await run((c) => c.request("plugin.get", { name }));
    if (!got.ok) return "failed";
    const card = got.value.card.dependencies ?? EMPTY;
    const source = got.value.source;
    const matchesReviewed = source?.matchesReviewed ?? true;
    if (source === null) {
      return { card, source: null, access: accessOf(entry, null, false), matchesReviewed };
    }
    const fromSource = await run((c) => c.request("ext.dependencies.read", { dir: source.path }));
    if (fromSource.ok) {
      return {
        card,
        source: fromSource.value.dependencies,
        access: accessOf(entry, source.path, false),
        matchesReviewed,
      };
    }
    return {
      card,
      source: null,
      access: accessOf(entry, source.path, isDenied(fromSource.error)),
      matchesReviewed,
    };
  }, [entry, name, run]);

  useEffect(() => {
    if (phase !== "live") return undefined;
    let live = true;
    const load = async (): Promise<void> => {
      const [deps, listed] = await Promise.all([readAll(), commands.pluginReview.list()]);
      if (!live) return;
      setRead(deps);
      setPending(listed.ok ? pendingItemOf(listed.value.items, name) : null);
    };
    detach(load(), rethrow);
    const off = commands.pluginReview.onChanged(() => {
      setTick((n) => n + 1);
    });
    return () => {
      live = false;
      off();
    };
  }, [commands, name, phase, readAll, tick]);

  const edit = useCallback(
    async (ops: readonly DependencyOp[]): Promise<DepsEditOutcome> => {
      if (read === null || read === "failed")
        return { ok: false, text: "desktop.craft.deps.load.failed" };
      if (read.access.kind !== "editable")
        return { ok: false, text: "desktop.craft.members.fail.denied" };
      const dir = read.access.dir;
      const done = await run((c) => c.request("ext.dependencies.edit", { dir, ops: [...ops] }));
      if (!done.ok) return { ok: false, text: depsEditFailureText(done.error) };
      setRead({ ...read, source: done.value.dependencies, matchesReviewed: false });
      setEditedSinceSend(true);
      setTick((n) => n + 1);
      return { ok: true };
    },
    [read, run],
  );

  const send = useCallback(async (): Promise<SendOutcome> => {
    if (read === null || read === "failed")
      return { ok: false, text: "desktop.craft.deps.load.failed" };
    if (read.access.kind !== "editable")
      return { ok: false, text: "desktop.craft.members.fail.denied" };
    const sent = await submitDirForReview(run, read.access.dir);
    if (!sent.ok) return sent;
    setEditedSinceSend(false);
    setTick((n) => n + 1);
    return sent;
  }, [read, run]);

  const load: DepsLoad =
    phase !== "live" && read === null
      ? { status: "offline" }
      : read === null
        ? { status: "loading" }
        : read === "failed"
          ? { status: "failed" }
          : { status: "ready", ...read, pending };

  return {
    load,
    name,
    members: entry.plugins.flatMap((p) => (p.id === undefined ? [] : [p.id])),
    entries,
    editedSinceSend,
    edit,
    send,
    openReview,
  };
}
