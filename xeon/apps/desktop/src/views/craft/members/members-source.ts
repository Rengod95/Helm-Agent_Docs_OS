// 구성원 탭의 실제 원천(m6Mb). 엔진 호출만 하고 그리지 않는다.
// 읽기: `plugin.get`(원본 폴더와 승인본과의 일치) → 원본 폴더가 있으면 `ext.members.read`, 없거나 엔진이 거절하면 설치본 매니페스트(`ext.get`).
// 리뷰 대기: `pluginReview.list`에서 이 플러그인의 대기 항목. `pluginReview.changed`·`plugin.changed`가 오면 다시 읽는다.
// 쓰기: 편집 하나마다 `ext.members.edit { dir, ops }`(원본 폴더를 바로 고친다. 설치도 승인도 하지 않는다). "리뷰로 보내기"는
// `plugin.draft.create { dir }` 다음 `pluginReview.submitDraft { draftId }`다. 승인 전에는 승인본이 그대로 돈다.
import type { MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow, type Result } from "@fresnel/contracts";
import type { MemberInfo, MemberOp } from "@fresnel/contracts/services";
import type { ExtListEntry, HostConnection, ReviewItem } from "@fresnel/contracts/wire";
import { useCallback, useEffect, useState } from "react";
import { useLinkPhase } from "../../../state/engine/index.ts";
import { useShellActions } from "../../../state/shell/index.ts";
import { useCommands, type CommandError } from "../../commands.ts";
import { requestReviewItem } from "../review/review-pick.ts";
import {
  accessOf,
  editFailureText,
  isDenied,
  keptFilesOf,
  membersOfManifest,
  pendingItemOf,
  rootLayerOf,
  type MembersAccess,
  type MembersOrigin,
} from "./members-model.ts";

export type MembersLoad =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "offline" }
  | {
      readonly status: "ready";
      readonly members: readonly MemberInfo[];
      /** 목록이 원본 폴더에서 왔나, 설치본에서 왔나 */
      readonly origin: MembersOrigin;
      readonly access: MembersAccess;
      /** 원본 폴더가 지금 도는 승인본과 같은가. 원본 폴더가 없으면 참 */
      readonly matchesReviewed: boolean;
      readonly pending: ReviewItem | null;
    };

type EditOutcome =
  | { readonly ok: true; readonly kept: readonly string[] }
  | { readonly ok: false; readonly text: MessageId };

export type SendOutcome =
  | { readonly ok: true; readonly itemId: string }
  | { readonly ok: false; readonly text: MessageId };

/** 탭이 그리는 데 쓰는 값과 동작. 개발 빌드의 표본도 같은 모양을 준다 */
export interface MembersData {
  readonly load: MembersLoad;
  /** 뿌리 플러그인의 층(Drive 구성원을 더할 수 있는지 가른다) */
  readonly rootLayer: string | null;
  /** 뿌리 플러그인 이름. 구성원 이름과 겹치면 안 된다 */
  readonly rootName: string;
  /** 설치본 구성의 블록 제목 */
  readonly blockTitles: ReadonlyMap<string, string>;
  /** 이 화면에서 보낸 뒤 또 고쳤는가 */
  readonly editedSinceSend: boolean;
  readonly edit: (ops: readonly MemberOp[]) => Promise<EditOutcome>;
  readonly send: () => Promise<SendOutcome>;
  readonly openReview: (itemId: string) => void;
}

interface Read {
  readonly members: readonly MemberInfo[];
  readonly origin: MembersOrigin;
  readonly access: MembersAccess;
  readonly matchesReviewed: boolean;
}

/** 원본 폴더 하나로 드래프트를 만들어 리뷰에 낸다(`plugin.draft.create` 다음 `pluginReview.submitDraft`). 구성원, 의존, 떼기, 합치기가 같이 쓴다 */
export async function submitDirForReview(
  run: <T>(work: (connection: HostConnection) => Promise<T>) => Promise<Result<T, CommandError>>,
  dir: string,
): Promise<SendOutcome> {
  const sent = await run(async (c) => {
    const draft = await c.request("plugin.draft.create", { dir });
    const submitted = await c.request("pluginReview.submitDraft", { draftId: draft.draftId });
    return submitted.itemId;
  });
  return sent.ok
    ? { ok: true, itemId: sent.value }
    : { ok: false, text: sendFailureText(sent.error) };
}

