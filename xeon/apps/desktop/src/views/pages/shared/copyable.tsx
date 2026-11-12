import { IconButton } from "@caustic/react";
import { Copy } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";

// 복사할 수 있는 글(DP-115 [결정: 2026-11-12 dzRW]). 원격 wizard의 고치는 명령, 프록시 설정, 연결 주소가 같은 모양을 쓴다.
//   CommandLine  한 줄. 우물(bg.inset) 반경 8, 안쪽 좌 12 · 위아래 4, mono 12. 오른쪽 끝 복사 IconButton xs(24). 높이 32.
//   CodeBlock    여러 줄. 같은 우물, 안쪽 12, 최대 높이 240에서 스크롤. 복사 단추는 오른쪽 위에 떠 있다.
// 바탕은 카드 면 위의 우물 하나로만 구분한다(테두리·그림자 없음). 글은 줄바꿈하지 않고 가로로 스크롤한다(명령이 잘리지 않게).

const WELL = "rounded-lg bg-bg-inset";

export interface CopyableProps {
  readonly text: string;
  /** 복사한다. 알림(토스트)은 부르는 쪽이 띄운다 */
  readonly onCopy: (text: string) => void;
  /** 복사 단추 이름. 기본 "복사" */
  readonly copyLabel?: string | undefined;
  readonly slot?: string | undefined;
}

/** 복사할 명령 한 줄 */
export function CommandLine(props: CopyableProps): ReactNode {
  return (
    <div
      data-slot={props.slot ?? "command-line"}
      className={`flex min-h-8 min-w-0 items-center gap-2 ps-3 pe-1 ${WELL}`}
    >
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre py-1 font-mono text-mono-sm text-text-primary">
        {props.text}
      </code>
      <IconButton
        size="xs"
        variant="ghost"
        label={props.copyLabel ?? t("desktop.connection.copy")}
        onClick={() => {
          props.onCopy(props.text);
        }}
      >
        <Copy />
      </IconButton>
    </div>
  );
}

/** 복사할 여러 줄(설정 파일 예시) */
export function CodeBlock(props: CopyableProps): ReactNode {
  return (
    <div data-slot={props.slot ?? "code-block"} className={`relative min-w-0 ${WELL}`}>
      <pre className="m-0 max-h-60 overflow-auto p-3 pe-10 font-mono text-mono-sm text-text-primary">
        <code>{props.text}</code>
      </pre>
      <span className="absolute end-1 top-1">
        <IconButton
          size="xs"
          variant="ghost"
          label={props.copyLabel ?? t("desktop.connection.copy")}
          onClick={() => {
            props.onCopy(props.text);
          }}
        >
          <Copy />
        </IconButton>
      </span>
    </div>
  );
}
