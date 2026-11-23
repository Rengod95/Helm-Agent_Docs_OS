import { Button } from "@caustic/react";
import { MessageSquare } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { useContext, type ReactNode } from "react";
import { ShellStoreContext } from "../../state/shell/index.ts";
import { useAddonData } from "./addon-data.ts";
import { toolOwnerOf } from "./addon-model.ts";
import { useAppMoves } from "./app-moves.ts";
import { useOptionalPluginUi } from "./plugin-context.tsx";

// 대화의 도구 줄을 펼쳤을 때 "이 플러그인 고치기"(AGE-78). 도구를 낸 플러그인(매니페스트 `tools`)의 테스트 챗을 연다.
// 내장 플러그인이거나 주인을 모르면 그리지 않는다. 화면 런타임이나 셸 문맥이 없는 곳(시험, 따로 그린 기록)에서도 그리지 않는다.

function FixButton(props: { readonly tool: string }): ReactNode {
  const data = useAddonData(true);
  const moves = useAppMoves();
  const owner = toolOwnerOf(data.meta, props.tool);
  if (owner === undefined || data.meta.get(owner)?.origin === "builtin") return null;
  return (
    <div className="flex">
      <Button
        size="xs"
        variant="ghost"
        iconStart={<MessageSquare aria-hidden />}
        onClick={() => {
          moves.fix(owner);
        }}
      >
        {t("desktop.convo.tool.fixPlugin")}
      </Button>
    </div>
  );
}

/** 도구 이름 하나의 "이 플러그인 고치기" 단추. 펼친 도구 줄 안에서만 그린다 */
export function FixPluginLink(props: { readonly tool: string }): ReactNode {
  const ui = useOptionalPluginUi();
  const shell = useContext(ShellStoreContext);
  if (ui === null || shell === null) return null;
  return <FixButton tool={props.tool} />;
}
