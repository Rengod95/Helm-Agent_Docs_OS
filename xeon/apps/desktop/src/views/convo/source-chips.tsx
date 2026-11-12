import { Button } from "@caustic/react";
import { Globe } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import type { WebSource } from "../tool-extras-model.ts";
import { useOpenSource } from "./open-source.ts";

// 출처 칩 줄(dzT2a 시안 3.6). 칩은 xs(24) outline: 도메인 + 제목(말줄임, 칩 최대 240px). 일곱 개 넘으면 "+N".
// 누르면 확인 뒤 외부 브라우저로 연다. 도구 줄 아래(아이콘 열 아래로 들여 20)와 답 본문 아래에 쓴다.

const SHOWN = 7;

export function SourceChips(props: {
  readonly sources: readonly WebSource[];
  /** 도구 줄 아래면 들여 쓴다 */
  readonly indent?: boolean;
}): ReactNode {
  const open = useOpenSource();
  if (props.sources.length === 0) return null;
  const shown = props.sources.slice(0, SHOWN);
  const rest = props.sources.length - shown.length;
  return (
    <ul
      className={`m-0 flex list-none flex-wrap items-center gap-1 p-0 ${props.indent === false ? "" : "ml-5 mb-1"}`}
      aria-label={t("desktop.item.sources.label")}
    >
      {shown.map((source) => (
        <li key={source.url} className="min-w-0 max-w-60">
          <Button
            size="xs"
            variant="outline"
            title={source.url}
            className="max-w-full"
            onClick={() => {
              open(source.url);
            }}
          >
            <Globe aria-hidden />
            <span className="min-w-0 truncate">
              {source.title === source.domain
                ? source.domain
                : `${source.domain} · ${source.title}`}
            </span>
          </Button>
        </li>
      ))}
      {rest > 0 ? (
        <li className="convo-line-meta">{t("desktop.convo.tag.more", { count: rest })}</li>
      ) : null}
    </ul>
  );
}
