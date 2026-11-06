//! 데스크톱 설정 파일을 읽는다 (L4.desktop.spec §3.6, §4.2 1단계, §5, §6).
//!
//! 파일은 `<app_config_dir>/desktop-settings.json`이다. 키는 전체 설정 키(`l4.desktop.*`)를 쓰는 평평한 JSON 객체다.
//! 셸은 시작할 때 한 번 읽는다. 값 하나가 틀리면 그 키만 기본값을 쓰고, 파일 전체가 틀리면 모두 기본값을 쓴다.
//! 진단은 키 이름과 이유만 담는다. 다른 키의 값은 담지 않는다(E11).
//! WebView는 `desktop_settings_read/write`로 같은 파일을 읽고 쓴다. 알려진 키는 `parse`와 같은 범위로 검사하고,
//! UI 상태 키(`UI_KEY_PREFIXES`)는 값을 해석하지 않고 저장한다. 쓰기는 임시 파일을 거쳐 이름을 바꾼다.
//! 셸은 시작할 때 한 번 읽는다. 다만 닫기 동작(`closeBehavior`)은 쓰는 즉시 셸 상태에 반영된다. 나머지 엔진 값은 다음 실행부터 반영된다.

use std::fs::File;
use std::io::{self, ErrorKind, Read, Write};
use std::ops::RangeInclusive;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};

use crate::relay::CommandError;

/// 설정 파일 이름.
pub const FILE_NAME: &str = "desktop-settings.json";
/// 파일 읽기 상한(바이트). 이보다 큰 파일은 전체를 기본값으로 쓴다.
const MAX_FILE_BYTES: u64 = 64 * 1024;

pub const KEY_CLOSE_BEHAVIOR: &str = "l4.desktop.window.closeBehavior";
pub const KEY_SHUTDOWN_GRACE_MS: &str = "l4.desktop.engine.shutdownGraceMs";
pub const KEY_RESTART_LIMIT: &str = "l4.desktop.engine.restartLimit";

/// WebView가 UI 상태로 저장하는 키 앞부분. 셸은 값을 해석하지 않고 그대로 보관한다.
const UI_KEY_PREFIXES: [&str; 4] = [
    "l4.desktop.window.",
    "l4.desktop.appearance.",
    "l4.desktop.firstRun.",
    "l4.desktop.workbench.",
];
/// 읽고 고쳐 쓰는 동안 다른 쓰기가 끼지 않게 한다.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// `l4.desktop.engine.shutdownGraceMs`의 range (spec §6). `EngineConfig::from_values`도 이 범위를 쓴다.
pub const SHUTDOWN_GRACE_MS_RANGE: RangeInclusive<i64> = 1000..=180_000;
/// `l4.desktop.engine.restartLimit`의 range (spec §6).
pub const RESTART_LIMIT_RANGE: RangeInclusive<i64> = 0..=10;

/// 창을 닫을 때의 동작 (`l4.desktop.window.closeBehavior`). 기본값은 트레이 유지다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CloseBehavior {
    /// 정상 종료 순서를 탄다 (§4.3).
    Quit,
    /// WebView를 해제하고 셸과 엔진을 남긴다 (§6). 기본값이다.
    #[default]
    Tray,
}

/// 셸이 시작할 때 쓰는 값. 엔진 값은 범위 안에서만 `Some`이다. 없으면 `EngineConfig`의 기본값을 쓴다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct DesktopSettings {
    pub close_behavior: CloseBehavior,
    pub shutdown_grace_ms: Option<i64>,
    pub restart_limit: Option<i64>,
}

