import type { ServiceCommand } from "./service/ensure.ts";
import type { SettingsFileScope } from "./settings.ts";
import type { AssembleOptions } from "./types.ts";

// L4.host-service.spec §3.3.4. runHostCommand가 받는 명령과 입출력.

export type HostCommand =
  | { readonly kind: "host-stdio" }
  /** 서비스 본체를 전경에서 실행한다(`fresnel service run`, `fresnel host --service`). 시작 거부는 종료코드 1, 이미 떠 있으면 0 */
  | {
      readonly kind: "service-run";
      readonly safeMode: boolean;
      /** `host:port`로도 연다. 토큰은 등록 파일에 있다 */
      readonly tcp?: { readonly host: string; readonly port: number };
      /** 루프백이 아닌 tcp 주소를 허용한다. 기본은 거부(`tcp_not_loopback`) */
      readonly allowNonLoopback?: boolean;
    }
  /**
   * `ensure`를 하고 결과를 사람이 읽는 한 줄로 쓴다. `start`는 서비스를 띄우는 명령(없으면 이 실행 파일이 자기 자신을 `service run`으로 띄운다).
   * 서비스를 새로 띄울 때만 `safeMode`·`tcp`가 `service run`의 인자로 간다. 이미 떠 있는 서비스의 모드는 바뀌지 않는다
   */
  | {
      readonly kind: "service-start";
      readonly start?: ServiceCommand;
      readonly safeMode?: boolean;
      readonly tcp?: { readonly host: string; readonly port: number };
      readonly allowNonLoopback?: boolean;
    }
  | { readonly kind: "service-status"; readonly json: boolean }
  /** 원격 접속 페어링 코드를 청한다(L4.remote §8.3). `json`이면 `{"code","expiresAt"}` 한 줄을 쓴다 */
  | { readonly kind: "service-pair"; readonly json: boolean }
  | { readonly kind: "service-stop" }
  | {
      readonly kind: "service-ensure";
      readonly start?: ServiceCommand;
      readonly safeMode?: boolean;
    }
  | { readonly kind: "service-launch-mode" }
  /** 로그인 자동 시작을 등록한다(macOS launchd 사용자 에이전트, Linux systemd 사용자 유닛). 동의는 호출하는 쪽(CLI 확인, 데스크톱 확인 대화 상자)이 받았다고 본다 */
  | { readonly kind: "service-install" }
  /** 로그인 자동 시작을 해제하고 등록 파일을 지운다 */
  | { readonly kind: "service-uninstall" }
  | {
      readonly kind: "config-schema";
      readonly scope: SettingsFileScope;
      readonly out?: string;
      readonly coreOnly: boolean;
      /** 앱이 카탈로그에 더하는 설정 그룹(CLI의 `l4.cli.*`). `coreOnly`면 쓰지 않는다. 엔진을 세울 때 넘기는 `AssembleOptions.settingGroups`와 같다 */
      readonly settingGroups?: AssembleOptions["settingGroups"];
    };

export interface CommandIo {
  /** host-stdio에서는 계약 전용이다. 다른 출력을 쓰지 않는다 */
  readonly stdout: WritableStream<Uint8Array>;
  readonly stderr: WritableStream<Uint8Array>;
  readonly stdin: ReadableStream<Uint8Array>;
}
