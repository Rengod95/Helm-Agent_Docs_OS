// 크래프트 순수 모델의 타입과 거르기 규칙. 화면 문구는 두지 않는다: 이름과 설명은 엔진이 준 데이터이고, 문구는 화면이 id로 찾는다.
import { assertNever } from "@fresnel/contracts";

/** 지도 층. 외부 플러그인은 매니페스트에서 "plugin"이다 */
export type LayerKey = "L1" | "L2" | "L3" | "plugin";

/** 매니페스트 layer 값 그대로. 화면 이름표는 화면이 정한다 */
export const LAYER_CODE: Readonly<Record<LayerKey, string>> = {
  L1: "L1",
  L2: "L2",
  L3: "L3",
  plugin: "plugin",
};

/** 출처: 내장, 사용자가 설치, 프로젝트가 가져온 것 */
export type Origin = "builtin" | "user" | "project";

/** 플러그인이 넣어 주는 것의 종류(훅과 기능은 따로 있다) */
export type PieceKind = "skill" | "command" | "tool" | "mcp" | "agent" | "view";

export interface CanvasPiece {
  readonly kind: PieceKind;
  readonly name: string;
}

export interface CanvasHealth {
  /** 연속 실패 횟수 */
  readonly fails: number;
  /** 어느 훅에서 실패했나. ext.health에는 없어서 스냅샷 어댑터는 비운다 */
  readonly hook?: string;
  /** 엔진이 남긴 실패 사유(데이터다, 문구가 아니다) */
  readonly text: string;
  /** 실패 시각(엔진 표기) */
  readonly at: string;
  /** 연속 실패가 기준을 넘어 자동으로 꺼졌나 */
  readonly autoOff?: boolean;
  /** 자동 꺼짐 기준(연속 실패 수). ext.health에는 없어서 스냅샷 어댑터는 비운다 */
  readonly limit?: number;
}

export interface CanvasPlugin {
  /** 등록 id: 루트는 확장 이름, 그 밖은 "<확장>/<id>" */
  readonly id: string;
  readonly name: string;
  /** 한 줄 설명(엔진 데이터). 없으면 화면이 아무것도 보이지 않는다 */
  readonly role?: string;
  readonly layer: LayerKey;
  /** 그룹 id(= 확장 이름). 없으면 혼자 설치된 플러그인 */
  readonly group?: string;
  readonly origin: Origin;
  readonly version?: string;
  /** 선언한 훅 id들(정적 선언) */
  readonly hooks: readonly string[];
  readonly provides: readonly string[];
  readonly optional?: readonly string[];
  /** 꼭 있어야 하는 기능. 없으면 기능 대기다 */
  readonly requires?: readonly string[];
  readonly pieces: readonly CanvasPiece[];
  /** 주도를 선언했나(보유·경합의 대상) */
  readonly drives?: boolean;
  /** 남기는 기록 종류 */
  readonly records?: readonly string[];
  /** 읽는 기록 종류. 끝이 ".*"이면 앞부분으로 시작하는 것 전부다 */
  readonly reads?: readonly string[];
  /** 켜져 있나(전역 하나). 자동 꺼짐 여부는 isOn이 본다 */
  readonly on: boolean;
  readonly health?: CanvasHealth;
}

export interface CanvasGroup {
  readonly id: string;
  readonly name: string;
  readonly role?: string;
  readonly version: string;
  readonly origin: Origin;
  /** 구성원 플러그인 id들 */
  readonly members: readonly string[];
  /** 그룹이 쥔 공용 설정(엔진이 적은 값) */
  readonly config?: string;
}

export interface CanvasSnapshot {
  readonly plugins: readonly CanvasPlugin[];
  readonly groups: readonly CanvasGroup[];
}

/** 선택: 아무것도 아님(에이전트), 층, 플러그인, 그룹, 훅 줄, 내장 슬롯 */
export type Sel =
  | { readonly k: "agent" }
  | { readonly k: "layer"; readonly id: LayerKey }
  | { readonly k: "plugin"; readonly id: string }
  | { readonly k: "group"; readonly id: string }
  | { readonly k: "hook"; readonly id: string }
  | { readonly k: "builtin"; readonly slot: string };

export const sameSel = (a: Sel, b: Sel): boolean => {
  switch (a.k) {
    case "agent":
      return b.k === "agent";
    case "layer":
      return b.k === "layer" && b.id === a.id;
    case "plugin":
      return b.k === "plugin" && b.id === a.id;
    case "group":
      return b.k === "group" && b.id === a.id;
    case "hook":
      return b.k === "hook" && b.id === a.id;
    case "builtin":
      return b.k === "builtin" && b.slot === a.slot;
    default:
      return assertNever(a, "sameSel");
  }
};

/** 어떤 플러그인인가로 거르기. 넷은 겹치지 않는다(kindOf가 나눈다) */
export type KindFilter = "all" | "group" | "single" | "external";

/** 무엇을 넣어 주나로 거르기. 훅은 따로 센다 */
export type Contrib = "hook" | PieceKind;

/** 그룹에 속하면 그룹, 아니고 바깥 층이면 외부, 나머지는 혼자 설치된 것 */
export const kindOf = (p: CanvasPlugin): Exclude<KindFilter, "all"> => {
  if (p.group !== undefined) return "group";
  return p.layer === "plugin" ? "external" : "single";
};

export const matchesKind = (p: CanvasPlugin, k: KindFilter): boolean =>
  k === "all" || kindOf(p) === k;

export const hasContrib = (p: CanvasPlugin, c: Contrib): boolean => {
  if (c === "hook") return p.hooks.length > 0;
  return p.pieces.some((x) => x.kind === c);
};