/// 설정 파일 본문을 해석한다. 진단 문장은 키 이름과 이유만 담는다.
pub fn parse(text: &str) -> (DesktopSettings, Vec<String>) {
    let mut settings = DesktopSettings::default();
    let mut diagnostics = Vec::new();
    let root: Value = match serde_json::from_str(text) {
        Ok(root) => root,
        Err(error) => {
            diagnostics.push(format!(
                "desktop settings: not valid JSON (line {}, column {}); using defaults",
                error.line(),
                error.column()
            ));
            return (settings, diagnostics);
        }
    };
    let Value::Object(map) = root else {
        diagnostics
            .push("desktop settings: the top level is not a JSON object; using defaults".into());
        return (settings, diagnostics);
    };
    if let Some(value) = map.get(KEY_CLOSE_BEHAVIOR) {
        match value.as_str() {
            Some("quit") => settings.close_behavior = CloseBehavior::Quit,
            Some("tray") => settings.close_behavior = CloseBehavior::Tray,
            _ => diagnostics.push(skipped(KEY_CLOSE_BEHAVIOR, "is not \"quit\" or \"tray\"")),
        }
    }
    settings.shutdown_grace_ms = integer_in_range(
        &map,
        KEY_SHUTDOWN_GRACE_MS,
        &SHUTDOWN_GRACE_MS_RANGE,
        &mut diagnostics,
    );
    settings.restart_limit = integer_in_range(
        &map,
        KEY_RESTART_LIMIT,
        &RESTART_LIMIT_RANGE,
        &mut diagnostics,
    );
    (settings, diagnostics)
}

/// 파일을 읽어 해석한다. 파일이 없는 것은 오류가 아니라 기본값이다. 디렉터리가 없으면 진단을 남긴다.
pub fn load(dir: Option<&Path>) -> (DesktopSettings, Vec<String>) {
    let Some(dir) = dir else {
        return (
            DesktopSettings::default(),
            vec!["desktop settings: the config directory is unavailable; using defaults".into()],
        );
    };
    let file = match File::open(dir.join(FILE_NAME)) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return (DesktopSettings::default(), Vec::new());
        }
        Err(error) => {
            return (
                DesktopSettings::default(),
                vec![format!(
                    "desktop settings: the file could not be opened ({:?}); using defaults",
                    error.kind()
                )],
            );
        }
    };
    // 상한보다 한 바이트 더 읽어 넘었는지 본다.
    let mut bytes = Vec::new();
    if let Err(error) = file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes) {
        return (
            DesktopSettings::default(),
            vec![format!(
                "desktop settings: the file could not be read ({:?}); using defaults",
                error.kind()
            )],
        );
    }
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_FILE_BYTES {
        return (
            DesktopSettings::default(),
            vec!["desktop settings: the file is larger than 64 KiB; using defaults".into()],
        );
    }
    match std::str::from_utf8(&bytes) {
        Ok(text) => parse(text),
        Err(_) => (
            DesktopSettings::default(),
            vec!["desktop settings: the file is not UTF-8; using defaults".into()],
        ),
    }
}

/// `RunEvent::ExitRequested`에서 종료를 막을지 정한다.
/// 막는 경우는 트레이 유지이고 창이 모두 닫혀 생긴 종료(`code`가 없음)뿐이다. 그때 WebView는 이미 없고,
/// 셸과 엔진과 진행 중 turn은 남는다. 명시 종료(코드가 있는 `app.exit`, 신호)와 `quit`은
/// `Supervisor::on_exit_requested` 경로를 그대로 탄다 (§4.3).
pub fn should_prevent_exit(behavior: CloseBehavior, code: Option<i32>) -> bool {
    behavior == CloseBehavior::Tray && code.is_none()
}

/// 설정된 닫기 동작을 실제 동작으로 바꾼다. 트레이 유지인데 트레이 아이콘이 없으면 창을 닫은 뒤 남을 곳이 없으니 끝낸다.
pub fn effective_close_behavior(configured: CloseBehavior, tray_active: bool) -> CloseBehavior {
    match configured {
        CloseBehavior::Tray if !tray_active => CloseBehavior::Quit,
        other => other,
    }
}

/// 쓴 키와 값이 닫기 동작을 바꾸면 그 새 동작을 돌려준다. 다른 키이거나 값이 맞지 않으면 `None`이다.
pub fn close_behavior_update(key: &str, value: &Value) -> Option<CloseBehavior> {
    if key != KEY_CLOSE_BEHAVIOR {
        return None;
    }
    match value.as_str() {
        Some("quit") => Some(CloseBehavior::Quit),
        Some("tray") => Some(CloseBehavior::Tray),
        _ => None,
    }
}

