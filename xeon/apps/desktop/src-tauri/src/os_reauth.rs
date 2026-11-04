//! 사람 재인증 명령 `os_reauth`(L4.desktop.spec §4.17, L0.secrets.spec §4.9.1). macOS에서는 Touch ID나 기기 암호 창을 띄운다.
//! 창은 `LAContext.evaluatePolicy`가 띄우고, 답은 reply 블록으로 비동기에 온다. 명령은 답을 기다리기만 하므로 메인 스레드를 막지 않는다.
//! 사유 문구와 값은 로그에 쓰지 않는다. 로그에는 결과 종류만 남긴다.

use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::applog::AppLog;
use crate::time::now_ms;

/// 사유 문구의 상한(문자 수). 시스템 창에 한 줄로 들어가는 길이다.
const MAX_REASON_CHARS: usize = 120;
/// 사유가 비었을 때 창에 보이는 문구.
const DEFAULT_REASON: &str = "Fresnel";

/// 인증 증거. `verified_at_ms`는 인증이 끝난 시각(Unix epoch 밀리초)이다. reveal은 60초 안의 증거만 받는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReauthGrant {
    pub verified_at_ms: u64,
}

/// WebView로 돌려주는 오류. `{ "kind": "..." }`다(secret_entry.rs의 `SecretEntryError`와 같은 모양).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ReauthError {
    /// 사람이 창을 닫았거나, 시스템이나 앱이 인증을 끊었다
    Cancelled,
    /// 인증이 거절됐다(암호가 틀림, 생체 인증 실패)
    Denied,
    /// 이 기기와 세션에서 인증할 수단이 없다(암호 미설정, 비대화형 세션, macOS가 아님)
    Unavailable,
    /// 그 밖의 실패
    Failed,
}

/// 시스템 창에 보일 문구. 제어 문자는 공백으로 바꾸고, 공백은 한 칸으로 줄이고, 120자로 자른다. 비면 "Fresnel"이다.
pub fn prompt_text(reason: &str) -> String {
    let spaced: String = reason
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let text = spaced.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return DEFAULT_REASON.to_string();
    }
    // 자른 자리에 공백이 남으면 떼어 낸다. 창 문구 끝에 빈칸이 남지 않게 한다
    text.chars()
        .take(MAX_REASON_CHARS)
        .collect::<String>()
        .trim_end()
        .to_string()
}

/// LAError 코드(NSInteger)를 오류 종류로 바꾼다. 값은 LocalAuthentication의 LAError 상수다(objc2-local-authentication 0.3.2 확인).
/// 여기 없는 코드는 모두 `failed`다. 비-macOS 빌드는 이 함수를 쓰지 않는다.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn kind_for_la_error(code: isize) -> ReauthError {
    match code {
        // LAErrorAuthenticationFailed
        -1 => ReauthError::Denied,
        // LAErrorUserCancel
        -2 => ReauthError::Cancelled,
        // LAErrorUserFallback: 사람이 인증 대신 다른 길을 골라 창을 떠났다. 인증은 되지 않았다
        -3 => ReauthError::Cancelled,
        // LAErrorSystemCancel
        -4 => ReauthError::Cancelled,
        // LAErrorPasscodeNotSet
        -5 => ReauthError::Unavailable,
        // LAErrorBiometryNotAvailable
        -6 => ReauthError::Unavailable,
        // LAErrorBiometryNotEnrolled
        -7 => ReauthError::Unavailable,
        // LAErrorBiometryLockout
        -8 => ReauthError::Unavailable,
        // LAErrorAppCancel
        -9 => ReauthError::Cancelled,
        // LAErrorInvalidContext
        -10 => ReauthError::Failed,
        // LAErrorNotInteractive
        -1004 => ReauthError::Unavailable,
        _ => ReauthError::Failed,
    }
}

