// 구성원 탭의 배치 견주기와 표본 장면(개발 빌드만, `BUILD_CHECKS`). 배포 빌드로 묶은 앱에는 이 파일이 실리지 않는다.
// 배치: 1 줄 목록(`list`, 배포 판), 2 목록과 자세히(`split`). 장면: 실제 엔진(기본), 구성원 넷, 구성원 열다섯, 잠긴 플러그인.
// 표본의 편집은 표본 안에서만 바뀐다(엔진에 보내지 않는다). 고른 값은 localStorage에 남는다(찍기 도구도 이 키를 미리 정한다).
import { t, type MessageId } from "@fresnel/client/i18n";
import { attempt, assertNever } from "@fresnel/contracts";
import type { MemberInfo, MemberOp } from "@fresnel/contracts/services";
import { Button, Menu, MenuGroup, MenuHeading, MenuItem, MenuSeparator } from "@caustic/react";
import { Check, ChevronDown, FlaskConical } from "@caustic/react/icons";
import { useState, type ReactNode } from "react";
import { movedOrder } from "./members-model.ts";
import type { MembersData } from "./members-source.ts";
import { MembersView, type MembersLayout } from "./members-view.tsx";

const LAYOUT_KEY = "fresnel.craft.members.layout";
const SCENE_KEY = "fresnel.craft.members.scene";
const LAYOUTS: readonly MembersLayout[] = ["list", "split"];
const LAYOUT_WORD: Readonly<Record<MembersLayout, MessageId>> = {
  list: "desktop.craft.members.dev.list",
  split: "desktop.craft.members.dev.split",
};
const SCENES = ["live", "four", "many", "locked"] as const;
type Scene = (typeof SCENES)[number];
const SCENE_WORD: Readonly<Record<Scene, MessageId>> = {
  live: "desktop.craft.members.dev.scene.live",
  four: "desktop.craft.members.dev.scene.four",
  many: "desktop.craft.members.dev.scene.many",
  locked: "desktop.craft.members.dev.scene.locked",
};

function readKey(key: string): string | null {
  const read = attempt(() => localStorage.getItem(key));
  return read.ok ? read.value : null;
}
function writeKey(key: string, value: string): void {
  attempt(() => {
    localStorage.setItem(key, value);
  });
}

function member(
  id: string,
  title: string | null,
  hooks: readonly string[],
  drives = false,
): MemberInfo {
  return {
    id,
    registrationId: `sample-kit/${id}`,
    title,
    layer: "L3",
    hooks,
    drives,
    defaultEnabled: false,
    blockIds: [],
  };
}

const FOUR: readonly MemberInfo[] = [
  member("guard", "Test guard", ["tool.call.before"]),
  member("tap", null, ["boundary.settle.after"]),
  { ...member("lead", "Plan lead", [], true), blockIds: ["plan"] },
  member("notes", "House notes", []),
];

const MANY_HOOKS: readonly (readonly string[])[] = [
  ["tool.call.before"],
  ["boundary.settle.after"],
  [],
  ["input.user.before"],
  ["request.model.after"],
  ["tool.result"],
  [],
];
const MANY: readonly MemberInfo[] = Array.from({ length: 15 }, (_, i) => {
  const hooks = MANY_HOOKS[i % MANY_HOOKS.length] ?? [];
  return member(
    `part-${String(i + 1).padStart(2, "0")}`,
    i % 3 === 0 ? `Part ${String(i + 1)}` : null,
    hooks,
    i === 2,
  );
});

const SAMPLE_BLOCKS: ReadonlyMap<string, string> = new Map([["plan", "Plan steps"]]);

