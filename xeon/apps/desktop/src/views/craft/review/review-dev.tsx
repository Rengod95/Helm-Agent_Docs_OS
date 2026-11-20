// 리뷰 화면의 배치 견주기와 표본 장면(개발 빌드만, `BUILD_CHECKS`). 셋째 판: 고르개를 창 왼쪽 아래 구석에서 화면 머리 오른쪽 끝의 작은
// 메뉴("표본 · <장면>")로 옮겼다. 왼쪽 아래는 옆 내비의 설정 줄과 아래쪽 띠에 묻혀 찾기 어려웠다. 빈 화면에도 "표본 장면 보기"가 있다.
// 배치 1(band)이 배포 판이다. 2(rail, 요약을 오른쪽 열 위로)와 3(stack, 한 열 = 좁은 창의 모습)은 고르지 않은 안이고 견주기로만 남긴다.
// 장면 "실제 엔진"은 실제 원천을 그대로 쓰고, 나머지는 `review-samples.ts`의 표본이다(결정도 표본 안에서만 바뀐다).
// 고른 값은 localStorage에 남는다(찍기 도구도 이 키를 미리 정한다). 키보드 1·2·3은 배치를 바꾼다(글자 입력 중 제외).
// 이 파일은 개발 빌드(`just desktop-ui dev`)에서만 화면에 실린다. 배포 빌드(`just desktop-ui`)로 묶은 앱에는 메뉴가 없다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, attempt, err, ok } from "@fresnel/contracts";
import type { ReviewDecision, ReviewItem } from "@fresnel/contracts/wire";
import { Button, Kbd, Menu, MenuGroup, MenuHeading, MenuItem, MenuSeparator } from "@caustic/react";
import { Check, ChevronDown, FlaskConical } from "@caustic/react/icons";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  manyItems,
  sampleFile,
  sampleItems,
  SAMPLE_INSTALLED,
  SAMPLE_PROFILES,
} from "./testing/review-samples.ts";
import type { ReviewData, ReviewLoad } from "./review-source.ts";
import type { DetailArrange } from "./review-detail.tsx";
import { missingByProfileOf } from "./review-model.ts";
import { ReviewView } from "./review-view.tsx";
import { HEADER_CONTROL_SIZE } from "../../shell/screen-header.tsx";

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

/** 표본의 "기본" 프로필은 이 기기에 없는 플러그인(helm)을 가리킨다: 넣을 곳 고르기와 승인 결과에 경고가 보인다 */
const SAMPLE_MISSING_BY_PROFILE = missingByProfileOf(SAMPLE_PROFILES, null, SAMPLE_INSTALLED);

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
              missing: SAMPLE_MISSING_BY_PROFILE,
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
      const missingPlugins = [
        ...new Set(appliedTo.flatMap((id) => SAMPLE_MISSING_BY_PROFILE.get(id) ?? [])),
      ];
      return Promise.resolve(
        ok({
          item: next,
          appliedTo,
          ...(missingPlugins.length === 0 ? {} : { missingPlugins }),
        }),
      );
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
  const pickScene = (value: Scene): void => {
    writeKey(SCENE_KEY, value);
    setScene(value);
  };
  const menu = (
    <Menu
      align="end"
      size="sm"
      trigger={
        <Button
          size={HEADER_CONTROL_SIZE}
          variant="ghost"
          data-review-switcher=""
          aria-label={`${t("desktop.craft.review.dev.menu")}: ${t(SCENE_WORD[scene])}`}
          iconStart={<FlaskConical />}
          iconEnd={<ChevronDown />}
          className="text-text-secondary"
        >
          {t("desktop.craft.review.dev.trigger", { scene: t(SCENE_WORD[scene]) })}
        </Button>
      }
    >
      <MenuGroup>
        <MenuHeading>{t("desktop.craft.review.dev.scene")}</MenuHeading>
        {SCENES.map((s) => (
          <MenuItem
            key={s}
            role="menuitemradio"
            selected={s === scene}
            icon={s === scene ? <Check /> : <span className="size-4" />}
            onSelect={() => {
              pickScene(s);
            }}
          >
            {t(SCENE_WORD[s])}
          </MenuItem>
        ))}
      </MenuGroup>
      <MenuSeparator />
      <MenuGroup>
        <MenuHeading>{t("desktop.craft.review.dev.pick")}</MenuHeading>
        {ARRANGES.map((a, index) => (
          <MenuItem
            key={a}
            role="menuitemradio"
            selected={a === arrange}
            icon={a === arrange ? <Check /> : <span className="size-4" />}
            end={<Kbd size="sm">{String(index + 1)}</Kbd>}
            onSelect={() => {
              choose(a);
            }}
          >
            {t(ARRANGE_WORD[a])}
          </MenuItem>
        ))}
      </MenuGroup>
    </Menu>
  );
  return (
    <div className="rv-root relative flex min-h-0 flex-1 flex-col">
      <ReviewView
        key={scene}
        data={data}
        arrange={arrange}
        dev={{
          menu,
          showSample: () => {
            pickScene("sample");
          },
        }}
      />
    </div>
  );
}
