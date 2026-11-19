import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detach, rethrow, type Result } from "@fresnel/contracts";
import type {
  PluginReviewDecideResult,
  PluginReviewFileResult,
  Profile,
  ReviewDecision,
  ReviewItem,
} from "@fresnel/contracts/wire";
import { useCommands, type CommandError } from "../../commands.ts";
import { useLinkPhase } from "../../../state/engine/index.ts";

// 리뷰 화면의 원천. 실제 엔진(`pluginReview.list`, `profile.list`, `ext.list`)을 읽고 `pluginReview.changed`·`plugin.changed`가
// 오면 다시 읽는다. 개발 빌드의 표본(`review-samples.ts`)도 같은 모양(`ReviewData`)을 낸다: 화면은 둘을 가르지 않는다.

/** 읽기 상태. 준비되지 않은 데이터를 빈 목록으로 그리지 않는다(디자인 공통 규칙) */
export type ReviewLoad =
  | { readonly status: "loading" }
  | { readonly status: "offline" }
  /** 연결된 엔진에 `pluginReview.*`가 없다 */
  | { readonly status: "unsupported" }
  | { readonly status: "failed" }
  | {
      readonly status: "ready";
      readonly items: readonly ReviewItem[];
      readonly profiles: readonly Profile[];
      /** 관리자가 꺼 둔 플러그인 이름(`ext.list`의 `enabledSource: managed`) */
      readonly managedOff: ReadonlySet<string>;
      /** 읽은 뒤 연결이 끊겼다. 목록은 남기고 결정을 잠근다 */
      readonly offline: boolean;
    };

export interface ReviewData {
  readonly load: ReviewLoad;
  reload(): void;
  file(itemId: string, path: string): Promise<Result<PluginReviewFileResult, CommandError>>;
  decide(
    itemId: string,
    decision: ReviewDecision,
  ): Promise<Result<PluginReviewDecideResult, CommandError>>;
}

function failedLoad(error: CommandError): ReviewLoad {
  if (error.kind === "offline") return { status: "offline" };
  if (error.kind === "unsupported") return { status: "unsupported" };
  return { status: "failed" };
}

export function useReviewSource(): ReviewData {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [load, setLoad] = useState<ReviewLoad>({ status: "loading" });
  // 늦게 온 응답이 새 응답을 덮지 않게 차례 번호를 둔다
  const turn = useRef(0);

  const reload = useCallback((): void => {
    turn.current += 1;
    const mine = turn.current;
    const run = async (): Promise<void> => {
      const [listed, profiles, exts] = await Promise.all([
        commands.pluginReview.list(),
        commands.pluginReview.profiles(),
        commands.workbench.list(),
      ]);
      if (mine !== turn.current) return;
      if (!listed.ok) {
        setLoad(failedLoad(listed.error));
        return;
      }
      // 프로필과 관리 잠금은 덧붙임이다. 못 읽으면 고를 프로필이 없고(보관만) 잠금을 모를 뿐 목록은 보인다
      const managedOff = new Set(
        exts.ok
          ? exts.value
              .filter((entry) => entry.enabledSource === "managed")
              .map((entry) => entry.name)
          : [],
      );
      setLoad({
        status: "ready",
        items: listed.value.items,
        profiles: profiles.ok ? profiles.value.profiles : [],
        managedOff,
        offline: false,
      });
    };
    // 명령은 실패를 값으로 돌려준다. 그래도 던지면 화면은 실패 상태로 보이고 원인은 다시 던진다(TY-25)
    detach(run(), (cause) => {
      if (mine === turn.current) setLoad({ status: "failed" });
      rethrow(cause);
    });
  }, [commands]);

  // 처음과 연결이 다시 살아날 때 읽는다
  useEffect(() => {
    if (phase === "live") reload();
  }, [phase, reload]);

  useEffect(() => commands.pluginReview.onChanged(reload), [commands, phase, reload]);

  const live = phase === "live";
  const shown = useMemo(
    (): ReviewLoad =>
      load.status === "ready"
        ? { ...load, offline: !live }
        : !live && load.status === "loading"
          ? { status: "offline" }
          : load,
    [load, live],
  );

  // 본문 읽기와 결정은 명령에만 기대므로 그리기마다 새로 만들지 않는다(파일 읽기 효과가 다시 돌지 않게)
  const file = useCallback<ReviewData["file"]>(
    (itemId, path) => commands.pluginReview.file(itemId, path),
    [commands],
  );
  const decide = useCallback<ReviewData["decide"]>(
    (itemId, decision) => commands.pluginReview.decide(itemId, decision),
    [commands],
  );
  return useMemo(() => ({ load: shown, reload, file, decide }), [shown, reload, file, decide]);
}