/** 표본 안의 편집. 엔진의 규칙 가운데 순서와 이름만 흉내 낸다 */
function applied(members: readonly MemberInfo[], op: MemberOp): readonly MemberInfo[] {
  switch (op.kind) {
    case "add":
      return [
        ...members,
        member(
          op.id,
          op.title ?? null,
          op.mode === "hook" || op.mode === undefined ? ["boundary.settle.after"] : [],
          op.mode === "drive",
        ),
      ];
    case "rename":
      return members.map((m) => (m.id === op.id ? { ...m, id: op.to } : m));
    case "remove":
      return members.filter((m) => m.id !== op.id);
    case "move": {
      const from = members.findIndex((m) => m.id === op.id);
      return movedOrder(members, from, op.toIndex);
    }
    default:
      return assertNever(op, "sample member op");
  }
}

function useSample(scene: Scene, live: MembersData): MembersData {
  const seed = scene === "many" ? MANY : FOUR;
  const [store, setStore] = useState<{
    readonly scene: Scene;
    readonly members: readonly MemberInfo[];
    readonly edited: boolean;
  }>({ scene, members: seed, edited: false });
  const current = store.scene === scene ? store : { scene, members: seed, edited: false };
  if (scene === "live") return live;
  const locked = scene === "locked";
  return {
    load: {
      status: "ready",
      members: current.members,
      origin: locked ? "installed" : "source",
      access: locked
        ? { kind: "locked", reason: "noSource" }
        : { kind: "editable", dir: "/sample/kit" },
      matchesReviewed: !current.edited,
      pending: null,
    },
    rootLayer: "L3",
    rootName: "sample-kit",
    blockTitles: SAMPLE_BLOCKS,
    editedSinceSend: current.edited,
    edit: (ops) => {
      const next = ops.reduce(applied, current.members);
      const kept = ops.flatMap((op) => (op.kind === "remove" ? [`src/members/${op.id}.ts`] : []));
      setStore({ ...current, members: next, edited: true });
      return Promise.resolve({ ok: true, kept });
    },
    send: () => {
      setStore({ ...current, edited: false });
      return Promise.resolve({ ok: true, itemId: "sample-item" });
    },
    openReview: () => {},
  };
}

export function MembersDev(props: { readonly live: MembersData }): ReactNode {
  const [layout, setLayout] = useState<MembersLayout>(
    () => LAYOUTS.find((l) => l === readKey(LAYOUT_KEY)) ?? "list",
  );
  const [scene, setScene] = useState<Scene>(
    () => SCENES.find((s) => s === readKey(SCENE_KEY)) ?? "live",
  );
  const data = useSample(scene, props.live);
  return (
    <div className="grid max-w-200 gap-3">
      <div className="flex justify-end">
        <Menu
          align="end"
          size="sm"
          trigger={
            <Button
              size="xs"
              variant="ghost"
              data-members-switcher=""
              iconStart={<FlaskConical />}
              iconEnd={<ChevronDown />}
              className="text-text-secondary"
            >
              {t("desktop.craft.members.dev.trigger", {
                layout: t(LAYOUT_WORD[layout]),
                scene: t(SCENE_WORD[scene]),
              })}
            </Button>
          }
        >
          <MenuGroup>
            <MenuHeading>{t("desktop.craft.members.dev.layout")}</MenuHeading>
            {LAYOUTS.map((l) => (
              <MenuItem
                key={l}
                role="menuitemradio"
                selected={l === layout}
                icon={l === layout ? <Check /> : <span className="size-4" />}
                onSelect={() => {
                  writeKey(LAYOUT_KEY, l);
                  setLayout(l);
                }}
              >
                {t(LAYOUT_WORD[l])}
              </MenuItem>
            ))}
          </MenuGroup>
          <MenuSeparator />
          <MenuGroup>
            <MenuHeading>{t("desktop.craft.members.dev.scene")}</MenuHeading>
            {SCENES.map((s) => (
              <MenuItem
                key={s}
                role="menuitemradio"
                selected={s === scene}
                icon={s === scene ? <Check /> : <span className="size-4" />}
                onSelect={() => {
                  writeKey(SCENE_KEY, s);
                  setScene(s);
                }}
              >
                {t(SCENE_WORD[s])}
              </MenuItem>
            ))}
          </MenuGroup>
        </Menu>
      </div>
      <MembersView key={scene} data={data} layout={layout} />
    </div>
  );
}
