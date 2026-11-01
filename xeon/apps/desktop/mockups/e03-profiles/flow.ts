// e03 상태 기계(목업 전용): 프로필 관리(N-57). 프로필은 런타임 호스트 설정(profiles.json)에 있고 데스크톱·웹·앱이 같은 목록을 본다(결정 5).
// 저장은 baseRev 비교(profile.put { id, baseRev }, W-46). 다른 곳이 먼저 저장하면 "다른 곳에서 바뀜"과 다시 읽기·덮어쓰기.
// 다른 클라이언트의 저장은 profile.changed 이벤트로 와서 목록을 새로 그리고 토스트 하나를 띄운다.
import { L2, T } from "../_shell";
import type { After } from "../_chat-rt";

export interface Profile {
  id: string;
  title: string;
  enable: string[];
  disable: string[];
  settings: { key: string; value: string }[];
  driveGroup: string | null;
  rev: number;
  /** 마지막으로 저장한 곳과 때. */
  by: string;
  at: string;
}

/** 프로필을 쓰는 곳(지우기 확인에 보임). */
export interface Use {
  kind: "trial" | "context";
  label: string;
  note: string;
}

export const USES: Record<string, Use[]> = {
  explore: [
    { kind: "trial", label: "렌즈 5개로 넓히기", note: L2("실행 중", "running") },
    { kind: "trial", label: "렌즈 3개와 비교", note: L2("멈춤", "paused") },
    {
      kind: "context",
      label: L2(`${T.webClient} · build-box 창`, `${T.webClient} · build-box window`),
      note: L2("지금 이 프로필로 보는 중", "viewing by it now"),
    },
  ],
  quiet: [],
  "review-trial": [{ kind: "trial", label: "리뷰 다시 켜기 확인", note: L2("끝남", "finished") }],
};

export const BASE: Profile[] = [
  {
    id: "explore",
    title: "탐구 중심",
    enable: ["helm", "learning", "web-exa"],
    disable: ["review"],
    settings: [{ key: "ext.helm.maxLenses", value: "4" }],
    driveGroup: "helm",
    rev: 7,
    by: L2("이 창", "this window"),
    at: L2("어제", "yesterday"),
  },
  {
    id: "quiet",
    title: "조용히",
    enable: ["learning"],
    disable: ["helm", "review"],
    settings: [],
    driveGroup: null,
    rev: 3,
    by: L2(`${T.webClient} · build-box`, `${T.webClient} · build-box`),
    at: L2("3일 전", "3 days ago"),
  },
  {
    id: "review-trial",
    title: "review 시험",
    enable: ["review", "web-exa"],
    disable: [],
    settings: [{ key: "ext.review.strict", value: "true" }],
    driveGroup: "review",
    rev: 2,
    by: L2("이 창", "this window"),
    at: L2("지난주", "last week"),
  },
];

export type Dialog = "create" | "delete" | null;

export interface S {
  list: Profile[];
  sel: string | null;
  load: "ready" | "loading" | "offline" | "empty";
  dialog: Dialog;
  newName: string;
  renaming: string | null;
  renameText: string;
  /** 저장 중(profile.put). */
  saving: boolean;
  /** baseRev 충돌: 다른 곳이 저장한 판과 내 바꿈. */
  conflict: { id: string; mine: string; theirs: Profile } | null;
  /** 방금 다른 곳에서 바뀐 프로필(목록 표시). */
  fresh: string | null;
  menuFor: string | null;
  toast: {
    n: number;
    title: string;
    description?: string;
    tone: "neutral" | "success" | "danger";
  } | null;
}

export type A =
  | { t: "start" }
  | { t: "sel"; id: string }
  | { t: "createOpen" }
  | { t: "createName"; v: string }
  | { t: "create" }
  | { t: "renameStart"; id: string }
  | { t: "renameText"; v: string }
  | { t: "renameSave"; conflict?: boolean }
  | { t: "saved" }
  | { t: "conflict" }
  | { t: "reload" }
  | { t: "overwrite" }
  | { t: "duplicate"; id: string }
  | { t: "deleteAsk"; id: string }
  | { t: "delete" }
  | { t: "close" }
  | { t: "remote" }
  | { t: "menu"; id: string | null };

export function init(): S {
  return {
    list: BASE,
    sel: "explore",
    load: "ready",
    dialog: null,
    newName: "",
    renaming: null,
    renameText: "",
    saving: false,
    conflict: null,
    fresh: null,
    menuFor: null,
    toast: null,
  };
}

let n = 0;
const tst = (
  title: string,
  tone: "neutral" | "success" | "danger" = "neutral",
  description?: string,
) => {
  n += 1;
  return { n, title, tone, ...(description !== undefined ? { description } : {}) };
};