/// `desktop_settings_read`: 설정 파일을 JSON 객체로 돌려준다. 파일이 없으면 `{}`다.
#[tauri::command]
pub async fn desktop_settings_read(app: AppHandle) -> Result<Value, CommandError> {
    let dir = config_dir(&app)?;
    read_object(&dir).map(Value::Object)
}

/// `desktop_settings_write`: 키 하나를 검사해 쓴다. 알 수 없는 키와 틀린 값은 `BadRequest`다.
/// 닫기 동작은 파일 쓰기가 성공한 뒤 셸 상태에도 바로 반영한다.
#[tauri::command]
pub async fn desktop_settings_write(
    app: AppHandle,
    key: String,
    value: Value,
) -> Result<(), CommandError> {
    let dir = config_dir(&app)?;
    let closing = close_behavior_update(&key, &value);
    write_key(&dir, &key, value)?;
    if let Some(behavior) = closing {
        *app.state::<Mutex<CloseBehavior>>()
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = behavior;
    }
    Ok(())
}

/// `load`와 같은 디렉터리(`app_config_dir`)를 쓴다.
fn config_dir(app: &AppHandle) -> Result<PathBuf, CommandError> {
    app.path()
        .app_config_dir()
        .map_err(|_| CommandError::StorageFailed)
}

/// 설정 파일을 JSON 객체로 읽는다. 파일이 없으면 빈 객체다. 크기, 인코딩, 형식이 틀리면 `StorageFailed`다.
pub fn read_object(dir: &Path) -> Result<Map<String, Value>, CommandError> {
    let file = match File::open(dir.join(FILE_NAME)) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Map::new()),
        Err(_) => return Err(CommandError::StorageFailed),
    };
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| CommandError::StorageFailed)?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_FILE_BYTES {
        return Err(CommandError::StorageFailed);
    }
    match serde_json::from_slice(&bytes) {
        Ok(Value::Object(map)) => Ok(map),
        _ => Err(CommandError::StorageFailed),
    }
}

/// 키 하나를 설정 파일에 쓴다. 다른 키는 그대로 두고, 파일 전체가 상한을 넘으면 `TooLarge`로 거부한다.
/// 상한을 넘은 파일은 `load`가 통째로 버리므로 쓰기 전에 막는다.
pub fn write_key(dir: &Path, key: &str, value: Value) -> Result<(), CommandError> {
    validate_entry(key, &value)?;
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut map = read_object(dir)?;
    map.insert(key.to_string(), value);
    let bytes = serde_json::to_vec(&Value::Object(map)).map_err(|_| CommandError::StorageFailed)?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_FILE_BYTES {
        return Err(CommandError::TooLarge);
    }
    std::fs::create_dir_all(dir).map_err(|_| CommandError::StorageFailed)?;
    write_atomic(dir, &bytes).map_err(|_| CommandError::StorageFailed)
}

/// 쓸 수 있는 키인지 보고, 알려진 키면 값이 `parse`와 같은 범위인지 본다. 아니면 `BadRequest`다.
pub fn validate_entry(key: &str, value: &Value) -> Result<(), CommandError> {
    let valid = match key {
        KEY_CLOSE_BEHAVIOR => matches!(value.as_str(), Some("quit" | "tray")),
        KEY_SHUTDOWN_GRACE_MS => value
            .as_i64()
            .is_some_and(|n| SHUTDOWN_GRACE_MS_RANGE.contains(&n)),
        KEY_RESTART_LIMIT => value
            .as_i64()
            .is_some_and(|n| RESTART_LIMIT_RANGE.contains(&n)),
        _ => UI_KEY_PREFIXES.iter().any(|prefix| key.starts_with(prefix)),
    };
    if valid {
        Ok(())
    } else {
        Err(CommandError::BadRequest)
    }
}

