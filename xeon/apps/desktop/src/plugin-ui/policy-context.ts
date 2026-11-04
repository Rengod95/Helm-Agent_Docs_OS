import { err, ok, parse, type Result } from "@fresnel/contracts";
import { ExtensionManifestSchema, type ExtensionManifest } from "@fresnel/contracts/extensions";
import type { ExtGetResult, ExtTrust, ExtUiEntry } from "@fresnel/contracts/wire";
import {
  defaultAllowPost,
  type BridgePolicyContext,
  type MethodGrant,
} from "@fresnel/client/views/app";

// 다리 판정 맥락(`BridgePolicyContext`)을 엔진이 준 확장 정보로 만든다. 순수 함수이고 wire를 부르지 않는다.
// 입력은 `ext.get`(매니페스트, 상태), `ext.ui.list` 항목(설치 등급), 열린 대화, `command.list`의 등록 주체다.
// 설정 값은 여기서 읽지 않는다. 앱 정책(`x.ui.apps`, `x.ui.allowProjectApps`)은 `appsAllowed`가 따로 본다.

/** 다리 판정의 등급. 엔진의 `managed`는 다리 등급에 없어 `user`로 본다(post 기본 거부) [미결] */
export type BridgeTrust = BridgePolicyContext["trust"];

interface CommandOwnership {
  readonly name: string;
  /** 등록 주체. 확장이 등록했으면 확장 이름이다 */
  readonly origin: string;
}

export interface PolicyContextInput {
  /** `ext.get` 결과. 매니페스트와 상태를 담는다 */
  readonly get: ExtGetResult;
  /** 화면 항목. 설치 등급을 여기서 읽는다 */
  readonly entry: ExtUiEntry;
  /** 지금 열린 대화 id. 없으면 undefined */
  readonly openThreadId: string | undefined;
  /** `command.list`의 명령 이름과 등록 주체. 이 확장의 명령만 `ownCommands`가 된다 */
  readonly commands: readonly CommandOwnership[];
}

export type PolicyContextError =
  | { readonly kind: "manifest_invalid" }
  | { readonly kind: "extension_mismatch" };

/** 설정 키 `x.ui.apps`(기본 참, Windows는 클라이언트가 끈다)와 `x.ui.allowProjectApps`(기본 거짓). ext-host 검사와 같은 키다 */
export const UI_APPS_KEY = "x.ui.apps";
export const UI_ALLOW_PROJECT_APPS_KEY = "x.ui.allowProjectApps";

export function bridgeTrustOf(trust: ExtTrust): BridgeTrust {
  return trust === "managed" ? "user" : trust;
}

function uniqueOf(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

/** 확장 하나의 판정 맥락. 매니페스트가 검사를 통과하지 못하면 오류 값이다(던지지 않는다) */
export function policyContextOf(
  input: PolicyContextInput,
): Result<BridgePolicyContext, PolicyContextError> {
  const { get, entry } = input;
  if (get.entry.name !== entry.extension) return err({ kind: "extension_mismatch" });
  const parsed = parse(ExtensionManifestSchema, get.manifest);
  if (!parsed.ok) return err({ kind: "manifest_invalid" });
  const manifest: ExtensionManifest = parsed.value;
  const extension = manifest.name;
  const trust = bridgeTrustOf(entry.trust);
  const methods: ReadonlyMap<string, MethodGrant> = new Map(
    (manifest.methods ?? []).map((decl): [string, MethodGrant] => [
      decl.verb,
      {
        readOnly: decl.readOnly,
        approval: decl.approval === true,
        ...(decl.label === undefined ? {} : { label: decl.label }),
      },
    ]),
  );
  // 내장 확장만 그룹 설정 접두 `l3.<이름>.`을 받는다(ADR-0021 §3.4 표)
  const settingPrefixes =
    trust === "builtin" ? [`ext.${extension}.`, `l3.${extension}.`] : [`ext.${extension}.`];
  return ok({
    extension,
    enabled: get.entry.status === "enabled",
    safeMode: get.entry.safeModeExcluded !== null,
    trust,
    methods,
    readsRecordKinds: uniqueOf(manifest.plugins.flatMap((plugin) => plugin.readsRecordKinds ?? [])),
    settingPrefixes,
    declaredSettingKeys: new Set(
      Object.values(manifest.userConfig ?? {}).map((setting) => setting.setting),
    ),
    ownCommands: new Set(
      input.commands
        .filter((command) => command.origin === extension)
        .map((command) => command.name),
    ),
    allowPost: defaultAllowPost(trust),
    openThreadId: input.openThreadId,
  });
}

function flagOf(
  settings: Readonly<Record<string, unknown>>,
  key: string,
  fallback: boolean,
): boolean {
  const value = settings[key];
  return typeof value === "boolean" ? value : fallback;
}

/**
 * 화면 앱을 쓸 수 있는가. `x.ui.apps`가 거짓이면 모든 앱이 막힌다. 프로젝트 등급의 앱은 `x.ui.allowProjectApps`가 참이어야 한다.
 * 설정 값이 없거나 불리언이 아니면 기본을 쓴다(앱 켜짐, 프로젝트 앱 꺼짐)
 */
export function appsAllowed(trust: ExtTrust, settings: Readonly<Record<string, unknown>>): boolean {
  if (!flagOf(settings, UI_APPS_KEY, true)) return false;
  if (trust !== "project") return true;
  return flagOf(settings, UI_ALLOW_PROJECT_APPS_KEY, false);
}
