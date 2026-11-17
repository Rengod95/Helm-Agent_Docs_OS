import * as groupSdk from "@fresnel/group-sdk";
import type { SdkModules } from "@fresnel/ext-host";

// X.loading-trust.spec §4.4.6. 외부 플러그인 번들이 import하는 SDK 가상 모듈 가운데 X가 직접 등록하지 못하는 L3 모듈.
// 엔진 쪽 로더와 플러그인 호스트 프로세스가 같은 목록을 쓴다. `@fresnel/contracts`와 `typebox`는 X가 등록한다.
// 이 파일은 엔진 조립(assembly)을 import하지 않는다: 플러그인 호스트 진입이 이 파일만 거쳐 group-sdk를 싣는다.

export const HOST_SDK_MODULES: SdkModules = { "@fresnel/group-sdk": groupSdk };