/// 재인증 창을 띄우고 답을 기다린다. 성공하면 `Ok`다.
#[cfg(target_os = "macos")]
async fn evaluate(reason: &str) -> Result<(), ReauthError> {
    let received = native::start(reason);
    match received.await {
        Ok(outcome) => outcome,
        // 답을 쓰기 전에 보내는 쪽이 사라졌다. 답이 없으니 실패다
        Err(_) => Err(ReauthError::Failed),
    }
}

/// macOS가 아니면 Touch ID나 기기 암호 창이 없다. 다른 OS의 인증은 후속이다(L0.secrets.spec §4.9.1).
#[cfg(not(target_os = "macos"))]
async fn evaluate(_reason: &str) -> Result<(), ReauthError> {
    Err(ReauthError::Unavailable)
}

#[cfg(target_os = "macos")]
mod native {
    use std::sync::Mutex;

    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};
    use tokio::sync::oneshot;

    use super::{kind_for_la_error, ReauthError};

    /// 평가를 시작하고 답을 받을 수신단을 돌려준다. 이 호출은 기다리지 않는다.
    pub fn start(reason: &str) -> oneshot::Receiver<Result<(), ReauthError>> {
        let (answer, received) = oneshot::channel();
        let reason = NSString::from_str(reason);
        let context = unsafe { LAContext::new() };
        // reply 블록이 컨텍스트를 쥐고 있어 평가가 끝날 때까지 살아 있다. LAContext 문서는 평가 중에 강한 참조를 두라고 한다
        let kept = context.clone();
        let slot = Mutex::new(Some(answer));
        let reply = RcBlock::new(move |success: Bool, error: *mut NSError| {
            let outcome = if success.as_bool() {
                Ok(())
            } else {
                Err(error_kind(unsafe { error.as_ref() }))
            };
            // 답은 한 번만 보낸다. 받는 쪽이 이미 없으면 버린다
            if let Some(answer) = slot.lock().ok().and_then(|mut guard| guard.take()) {
                let _ = answer.send(outcome);
            }
            // 평가가 끝났으니 컨텍스트를 무효화한다
            unsafe { kept.invalidate() };
        });
        unsafe {
            context.evaluatePolicy_localizedReason_reply(
                LAPolicy::DeviceOwnerAuthentication,
                &reason,
                &reply,
            )
        };
        received
    }

    /// 실패 답의 오류 객체를 종류로 바꾼다. 오류 객체가 없으면 실패다.
    fn error_kind(error: Option<&NSError>) -> ReauthError {
        error.map_or(ReauthError::Failed, |error| kind_for_la_error(error.code()))
    }
}

/// 사람 재인증 명령. 시스템 Touch ID나 기기 암호 창을 띄우고, 인증되면 인증 시각을 돌려준다.
#[tauri::command]
pub async fn os_reauth(
    reason: String,
    log: State<'_, Arc<AppLog>>,
) -> Result<ReauthGrant, ReauthError> {
    let outcome = evaluate(&prompt_text(&reason)).await;
    // 사유와 값은 쓰지 않는다. 결과 종류만 쓴다
    log.line(&format!("os reauth: {}", outcome_text(&outcome)));
    outcome.map(|()| ReauthGrant {
        verified_at_ms: now_ms(),
    })
}

