// 캔버스에서 끌어서 합치기, 의존으로 잇기, 떼기(cvMerge, AGE-72)의 순수 모델과 엔진 값 옮기기.
// 범위는 엔진 그대로다(사용자가 넣은, 외부 층의, 멤버 없는, 원본 폴더가 있는 플러그인끼리만 합친다). 묶음과 리뷰 대기 판의 값도 본다.
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { PluginCard } from "@fresnel/contracts/extensions";
import type { MemberInfo } from "@fresnel/contracts/services";
import type { CommonSet, Profile } from "@fresnel/contracts/wire";
import {
  canvasProfileOf,
  liveBundleOfCard,
  memberPluginOf,
  pluginOfCard,
  profileInputOf,
} from "../../../src/views/craft/canvas/cv6/live.ts";
import {
  defaultMergeName,
  detachRefusalOf,
  dropChoicesOf,
  linkFromRefusalOf,
  linkPartnersOf,
  linkToRefusalOf,
  memberPartsOf,
  mergePartnersOf,
  mergeRefusalOf,
  type MergeFacts,
} from "../../../src/views/craft/canvas/cv6/merge.ts";
import {
  addPlugin,
  bundleIdOfMember,
  inProfile,
  installLiveCatalog,
  installPending,
  installSampleCatalog,
  pendingItemOf,
  pendingNames,
  placedOf,
  withPending,
  type CanvasProfile,
  type Plugin,
} from "../../../src/views/craft/canvas/cv6/model.ts";
import { entry } from "../workbench/support.tsx";

function card(name: string, over: Partial<PluginCard> = {}): PluginCard {
  return {
    name,
    displayName: name,
    version: "1.0.0",
    purpose: `${name} purpose`,
    description: `${name} description`,
    does: {
      inject: null,
      hook: {
        hooks: [{ name: "guard.tool.before", fold: "chain", position: "tools.before", powers: [] }],
      },
      drive: null,
    },
    enforcement: "advisory",
    runs: { code: true, isolated: true },
    cost: { always: null, drive: null, onDemand: null, toolCount: null, basis: "unknown" },
    health: { state: "ok", lastActiveAt: null, lastError: null },
    origin: { kind: "user" },
    review: { state: "approved", currentHash: "abc123", pendingItemId: null, approvedAt: null },
    usedBy: [],
    ...over,
  };
}

function member(id: string, over: Partial<MemberInfo> = {}): MemberInfo {
  return {
    id,
    registrationId: `group/${id}`,
    title: null,
    layer: "plugin",
    hooks: [],
    drives: false,
    defaultEnabled: true,
    blockIds: [],
    injects: [],
    tools: [],
    ...over,
  };
}

const ALPHA = pluginOfCard(card("alpha"));
const BETA = pluginOfCard(card("beta"));
const CORE = pluginOfCard(
  card("files", { requiredByCore: ["cap-workspace"], origin: { kind: "builtin" } }),
);
const BUILT = pluginOfCard(card("guide", { origin: { kind: "builtin" } }));
const GROUP = pluginOfCard(card("group"));
const GROUP_MEMBERS: readonly Plugin[] = [
  memberPluginOf(GROUP, member("guard", { hooks: ["guard.tool.before"], title: "Guard" })),
  memberPluginOf(GROUP, member("lead", { drives: true })),
  memberPluginOf(GROUP, member("notes")),
];

const FACTS: MergeFacts = {
  entries: [
    entry("alpha", { layer: "plugin" }),
    entry("beta", { layer: "plugin" }),
    entry("gamma", { layer: "plugin" }),
    entry("nodir", { layer: "plugin" }),
    entry("layered", { layer: "L2" }),
    entry("files", { origin: "builtin", layer: "L1" }),
    entry("guide", { origin: "builtin", layer: "L3" }),
    entry("group", {
      layer: "plugin",
      isOrchestration: true,
      plugins: [
        { registrationId: "group", layer: "plugin", status: "enabled", inOrchestration: true },
        {
          registrationId: "group/guard",
          id: "guard",
          layer: "plugin",
          status: "enabled",
          inOrchestration: true,
        },
      ],
    }),
  ],
  sources: new Map([
    ["alpha", "/src/alpha"],
    ["beta", "/src/beta"],
    ["gamma", "/src/gamma"],
    ["layered", "/src/layered"],
    ["group", "/src/group"],
  ]),
};

const COMMON: CommonSet = { plugins: [], settings: [], updatedAt: "2026-11-23T00:00:00Z", rev: 1 };

const SAVED: Profile = {
  id: "default",
  title: "기본",
  builtin: true,
  plugins: [
    { name: "alpha" },
    { name: "beta" },
    { name: "group" },
    { name: "files" },
    { name: "guide" },
  ],
  settings: [],
  startDrive: null,
  updatedAt: "2026-11-23T00:00:00Z",
  rev: 4,
};

