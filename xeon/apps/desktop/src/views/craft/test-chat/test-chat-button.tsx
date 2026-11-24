// 플러그인 상세(C2) 머리의 "테스트 챗" 단추(craft-flows 5, C2 → C7 `{ kind: "plugin" }`). 그 플러그인의 가장 최근 테스트 챗을
// 다시 열고(없으면 만든다) 플러그인 참조를 맥락으로 남긴다. 창은 이 화면 위에 뜬다.
import type { ReactNode } from "react";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { Button } from "@caustic/react";
import { MessageSquare } from "@caustic/react/icons";
import { HEADER_CONTROL_SIZE } from "../../shell/screen-header.tsx";
import { useOpenTestChat } from "./use-test-chat.ts";

export function TestChatButton(props: { readonly plugin: string }): ReactNode {
  const open = useOpenTestChat();
  return (
    <Button
      size={HEADER_CONTROL_SIZE}
      variant="outline"
      data-test-chat-open=""
      iconStart={<MessageSquare aria-hidden />}
      onClick={() => {
        detach(
          open({
            plugin: props.plugin,
            reuse: "last",
            context: [{ kind: "plugin", name: props.plugin }],
          }),
          rethrow,
        );
      }}
    >
      {t("desktop.craft.testChat.open")}
    </Button>
  );
}
