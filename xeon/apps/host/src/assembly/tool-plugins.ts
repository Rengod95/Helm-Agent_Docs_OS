import { Bug } from "@fresnel/contracts";
import {
  defineManifest,
  internalPluginLayer,
  externalToolAppliesOn,
  type ExtensionEntry,
  type ExtensionManifest,
  type ExternalToolInstall,
  type ExternalToolDecl,
  type ExternalToolPlatform,
} from "@fresnel/contracts/extensions";
import type { ExtensionUnit } from "@fresnel/ext-host";
import installTexts from "./tool-install.json";

const TOOL_INSTALL_TEXT: Readonly<Record<string, ExternalToolInstall>> = installTexts;

// 도구 종류 플러그인(AGE-76 질문 2, F.extensions.spec §3.1.5). 외부 도구 하나가 플러그인 하나다: 매니페스트 `externalTool`이 실행 파일과 최소 버전, 설치 안내를 선언하고
// 엔진이 L0.os의 점검(`checkExternalBinaries`)으로 상태를 낸다. 이 플러그인은 모델 도구, 훅, Drive를 등록하지 않아 모델에게 가는 문구가 늘지 않는다.
// 조립 루트 코드(DR-14 예외 2). 그 OS에서 쓰는 도구의 플러그인만 싣는다.

/**
 * 내장 도구 플러그인의 설치 안내(ko, en 쌍). 사용자 문장이라 코드에 두지 않고 카탈로그 JSON(`tool-install.json`)에 둔다(ADR-0016).
 * 호스트는 `@fresnel/client`를 import할 수 없어(DR-10) 클라이언트 카탈로그 대신 이 자리에 둔다
 */
function installOf(name: string): ExternalToolInstall {
  const text = TOOL_INSTALL_TEXT[name];
  if (text === undefined) throw new Bug(`no install text for ${name}`);
  return text;
}

interface ToolPluginRow {
  readonly name: string;
  readonly displayName: string;
  readonly purpose: string;
  readonly description: string;
  readonly tool: ExternalToolDecl;
}

/** 내장 도구 플러그인 전부. 표(`platform-os`의 `binaryRequirements`)와 같은 도구이고, 어긋나면 host 시험이 잡는다 */
export const TOOL_PLUGIN_ROWS: readonly ToolPluginRow[] = [
  {
    name: "tool-rg",
    displayName: "ripgrep",
    purpose: "Checks that ripgrep (rg) is installed.",
    description:
      "Checks that the ripgrep tool (rg) is on this computer. Workspace file search and sandbox start use it; without it, they do not work.",
    tool: {
      binary: "rg",
      install: installOf("tool-rg"),
      bundled: true,
    },
  },
  {
    name: "tool-sops",
    displayName: "sops",
    purpose: "Checks that sops is installed.",
    description:
      "Checks that sops is on this computer at the needed version. Secrets are read and written with it; without it, secrets cannot be read or written.",
    tool: {
      binary: "sops",
      minVersion: "3.10.0",
      install: installOf("tool-sops"),
      bundled: true,
    },
  },
  {
    name: "tool-age",
    displayName: "age",
    purpose: "Checks that age is installed.",
    description:
      "Checks that age is on this computer. New secret keys are made with it; without it, new secret keys cannot be created.",
    tool: {
      binary: "age",
      install: installOf("tool-age"),
      bundled: true,
    },
  },
  {
    name: "tool-git",
    displayName: "Git",
    purpose: "Checks that git is installed.",
    description:
      "Checks that git is on this computer. Workspace git status and work trees use it; without it, only those are missing.",
    tool: {
      binary: "git",
      install: installOf("tool-git"),
      bundled: false,
    },
  },
  {
    name: "tool-security",
    displayName: "macOS security",
    purpose: "Checks the macOS security tool for the Keychain.",
    description:
      "Checks that the macOS security tool is available. Secret keys are kept in the Keychain with it; without it, keys cannot be stored there.",
    tool: {
      binary: "security",
      install: installOf("tool-security"),
      bundled: false,
      platforms: ["darwin"],
    },
  },
  {
    name: "tool-bwrap",
    displayName: "bubblewrap",
    purpose: "Checks that bubblewrap (bwrap) is installed.",
    description:
      "Checks that bubblewrap (bwrap) is on this Linux computer at the needed version. The sandbox uses it; without it, the sandbox cannot run.",
    tool: {
      binary: "bwrap",
      minVersion: "0.4.0",
      install: installOf("tool-bwrap"),
      bundled: false,
      platforms: ["linux"],
    },
  },
  {
    name: "tool-socat",
    displayName: "socat",
    purpose: "Checks that socat is installed.",
    description:
      "Checks that socat is on this Linux computer. The sandbox network relay uses it; without it, the sandbox cannot run.",
    tool: {
      binary: "socat",
      versionArgs: "-V",
      install: installOf("tool-socat"),
      bundled: false,
      platforms: ["linux"],
    },
  },
  {
    name: "tool-secret-tool",
    displayName: "secret-tool",
    purpose: "Checks that secret-tool is installed.",
    description:
      "Checks that secret-tool is on this Linux computer. Secret keys can be kept in the Secret Service with it; without it, keys are kept in a protected file instead.",
    tool: {
      binary: "secret-tool",
      install: installOf("tool-secret-tool"),
      bundled: false,
      platforms: ["linux"],
    },
  },
];

