// 프로필 화면(C3) 왼쪽 패널의 새 프로필(+ 단추, pfMode2)과 ⋯ 메뉴의 복사, 이름 바꾸기, 지우기(craft-flows §6.10, pfCrud).
// 이름에서 id를 만드는 규칙과 저장 값은 순수 함수로, 엔진에 쓰고 다시 읽는 흐름은 메모리 안의 가짜 엔진으로 값을 비교한다.
import { beforeEach, describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { err, ok } from "@fresnel/contracts";
import { BLOCK_MODEL } from "@fresnel/contracts/blocks";
import type { PluginCard } from "@fresnel/contracts/extensions";
import {
  WIRE_ERRORS,
  type CommonSet,
  type Profile,
  type ProfileInput,
} from "@fresnel/contracts/wire";
import type { ProfileCanvasCommands } from "../../../src/views/commands.ts";
import {
  checkProfileTitle,
  newProfileInput,
  profileIdFrom,
  profileModeOf,
  renamedInput,
  withModeInput,
} from "../../../src/views/craft/canvas/cv6/live.ts";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { parseHTML } from "linkedom";
import { CommandsContext } from "../../../src/views/commands.ts";
import {
  ProfileHead,
  profileWriteErrorText,
  startTextOf,
} from "../../../src/views/craft/canvas/cv6/profile-menu.tsx";
import { fakeCommands as fakeViewCommands } from "../fake-commands.ts";
import {
  cloneProfile,
  createProfile,
  deleteProfile,
  renameProfile,
  setProfileMode,
  startLive,
  updateStore,
  type CanvasStore,
} from "../../../src/views/craft/canvas/cv6/store.ts";

function profile(id: string, over: Partial<Profile> = {}): Profile {
  return {
    id,
    title: id,
    builtin: id === "default",
    plugins: [],
    settings: [],
    startDrive: null,
    updatedAt: "2026-11-23T00:00:00.000Z",
    rev: 1,
    ...over,
  };
}

function card(name: string, over: Partial<PluginCard> = {}): PluginCard {
  return {
    name,
    displayName: name,
    version: "1.0.0",
    purpose: `${name} purpose`,
    does: { inject: null, hook: null, drive: null },
    enforcement: "advisory",
    runs: { code: false, isolated: null },
    cost: { always: null, drive: null, onDemand: null, toolCount: null, basis: "unknown" },
    health: { state: "ok", lastActiveAt: null, lastError: null },
    origin: { kind: "user" },
    review: { state: "approved", currentHash: null, pendingItemId: null, approvedAt: null },
    usedBy: [],
    ...over,
  };
}

describe("이름에서 id", () => {
  test("영문 소문자와 숫자만 남기고 나머지는 - 하나로 줄인다", () => {
    expect(profileIdFrom("My Review  Profile!", new Set())).toBe("my-review-profile");
  });

  test("글자로 시작하지 않거나 쓸 글자가 없으면 profile을 쓴다", () => {
    expect(profileIdFrom("리뷰용", new Set())).toBe("profile");
    expect(profileIdFrom("2nd", new Set())).toBe("profile");
  });

  test("겹치면 -2, -3을 붙이고 default와 craft는 늘 겹친 것으로 본다", () => {
    expect(profileIdFrom("Review", new Set(["review"]))).toBe("review-2");
    expect(profileIdFrom("Review", new Set(["review", "review-2"]))).toBe("review-3");
    expect(profileIdFrom("Default", new Set())).toBe("default-2");
    expect(profileIdFrom("craft", new Set())).toBe("craft-2");
  });

  test("계약의 id 모양(48자 이하, 글자로 시작)을 지킨다", () => {
    const long = "a".repeat(60);
    const first = profileIdFrom(long, new Set());
    expect(first).toBe("a".repeat(48));
    expect(profileIdFrom(long, new Set([first]))).toBe(`${"a".repeat(46)}-2`);
  });
});

describe("이름과 저장 값", () => {
  test("이름은 앞뒤 공백을 떼고 1~128자다", () => {
    expect(checkProfileTitle("  리뷰  ")).toBe("리뷰");
    expect(checkProfileTitle("   ")).toBeNull();
    expect(checkProfileTitle("a".repeat(129))).toBeNull();
    expect(checkProfileTitle("a".repeat(128))).toBe("a".repeat(128));
  });

  test("새 프로필에는 엔진이 필요로 하는 플러그인만 들고 설정과 시작 Drive는 비어 있다", () => {
    expect(newProfileInput("review", "리뷰", ["cap-workspace"])).toEqual({
      id: "review",
      title: "리뷰",
      plugins: [{ name: "cap-workspace" }],
      settings: [],
      startDrive: null,
    });
  });

  test("이름 바꾸기는 이름만 바꾼다", () => {
    const saved = profile("work", {
      plugins: [{ name: "helm" }],
      settings: [{ key: "l1.tools.permissionMode", value: "default" }],
      startDrive: "helm",
    });
    expect(renamedInput(saved, "일")).toEqual({
      id: "work",
      title: "일",
      plugins: [{ name: "helm" }],
      settings: [{ key: "l1.tools.permissionMode", value: "default" }],
      startDrive: "helm",
    });
  });
});

function rejected(code: number): { readonly kind: "rejected"; readonly code: number } {
  return { kind: "rejected", code };
}

describe("거절 글", () => {
  test("내장 프로필 보호와 상한은 그 까닭을 말한다", () => {
    expect(
      profileWriteErrorText(rejected(WIRE_ERRORS["profile.builtinProtected"].code), "delete"),
    ).toBe("desktop.craft.canvas.cv9.profileMenu.builtin");
    expect(profileWriteErrorText(rejected(WIRE_ERRORS["profile.limit"].code), "new")).toBe(
      "desktop.craft.canvas.cv9.profileMenu.error.limit",
    );
  });

  test("conflict는 만들기와 복사에서 id가 겹친 것이고, 이름 바꾸기에서는 그사이 바뀐 것이다", () => {
    const conflict = rejected(WIRE_ERRORS["profile.conflict"].code);
    expect(profileWriteErrorText(conflict, "new")).toBe(
      "desktop.craft.canvas.cv9.profileMenu.error.taken",
    );
    expect(profileWriteErrorText(conflict, "clone")).toBe(
      "desktop.craft.canvas.cv9.profileMenu.error.taken",
    );
    expect(profileWriteErrorText(conflict, "rename")).toBe(
      "desktop.compose.profile.error.conflict",
    );
  });

  test("연결이 없으면 연결 글이다", () => {
    expect(profileWriteErrorText({ kind: "offline" }, "delete")).toBe("desktop.compose.offline");
  });
});

/** 메모리 안의 엔진: `profile.list`, `profile.put`, `profile.clone`, `profile.delete`를 엔진 규칙대로 흉내 낸다 */
interface FakeEngine {
  profiles: Profile[];
  readonly calls: string[];
  readonly puts: { readonly input: ProfileInput; readonly baseRev: number | null }[];
  /** 이 프로필을 쓰는 열린 대화 수 */
  readonly threads: Readonly<Record<string, number>>;
}

const COMMON: CommonSet = {
  plugins: [{ name: "cap-dialog" }],
  settings: [],
  updatedAt: "2026-11-23T00:00:00.000Z",
  rev: 1,
};

function fakeCommands(engine: FakeEngine): ProfileCanvasCommands {
  const conflict = { kind: "rejected" as const, code: WIRE_ERRORS["profile.conflict"].code };
  return {
    profiles: () => {
      engine.calls.push("list");
      return Promise.resolve(ok({ profiles: engine.profiles, common: COMMON, rev: 1 }));
    },
    cards: () =>
      Promise.resolve(
        ok({
          plugins: [
            card("cap-workspace", { requiredByCore: ["core-tools"] }),
            card("cap-dialog"),
            card("helm"),
          ],
        }),
      ),
    blocks: () => Promise.resolve(ok(BLOCK_MODEL)),
    applied: () => Promise.resolve(err({ kind: "unsupported" })),
    preview: () => Promise.resolve(err({ kind: "unsupported" })),
    put: (input, baseRev) => {
      engine.calls.push(`put:${input.id}`);
      engine.puts.push({ input, baseRev });
      const existing = engine.profiles.find((p) => p.id === input.id);
      if ((existing?.rev ?? null) !== baseRev) return Promise.resolve(err(conflict));
      const stored = profile(input.id, { ...input, rev: (existing?.rev ?? 0) + 1 });
      engine.profiles =
        existing === undefined
          ? [...engine.profiles, stored]
          : engine.profiles.map((p) => (p.id === input.id ? stored : p));
      return Promise.resolve(ok({ profile: stored, issues: [] }));
    },
    clone: (params) => {
      engine.calls.push(`clone:${params.id}>${params.newId}`);
      const source = engine.profiles.find((p) => p.id === params.id);
      if (source === undefined || engine.profiles.some((p) => p.id === params.newId))
        return Promise.resolve(err(conflict));
      const copy = profile(params.newId, {
        title: params.title,
        plugins: source.plugins,
        settings: source.settings,
        startDrive: source.startDrive,
      });
      engine.profiles = [...engine.profiles, copy];
      return Promise.resolve(ok({ profile: copy }));
    },
    bypassAllowed: () => Promise.resolve(ok(true)),
    extensions: () => Promise.resolve(err({ kind: "unsupported" })),
    extension: () => Promise.resolve(err({ kind: "unsupported" })),
    plugin: () => Promise.resolve(err({ kind: "unsupported" })),
    pendingReviews: () => Promise.resolve(err({ kind: "unsupported" })),
    remove: (id) => {
      engine.calls.push(`delete:${id}`);
      if (id === "default" || id === "craft")
        return Promise.resolve(
          err({ kind: "rejected", code: WIRE_ERRORS["profile.builtinProtected"].code }),
        );
      engine.profiles = engine.profiles.filter((p) => p.id !== id);
      return Promise.resolve(ok({ rev: 2, reassignedThreads: engine.threads[id] ?? 0 }));
    },
  };
}

let engine: FakeEngine;
let commands: ProfileCanvasCommands;
let seen: CanvasStore;

/** 지금 상태를 읽는다(`updateStore`에 바꾸지 않는 함수를 넘긴다) */
function snapshot(): CanvasStore {
  updateStore((s) => {
    seen = s;
    return s;
  });
  return seen;
}

beforeEach(async () => {
  engine = {
    profiles: [
      profile("default", { title: "default", plugins: [{ name: "cap-workspace" }] }),
      profile("work", {
        title: "일",
        plugins: [{ name: "cap-workspace" }, { name: "helm" }],
        startDrive: "helm",
        rev: 3,
      }),
    ],
    calls: [],
    puts: [],
    threads: { work: 2 },
  };
  commands = fakeCommands(engine);
  updateStore((s) => ({ ...s, current: "work" }));
  await startLive(commands);
});

describe("메뉴의 쓰기", () => {
  test("새 프로필: 이름에서 id를 만들고 baseRev null로 쓴 뒤 그 프로필을 연다", async () => {
    const made = await createProfile(commands, "Review");
    expect(made).toEqual(ok("review"));
    expect(engine.puts.at(-1)).toEqual({
      input: {
        id: "review",
        title: "Review",
        plugins: [{ name: "cap-workspace" }],
        settings: [],
        startDrive: null,
      },
      baseRev: null,
    });
    const s = snapshot();
    expect(s.current).toBe("review");
    expect(s.order).toEqual(["default", "work", "review"]);
    // 빈 프로필에도 공통 묶음(베이스)과 엔진이 필요로 하는 플러그인이 보인다
    expect(s.profiles["review"]).toEqual({
      id: "review",
      base: ["cap-dialog"],
      entries: [{ type: "plugin", name: "cap-workspace" }],
      startDrive: null,
    });
  });

  test("새 프로필: 이름에서 나온 id가 있으면 번호를 붙인다", async () => {
    expect(await createProfile(commands, "Work")).toEqual(ok("work-2"));
  });

  test("복사: profile.clone으로 새 이름의 복사본을 만들고 연다", async () => {
    const made = await cloneProfile(commands, "work", "일 복사");
    expect(made).toEqual(ok("profile"));
    expect(engine.calls).toContain("clone:work>profile");
    const s = snapshot();
    expect(s.current).toBe("profile");
    expect(s.live?.saved["profile"]?.title).toBe("일 복사");
    expect(s.live?.saved["profile"]?.plugins).toEqual([
      { name: "cap-workspace" },
      { name: "helm" },
    ]);
    expect(s.live?.saved["profile"]?.startDrive).toBe("helm");
  });

  test("이름 입력의 처음 글: 복사는 보이는 이름으로 시작하고, 이름 고치기는 저장된 제목이다", () => {
    const shown = t("desktop.profileChip.defaultName");
    expect(startTextOf("clone", "default", shown)).toBe(
      t("desktop.craft.canvas.cv9.profileMenu.cloneTitle", { name: shown }),
    );
    expect(startTextOf("rename", "default", shown)).toBe("default");
    expect(startTextOf("new", "default", shown)).toBe("");
  });

  test("이름 바꾸기: 저장된 rev로 이름만 바꿔 쓴다", async () => {
    const done = await renameProfile(commands, "work", "업무");
    expect(done).toEqual(ok(null));
    expect(engine.puts.at(-1)).toEqual({
      input: {
        id: "work",
        title: "업무",
        plugins: [{ name: "cap-workspace" }, { name: "helm" }],
        settings: [],
        startDrive: "helm",
      },
      baseRev: 3,
    });
    expect(snapshot().live?.saved["work"]?.title).toBe("업무");
  });

  test("이름 바꾸기: 그사이 바뀌어 거절되면 오류를 돌려주고 목록을 다시 읽는다", async () => {
    engine.profiles = engine.profiles.map((p) => (p.id === "work" ? { ...p, rev: 9 } : p));
    const before = engine.calls.filter((c) => c === "list").length;
    const done = await renameProfile(commands, "work", "업무");
    expect(done).toEqual(err({ kind: "rejected", code: WIRE_ERRORS["profile.conflict"].code }));
    expect(engine.calls.filter((c) => c === "list").length).toBe(before + 1);
    expect(snapshot().live?.saved["work"]?.rev).toBe(9);
  });

  test("지우기: 쓰던 열린 대화 수를 돌려주고 기본 프로필을 연다", async () => {
    const done = await deleteProfile(commands, "work");
    expect(done).toEqual(ok(2));
    const s = snapshot();
    expect(s.current).toBe("default");
    expect(s.order).toEqual(["default"]);
  });

  test("지우기: 엔진이 기본 프로필을 거절하면 그 오류를 그대로 돌려주고 목록은 그대로다", async () => {
    const done = await deleteProfile(commands, "default");
    expect(done).toEqual(
      err({ kind: "rejected", code: WIRE_ERRORS["profile.builtinProtected"].code }),
    );
    expect(snapshot().order).toEqual(["default", "work"]);
    expect(snapshot().current).toBe("work");
  });
});

// 실행 방식(pfMode): 대화의 실행 방식은 프로필이 정하고, 값이 없으면 "모두 허용"이다 [결정: 2026-11-23 사용자, AGE-71 질문 3]
describe("프로필의 실행 방식", () => {
  const MODE = "l1.tools.permissionMode";

  test("값이 없으면 모두 허용, 프로필 값이 공통 묶음 값을 이기고, 엔진이 모르는 값은 null이다", () => {
    expect(profileModeOf(profile("work"), COMMON)).toBe("bypass");
    const shared: CommonSet = { ...COMMON, settings: [{ key: MODE, value: "acceptEdits" }] };
    expect(profileModeOf(profile("work"), shared)).toBe("acceptEdits");
    expect(
      profileModeOf(profile("work", { settings: [{ key: MODE, value: "default" }] }), shared),
    ).toBe("default");
    expect(
      profileModeOf(
        profile("work", {
          settings: [
            { key: MODE, value: "acceptEdits" },
            { key: MODE, value: "default" },
          ],
        }),
        COMMON,
      ),
    ).toBe("default");
    expect(
      profileModeOf(profile("work", { settings: [{ key: MODE, value: "plan" }] }), COMMON),
    ).toBeNull();
  });

  test("저장 값은 실행 방식 줄만 바꾸고 다른 설정과 이름, 플러그인, 시작 Drive는 그대로다", () => {
    const saved = profile("work", {
      title: "일",
      plugins: [{ name: "helm" }],
      settings: [
        { key: MODE, value: "bypass" },
        { key: "l1.loop.maxSteps", value: 5 },
      ],
      startDrive: "helm",
    });
    expect(withModeInput(saved, "default")).toEqual({
      id: "work",
      title: "일",
      plugins: [{ name: "helm" }],
      settings: [
        { key: "l1.loop.maxSteps", value: 5 },
        { key: MODE, value: "default" },
      ],
      startDrive: "helm",
    });
  });

  test("고르면 저장된 rev로 profile.put을 쓰고 새 값을 보이며, 기본 프로필도 바꿀 수 있다", async () => {
    expect(await setProfileMode(commands, "work", "acceptEdits")).toEqual(ok(null));
    expect(engine.puts.at(-1)).toEqual({
      input: {
        id: "work",
        title: "일",
        plugins: [{ name: "cap-workspace" }, { name: "helm" }],
        settings: [{ key: MODE, value: "acceptEdits" }],
        startDrive: "helm",
      },
      baseRev: 3,
    });
    const work = snapshot().live?.saved["work"];
    expect(work === undefined ? null : profileModeOf(work, COMMON)).toBe("acceptEdits");

    expect(await setProfileMode(commands, "default", "default")).toEqual(ok(null));
    expect(engine.puts.at(-1)?.input.settings).toEqual([{ key: MODE, value: "default" }]);
    expect(engine.puts.at(-1)?.baseRev).toBe(1);
  });

  test("거절되면 오류를 돌려주고 목록을 다시 읽어 저장된 값으로 돌아간다", async () => {
    // 그사이 다른 곳에서 고쳐 저장된 rev가 9다(실행 방식은 정하지 않았다)
    engine.profiles = [
      ...engine.profiles.filter((p) => p.id !== "work"),
      profile("work", {
        title: "일",
        plugins: [{ name: "cap-workspace" }, { name: "helm" }],
        startDrive: "helm",
        rev: 9,
      }),
    ];
    const done = await setProfileMode(commands, "work", "default");
    expect(done).toEqual(err({ kind: "rejected", code: WIRE_ERRORS["profile.conflict"].code }));
    const work = snapshot().live?.saved["work"];
    expect(work?.rev).toBe(9);
    expect(work === undefined ? null : profileModeOf(work, COMMON)).toBe("bypass");
  });
});

/** 엔진 목록을 읽은 뒤의 머리를 그린 문서 */
function head(): Document {
  const markup = renderToString(
    createElement(
      CommandsContext,
      { value: fakeViewCommands({ profileCanvas: commands }) },
      createElement(ProfileHead, {
        current: "work",
        choices: [
          { id: "default", title: "default" },
          { id: "work", title: "일" },
        ],
        onProfile: () => {},
      }),
    ),
  );
  return parseHTML(`<!doctype html><html><body>${markup}</body></html>`).document;
}

describe("프로필 머리의 + 단추 (pfMode2, AGE-71)", () => {
  test("고르기, +, ⋯ 순서로 한 줄에 서고 셋 다 높이 control-md다", () => {
    const row = head().querySelector("div > div");
    // 보이는 단추만 본다(고르기 옆의 숨은 기본 select는 뺀다)
    const buttons = [...(row?.children ?? [])].filter((el) => el.tagName === "BUTTON");
    expect(
      buttons.map((el) => ({
        slot: el.getAttribute("data-slot"),
        label: el.getAttribute("aria-label"),
        isNew: el.hasAttribute("data-profile-new"),
        // 데스크톱 밀도에서 field-md와 control-md는 둘 다 32다
        md: el.className.split(" ").some((c) => c === "size-control-md" || c === "h-field-md"),
      })),
    ).toEqual([
      { slot: "select-trigger", label: "프로필", isNew: false, md: true },
      { slot: "tooltip-trigger", label: "새 프로필", isNew: true, md: true },
      { slot: "icon-button", label: "프로필 메뉴: 일", isNew: false, md: true },
    ]);
    expect(row?.className).toBe("flex items-center gap-1");
  });
});
