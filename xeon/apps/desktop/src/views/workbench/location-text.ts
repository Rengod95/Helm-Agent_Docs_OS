// 플러그인 상세 "개요"의 설치 위치 칸(AGE-77 S-09 라)의 순수 함수. 긴 내부 경로를 가운데 말줄임으로 줄이고,
// 폴더에서 열 수 있는 실제 경로인지 가른다(출처 글 `builtin`은 경로가 아니다).

import { shortenHome } from "../pages/settings/settings-file-paths.ts";

const ELLIPSIS = "…";

/** 설치 위치 칸에 보이는 글자 수 상한(글자 단위) */
export const LOCATION_LIMIT = 48;

/**
 * 글을 가운데 말줄임으로 `limit`자 안에 줄인다. 앞부분과 뒷부분을 남기고 가운데를 `…`로 잇는다.
 * 글자는 코드 점 단위로 센다(한글과 이모지가 잘리지 않는다). 이미 상한 안이면 그대로 돌려준다
 */
export function middleEllipsisOf(text: string, limit: number): string {
  const chars = Array.from(text);
  if (chars.length <= limit) return text;
  const keep = Math.max(0, limit - ELLIPSIS.length);
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${chars.slice(0, head).join("")}${ELLIPSIS}${chars.slice(chars.length - tail).join("")}`;
}

/** "폴더에서 보기"로 열 수 있는 위치: 절대 경로(`/`로 시작)만 그렇다. 출처 글(`builtin` 등)은 null이다 */
export function revealablePathOf(location: string): string | null {
  return location.startsWith("/") ? location : null;
}

/**
 * 설치 위치 칸에 보일 글(rerun3 T-04). 데이터 폴더 아래면 "Fresnel 데이터 폴더" 뒤에 상대 경로를 잇고(`<라벨>/config/…`),
 * 그 밖이면 홈을 `~`로 줄인다. 데이터 폴더 경로를 모르면(`dataDir` null) 홈 줄이기만 한다. 전체 경로는 제목 글에 둔다
 */
export function locationTextOf(
  location: string,
  dataDir: string | null,
  dataLabel: string,
): string {
  const root = dataDir === null ? "" : dataDir.replace(/\/+$/, "");
  if (root !== "" && location.startsWith(`${root}/`)) {
    return `${dataLabel}/${location.slice(root.length + 1)}`;
  }
  return shortenHome(location);
}
