//! OS 알림 (B-10). WebView에는 알림 플러그인 권한(`notification:default`)을 주지 않는다. 띄우는 일은 이 파일의 명령이 Rust에서 한다.
//!
//! 알림 클릭: tauri-plugin-notification 2.8.0 데스크톱에는 `Notification::on_action`으로 클릭을 알리는 길이 있다(desktop.rs).
//! 이 모듈은 그 콜백을 등록하지 않는다. 클릭으로 앱이 앞에 올라오면 WebView가 `notify_take_target`으로 마지막 알림 대화를 가져간다.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::{NotificationExt, PermissionState};

use crate::applog::AppLog;
use crate::relay::CommandError;

const TITLE_MAX_CHARS: usize = 80;
const BODY_MAX_CHARS: usize = 400;
const THREAD_ID_MAX_CHARS: usize = 128;
/// 마지막 알림 대화를 가져갈 수 있는 시간.
const TARGET_LIFETIME: Duration = Duration::from_secs(30);

/// 마지막으로 알림을 띄운 대화의 id와 기록 시각. `notify_take_target`이 가져가 비운다.
#[derive(Default)]
pub struct NotifyTarget(pub Mutex<Option<(String, Instant)>>);

/// `notify_os`의 답. 실패는 종류로만 알린다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NotifyReply {
    Shown,
    Denied,
    Failed,
}

/// 글을 좁힌다. 줄바꿈과 탭은 빈칸으로 바꾸고 나머지 제어 문자는 뺀다. 앞뒤 공백을 떼고 `max`자까지 남긴다.
pub fn clean(text: &str, max: usize) -> String {
    text.chars()
        .filter_map(|c| match c {
            '\n' | '\r' | '\t' => Some(' '),
            c if c.is_control() => None,
            c => Some(c),
        })
        .take(max)
        .collect::<String>()
        .trim()
        .to_string()
}

/// 대화 id를 기록해도 되는 형식인지 본다. 비어 있지 않고, 128자 이하이며, 제어 문자가 없어야 한다.
pub fn valid_thread_id(id: &str) -> bool {
    !id.is_empty() && id.chars().count() <= THREAD_ID_MAX_CHARS && !id.chars().any(char::is_control)
}

/// 권한 상태를 WebView가 읽는 글로 옮긴다.
pub fn permission_word(state: PermissionState) -> &'static str {
    match state {
        PermissionState::Granted => "granted",
        PermissionState::Denied => "denied",
        PermissionState::Prompt | PermissionState::PromptWithRationale => "prompt",
    }
}

/// 마지막 알림 대화를 한 번 가져간다. 30초 안이면 대화 id를 돌려주고, 어느 경우든 칸을 비운다.
pub fn take_target(slot: &mut Option<(String, Instant)>, now: Instant) -> Option<String> {
    let (thread_id, recorded) = slot.take()?;
    (now.saturating_duration_since(recorded) <= TARGET_LIFETIME).then_some(thread_id)
}

/// 알림 권한 상태. 데스크톱 플러그인은 늘 허용으로 답한다. 알 수 없거나 읽지 못하면 `prompt`다.
#[tauri::command]
pub fn notify_permission(app: AppHandle) -> &'static str {
    app.notification()
        .permission_state()
        .map_or("prompt", permission_word)
}

/// 권한을 요청한다. 데스크톱은 묻지 않고 허용으로 답한다. 알 수 없으면 `prompt`다.
#[tauri::command]
pub fn notify_request_permission(app: AppHandle) -> &'static str {
    app.notification()
        .request_permission()
        .map_or("prompt", permission_word)
}

/// OS 알림을 띄운다. 제목이 비면 `BadRequest`다. 대화 id가 형식에 맞으면 띄우기 전에 마지막 알림 대화로 기록한다.
/// 권한이 거부되었으면 띄우지 않고 `denied`, 전달이 실패하면 `failed`를 돌려준다. 앱은 계속 돈다.
#[tauri::command]
pub fn notify_os(
    app: AppHandle,
    title: String,
    body: Option<String>,
    thread_id: Option<String>,
) -> Result<NotifyReply, CommandError> {
    let title = clean(&title, TITLE_MAX_CHARS);
    if title.is_empty() {
        return Err(CommandError::BadRequest);
    }
    let body = body
        .map(|text| clean(&text, BODY_MAX_CHARS))
        .filter(|text| !text.is_empty());
    let notification = app.notification();
    if matches!(notification.permission_state(), Ok(PermissionState::Denied)) {
        return Ok(NotifyReply::Denied);
    }
    if let Some(thread_id) = thread_id.filter(|id| valid_thread_id(id)) {
        record_target(&app, thread_id);
    }
    let mut builder = notification.builder().title(title);
    if let Some(body) = body {
        builder = builder.body(body);
    }
    match builder.show() {
        Ok(()) => Ok(NotifyReply::Shown),
        Err(_) => {
            app.state::<Arc<AppLog>>()
                .line("notify: not shown (reason: show_failed)");
            Ok(NotifyReply::Failed)
        }
    }
}

