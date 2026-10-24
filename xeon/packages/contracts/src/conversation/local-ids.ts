import { ID_LENGTH, ULID_PATTERN, type IdPrefix } from "./ids.ts";

/** 도메인 지역 ID 접두. 세 글자 소문자. IdPrefix 8종과 "sto"는 쓸 수 없다 */
export const LOCAL_ID_PREFIX_PATTERN: string = "^[a-z]{3}$";

export const RESERVED_ID_PREFIXES: readonly (IdPrefix | "sto")[] = [
  "thr",
  "trn",
  "stp",
  "itm",
  "prt",
  "evt",
  "efx",
  "ckp",
  "sto",
];

export type LocalIdPrefix =
  | "art"
  | "rvw"
  | "cmt"
  | "hof" // L2.artifacts
  | "lop"
  | "wak"
  | "tmr"
  | "wch" // L2.schedule
  | "wcl"
  | "wbr"
  | "wrs" // L2.web: 호출, 브라우저, 결과
  | "knl"
  | "knp" // L2.knowledge: 원장, 제안
  | "bgp" // L0.process: 백그라운드 프로세스
  | "sls"; // L0.secrets: 비밀 임대

/** 등록된 지역 접두와 소유 문서. 새 접두는 이 표에 행을 더해서만 쓴다(데이터 상수) */
export const LOCAL_ID_PREFIXES: Readonly<Record<LocalIdPrefix, { readonly owner: string }>> = {
  art: { owner: "L2.artifacts" },
  rvw: { owner: "L2.artifacts" },
  cmt: { owner: "L2.artifacts" },
  hof: { owner: "L2.artifacts" },
  lop: { owner: "L2.schedule" },
  wak: { owner: "L2.schedule" },
  tmr: { owner: "L2.schedule" },
  wch: { owner: "L2.schedule" },
  wcl: { owner: "L2.web" },
  wbr: { owner: "L2.web" },
  wrs: { owner: "L2.web" },
  knl: { owner: "L2.knowledge" },
  knp: { owner: "L2.knowledge" },
  bgp: { owner: "L0.process" },
  sls: { owner: "L0.secrets" },
};

/** 지역 ID는 브랜드를 두지 않는다. 브랜드가 필요하면 소유 문서가 Brand<LocalId<P>, "...">로 감싼다. */
export type LocalId<P extends LocalIdPrefix> = `${P}_${string}`;

export function localIdPattern(prefix: LocalIdPrefix): string {
  return `^${prefix}_${ULID_PATTERN}$`;
}

export function isLocalId<P extends LocalIdPrefix>(prefix: P, value: unknown): value is LocalId<P> {
  return (
    typeof value === "string" &&
    value.length === ID_LENGTH &&
    new RegExp(localIdPattern(prefix)).test(value)
  );
}

/** 발급 인터페이스. 구현은 F 밖(platform-os의 createLocalIdFactory) */
export interface LocalIdFactory {
  next<P extends LocalIdPrefix>(prefix: P): LocalId<P>;
}
