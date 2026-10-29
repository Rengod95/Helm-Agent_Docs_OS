import { describeWebSettings, readWebSettings, type WebRuntime } from "@xeon/cap-web";
import type { WebPort } from "../types.ts";
import type { SettingsEngine } from "./settings-engine.ts";

// M3-REQ-96, F wire-settings `web.providers`. cap-web(hostWebPlugin)이 런타임을 만들면 `holder.current`에 채우고 해제하면 비운다.
// 값은 런타임의 provider 탐침과 설정 층에서 채운다. 런타임이 없으면(cap-web이 올라오지 않은 엔진) provider 목록은 비고 설정 값은
// 같은 설정 층에서 읽는다: 설정 파일이 비어 있으면 `DEFAULT_WEB_SETTINGS`와 같다. 조립 루트 코드(DR-14 예외 2).

/** cap-web 런타임을 `web.providers` 처리기에 잇는 자리. 호스트가 만들고 cap-web 확장이 채운다 */
export interface WebStatusHolder {
  current: Pick<WebRuntime, "providerStatus"> | undefined;
}

export interface WebPortDeps {
  readonly holder: WebStatusHolder;
  readonly settings: Pick<SettingsEngine, "layers">;
}

export function createWebPort(deps: WebPortDeps): WebPort {
  return {
    async providers(signal) {
      const runtime = deps.holder.current;
      const providers = runtime === undefined ? [] : await runtime.providerStatus(signal);
      const settings = describeWebSettings(readWebSettings(deps.settings.layers(undefined)));
      return { providers: [...providers], settings };
    },
  };
}
