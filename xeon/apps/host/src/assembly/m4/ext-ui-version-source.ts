import type { ThreadId } from "@fresnel/contracts/conversation";
import type { Clock } from "@fresnel/contracts";
import type { ExtHost, ExtensionLoader, VersionHistory } from "@fresnel/ext-host";
import type { BundledPluginVersion } from "../default-plugins.ts";
import { createExtUiVersionHistory, sha256Hex } from "./ext-ui-version-fs.ts";

// 확장 버전과 화면 목록(T-XV, HS-108)이 읽는 원천. 조립 루트(assemble.ts)가 만들어 엔진 포트에 넘긴다.
// 로더는 조립의 뒤쪽에서 만들어지므로 지연 읽기 함수로 받는다. 기본 그룹이 꺼져 있으면 로더가 없다.

export interface ExtUiVersionSource {
  /** 확장 등록(scope) 목록과 켜기·끄기, 상태 비우기에 쓴다 */
  readonly host: Pick<ExtHost, "registrations" | "registration" | "resetRegistrationState" | "ui">;
  /** 외부 확장 로더. 로더가 없으면 undefined다 */
  readonly loader: () => Pick<ExtensionLoader, "list" | "uiEntries" | "reload"> | undefined;
  /** 버전 기록. 되돌리기와 기본 플러그인 교체가 같은 보관을 쓴다 */
  readonly history: VersionHistory;
  /** 사용자 확장 위치(`<config>/extensions`). 확장 하나의 설치본은 `<위치>/<이름>`이다 */
  readonly extensionsDir: string;
  /** 이 엔진이 쥔 thread. 상태 비우기가 연다 */
  readonly heldThreads: () => readonly ThreadId[];
  /** 지금 설치본의 상태 스키마 버전. 모르면 null이고, 그때 되돌리기는 스키마를 검사하지 않는다 */
  readonly stateSchemaVersion: (name: string) => number | null;
  /**
   * 앱에 든 기본 플러그인 번들의 판(HS-108). 기본 플러그인 이름만 번들이 있고, 그 밖의 이름이나 번들이 없으면 null이다.
   * 버전 목록의 `bundledVersion`과 되돌리기의 "앱에 든 버전" 기록이 쓴다
   */
  readonly bundle: (name: string) => Promise<BundledPluginVersion | null>;
  /** 매니페스트 텍스트의 해시. 버전 기록이 저장할 값과 같은 함수다(되돌리기가 보관 항목과 번들을 비교한다) */
  readonly hash: (text: string) => string;
}

/** 조립 루트가 넘기는 재료. 버전 기록은 여기서 만든다 */
export function createExtUiVersionSource(input: {
  readonly host: ExtUiVersionSource["host"];
  readonly extensionsDir: string;
  readonly clock: Clock;
  readonly loader: ExtUiVersionSource["loader"];
  readonly heldThreads: ExtUiVersionSource["heldThreads"];
  readonly bundle: ExtUiVersionSource["bundle"];
}): ExtUiVersionSource {
  return {
    host: input.host,
    loader: input.loader,
    history: createExtUiVersionHistory({ extensionsDir: input.extensionsDir, clock: input.clock }),
    extensionsDir: input.extensionsDir,
    heldThreads: input.heldThreads,
    bundle: input.bundle,
    hash: sha256Hex,
    // ext-host는 상태 스키마 버전을 밝히지 않는다(StateDecl.version은 등록 정의 안에만 있다). X.loading-trust §10 24번 [미결]
    stateSchemaVersion: () => null,
  };
}
