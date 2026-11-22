// 멤버 떼기와 플러그인 합치기의 엔진 호출(m6Mb, AGE-33). 그리지 않는다.
// 떼기 `ext.members.detach`, 합치기 `ext.members.merge`가 새 폴더를 쓰면, 그 폴더로 드래프트를 만들어 리뷰에 낸다
// (`plugin.draft.create { dir: outDir }` 다음 `pluginReview.submitDraft`). 원본 폴더와 원래 플러그인은 그대로다.
// 리뷰로 내기가 실패해도 새 폴더는 이미 쓰였으므로 성공으로 돌려주고 그 실패를 따로 싣는다.
import type { MessageId } from "@fresnel/client/i18n";
import type { MembersDetachInput, MembersMergeInput } from "@fresnel/contracts/services";
import type { HostConnection } from "@fresnel/contracts/wire";
import { useCallback, useMemo } from "react";
import { useCommands } from "../../commands.ts";
import { submitDirForReview, useOpenReview } from "./members-source.ts";
import { splitFailureText, splitNotesOf, type SplitNote } from "./split-model.ts";

export type SplitOutcome =
  | {
      readonly ok: true;
      readonly name: string;
      readonly outDir: string;
      /** 리뷰 항목 id. 리뷰로 내지 못했으면 null이고 `sendFailed`가 그 까닭이다 */
      readonly itemId: string | null;
      readonly sendFailed: MessageId | null;
      readonly notes: readonly SplitNote[];
    }
  | { readonly ok: false; readonly text: MessageId };

export interface SplitActions {
  readonly detach: (input: MembersDetachInput) => Promise<SplitOutcome>;
  readonly merge: (input: MembersMergeInput) => Promise<SplitOutcome>;
  /** 플러그인마다 원본 폴더(`plugin.get`의 `source.path`). 원본 폴더가 없거나 읽지 못한 이름은 빠진다 */
  readonly sources: (names: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  readonly openReview: (itemId: string) => void;
}

export function useSplitActions(): SplitActions {
  const commands = useCommands();
  const openReview = useOpenReview();
  const pluginUi = commands.pluginUi;
  const run = useCallback(
    <T>(work: (connection: HostConnection) => Promise<T>) => pluginUi.withConnection(work),
    [pluginUi],
  );
  const finish = useCallback(
    async (
      written: { readonly name: string; readonly outDir: string },
      notes: readonly SplitNote[],
    ): Promise<SplitOutcome> => {
      const sent = await submitDirForReview(run, written.outDir);
      return {
        ok: true,
        name: written.name,
        outDir: written.outDir,
        itemId: sent.ok ? sent.itemId : null,
        sendFailed: sent.ok ? null : sent.text,
        notes,
      };
    },
    [run],
  );
  const detach = useCallback(
    async (input: MembersDetachInput): Promise<SplitOutcome> => {
      const done = await run((c) => c.request("ext.members.detach", input));
      if (!done.ok) return { ok: false, text: splitFailureText(done.error) };
      return finish(done.value, splitNotesOf(done.value.issues));
    },
    [finish, run],
  );
  const merge = useCallback(
    async (input: MembersMergeInput): Promise<SplitOutcome> => {
      const done = await run((c) =>
        c.request("ext.members.merge", { ...input, dirs: [...input.dirs] }),
      );
      if (!done.ok) return { ok: false, text: splitFailureText(done.error) };
      return finish(done.value, splitNotesOf(done.value.issues));
    },
    [finish, run],
  );
  const sources = useCallback(
    async (names: readonly string[]): Promise<ReadonlyMap<string, string>> => {
      const got = await Promise.all(
        names.map(async (name) => {
          const read = await run((c) => c.request("plugin.get", { name }));
          const path = read.ok ? (read.value.source?.path ?? null) : null;
          return [name, path] as const;
        }),
      );
      const out = new Map<string, string>();
      for (const [name, path] of got) if (path !== null) out.set(name, path);
      return out;
    },
    [run],
  );
  return useMemo(
    () => ({ detach, merge, sources, openReview }),
    [detach, merge, sources, openReview],
  );
}