/// 알림을 눌러 앞에 올라온 WebView가 마지막 알림 대화를 가져간다. 30초 안의 것만, 한 번 준다.
#[tauri::command]
pub fn notify_take_target(app: AppHandle) -> Option<String> {
    let target = app.state::<NotifyTarget>();
    let mut slot = target.0.lock().unwrap_or_else(|e| e.into_inner());
    take_target(&mut slot, Instant::now())
}

fn record_target(app: &AppHandle, thread_id: String) {
    let target = app.state::<NotifyTarget>();
    *target.0.lock().unwrap_or_else(|e| e.into_inner()) = Some((thread_id, Instant::now()));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn clean_drops_control_characters_and_turns_line_breaks_into_spaces() {
        assert_eq!(
            clean("  안녕\u{7}하세요\n\t끝  ", 80),
            "안녕하세요  끝",
            "벨 문자는 빠지고 줄바꿈과 탭은 빈칸이 된다"
        );
        assert_eq!(clean("\u{1b}[31mred", 80), "[31mred");
        assert_eq!(clean(" \n\t\r ", 80), "");
    }

    #[test]
    fn clean_keeps_at_most_max_characters_not_bytes() {
        assert_eq!(clean(&"가".repeat(100), 80).chars().count(), 80);
        assert_eq!(clean(&"a".repeat(400), 400).chars().count(), 400);
        assert_eq!(clean(&"a".repeat(401), 400).chars().count(), 400);
    }

    #[test]
    fn a_thread_id_is_recorded_only_when_it_is_short_nonempty_and_printable() {
        assert!(!valid_thread_id(""));
        assert!(valid_thread_id("t-1"));
        assert!(valid_thread_id(&"가".repeat(128)));
        assert!(!valid_thread_id(&"가".repeat(129)));
        assert!(!valid_thread_id("a\nb"));
        assert!(!valid_thread_id("a\u{0}"));
        assert!(!valid_thread_id("a\u{7f}"));
    }

    #[test]
    fn every_permission_state_has_one_word_and_prompt_is_the_fallback() {
        assert_eq!(permission_word(PermissionState::Granted), "granted");
        assert_eq!(permission_word(PermissionState::Denied), "denied");
        assert_eq!(permission_word(PermissionState::Prompt), "prompt");
        assert_eq!(
            permission_word(PermissionState::PromptWithRationale),
            "prompt"
        );
    }

    #[test]
    fn the_target_is_taken_once_within_thirty_seconds() {
        let recorded = Instant::now();
        let mut slot = Some(("thread-a".to_string(), recorded));
        assert_eq!(
            take_target(&mut slot, recorded + Duration::from_secs(30)),
            Some("thread-a".to_string())
        );
        assert_eq!(slot, None);
        assert_eq!(take_target(&mut slot, recorded), None, "한 번만 준다");
    }

    #[test]
    fn a_target_older_than_thirty_seconds_is_cleared_and_not_given() {
        let recorded = Instant::now();
        let mut slot = Some(("thread-a".to_string(), recorded));
        assert_eq!(
            take_target(&mut slot, recorded + Duration::from_secs(31)),
            None
        );
        assert_eq!(slot, None, "오래된 것도 칸은 비운다");
    }

    #[test]
    fn an_empty_slot_gives_nothing() {
        let mut slot: Option<(String, Instant)> = None;
        assert_eq!(take_target(&mut slot, Instant::now()), None);
    }

    #[test]
    fn replies_serialize_with_a_kind_tag() {
        assert_eq!(
            serde_json::to_value(NotifyReply::Shown).expect("the reply serializes"),
            json!({ "kind": "shown" })
        );
        assert_eq!(
            serde_json::to_value(NotifyReply::Denied).expect("the reply serializes"),
            json!({ "kind": "denied" })
        );
        assert_eq!(
            serde_json::to_value(NotifyReply::Failed).expect("the reply serializes"),
            json!({ "kind": "failed" })
        );
    }
}