fn outcome_text(outcome: &Result<(), ReauthError>) -> &'static str {
    match outcome {
        Ok(()) => "ok",
        Err(ReauthError::Cancelled) => "cancelled",
        Err(ReauthError::Denied) => "denied",
        Err(ReauthError::Unavailable) => "unavailable",
        Err(ReauthError::Failed) => "failed",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn prompt_keeps_plain_text_and_joins_whitespace_runs() {
        assert_eq!(
            prompt_text("  Show   the\tsecret\nvalue  "),
            "Show the secret value"
        );
    }

    #[test]
    fn prompt_turns_control_characters_into_spaces() {
        assert_eq!(prompt_text("a\u{1b}[31mb"), "a [31mb");
    }

    #[test]
    fn empty_or_blank_prompt_falls_back_to_the_app_name() {
        assert_eq!(prompt_text(""), "Fresnel");
        assert_eq!(prompt_text("  \n\t "), "Fresnel");
        assert_eq!(prompt_text("\u{0}\u{7}"), "Fresnel");
    }

    #[test]
    fn prompt_is_clipped_to_120_characters() {
        assert_eq!(prompt_text(&"a".repeat(200)), "a".repeat(120));
    }

    #[test]
    fn prompt_counts_characters_not_bytes() {
        assert_eq!(prompt_text(&"가".repeat(130)), "가".repeat(120));
    }

    #[test]
    fn clipping_does_not_leave_a_trailing_space() {
        let reason = format!("{} b", "a".repeat(119));
        assert_eq!(prompt_text(&reason), "a".repeat(119));
    }

    #[test]
    fn authentication_failed_is_denied() {
        assert_eq!(kind_for_la_error(-1), ReauthError::Denied);
    }

    #[test]
    fn user_and_system_and_app_cancels_are_cancelled() {
        assert_eq!(kind_for_la_error(-2), ReauthError::Cancelled);
        assert_eq!(kind_for_la_error(-3), ReauthError::Cancelled);
        assert_eq!(kind_for_la_error(-4), ReauthError::Cancelled);
        assert_eq!(kind_for_la_error(-9), ReauthError::Cancelled);
    }

    #[test]
    fn missing_passcode_or_biometry_and_non_interactive_are_unavailable() {
        assert_eq!(kind_for_la_error(-5), ReauthError::Unavailable);
        assert_eq!(kind_for_la_error(-6), ReauthError::Unavailable);
        assert_eq!(kind_for_la_error(-7), ReauthError::Unavailable);
        assert_eq!(kind_for_la_error(-8), ReauthError::Unavailable);
        assert_eq!(kind_for_la_error(-1004), ReauthError::Unavailable);
    }

    #[test]
    fn invalid_context_and_unmapped_codes_are_failed() {
        assert_eq!(kind_for_la_error(-10), ReauthError::Failed);
        // LAErrorWatchNotAvailable(-11)과 LAErrorBiometryNotPaired(-12)는 여기서 따로 매핑하지 않는다
        assert_eq!(kind_for_la_error(-11), ReauthError::Failed);
        assert_eq!(kind_for_la_error(-12), ReauthError::Failed);
        assert_eq!(kind_for_la_error(0), ReauthError::Failed);
        assert_eq!(kind_for_la_error(-999), ReauthError::Failed);
    }

    #[test]
    fn error_serializes_as_a_kind_object() {
        assert_eq!(
            serde_json::to_value(ReauthError::Cancelled).expect("serializes"),
            json!({ "kind": "cancelled" })
        );
        assert_eq!(
            serde_json::to_value(ReauthError::Denied).expect("serializes"),
            json!({ "kind": "denied" })
        );
        assert_eq!(
            serde_json::to_value(ReauthError::Unavailable).expect("serializes"),
            json!({ "kind": "unavailable" })
        );
        assert_eq!(
            serde_json::to_value(ReauthError::Failed).expect("serializes"),
            json!({ "kind": "failed" })
        );
    }

    #[test]
    fn grant_serializes_the_verified_time_in_camel_case() {
        let grant = ReauthGrant {
            verified_at_ms: 1_792_800_000_123,
        };
        assert_eq!(
            serde_json::to_value(grant).expect("serializes"),
            json!({ "verifiedAtMs": 1_792_800_000_123_u64 })
        );
    }

    #[cfg(not(target_os = "macos"))]
    #[tokio::test]
    async fn without_macos_there_is_no_prompt_and_the_answer_is_unavailable() {
        assert_eq!(evaluate("Fresnel").await, Err(ReauthError::Unavailable));
    }
}
