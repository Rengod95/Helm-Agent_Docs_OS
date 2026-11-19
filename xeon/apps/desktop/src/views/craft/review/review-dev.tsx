// 리뷰 화면의 판 전환기와 표본 장면(개발 빌드만, `BUILD_CHECKS`). 창 왼쪽 아래의 작은 칸: `가 │ 나`와 장면 고르기.
// 장면 "실제 엔진"은 실제 원천을 그대로 쓰고, 나머지는 `review-samples.ts`의 표본이다(결정도 표본 안에서만 바뀐다).
// 고른 값은 localStorage에 남는다(찍기 도구도 이 키를 미리 정한다). 키보드 1·2는 판을 바꾼다(글자 입력 중 제외).
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, attempt, err, ok } from "@fresnel/contracts";
import type { ReviewDecision, ReviewItem } from "@fresnel/contracts/wire";
import { Select, SelectOption, SegmentedControl, SegmentedControlItem } from "@caustic/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { manyItems, sampleFile, sampleItems, SAMPLE_PROFILES } from "./testing/review-samples.ts";
import type { ReviewData, ReviewLoad } from "./review-source.ts";
import { ReviewView, type ReviewLayout } from "./review-view.tsx";

const LAYOUT_KEY = "fresnel.craft.review.layout";
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

const sampleFileOf: ReviewData["file"] = (itemId, path) => sampleFile(itemId, path);

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
  const [layout, setLayout] = useState<ReviewLayout>(() =>
    readKey(LAYOUT_KEY) === "cards" ? "cards" : "split",
  );
  const [scene, setScene] = useState<Scene>(() => {
    const stored = readKey(SCENE_KEY);
    return isScene(stored) ? stored : "live";
  });
  const data = useSampleData(scene, props.live);
  const chooseLayout = (value: string): void => {
    const next: ReviewLayout = value === "cards" ? "cards" : "split";
    writeKey(LAYOUT_KEY, next);
    setLayout(next);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat || typing(e.target)) return;
      if (e.key !== "1" && e.key !== "2") return;
      const next: ReviewLayout = e.key === "1" ? "split" : "cards";
      writeKey(LAYOUT_KEY, next);
      setLayout(next);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <div className="rv-root relative flex min-h-0 flex-1 flex-col">
      <ReviewView key={`${scene}:${layout}`} data={data} layout={layout} />
      <div
        data-review-switcher=""
        className="fixed bottom-2 left-24 z-40 flex items-center gap-1 opacity-55 transition-opacity focus-within:opacity-100 hover:opacity-100"
      >
        <SegmentedControl
          size="xs"
          variant="ghost"
          aria-label={t("desktop.craft.review.dev.pick")}
          value={layout}
          onValueChange={chooseLayout}
        >
          <SegmentedControlItem
            value="split"
            aria-label={t("desktop.craft.review.dev.a")}
            title={`${t("desktop.craft.review.dev.a")} · 1`}
            className="font-semibold"
          >
            {t("desktop.craft.review.dev.aShort")}
          </SegmentedControlItem>
          <SegmentedControlItem
            value="cards"
            aria-label={t("desktop.craft.review.dev.b")}
            title={`${t("desktop.craft.review.dev.b")} · 2`}
            className="font-semibold"
          >
            {t("desktop.craft.review.dev.bShort")}
          </SegmentedControlItem>
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