/// 임시 파일에 쓰고 디스크까지 내린 뒤 이름을 바꾼다. 도중에 끊겨도 기존 파일은 온전하다.
fn write_atomic(dir: &Path, bytes: &[u8]) -> io::Result<()> {
    let temp = dir.join(format!("{FILE_NAME}.tmp"));
    let written =
        write_synced(&temp, bytes).and_then(|()| std::fs::rename(&temp, dir.join(FILE_NAME)));
    if written.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    written
}

fn write_synced(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = File::create(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

fn integer_in_range(
    map: &Map<String, Value>,
    key: &str,
    range: &RangeInclusive<i64>,
    diagnostics: &mut Vec<String>,
) -> Option<i64> {
    let value = map.get(key)?;
    match value.as_i64() {
        Some(number) if range.contains(&number) => Some(number),
        Some(_) => {
            diagnostics.push(skipped(key, "is outside its range"));
            None
        }
        None => {
            diagnostics.push(skipped(key, "is not an integer"));
            None
        }
    }
}

fn skipped(key: &str, reason: &str) -> String {
    format!("desktop settings: {key} {reason}; using the default")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::Duration;

    use serde_json::json;

    use crate::engine::EngineConfig;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "fresnel-desktop-settings-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("the temp dir is created");
        dir
    }

    #[test]
    fn parse_reads_the_documented_flat_keys() {
        let text = r#"{"l4.desktop.window.closeBehavior":"tray","l4.desktop.engine.shutdownGraceMs":5000,"l4.desktop.engine.restartLimit":2}"#;
        let (settings, diagnostics) = parse(text);
        assert_eq!(
            settings,
            DesktopSettings {
                close_behavior: CloseBehavior::Tray,
                shutdown_grace_ms: Some(5000),
                restart_limit: Some(2),
            }
        );
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
    }

    #[test]
    fn parse_accepts_the_range_bounds_and_quit() {
        let (upper, diagnostics) = parse(
            r#"{"l4.desktop.window.closeBehavior":"quit","l4.desktop.engine.shutdownGraceMs":180000,"l4.desktop.engine.restartLimit":0}"#,
        );
        assert_eq!(upper.close_behavior, CloseBehavior::Quit);
        assert_eq!(upper.shutdown_grace_ms, Some(180_000));
        assert_eq!(upper.restart_limit, Some(0));
        assert!(diagnostics.is_empty(), "{diagnostics:?}");

        let (lower, diagnostics) = parse(
            r#"{"l4.desktop.engine.shutdownGraceMs":1000,"l4.desktop.engine.restartLimit":10}"#,
        );
        assert_eq!(lower.shutdown_grace_ms, Some(1000));
        assert_eq!(lower.restart_limit, Some(10));
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
    }

    /// 값 하나가 틀리면 그 키만 기본값이고 진단이 하나 남는다.
    #[test]
    fn parse_skips_each_invalid_value_with_one_diagnostic_naming_its_key() {
        let invalid = [
            (KEY_CLOSE_BEHAVIOR, r#""exit""#),
            (KEY_CLOSE_BEHAVIOR, r#""Tray""#),
            (KEY_CLOSE_BEHAVIOR, "1"),
            (KEY_CLOSE_BEHAVIOR, "null"),
            (KEY_SHUTDOWN_GRACE_MS, r#""5000""#),
            (KEY_SHUTDOWN_GRACE_MS, "5000.5"),
            (KEY_SHUTDOWN_GRACE_MS, "999"),
            (KEY_SHUTDOWN_GRACE_MS, "180001"),
            (KEY_SHUTDOWN_GRACE_MS, "true"),
            (KEY_RESTART_LIMIT, "-1"),
            (KEY_RESTART_LIMIT, "11"),
            (KEY_RESTART_LIMIT, "2.0"),
            (KEY_RESTART_LIMIT, "[2]"),
        ];
        for (key, value) in invalid {
            let text = format!(r#"{{"{key}":{value}}}"#);
            let (settings, diagnostics) = parse(&text);
            assert_eq!(settings, DesktopSettings::default(), "{text}");
            assert_eq!(diagnostics.len(), 1, "{text}: {diagnostics:?}");
            assert!(diagnostics[0].contains(key), "{text}: {diagnostics:?}");
        }
    }

    #[test]
    fn an_invalid_value_does_not_drop_the_valid_ones_next_to_it() {
        let (settings, diagnostics) = parse(
            r#"{"l4.desktop.window.closeBehavior":"tray","l4.desktop.engine.restartLimit":"two","l4.desktop.engine.shutdownGraceMs":6000}"#,
        );
        assert_eq!(settings.close_behavior, CloseBehavior::Tray);
        assert_eq!(settings.restart_limit, None);
        assert_eq!(settings.shutdown_grace_ms, Some(6000));
        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
    }

    /// 진단은 키 이름을 담고 다른 키의 값을 담지 않는다.
    #[test]
    fn diagnostics_name_the_key_and_never_echo_a_value() {
        let (_, diagnostics) = parse(
            r#"{"l4.desktop.window.closeBehavior":"zz-marker-one","l4.desktop.engine.restartLimit":"zz-marker-two"}"#,
        );
        assert_eq!(diagnostics.len(), 2, "{diagnostics:?}");
        let joined = diagnostics.join("\n");
        assert!(joined.contains(KEY_CLOSE_BEHAVIOR), "{joined}");
        assert!(joined.contains(KEY_RESTART_LIMIT), "{joined}");
        assert!(!joined.contains("zz-marker"), "{joined}");
    }

    #[test]
    fn corrupt_json_or_a_non_object_gives_all_defaults_and_one_diagnostic() {
        for text in [
            "",
            "{",
            "not json",
            r#"{"l4.desktop.window.closeBehavior":"tray","#,
            "[1,2]",
            r#""tray""#,
        ] {
            let (settings, diagnostics) = parse(text);
            assert_eq!(settings, DesktopSettings::default(), "{text:?}");
            assert_eq!(diagnostics.len(), 1, "{text:?}: {diagnostics:?}");
        }
    }

    #[test]
    fn an_empty_object_and_unknown_keys_are_ignored_without_a_diagnostic() {
        let (settings, diagnostics) = parse("{}");
        assert_eq!(settings, DesktopSettings::default());
        assert!(diagnostics.is_empty());

        let long_key = "k".repeat(10_000);
        let text = format!(
            r#"{{"l4.desktop.appearance.theme":"dark","l4.desktop.window.other":{{"x":1}},"{long_key}":"y","l4.desktop.engine.restartLimit":4}}"#
        );
        let (settings, diagnostics) = parse(&text);
        assert_eq!(settings.restart_limit, Some(4));
        assert_eq!(settings.close_behavior, CloseBehavior::Tray);
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
    }

    /// 기본 닫기 동작은 트레이 유지다. 설정 파일이 없거나 닫기 키가 없으면 이 값을 쓴다.
    #[test]
    fn the_close_behavior_defaults_to_tray_everywhere() {
        assert_eq!(CloseBehavior::default(), CloseBehavior::Tray);
        assert_eq!(
            DesktopSettings::default().close_behavior,
            CloseBehavior::Tray
        );
        assert_eq!(parse("{}").0.close_behavior, CloseBehavior::Tray);
        assert_eq!(
            parse(r#"{"l4.desktop.window.closeBehavior":"quit"}"#)
                .0
                .close_behavior,
            CloseBehavior::Quit,
            "명시한 quit은 그대로 둔다"
        );
    }

    /// 트레이가 없으면 설정이 tray여도 quit이 된다. 나머지 조합은 그대로다.
    #[test]
    fn a_tray_setting_without_a_tray_icon_quits_on_close() {
        let table = [
            (CloseBehavior::Quit, false, CloseBehavior::Quit),
            (CloseBehavior::Quit, true, CloseBehavior::Quit),
            (CloseBehavior::Tray, false, CloseBehavior::Quit),
            (CloseBehavior::Tray, true, CloseBehavior::Tray),
        ];
        for (configured, tray_active, expected) in table {
            assert_eq!(
                effective_close_behavior(configured, tray_active),
                expected,
                "{configured:?} with tray {tray_active}"
            );
        }
    }

    /// 쓰기 명령이 닫기 동작을 바꾸는 값은 quit과 tray뿐이다. 다른 키와 틀린 값은 상태를 바꾸지 않는다.
    #[test]
    fn a_close_behavior_write_updates_the_live_state_only_for_valid_values() {
        let key = KEY_CLOSE_BEHAVIOR;
        assert_eq!(
            close_behavior_update(key, &json!("tray")),
            Some(CloseBehavior::Tray)
        );
        assert_eq!(
            close_behavior_update(key, &json!("quit")),
            Some(CloseBehavior::Quit)
        );
        for value in [json!("exit"), json!("Tray"), json!(1), Value::Null] {
            assert_eq!(close_behavior_update(key, &value), None, "{value}");
        }
        assert_eq!(
            close_behavior_update(KEY_RESTART_LIMIT, &json!(2)),
            None,
            "다른 키는 닫기 동작을 바꾸지 않는다"
        );
        assert_eq!(
            close_behavior_update("l4.desktop.appearance.theme", &json!("tray")),
            None
        );
    }

    /// 범위 밖 숫자는 `parse`에서 걸러져 `from_values`가 기본값으로 바꾼다.
    #[test]
    fn out_of_range_numbers_fall_back_to_the_engine_defaults_through_parse() {
        let default = EngineConfig::default();
        for text in [
            r#"{"l4.desktop.engine.shutdownGraceMs":999,"l4.desktop.engine.restartLimit":11}"#,
            r#"{"l4.desktop.engine.shutdownGraceMs":180001,"l4.desktop.engine.restartLimit":-1}"#,
        ] {
            let (settings, _) = parse(text);
            let config =
                EngineConfig::from_values(settings.shutdown_grace_ms, settings.restart_limit);
            assert_eq!(config, default, "{text}");
        }
    }

    #[test]
    fn valid_values_reach_the_engine_config_through_parse() {
        let (settings, _) = parse(
            r#"{"l4.desktop.engine.shutdownGraceMs":5000,"l4.desktop.engine.restartLimit":0}"#,
        );
        let config = EngineConfig::from_values(settings.shutdown_grace_ms, settings.restart_limit);
        assert_eq!(config.shutdown_grace, Duration::from_millis(5000));
        assert_eq!(config.restart_limit, 0);
    }

    /// 종료 결정은 (동작 × 종료 코드) 모든 조합을 값으로 확인한다. `i32::MAX`는 tauri의 재시작 코드다.
    #[test]
    fn only_a_tray_close_without_an_exit_code_is_prevented() {
        let table = [
            (CloseBehavior::Quit, None, false),
            (CloseBehavior::Quit, Some(0), false),
            (CloseBehavior::Quit, Some(1), false),
            (CloseBehavior::Quit, Some(-1), false),
            (CloseBehavior::Quit, Some(i32::MAX), false),
            (CloseBehavior::Tray, None, true),
            (CloseBehavior::Tray, Some(0), false),
            (CloseBehavior::Tray, Some(1), false),
            (CloseBehavior::Tray, Some(-1), false),
            (CloseBehavior::Tray, Some(i32::MAX), false),
        ];
        for (behavior, code, expected) in table {
            assert_eq!(
                should_prevent_exit(behavior, code),
                expected,
                "{behavior:?} with {code:?}"
            );
        }
    }

    #[test]
    fn load_without_a_directory_reports_it_and_uses_defaults() {
        let (settings, diagnostics) = load(None);
        assert_eq!(settings, DesktopSettings::default());
        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
    }

    #[test]
    fn load_of_a_missing_directory_or_a_missing_file_is_silent() {
        let missing = std::env::temp_dir().join(format!(
            "fresnel-desktop-settings-missing-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&missing);
        let (settings, diagnostics) = load(Some(&missing));
        assert_eq!(settings, DesktopSettings::default());
        assert!(diagnostics.is_empty(), "{diagnostics:?}");

        let dir = scratch_dir("no-file");
        let (settings, diagnostics) = load(Some(&dir));
        assert_eq!(settings, DesktopSettings::default());
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_reads_the_file_in_the_directory() {
        let dir = scratch_dir("read");
        std::fs::write(
            dir.join(FILE_NAME),
            r#"{"l4.desktop.window.closeBehavior":"tray","l4.desktop.engine.restartLimit":1}"#,
        )
        .expect("the settings file is written");
        let (settings, diagnostics) = load(Some(&dir));
        assert_eq!(settings.close_behavior, CloseBehavior::Tray);
        assert_eq!(settings.restart_limit, Some(1));
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 파일이 상한을 넘으면 앞부분이 맞아도 전체를 기본값으로 쓴다. 정확히 상한이면 읽는다.
    #[test]
    fn load_refuses_a_file_over_64_kib_and_reads_one_of_exactly_64_kib() {
        let dir = scratch_dir("cap");
        let head = r#"{"l4.desktop.engine.restartLimit":2}"#;
        let padded = |total: usize| format!("{head}{}", " ".repeat(total - head.len()));

        std::fs::write(dir.join(FILE_NAME), padded(65 * 1024)).expect("written");
        let (settings, diagnostics) = load(Some(&dir));
        assert_eq!(settings, DesktopSettings::default());
        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");

        std::fs::write(dir.join(FILE_NAME), padded(64 * 1024)).expect("written");
        let (settings, diagnostics) = load(Some(&dir));
        assert_eq!(settings.restart_limit, Some(2));
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_of_a_file_that_is_not_utf8_uses_defaults() {
        let dir = scratch_dir("utf8");
        std::fs::write(dir.join(FILE_NAME), [0xff_u8, 0xfe, 0x00]).expect("written");
        let (settings, diagnostics) = load(Some(&dir));
        assert_eq!(settings, DesktopSettings::default());
        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ----- 쓰기 명령 (desktop_settings_read/write) -----

    #[test]
    fn read_of_a_missing_file_is_an_empty_object() {
        let dir = scratch_dir("read-absent");
        assert_eq!(read_object(&dir), Ok(Map::new()));
    }

    #[test]
    fn write_then_read_returns_the_keys_that_were_written() {
        let dir = scratch_dir("write-read");
        assert_eq!(write_key(&dir, KEY_RESTART_LIMIT, json!(2)), Ok(()));
        assert_eq!(
            write_key(&dir, "l4.desktop.appearance.theme", json!("dark")),
            Ok(())
        );
        assert_eq!(write_key(&dir, KEY_CLOSE_BEHAVIOR, json!("tray")), Ok(()));
        let read = Value::Object(read_object(&dir).expect("the file reads back"));
        assert_eq!(
            read,
            json!({
                "l4.desktop.engine.restartLimit": 2,
                "l4.desktop.appearance.theme": "dark",
                "l4.desktop.window.closeBehavior": "tray"
            })
        );
        // 쓴 파일은 시작할 때 읽는 `load`가 그대로 받는다. 임시 파일은 남지 않는다.
        let (settings, diagnostics) = load(Some(&dir));
        assert_eq!(settings.restart_limit, Some(2));
        assert_eq!(settings.close_behavior, CloseBehavior::Tray);
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        assert!(!dir.join(format!("{FILE_NAME}.tmp")).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_rejects_an_unknown_key_and_creates_no_file() {
        let dir = scratch_dir("reject-key");
        for key in [
            "l4.desktop.engine.bogus",
            "l4.desktop.engine.restartLimitX",
            "l4.desktop.window",
            "other.app.key",
            "",
        ] {
            assert_eq!(
                write_key(&dir, key, json!(1)),
                Err(CommandError::BadRequest),
                "{key:?}"
            );
        }
        assert!(!dir.join(FILE_NAME).exists());
        assert_eq!(read_object(&dir), Ok(Map::new()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_rejects_a_known_key_with_a_bad_value_and_keeps_the_file_as_it_was() {
        let dir = scratch_dir("reject-value");
        assert_eq!(write_key(&dir, KEY_RESTART_LIMIT, json!(2)), Ok(()));
        let before = std::fs::read(dir.join(FILE_NAME)).expect("read");
        let cases = [
            (KEY_RESTART_LIMIT, json!(11)),
            (KEY_RESTART_LIMIT, json!(-1)),
            (KEY_RESTART_LIMIT, json!("2")),
            (KEY_RESTART_LIMIT, json!(2.0)),
            (KEY_SHUTDOWN_GRACE_MS, json!(999)),
            (KEY_SHUTDOWN_GRACE_MS, json!(180_001)),
            (KEY_CLOSE_BEHAVIOR, json!("exit")),
            (KEY_CLOSE_BEHAVIOR, json!("Tray")),
            (KEY_CLOSE_BEHAVIOR, Value::Null),
        ];
        for (key, value) in cases {
            assert_eq!(
                write_key(&dir, key, value.clone()),
                Err(CommandError::BadRequest),
                "{key} = {value}"
            );
        }
        assert_eq!(std::fs::read(dir.join(FILE_NAME)).expect("read"), before);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn known_keys_accept_their_range_bounds_and_their_enum_values() {
        assert_eq!(validate_entry(KEY_SHUTDOWN_GRACE_MS, &json!(1000)), Ok(()));
        assert_eq!(
            validate_entry(KEY_SHUTDOWN_GRACE_MS, &json!(180_000)),
            Ok(())
        );
        assert_eq!(validate_entry(KEY_RESTART_LIMIT, &json!(0)), Ok(()));
        assert_eq!(validate_entry(KEY_RESTART_LIMIT, &json!(10)), Ok(()));
        assert_eq!(validate_entry(KEY_CLOSE_BEHAVIOR, &json!("quit")), Ok(()));
        assert_eq!(validate_entry(KEY_CLOSE_BEHAVIOR, &json!("tray")), Ok(()));
        assert_eq!(
            validate_entry("l4.desktop.firstRun.done", &json!({"at": "2026-11-03"})),
            Ok(())
        );
    }

    /// 파일이 상한을 넘게 되는 쓰기는 거부한다. 거부하면 파일은 그대로 남아 `load`가 읽는다.
    #[test]
    fn write_refuses_a_value_that_would_push_the_file_over_64_kib() {
        let dir = scratch_dir("too-large");
        assert_eq!(write_key(&dir, KEY_RESTART_LIMIT, json!(2)), Ok(()));
        let big = Value::String("x".repeat(64 * 1024));
        assert_eq!(
            write_key(&dir, "l4.desktop.workbench.draft", big),
            Err(CommandError::TooLarge)
        );
        assert_eq!(
            Value::Object(read_object(&dir).expect("still readable")),
            json!({"l4.desktop.engine.restartLimit": 2})
        );
        let (settings, diagnostics) = load(Some(&dir));
        assert_eq!(settings.restart_limit, Some(2));
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 틀린 파일은 읽지도 쓰지도 않는다. 쓰기가 틀린 파일을 덮어쓰면 남은 키가 사라진다.
    #[test]
    fn a_damaged_file_is_neither_read_nor_overwritten() {
        let dir = scratch_dir("damaged");
        for text in ["{ not json", "[1,2]", "\"tray\"", ""] {
            std::fs::write(dir.join(FILE_NAME), text).expect("written");
            assert_eq!(
                read_object(&dir),
                Err(CommandError::StorageFailed),
                "{text:?}"
            );
            assert_eq!(
                write_key(&dir, KEY_RESTART_LIMIT, json!(2)),
                Err(CommandError::StorageFailed),
                "{text:?}"
            );
            assert_eq!(
                std::fs::read_to_string(dir.join(FILE_NAME)).expect("read"),
                text
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_creates_a_missing_config_directory() {
        let dir = std::env::temp_dir().join(format!(
            "fresnel-desktop-settings-mkdir-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(write_key(&dir, KEY_RESTART_LIMIT, json!(3)), Ok(()));
        assert_eq!(
            Value::Object(read_object(&dir).expect("reads back")),
            json!({"l4.desktop.engine.restartLimit": 3})
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
