// P-13 확장 목록의 켜는 범위와 대기(N-35), X 훅 행(N-36) 상태 기계(목업 전용).
// spec §6.23(켜기·끄기는 settings.set { key: "ext.<이름>.enabled", scope }, 이 대화만은 scope "session"),
// §6.21(맥락이 프로필이면 프로필 고치기, 테스트이면 그 테스트 대화의 session 범위에만), X.loading-trust §4.8(requires 미충족 = 기능 대기),
// 결정 12(안전 모드에서는 X 훅도 싣지 않음).
import type { After } from "../_chat-rt";
import { extJ, extName, josa, T } from "../_shell";

export type Scope = "session" | "project" | "user";
export type RowState = "on" | "off" | "pending" | "capwait" | "managed" | "auto" | "exempt";

export interface Row {
  id: string;
  layer: "L0" | "L1" | "L2" | "L3" | "plugin" | "X";
  kind: string;
  ops: string;
  state: RowState;
  scope?: Scope;
  failures?: number;
  /** 기능 대기: 없는 기능 */
  needs?: string;
  /** X 훅: 이벤트·p50 */
  hook?: { event: string; p50: string; failures: number };
  /** 바깥(user·project) 확장인가: 안전 모드에서 빠짐 */
  external: boolean;
}

export const ROWS: Row[] = [
  {
    id: "helm",
    layer: "L3",
    kind: T.group,
    ops: "on 6 · post · drive",
    state: "on",
    scope: "user",
    external: true,
  },
  {
    id: "learning",
    layer: "L3",
    kind: T.group,
    ops: "on 3 · post",
    state: "on",
    scope: "user",
    external: false,
  },
  {
    id: "review",
    layer: "L3",
    kind: T.group,
    ops: "on 2 · drive",
    state: "auto",
    failures: 5,
    external: true,
  },
  {
    id: "authoring",
    layer: "L3",
    kind: T.group,
    ops: "on 2 · drive",
    state: "managed",
    external: false,
  },
  {
    id: "web-exa",
    layer: "L2",
    kind: T.plugin,
    ops: "on 1",
    state: "on",
    scope: "user",
    external: true,
  },
  {
    id: "work",
    layer: "L2",
    kind: T.plugin,
    ops: "on 2 · post",
    state: "on",
    scope: "user",
    external: false,
  },
  {
    id: "acme-notes",
    layer: "plugin",
    kind: T.plugin,
    ops: "on 1",
    state: "off",
    failures: 2,
    external: true,
  },
  {
    id: "provider-oauth",
    layer: "plugin",
    kind: T.plugin,
    ops: "on 1",
    state: "off",
    needs: "secrets.oauth",
    external: true,
  },
  { id: "core-loop", layer: "L1", kind: "core", ops: "", state: "exempt", external: false },
  {
    id: "pre-commit-lint",
    layer: "X",
    kind: `X ${T.hook}`,
    ops: "",
    state: "on",
    scope: "user",
    hook: { event: "tool.call.before", p50: "240ms", failures: 0 },
    external: true,
  },
  {
    id: "audit-log",
    layer: "X",
    kind: `X ${T.hook}`,
    ops: "",
    state: "on",
    scope: "project",
    hook: { event: "session.end", p50: "35ms", failures: 3 },
    external: true,
  },
];

export interface S {
  script: string;
  rows: Row[];
  /** 범위 고르기 팝오버가 열린 행 */
  picking: string | null;
  scope: Scope;
  /** 관리 잠금 툴팁을 연 행 */
  lockTip: string | null;
  note: {
    id: number;
    title: string;
    body?: string;
    tone?: "neutral" | "success" | "warning" | "danger";
  } | null;
}

export type A =
  | { t: "pick"; id: string }
  | { t: "scope"; scope: Scope }
  | { t: "closePick" }
  | { t: "apply" }
  | { t: "boundary"; id: string }
  | { t: "lockTip"; id: string | null }
  | { t: "toggleOff"; id: string }
  | { t: "profileToggle"; id: string };