beforeEach(() => {
  installLiveCatalog([ALPHA, BETA, CORE, BUILT, GROUP], {
    members: GROUP_MEMBERS,
    bundles: [
      liveBundleOfCard(
        GROUP,
        GROUP_MEMBERS.map((p) => p.name),
      ),
    ],
  });
  installPending([]);
});
afterAll(() => {
  installSampleCatalog();
});

describe("멤버 판과 묶음(엔진 값)", () => {
  test("멤버 판의 이름은 Registration id이고 종류와 자리는 멤버의 선언에서 온다. 사람용 글은 플러그인 카드의 것이다", () => {
    expect(GROUP_MEMBERS.map((p) => [p.name, p.kind, p.anchor, p.meta.displayName])).toEqual([
      ["group/guard", "hook", "before:tools", "Guard"],
      ["group/lead", "drive", "drive", "lead"],
      ["group/notes", "inject", "feed:context", "notes"],
    ]);
    expect(GROUP_MEMBERS[0]?.meta.purposeText).toBe("group purpose");
    expect(GROUP_MEMBERS[0]?.meta.createdByBuilder).toBe(false);
  });

  test("프로필의 멤버 있는 플러그인은 묶음 하나로 서고, 저장 값에는 이름 하나로 돌아간다", () => {
    const canvas = canvasProfileOf(SAVED, COMMON);
    expect(canvas.entries).toEqual([
      { type: "plugin", name: "alpha" },
      { type: "plugin", name: "beta" },
      { type: "bundle", id: "group", members: ["group/guard", "group/lead", "group/notes"] },
      { type: "plugin", name: "files" },
      { type: "plugin", name: "guide" },
    ]);
    expect(
      placedOf(canvas)
        .filter((p) => p.source.type === "bundle")
        .map((p) => p.plugin.name),
    ).toEqual(["group/guard", "group/lead", "group/notes"]);
    expect(profileInputOf(canvas, SAVED).plugins.map((r) => r.name)).toEqual([
      "alpha",
      "beta",
      "group",
      "files",
      "guide",
    ]);
  });

  test("묶음 이름은 프로필에 든 것으로 보고, 목록에서 넣으면 묶음째 든다. 멤버 판에서 묶음을 찾는다", () => {
    const empty: CanvasProfile = { id: "x", base: [], entries: [], startDrive: null };
    expect(inProfile(canvasProfileOf(SAVED, COMMON), "group")).toBe(true);
    expect(addPlugin(empty, "group").entries).toEqual([
      { type: "bundle", id: "group", members: ["group/guard", "group/lead", "group/notes"] },
    ]);
    expect(bundleIdOfMember("group/lead")).toBe("group");
    expect(bundleIdOfMember("alpha")).toBe(null);
    expect(memberPartsOf("group/lead")).toEqual({ root: "group", member: "lead" });
  });
});

describe("합치기 범위(엔진 그대로)", () => {
  test("까닭: 사용자가 넣은 외부 층의 멤버 없는 플러그인이고 원본 폴더가 있을 때만 합친다", () => {
    expect(
      ["alpha", "nodir", "layered", "files", "guide", "group", "group/guard", "ghost"].map((n) => [
        n,
        mergeRefusalOf(n, FACTS),
      ]),
    ).toEqual([
      ["alpha", null],
      ["nodir", "noSource"],
      ["layered", "layer"],
      ["files", "core"],
      ["guide", "builtin"],
      ["group", "members"],
      ["group/guard", "member"],
      ["ghost", "unknown"],
    ]);
  });

  test("합칠 상대는 범위 안의 다른 플러그인이고, 범위 밖 플러그인은 상대가 없다", () => {
    expect(mergePartnersOf("alpha", FACTS).map((e) => e.name)).toEqual(["beta", "gamma"]);
    expect(mergePartnersOf("guide", FACTS)).toEqual([]);
  });

  test("새 이름 기본값은 `<놓인 것>-<끌어온 것>`이고 32자에서 자르며, 있는 이름이면 비운다", () => {
    expect(defaultMergeName("alpha", "beta", ["alpha", "beta"])).toBe("alpha-beta");
    expect(defaultMergeName("alpha", "beta", ["alpha-beta"])).toBe("");
    expect(defaultMergeName("a".repeat(20), "b".repeat(20), [])).toBe(
      `${"a".repeat(20)}-${"b".repeat(11)}`,
    );
  });
});

