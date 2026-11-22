import { assertNever } from "@fresnel/contracts";
import type { ReactNode } from "react";
import { LINE_GLYPH } from "../illustrations/line-glyph.ts";
import type { ProfileLook } from "./profile-chip-model.ts";

// 프로필 아이콘(lcM6c, L4 desktop-ux §6.6.1). 프로필은 "이 대화에 쓸 플러그인 묶음과 권한 설정을 한 벌로 맞춘 구성"이라
// 기본 형태는 한 벌 상자다: 둥근 테두리 하나(한 벌) 안에 칸 셋(조각). 왼쪽 긴 칸은 흐름을 쥐는 자리(스타트 Drive)다.
// 상태는 다른 아이콘으로 갈아 끼우지 않고 같은 상자의 변주로 낸다:
// - ready: 칸 셋. start: 왼쪽 칸이 찬다(흐름을 쥐는 조각이 있다).
// - pending: 오른쪽 아래 조각이 상자 밖으로 빠져 있다(다음 단계에 끼워진다). changed: 그 조각이 제자리에 차 있다.
// - default: 고른 네 칸(손대지 않은 표준 한 벌). unsure: 칸이 보이지 않는 점선 테두리(무엇이 들었는지 모른다).
// - blocked: 왼쪽 칸이 금 간 채 찬다(스타트 Drive를 시작할 수 없다). 이것만 경고색이고 색은 부모가 준다.
// 16 격자에 선 1(caustic 24 격자의 1.5와 같은 굵기), 끝과 모서리 둥금, 좌표는 .5에 두어 16 px에서 화소 한 칸에 맞는다. 색은 currentColor.

const FRAME =
  "M5 2.5h6A2.5 2.5 0 0 1 13.5 5v6a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z";
const SPLIT = "M7.5 2.5v11";
const RIGHT_SPLIT = "M7.5 8.5h6";
/** 왼쪽 긴 칸(스타트 Drive 자리)을 채운 면 */
const LEAD = "M5 2.5h2.5v11H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z";
/** 금 간 왼쪽 칸: 45° 틈(폭 약 1.4)으로 나뉜 두 조각 */
const LEAD_CRACKED =
  "M5 2.5h2.5v2.7l-5 5V5A2.5 2.5 0 0 1 5 2.5zM7.5 7.2v6.3H5a2.5 2.5 0 0 1-2.21-1.35z";
/** 오른쪽 아래 칸을 채운 면(방금 끼워진 조각) */
const SEATED = "M7.5 8.5h6V11a2.5 2.5 0 0 1-2.5 2.5H7.5z";
/** 오른쪽 아래가 빈 테두리(조각이 빠진 상자) */
const FRAME_OPEN =
  "M13.5 6.5V5A2.5 2.5 0 0 0 11 2.5H5A2.5 2.5 0 0 0 2.5 5v6A2.5 2.5 0 0 0 5 13.5h2.5";

function partsOf(look: ProfileLook): ReactNode {
  switch (look) {
    case "ready":
      return <path d={`${FRAME}${SPLIT}${RIGHT_SPLIT}`} />;
    case "start":
      return (
        <>
          <path d={`${FRAME}${SPLIT}${RIGHT_SPLIT}`} />
          <path d={LEAD} fill="currentColor" />
        </>
      );
    case "pending":
      return (
        <>
          <path d={`${FRAME_OPEN}${SPLIT}M7.5 6.5h6`} />
          <rect data-part="loose" x="9.5" y="9.5" width="5" height="5" rx="1.25" />
        </>
      );
    case "changed":
      return (
        <>
          <path d={`${FRAME}${SPLIT}${RIGHT_SPLIT}`} />
          <path data-part="seated" d={SEATED} fill="currentColor" />
        </>
      );
    case "default":
      return <path d={`${FRAME}${SPLIT}M2.5 8.5h11`} />;
    case "unsure":
      return <path d={FRAME} strokeDasharray="2.2 2" />;
    case "blocked":
      return (
        <>
          <path d={`${FRAME}${SPLIT}${RIGHT_SPLIT}`} />
          <path d={LEAD_CRACKED} fill="currentColor" stroke="none" />
        </>
      );
    default:
      return assertNever(look, "ProfileLook");
  }
}

/**
 * 프로필 아이콘 하나. 칩은 16, 메뉴 줄은 20. 크기는 부모의 아이콘 크기 규칙보다 앞서도록 style로 준다.
 * 선은 직접 그린 아이콘의 한 벌(`LINE_GLYPH`, AGE-34): 20으로 커져도 화면 1px다(전에는 칸 1이라 20에서 1.25px)
 */
export function ProfileGlyph(props: {
  readonly look: ProfileLook;
  readonly size: 16 | 20;
  readonly className?: string;
}): ReactNode {
  const px = `${String(props.size)}px`;
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 16 16"
      {...LINE_GLYPH}
      data-profile-glyph={props.look}
      className={[LINE_GLYPH.className, "profile-glyph shrink-0", props.className ?? ""]
        .join(" ")
        .trim()}
      style={{ width: px, height: px }}
    >
      {partsOf(props.look)}
    </svg>
  );
}