export const init = (script: string): S => ({
  script,
  rows: ROWS,
  picking: null,
  scope: "session",
  lockTip: null,
  note: null,
});

const note = (
  s: S,
  title: string,
  body?: string,
  tone?: NonNullable<S["note"]>["tone"],
): S["note"] => ({
  id: (s.note?.id ?? 0) + 1,
  title,
  ...(body !== undefined ? { body } : {}),
  ...(tone !== undefined ? { tone } : {}),
});

const set = (s: S, id: string, patch: Partial<Row>): Row[] =>
  s.rows.map((r) => (r.id === id ? { ...r, ...patch } : r));

export const SCOPE_WORD: Record<Scope, string> = {
  session: `이 ${T.thread}만`,
  project: "이 프로젝트",
  user: "사용자 전체",
};

export function reduce(s: S, a: A): S {
  switch (a.t) {
    case "pick":
      return { ...s, picking: a.id, scope: "session", lockTip: null };
    case "scope":
      return { ...s, scope: a.scope };
    case "closePick":
      return { ...s, picking: null };
    case "apply": {
      const id = s.picking;
      if (id === null) return s;
      const row = s.rows.find((r) => r.id === id);
      if (row?.needs !== undefined)
        return {
          ...s,
          picking: null,
          rows: set(s, id, { state: "capwait", scope: s.scope }),
          note: note(
            s,
            `${extJ(id, "을", "를")} 켜지 못했어요`,
            `필요한 ${T.capability} ${josa(row.needs, "이", "가")} 없어 기다려요`,
            "warning",
          ),
        };
      return { ...s, picking: null, rows: set(s, id, { state: "pending", scope: s.scope }) };
    }
    case "boundary": {
      const row = s.rows.find((r) => r.id === a.id);
      if (row?.state !== "pending") return s;
      return {
        ...s,
        rows: set(s, a.id, { state: "on" }),
        note: note(
          s,
          `${extJ(a.id, "을", "를")} 켰어요`,
          `${SCOPE_WORD[row.scope ?? "session"]} · 단계 사이에서 적용했어요`,
          "success",
        ),
      };
    }
    case "lockTip":
      return { ...s, lockTip: a.id };
    case "toggleOff":
      return {
        ...s,
        rows: set(s, a.id, { state: "off" }),
        note: note(s, `${extJ(a.id, "을", "를")} 껐어요`, undefined, "neutral"),
      };
    case "profileToggle": {
      const row = s.rows.find((r) => r.id === a.id);
      const on = row?.state === "on";
      return {
        ...s,
        rows: set(s, a.id, { state: on ? "off" : "on" }),
        note: note(
          s,
          `${josa(T.profile, "을", "를")} 고쳤어요`,
          `탐구 중심 · ${extName(a.id)} ${on ? "끔" : "켬"}`,
          "neutral",
        ),
      };
    }
  }
}

export function effect(a: A, n: S, after: After<A>) {
  if (a.t === "apply") {
    const pending = n.rows.find((r) => r.state === "pending");
    if (pending !== undefined) after(2600, { t: "boundary", id: pending.id });
  }
}

export const SCRIPTS: Record<string, readonly A[]> = {
  // 이 대화만 켜기 → 다음 단계 사이 기다림 → 적용
  "enable-scope": [
    { t: "pick", id: "acme-notes" },
    { t: "scope", scope: "session" },
    { t: "apply" },
    { t: "boundary", id: "acme-notes" },
  ],
  // 실패: 필요한 기능이 없어 기다림
  "enable-capwait": [{ t: "pick", id: "provider-oauth" }, { t: "apply" }],
  // 실패: 관리 정책으로 잠김
  "enable-managed": [{ t: "lockTip", id: "authoring" }],
  base: [],
};
