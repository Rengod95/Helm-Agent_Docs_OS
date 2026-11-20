// 리뷰 화면의 배치 견주기와 표본 장면(개발 빌드만, `BUILD_CHECKS`). 창 왼쪽 아래의 작은 칸: `1 │ 2 │ 3`과 장면 고르기.
// 배치 1(band)이 배포 판이다. 2(rail, 요약을 오른쪽 열 위로)와 3(stack, 한 열 = 좁은 창의 모습)은 고르지 않은 안이고 견주기로만 남긴다.
// 장면 "실제 엔진"은 실제 원천을 그대로 쓰고, 나머지는 `review-samples.ts`의 표본이다(결정도 표본 안에서만 바뀐다).
// 고른 값은 localStorage에 남는다(찍기 도구도 이 키를 미리 정한다). 키보드 1·2·3은 배치를 바꾼다(글자 입력 중 제외).
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, attempt, err, ok } from "@fresnel/contracts";
import type { ReviewDecision, ReviewItem } from "@fresnel/contracts/wire";
import { Select, SelectOption, SegmentedControl, SegmentedControlItem } from "@caustic/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { manyItems, sampleFile, sampleItems, SAMPLE_PROFILES } from "./testing/review-samples.ts";
import type { ReviewData, ReviewLoad } from "./review-source.ts";
import type { DetailArrange } from "./review-detail.tsx";
import { ReviewView } from "./review-view.tsx";

const ARRANGE_KEY = "fresnel.craft.review.arrange";
const ARRANGES: readonly DetailArrange[] = ["band", "rail", "stack"];
const ARRANGE_WORD: Readonly<Record<DetailArrange, MessageId>> = {
  band: "desktop.craft.review.dev.band",
  rail: "desktop.craft.review.dev.rail",
  stack: "desktop.craft.review.dev.stack",
};

function arrangeOf(value: string | null): DetailArrange {
  return ARRANGES.find((a) => a === value) ?? "band";
}
const SCENE_KEY = "fresnel.craft.review.scene";

const SCENES = [
  "live",
  "sample",
  "empty",
  "loading",
  "failed",
  "offline",
  "locked",
  "many",
] as const;
type Scene = (typeof SCENES)[number];

const SCENE_WORD: Readonly<Record<Scene, MessageId>> = {
  live: "desktop.craft.review.dev.scene.live",
  sample: "desktop.craft.review.dev.scene.sample",
  empty: "desktop.craft.review.dev.scene.empty",
  loading: "desktop.craft.review.dev.scene.loading",
  failed: "desktop.craft.review.dev.scene.failed",
  offline: "desktop.craft.review.dev.scene.offline",
  locked: "desktop.craft.review.dev.scene.locked",
  many: "desktop.craft.review.dev.scene.many",
};

function isScene(value: string | null): value is Scene {
  return SCENES.some((scene) => scene === value);
}

function readKey(key: string): string | null {
  const read = attempt(() => localStorage.getItem(key));
  return read.ok ? read.value : null;
}

function writeKey(key: string, value: string): void {
  // 저장이 막힌 창(개인 창, 미리 보기)에서는 이번 실행에만 남는다
  attempt(() => {
    localStorage.setItem(key, value);
  });
}

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable || target.closest("input, textarea, select, [role='textbox']") !== null
  );
}

/** 표본 안에서 결정을 흉내 낸다: 상태를 바꾸고 승인은 고른 프로필(갱신은 기본 프로필)에 넣은 것으로 본다 */
function decided(item: ReviewItem, decision: ReviewDecision): ReviewItem {
  const at = new Date().toISOString();
  switch (decision.kind) {
    case "approve":
      return { ...item, state: "approved", decidedAt: at };
    case "sendBack":
      return { ...item, state: "sent_back", decidedAt: at, reason: decision.reason };
    case "discard":
      return { ...item, state: "discarded", decidedAt: at };
    default:
      return assertNever(decision, "sample decision");
  }
}