export function reduce(s: S, a: A): S {
  switch (a.t) {
    case "start":
      return s;
    case "sel":
      return { ...s, sel: a.id, renaming: null };
    case "createOpen":
      return { ...s, dialog: "create", newName: "" };
    case "createName":
      return { ...s, newName: a.v };
    case "create": {
      const id = "review-quiet";
      const p: Profile = {
        id,
        title: s.newName === "" ? L2("리뷰만 켜기", "Review only") : s.newName,
        enable: ["review"],
        disable: ["helm"],
        settings: [],
        driveGroup: null,
        rev: 1,
        by: L2("이 창", "this window"),
        at: L2("방금", "just now"),
      };
      return {
        ...s,
        list: [...s.list, p],
        sel: id,
        dialog: null,
        load: "ready",
        toast: tst(
          L2(`"${p.title}" ${T.profile}을 만들었어요`, `Created the "${p.title}" profile`),
          "success",
        ),
      };
    }
    case "renameStart": {
      const p = s.list.find((x) => x.id === a.id);
      return { ...s, sel: a.id, renaming: a.id, renameText: p?.title ?? "", menuFor: null };
    }
    case "renameText":
      return { ...s, renameText: a.v };
    case "renameSave":
      return { ...s, saving: true };
    case "saved":
      return {
        ...s,
        saving: false,
        renaming: null,
        list: s.list.map((p) =>
          p.id === s.renaming
            ? {
                ...p,
                title: s.renameText,
                rev: p.rev + 1,
                by: L2("이 창", "this window"),
                at: L2("방금", "just now"),
              }
            : p,
        ),
      };
    case "conflict": {
      const p = s.list.find((x) => x.id === s.renaming);
      if (p === undefined) return s;
      const theirs: Profile = {
        ...p,
        rev: p.rev + 1,
        settings: [{ key: "ext.helm.maxLenses", value: "6" }],
        enable: [...p.enable, "work"],
        by: L2(`${T.webClient} · build-box`, `${T.webClient} · build-box`),
        at: L2("1분 전", "1 min ago"),
      };
      return { ...s, saving: false, conflict: { id: p.id, mine: s.renameText, theirs } };
    }
    case "reload": {
      const c = s.conflict;
      if (c === null) return s;
      // 다시 읽기: 다른 곳의 판을 받고, 내 바꿈(이름)은 입력칸에 남겨 다시 저장할 수 있게 한다.
      return {
        ...s,
        conflict: null,
        list: s.list.map((p) => (p.id === c.id ? c.theirs : p)),
        renaming: c.id,
        renameText: c.mine,
        toast: tst(
          L2("다른 곳의 바뀐 내용을 읽었어요", "Loaded the changes from elsewhere"),
          "neutral",
          L2("이름은 아직 저장하지 않았어요", "Your new name isn't saved yet"),
        ),
      };
    }
    case "overwrite": {
      const c = s.conflict;
      if (c === null) return s;
      return {
        ...s,
        conflict: null,
        renaming: null,
        list: s.list.map((p) =>
          p.id === c.id
            ? {
                ...p,
                title: c.mine,
                rev: c.theirs.rev + 1,
                by: L2("이 창", "this window"),
                at: L2("방금", "just now"),
              }
            : p,
        ),
        toast: tst(
          L2("내 것으로 덮어썼어요", "Overwrote with your version"),
          "neutral",
          L2(`build-box에서 바꾼 2곳은 사라졌어요`, "The 2 changes made on build-box are gone"),
        ),
      };
    }
    case "duplicate": {
      const p = s.list.find((x) => x.id === a.id);
      if (p === undefined) return s;
      const copy: Profile = {
        ...p,
        id: `${p.id}-copy`,
        title: L2(`${p.title} 사본`, `${p.title} copy`),
        rev: 1,
        by: L2("이 창", "this window"),
        at: L2("방금", "just now"),
      };
      return {
        ...s,
        list: [...s.list, copy],
        sel: copy.id,
        menuFor: null,
        toast: tst(L2(`"${copy.title}"을 만들었어요`, `Created "${copy.title}"`), "success"),
      };
    }
    case "deleteAsk":
      return { ...s, sel: a.id, dialog: "delete", menuFor: null };
    case "delete": {
      const p = s.list.find((x) => x.id === s.sel);
      const rest = s.list.filter((x) => x.id !== s.sel);
      return {
        ...s,
        list: rest,
        sel: rest[0]?.id ?? null,
        dialog: null,
        load: rest.length === 0 ? "empty" : s.load,
        toast: tst(
          L2(`"${p?.title ?? ""}"을 지웠어요`, `Deleted "${p?.title ?? ""}"`),
          "neutral",
          L2(
            "시험 대화는 이미 적용한 값을 그대로 가져요",
            "Trial conversations keep the values already applied",
          ),
        ),
      };
    }
    case "close":
      return { ...s, dialog: null, conflict: null };
    case "remote":
      return {
        ...s,
        fresh: "quiet",
        list: s.list.map((p) =>
          p.id === "quiet"
            ? {
                ...p,
                enable: [...p.enable, "work"],
                rev: p.rev + 1,
                by: L2("앱 · iPhone", "app · iPhone"),
                at: L2("방금", "just now"),
              }
            : p,
        ),
        toast: tst(
          L2(`"조용히"가 다른 곳에서 바뀌었어요`, `"Quiet" changed elsewhere`),
          "neutral",
          L2("앱 · iPhone · rev 4", "app · iPhone · rev 4"),
        ),
      };
    case "menu":
      return { ...s, menuFor: a.id };
  }
}

export const SCRIPTS: Record<string, readonly A[]> = {
  base: [],
  "profile-crud": [
    { t: "createOpen" },
    { t: "createName", v: L2("리뷰만 켜기", "Review only") },
    { t: "create" },
    { t: "renameStart", id: "review-quiet" },
    { t: "renameText", v: L2("리뷰 조용히", "Quiet review") },
    { t: "renameSave" },
    { t: "saved" },
    { t: "duplicate", id: "review-quiet" },
    { t: "deleteAsk", id: "explore" },
    { t: "delete" },
  ],
  "profile-conflict": [
    { t: "renameStart", id: "explore" },
    { t: "renameText", v: L2("탐구 넓게", "Wide inquiry") },
    { t: "renameSave", conflict: true },
    { t: "conflict" },
    { t: "reload" },
  ],
  "profile-live": [{ t: "remote" }],
  menu: [{ t: "menu", id: "explore" }],
};

export function effect(a: A, _s: S, after: After<A>): void {
  if (a.t === "renameSave") after(700, a.conflict === true ? { t: "conflict" } : { t: "saved" });
  if (a.t === "start") after(2500, { t: "remote" });
}