describe("의존으로 잇기와 떼기", () => {
  test("의존은 원본 폴더가 있는 쪽에서 건다. 대상은 설치된 플러그인이나 멤버이고 자기 자신과 자기 멤버는 아니다", () => {
    expect(linkFromRefusalOf("alpha", FACTS)).toBe(null);
    expect(linkFromRefusalOf("guide", FACTS)).toBe("builtin");
    expect(linkFromRefusalOf("nodir", FACTS)).toBe("noSource");
    expect(linkToRefusalOf("alpha", "guide", FACTS)).toBe(null);
    expect(linkToRefusalOf("alpha", "group/guard", FACTS)).toBe(null);
    expect(linkToRefusalOf("group", "group/guard", FACTS)).toBe("self");
    expect(linkToRefusalOf("alpha", "alpha", FACTS)).toBe("self");
    expect(linkPartnersOf("alpha", FACTS).map((e) => e.name)).toEqual([
      "beta",
      "gamma",
      "nodir",
      "layered",
      "files",
      "guide",
      "group",
    ]);
  });

  test("멤버 판은 묶음의 원본 폴더가 있어야 뗀다", () => {
    expect(detachRefusalOf("group/guard", FACTS)).toBe(null);
    expect(detachRefusalOf("group/guard", { entries: FACTS.entries, sources: new Map() })).toBe(
      "noSource",
    );
    expect(detachRefusalOf("alpha", FACTS)).toBe("unknown");
  });
});

describe("놓은 자리 고르기", () => {
  const profile = canvasProfileOf(SAVED, COMMON);

  test("범위 안끼리는 합치기와 의존이 되고, 같은 자리면 옮기기도 남는다", () => {
    expect(dropChoicesOf(profile, "alpha", "beta", FACTS)).toEqual({
      merge: true,
      link: true,
      reorder: true,
      refusal: null,
    });
  });

  test("앱에 든 플러그인은 놓을 자리가 아니고(같은 자리면 옮기기만), 앱에 든 것을 끌면 합치기도 의존도 안 된다", () => {
    expect(dropChoicesOf(profile, "alpha", "guide", FACTS)).toEqual({
      merge: false,
      link: false,
      reorder: true,
      refusal: "builtin",
    });
    const builtinDragged = dropChoicesOf(
      {
        ...profile,
        entries: [
          { type: "plugin", name: "guide" },
          { type: "plugin", name: "files" },
        ],
      },
      "guide",
      "files",
      FACTS,
    );
    expect(builtinDragged).toEqual({ merge: false, link: false, reorder: false, refusal: "core" });
  });
});

describe("리뷰 대기 판", () => {
  test("기다리는 결과는 이름으로 찾고 프로필 끝에 덧붙여 그린다. 설치된 이름은 끼우지 않는다", () => {
    const merged = pluginOfCard(card("alpha-beta"));
    installPending([
      { itemId: "rev_1", plugin: merged },
      { itemId: "rev_2", plugin: ALPHA },
    ]);
    expect(pendingNames()).toEqual(["alpha-beta"]);
    expect(pendingItemOf("alpha-beta")).toBe("rev_1");
    expect(pendingItemOf("alpha")).toBe(null);
    const profile = canvasProfileOf(SAVED, COMMON);
    const shown = withPending(profile, pendingNames());
    expect(shown.entries.at(-1)).toEqual({ type: "plugin", name: "alpha-beta" });
    expect(profileInputOf(profile, SAVED).plugins.map((r) => r.name)).not.toContain("alpha-beta");
    expect(mergeRefusalOf("alpha-beta", FACTS)).toBe("pending");
    expect(dropChoicesOf(shown, "alpha", "alpha-beta", FACTS).refusal).toBe("pending");
  });

  test("다시 읽은 카탈로그가 그 이름을 설치했으면(승인) 대기 판에서 빠진다", () => {
    installPending([{ itemId: "rev_1", plugin: pluginOfCard(card("alpha-beta")) }]);
    installLiveCatalog([ALPHA, BETA, pluginOfCard(card("alpha-beta"))]);
    expect(pendingNames()).toEqual([]);
  });

  test("훑는 폴더에 쓰인 결과가 승인 전에 목록에 카드로 서도 대기 판으로 남는다", () => {
    const merged = pluginOfCard(card("alpha-beta"));
    installLiveCatalog([ALPHA, BETA, merged], {
      members: [],
      bundles: [],
      unapproved: ["alpha-beta"],
    });
    installPending([
      { itemId: "rev_1", plugin: merged },
      { itemId: "rev_2", plugin: pluginOfCard(card("gamma")) },
    ]);
    expect(pendingNames()).toEqual(["alpha-beta", "gamma"]);
    installLiveCatalog([ALPHA, BETA, merged], {
      members: [],
      bundles: [],
      unapproved: ["alpha-beta"],
    });
    expect(pendingNames()).toEqual(["alpha-beta", "gamma"]);
    installLiveCatalog([ALPHA, BETA, merged]);
    expect(pendingNames()).toEqual(["gamma"]);
  });
});
