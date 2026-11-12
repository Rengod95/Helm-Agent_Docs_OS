import { normalizeExternalLink } from "@fresnel/client/views/app";
import { detach, rethrow } from "@fresnel/contracts";
import { usePluginUi } from "../plugin/plugin-context.tsx";

/** 링크를 열기 전에 한 번 확인을 거쳐 OS 브라우저로 보낸다. 거부하면 아무 일도 없다. 답 본문 링크와 출처 칩이 같이 쓴다 */
export function useOpenSource(): (url: string) => void {
  const { confirm, openExternal } = usePluginUi();
  return (url) => {
    const link = normalizeExternalLink(url);
    if (link === undefined) return;
    detach(
      confirm
        .request({
          kind: "external",
          extension: "",
          trust: "builtin",
          action: link.display,
          ...(link.punycodeHost === undefined ? {} : { punycodeHost: link.punycodeHost }),
          label: undefined,
          paramsSummary: "",
          approval: false,
        })
        .then((answer) => (answer === "allow" ? openExternal(link.href) : undefined)),
      rethrow,
    );
  };
}
