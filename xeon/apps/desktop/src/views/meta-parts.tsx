import { Fragment, type ReactNode } from "react";

/**
 * 한 줄 메타의 조각들("12단계", "1분 4초", …). 조각 사이에 구분 글자를 두지 않는다: 부르는 쪽 flex 컨테이너의 간격 토큰(gap)이
 * 조각을 띄운다(가운뎃점 금지, desktop-ux spec §13.0 DP-226). 조각 사이 빈칸은 복사와 시험이 읽는 글이고, flex 안에서는 그려지지 않는다
 */
export function MetaParts(props: {
  readonly parts: readonly string[];
  readonly className?: string | undefined;
}): ReactNode {
  const seen = new Map<string, number>();
  let first = true;
  return props.parts.map((part) => {
    const count = seen.get(part) ?? 0;
    seen.set(part, count + 1);
    const lead = first ? null : " ";
    first = false;
    return (
      <Fragment key={`${part}#${count}`}>
        {lead}
        <span className={props.className}>{part}</span>
      </Fragment>
    );
  });
}