/** 내장 도구 플러그인의 이름 */
export const TOOL_PLUGIN_NAMES: readonly string[] = TOOL_PLUGIN_ROWS.map((row) => row.name);

/** 도구 플러그인의 매니페스트. 층은 L2이고 `defaultEnabled`라 기본 프로필에 든다 */
export function toolPluginManifest(row: ToolPluginRow): ExtensionManifest {
  return defineManifest({
    schemaVersion: 2,
    name: row.name,
    version: "0.1.0",
    displayName: row.displayName,
    purpose: row.purpose,
    description: row.description,
    defaultEnabled: true,
    entry: "./src/index.ts",
    externalTool: row.tool,
    plugins: [{ layer: "L2", hooks: [] }],
    trust: { level: "builtin" },
  });
}

/** 이 OS에서 싣는 도구 플러그인 행 */
export function toolPluginRowsOn(platform: ExternalToolPlatform): readonly ToolPluginRow[] {
  return TOOL_PLUGIN_ROWS.filter((row) => externalToolAppliesOn(row.tool, platform));
}

/** 정적 설정 카탈로그용: 모든 OS의 도구 플러그인 이름과 표시 이름(예약 키 `ext.<이름>.enabled`가 OS와 무관하게 같은 스키마여야 한다) */
export const TOOL_PLUGIN_KEY_ROWS: readonly {
  readonly name: string;
  readonly displayName: string;
  readonly layer: "L2";
}[] = TOOL_PLUGIN_ROWS.map((row) => ({
  name: row.name,
  displayName: row.displayName,
  layer: "L2",
}));

const entry: ExtensionEntry = ({ manifest, register }) => {
  register(manifest.name, { defaultEnabled: true }, () => undefined);
};

export function toolPluginUnit(row: ToolPluginRow, loadIndex: number): ExtensionUnit {
  return { manifest: toolPluginManifest(row), entry, loadIndex, builtin: true };
}

/**
 * 끌 수 없는 도구 종류 플러그인(앱 핵심, AGE-76 질문 2): 엔진이 꼭 필요로 하는 도구의 것이다(`internalPluginLayer`가 `core`).
 * `ext.<이름>.enabled`를 거짓으로 쓰는 요청은 `plugin.requiredByCore`로 거절한다. 선택 도구(git, secret-tool)는 기본 제공이라 이 집합에 없다
 */
export function isRequiredToolPlugin(name: string): boolean {
  return TOOL_PLUGIN_NAMES.includes(name) && internalPluginLayer(name) === "core";
}
