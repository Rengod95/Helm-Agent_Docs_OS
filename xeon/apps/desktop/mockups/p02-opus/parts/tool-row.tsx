// caustic 빈틈: ToolCall은 결과(children)를 늘 펼쳐 보이고 접기·펼치기가 없다. P-02는 "도구 호출 행은 기본 접힘, 실패하면 펼침"이다.
// 그리고 C-15(도구 출력·로그 보기): 긴 출력용 부품이 없어 mono 블록으로 대신한다.
// ToolCall을 그대로 쓰고, 머리(40px, Foundation "Tool call header") 위에 투명한 disclosure 버튼을 겹친다.
// 머리 앞 아이콘 자리에 회전하는 chevron을 둔다. 색과 모서리는 caustic 토큰과 ToolCall의 것을 그대로 따른다.
// 결과가 없는 행은 접을 것이 없어 단추와 chevron을 두지 않는다. 걸린 시간은 내지 않는다(디자인 언어 §6).
import { ToolCall } from "@caustic/react";
import { useId, useState } from "react";
import { ChevronRight, L, L2 } from "../../_shell";

export interface ToolRowProps {
  name: string;
  detail: string;
  status: "done" | "failed";
  /** @deprecated 화면에 내지 않는다. 받기만 한다. */
  duration?: string | undefined;
  output?: string | undefined;
}

export function ToolRow({ name, detail, status, output }: ToolRowProps) {
  const [open, setOpen] = useState(status === "failed");
  const bodyId = useId();
  if (output === undefined)
    return <ToolCall name={name} detail={detail} status={status} failedLabel={L("실패")} />;
  return (
    <div className="relative">
      <ToolCall
        name={name}
        detail={detail}
        status={status}
        failedLabel={L("실패")}
        icon={
          <ChevronRight
            className={
              open
                ? "rotate-90 transition-transform duration-quick"
                : "transition-transform duration-quick"
            }
          />
        }
      >
        {open ? (
          <pre id={bodyId} className="m-0 whitespace-pre-wrap break-words font-mono text-mono-sm">
            {output}
          </pre>
        ) : null}
      </ToolCall>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        aria-label={L2(
          `도구 ${name} ${detail}, ${status === "failed" ? "실패" : "완료"}. 결과 ${open ? "접기" : "펼치기"}`,
          `Tool ${name} ${detail}, ${status === "failed" ? "failed" : "done"}. ${open ? "Collapse" : "Expand"} result`,
        )}
        onClick={() => setOpen(!open)}
        className="absolute inset-x-0 top-0 h-10 cursor-pointer rounded-xl outline-none hover:bg-fill-hover focus-visible:focus-ring"
      />
    </div>
  );
}
