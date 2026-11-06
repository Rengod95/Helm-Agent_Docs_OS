import { TARGETS_KEY } from "@fresnel/client";
import { parse, type Result } from "@fresnel/contracts";
import {
  Type,
  type Static,
  type TArray,
  type TBoolean,
  type TInteger,
  type TLiteral,
  type TNumber,
  type TObject,
  type TRecord,
  type TSchema,
  type TString,
  type TUnion,
  type TUnknown,
} from "typebox";
import type { DesktopIpc, IpcError } from "../transport/ipc.ts";

// V-14 데스크톱 로컬 설정 저장소. 창, 패널, 영역 자리, 바로 가기 키, 첫 실행 표시를 `desktop-settings.json`에 둔다.
// 엔진 설정(`settings.*` wire)이 아니라 이 기기·이 앱만의 값이다. 읽기와 쓰기는 셸 명령(`desktop_settings_read/write`)이 한다.
// 값은 읽을 때와 쓸 때 모두 스키마로 검사한다. 틀린 값은 기본값처럼 건너뛴다.

const AreaSchema: TUnion<[TLiteral<"chat">, TLiteral<"workbench">]> = Type.Union([
  Type.Literal("chat"),
  Type.Literal("workbench"),
]);
const PlaceSchema: TObject<{ screen: TString; scroll: TNumber; endTab: TString }> = Type.Object(
  {
    screen: Type.String({ minLength: 1, maxLength: 64 }),
    scroll: Type.Number({ minimum: 0 }),
    endTab: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
);
const KeybindingsSchema: TRecord<string, TString> = Type.Record(
  Type.String(),
  Type.String({ maxLength: 64 }),
);

/** 로컬 설정 키 하나: 이름과 값 스키마. 값의 타입은 스키마에서 나온다 */
export interface LocalKey<S extends TSchema> {
  readonly key: string;
  readonly schema: S;
}

function localKey<S extends TSchema>(key: string, schema: S): LocalKey<S> {
  return { key, schema };
}

/** 로컬 설정 키 표. 키 이름은 spec §4.1·§4.9.2·§4.8의 `l4.desktop.*`이다 */
type LocalPlaceSchema = typeof PlaceSchema;
type LocalAreaSchema = typeof AreaSchema;

export const LOCAL: {
  readonly sidebarOpen: LocalKey<TBoolean>;
  readonly sidebarWidth: LocalKey<TInteger>;
  readonly endOpen: LocalKey<TBoolean>;
  readonly endWidth: LocalKey<TInteger>;
  readonly areaCurrent: LocalKey<LocalAreaSchema>;
  readonly areaChat: LocalKey<LocalPlaceSchema>;
  readonly areaWorkbench: LocalKey<LocalPlaceSchema>;
  readonly keybindings: LocalKey<TRecord<string, TString>>;
  readonly searchHintDismissed: LocalKey<TBoolean>;
  /** 연결 화면(P-08)의 원격 대상 목록. 값은 `targetsStorageOf`가 항목마다 검사한다 */
  readonly connectionTargets: LocalKey<TArray<TUnknown>>;
  /** 엔진 정상 종료 대기(ms). 셸이 같은 파일에서 읽는 키다. 대상을 바꾸는 동안의 쓰기 보류 한도를 정한다 */
  readonly shutdownGraceMs: LocalKey<TInteger>;
  /** 창 닫기 동작. 설정 화면이 바꾸고 셸이 같은 파일에서 읽는다(`defs.ts`) */
  readonly closeBehavior: LocalKey<TUnion<[TLiteral<"quit">, TLiteral<"tray">]>>;
  /** 엔진 자동 재기동 횟수. 설정 화면이 바꾸고 셸이 같은 파일에서 읽는다(`defs.ts`) */
  readonly restartLimit: LocalKey<TInteger>;
  /** 명령 팔레트(S-02)의 명령별 실행 횟수. 키는 명령 id다. 값의 상한은 `palette-model.ts`의 `PALETTE_USE_MAX`와 같다 */
  readonly paletteUses: LocalKey<TRecord<string, TInteger>>;
  /** OS 알림 종류별 켜짐(B-10). 값이 없으면 켠 것이다(`os-notify-prefs.ts`가 읽는다). 설정 화면의 "실행과 서비스" 묶음이 바꾼다 */
  readonly notifyTurnDone: LocalKey<TBoolean>;
  readonly notifyApproval: LocalKey<TBoolean>;
  readonly notifyScheduleFailed: LocalKey<TBoolean>;
  /** 움직임 줄이기를 앱에서 켠다. 없으면 운영체제 설정을 따른다(`appearance-prefs.ts`) */
  readonly motionReduce: LocalKey<TBoolean>;
  /** 화면 확대 비율(%). 허용 값은 `ZOOM_STEPS`다 */
  readonly zoomPercent: LocalKey<TInteger>;
} = {
  sidebarOpen: localKey("l4.desktop.window.sidebarOpen", Type.Boolean()),
  sidebarWidth: localKey(
    "l4.desktop.window.sidebarWidth",
    Type.Integer({ minimum: 240, maximum: 360 }),
  ),
  endOpen: localKey("l4.desktop.window.endOpen", Type.Boolean()),
  endWidth: localKey("l4.desktop.window.endWidth", Type.Integer({ minimum: 320, maximum: 480 })),
  areaCurrent: localKey("l4.desktop.window.area.current", AreaSchema),
  areaChat: localKey("l4.desktop.window.area.chat", PlaceSchema),
  areaWorkbench: localKey("l4.desktop.window.area.workbench", PlaceSchema),
  keybindings: localKey("l4.desktop.appearance.keybindings", KeybindingsSchema),
  searchHintDismissed: localKey("l4.desktop.firstRun.searchHintDismissed", Type.Boolean()),
  connectionTargets: localKey(TARGETS_KEY, Type.Array(Type.Unknown())),
  shutdownGraceMs: localKey(
    "l4.desktop.engine.shutdownGraceMs",
    Type.Integer({ minimum: 1000, maximum: 180000 }),
  ),
  closeBehavior: localKey(
    "l4.desktop.window.closeBehavior",
    Type.Union([Type.Literal("quit"), Type.Literal("tray")]),
  ),
  restartLimit: localKey(
    "l4.desktop.engine.restartLimit",
    Type.Integer({ minimum: 0, maximum: 10 }),
  ),
  paletteUses: localKey(
    "l4.desktop.window.paletteUses",
    Type.Record(Type.String(), Type.Integer({ minimum: 0, maximum: 1_000_000 })),
  ),
  notifyTurnDone: localKey("l4.desktop.window.notify.turnDone", Type.Boolean()),
  notifyApproval: localKey("l4.desktop.window.notify.approval", Type.Boolean()),
  notifyScheduleFailed: localKey("l4.desktop.window.notify.scheduleFailed", Type.Boolean()),
  motionReduce: localKey("l4.desktop.appearance.motion", Type.Boolean()),
  zoomPercent: localKey("l4.desktop.appearance.zoom", Type.Integer({ minimum: 90, maximum: 200 })),
};

type LocalSettingsError =
  | { readonly kind: "invalid"; readonly key: string }
  | { readonly kind: "ipc"; readonly error: IpcError };

export interface LocalSettings {
  /** 파일을 읽어 둔다. 읽지 못하면 모든 값이 없는 것으로 시작한다 */
  load(): Promise<Result<null, IpcError>>;
  /** 읽어 둔 값. 없거나 스키마에 맞지 않으면 undefined */
  get<S extends TSchema>(key: LocalKey<S>): Static<S> | undefined;
  /** 값을 검사하고 파일에 쓴다. 성공하면 `get`이 곧바로 새 값을 돌려준다 */
  set<S extends TSchema>(
    key: LocalKey<S>,
    value: Static<S>,
  ): Promise<Result<null, LocalSettingsError>>;
}

export function createLocalSettings(
  ipc: Pick<DesktopIpc, "readSettings" | "writeSettings">,
): LocalSettings {
  let file: Readonly<Record<string, unknown>> = {};
  return {
    async load() {
      const read = await ipc.readSettings();
      if (!read.ok) return read;
      file = read.value;
      return { ok: true, value: null };
    },
    get(local) {
      const raw = Object.hasOwn(file, local.key) ? file[local.key] : undefined;
      if (raw === undefined) return undefined;
      const checked = parse(local.schema, raw);
      return checked.ok ? checked.value : undefined;
    },
    async set(local, value) {
      const checked = parse(local.schema, value);
      if (!checked.ok) return { ok: false, error: { kind: "invalid", key: local.key } };
      const written = await ipc.writeSettings(local.key, value);
      if (!written.ok) return { ok: false, error: { kind: "ipc", error: written.error } };
      file = { ...file, [local.key]: value };
      return { ok: true, value: null };
    },
  };
}