/** 리뷰 화면을 열고 그 항목을 고른다 */
export function useOpenReview(): (itemId: string) => void {
  const shell = useShellActions();
  return useCallback(
    (itemId: string) => {
      requestReviewItem(itemId);
      shell.switchArea("workbench");
      shell.updatePlace({ screen: "craftReview", scroll: 0 });
    },
    [shell],
  );
}

function sendFailureText(error: CommandError): MessageId {
  switch (error.kind) {
    case "offline":
      return "desktop.craft.members.fail.offline";
    case "switching":
      return "desktop.craft.members.fail.switching";
    case "rejected":
    case "unsupported":
    case "locked":
    case "not_available":
    case "failed":
      return "desktop.craft.members.send.failed";
    default:
      return assertNever(error, "sendFailureText");
  }
}

export function useMembersSource(
  entry: ExtListEntry,
  manifest: Readonly<Record<string, unknown>> | null,
  blockTitles: ReadonlyMap<string, string>,
): MembersData {
  const commands = useCommands();
  const phase = useLinkPhase();
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
    const installed = manifest === null ? [] : membersOfManifest(name, manifest);
    const got = await run((c) => c.request("plugin.get", { name }));
    // 내장 부품처럼 `plugin.get`이 모르는 이름이면 설치본만 보인다(잠김)
    const source = got.ok ? got.value.source : null;
    const matchesReviewed = source?.matchesReviewed ?? true;
    if (source === null) {
      if (manifest === null) return "failed";
      return {
        members: installed,
        origin: "installed",
        access: accessOf(entry, null, false),
        matchesReviewed,
      };
    }
    const fromSource = await run((c) => c.request("ext.members.read", { dir: source.path }));
    if (fromSource.ok) {
      return {
        members: fromSource.value.members,
        origin: "source",
        access: accessOf(entry, source.path, false),
        matchesReviewed,
      };
    }
    if (manifest === null) return "failed";
    return {
      members: installed,
      origin: "installed",
      access: accessOf(entry, source.path, isDenied(fromSource.error)),
      matchesReviewed,
    };
  }, [entry, manifest, name, run]);

  useEffect(() => {
    if (phase !== "live") return undefined;
    let live = true;
    const load = async (): Promise<void> => {
      const [members, listed] = await Promise.all([readAll(), commands.pluginReview.list()]);
      if (!live) return;
      setRead(members);
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
    async (ops: readonly MemberOp[]): Promise<EditOutcome> => {
      if (read === null || read === "failed" || read.access.kind !== "editable") {
        return { ok: false, text: "desktop.craft.members.fail.denied" };
      }
      const dir = read.access.dir;
      const done = await run((c) => c.request("ext.members.edit", { dir, ops: [...ops] }));
      if (!done.ok) return { ok: false, text: editFailureText(done.error) };
      setRead({ ...read, members: done.value.members, matchesReviewed: false });
      setEditedSinceSend(true);
      // 원본과 승인본의 일치는 엔진이 다시 잰다
      setTick((n) => n + 1);
      return { ok: true, kept: keptFilesOf(done.value.issues) };
    },
    [read, run],
  );

  const send = useCallback(async (): Promise<SendOutcome> => {
    if (read === null || read === "failed" || read.access.kind !== "editable") {
      return { ok: false, text: "desktop.craft.members.fail.denied" };
    }
    const sent = await submitDirForReview(run, read.access.dir);
    if (!sent.ok) return sent;
    setEditedSinceSend(false);
    setTick((n) => n + 1);
    return sent;
  }, [read, run]);

  const openReview = useOpenReview();

  const load: MembersLoad =
    phase !== "live" && read === null
      ? { status: "offline" }
      : read === null
        ? { status: "loading" }
        : read === "failed"
          ? { status: "failed" }
          : { status: "ready", ...read, pending };

  return {
    load,
    rootLayer: rootLayerOf(entry),
    rootName: name,
    blockTitles,
    editedSinceSend,
    edit,
    send,
    openReview,
  };
}