const sampleFileOf: ReviewData["file"] = (itemId, path, side) => sampleFile(itemId, path, side);

function useSampleData(scene: Scene, live: ReviewData): ReviewData {
  const seed = useMemo(
    () => (scene === "many" ? manyItems() : scene === "empty" ? [] : sampleItems()),
    [scene],
  );
  // 표본 안의 결정은 장면마다 따로 둔다. 장면이 바뀌면 처음 표본으로 돌아간다
  const [store, setStore] = useState<{
    readonly scene: Scene;
    readonly items: readonly ReviewItem[];
  }>({ scene, items: seed });
  const items = store.scene === scene ? store.items : seed;
  if (scene === "live") return live;
  const load: ReviewLoad =
    scene === "loading"
      ? { status: "loading" }
      : scene === "failed"
        ? { status: "failed" }
        : scene === "offline"
          ? { status: "offline" }
          : {
              status: "ready",
              items,
              profiles: SAMPLE_PROFILES,
              managedOff: new Set(scene === "locked" ? items.map((i) => i.name) : []),
              offline: false,
            };
  return {
    load,
    reload: () => {},
    file: sampleFileOf,
    decide: (itemId, decision) => {
      const found = items.find((i) => i.itemId === itemId);
      if (found === undefined) return Promise.resolve(err({ kind: "rejected", code: 3651 }));
      const next = decided(found, decision);
      setStore({ scene, items: items.map((i) => (i.itemId === itemId ? next : i)) });
      const appliedTo =
        decision.kind !== "approve"
          ? []
          : found.kind === "update"
            ? ["default"]
            : [...decision.profileIds];
      return Promise.resolve(ok({ item: next, appliedTo }));
    },
  };
}

export function ReviewDev(props: { readonly live: ReviewData }): ReactNode {
  const [arrange, setArrange] = useState<DetailArrange>(() => arrangeOf(readKey(ARRANGE_KEY)));
  const [scene, setScene] = useState<Scene>(() => {
    const stored = readKey(SCENE_KEY);
    return isScene(stored) ? stored : "live";
  });
  const data = useSampleData(scene, props.live);
  const choose = (value: string): void => {
    const next = arrangeOf(value);
    writeKey(ARRANGE_KEY, next);
    setArrange(next);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat || typing(e.target)) return;
      const next = ARRANGES[Number(e.key) - 1];
      if (next === undefined) return;
      writeKey(ARRANGE_KEY, next);
      setArrange(next);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <div className="rv-root relative flex min-h-0 flex-1 flex-col">
      <ReviewView key={scene} data={data} arrange={arrange} />
      <div
        data-review-switcher=""
        className="fixed bottom-2 left-24 z-40 flex items-center gap-1 opacity-55 transition-opacity focus-within:opacity-100 hover:opacity-100"
      >
        <SegmentedControl
          size="xs"
          variant="ghost"
          aria-label={t("desktop.craft.review.dev.pick")}
          value={arrange}
          onValueChange={choose}
        >
          {ARRANGES.map((a, index) => (
            <SegmentedControlItem
              key={a}
              value={a}
              aria-label={t(ARRANGE_WORD[a])}
              title={`${t(ARRANGE_WORD[a])} · ${String(index + 1)}`}
              className="font-semibold tabular-nums"
            >
              {String(index + 1)}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <Select
          size="xs"
          variant="ghost"
          aria-label={t("desktop.craft.review.dev.scene")}
          value={scene}
          onValueChange={(value) => {
            if (!isScene(value)) return;
            writeKey(SCENE_KEY, value);
            setScene(value);
          }}
        >
          {SCENES.map((s) => (
            <SelectOption key={s} value={s}>
              {t(SCENE_WORD[s])}
            </SelectOption>
          ))}
        </Select>
      </div>
    </div>
  );
}
