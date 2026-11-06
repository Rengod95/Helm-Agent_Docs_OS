//! 앱 업데이트 셸 쪽(B-10). 서명 공개키와 배포 주소가 `tauri.conf.json`의 `plugins.updater`에 모두 채워져 있을 때만
//! 업데이트 플러그인을 등록한다. 비어 있으면 플러그인은 등록되지 않고 명령은 `notConfigured`를 돌려준다. 앱은 그대로 동작한다.
//!
//! WebView에는 플러그인 권한(`updater:default`)을 주지 않는다. 확인, 내려받기, 설치는 이 파일의 명령이 Rust에서 부른다.
//! 찾은 업데이트와 내려받은 바이트는 `UpdaterState`에 둔다. 서명 검증은 플러그인의 `download`와 `install`이 한다.

use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{App, AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::applog::AppLog;
use crate::engine::AppSupervisor;

/// 확인 한 번을 기다리는 상한. 응답이 멈춰도 `busy`가 풀리지 않는 일을 막는다. 넘으면 연결 불가로 본다.
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);

/// 업데이트 상태. `configured`는 플러그인을 등록했는지다. 찾은 업데이트와 내려받은 바이트는 `pending`에 둔다.
pub struct UpdaterState {
    configured: bool,
    pending: Mutex<Pending>,
    /// 확인, 내려받기, 설치 가운데 하나가 도는 동안 참이다. 겹치면 `busy`로 돌려보낸다.
    busy: AtomicBool,
}

#[derive(Default)]
struct Pending {
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}

impl UpdaterState {
    fn new(configured: bool) -> Self {
        Self {
            configured,
            pending: Mutex::new(Pending::default()),
            busy: AtomicBool::new(false),
        }
    }

    fn lock_pending(&self) -> MutexGuard<'_, Pending> {
        self.pending.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 바쁘지 않으면 플래그를 쥔 가드를 돌려준다. 가드가 떨어지면 플래그를 내린다.
    fn try_busy(&self) -> Option<BusyGuard<'_>> {
        self.busy
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .ok()
            .map(|_| BusyGuard(&self.busy))
    }
}

/// `busy` 플래그를 쥐고 있는 동안만 참이다.
struct BusyGuard<'a>(&'a AtomicBool);

impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// 설정을 보고 플러그인을 등록할지 정한 뒤 상태를 앱에 얹는다. main.rs `.setup`이 부른다.
/// 설정이 틀렸거나 등록이 실패하면 `configured`는 거짓이고, 로그에는 이유 코드만 남는다(주소와 키는 쓰지 않는다).
pub fn manage(app: &App, log: &AppLog) {
    let mut configured = is_configured(app.config().plugins.0.get("updater"));
    if configured
        && app
            .handle()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .is_err()
    {
        configured = false;
        log.line("updater: plugin registration failed, updates are off (reason: register_failed)");
    }
    app.manage(UpdaterState::new(configured));
}

/// 업데이트 설정이 쓸 만한지 본다. 서명 공개키가 공백 아닌 문자열이고, 배포 주소가 비어 있지 않은 배열이며
/// 그 원소가 모두 공백 아닌 문자열일 때만 참이다. 없음, `null`, 형식이 다른 값은 모두 거짓이다.
pub fn is_configured(plugin_config: Option<&serde_json::Value>) -> bool {
    let Some(config) = plugin_config else {
        return false;
    };
    let has_pubkey = config
        .get("pubkey")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|key| !key.trim().is_empty());
    let has_endpoints = config
        .get("endpoints")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|list| {
            !list.is_empty()
                && list
                    .iter()
                    .all(|item| item.as_str().is_some_and(|url| !url.trim().is_empty()))
        });
    has_pubkey && has_endpoints
}

/// 명령의 답. WebView는 `kind`로 가른다. 실패는 오류를 줄인 이유 코드로만 알린다.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UpdateReply {
    NotConfigured,
    UpToDate,
    Available {
        version: String,
        notes: Option<String>,
    },
    Offline,
    Failed {
        reason: &'static str,
    },
    Ready,
}

/// 내려받는 동안 채널로 보내는 진행 알림. `downloaded`는 지금까지 받은 바이트 수다.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DownloadEvent {
    Progress { downloaded: u64, total: Option<u64> },
}

/// `update_status`의 답. `currentVersion`은 패키지 정보에서 읽는다.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterStatus {
    configured: bool,
    current_version: String,
}

/// 플러그인 오류를 줄인 분류. 이유 문자열에는 주소, 키, 파일 경로를 넣지 않는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    /// 연결하지 못했다(연결 불가, DNS, 시간 초과).
    Offline,
    /// 그 밖의 실패. 이유 코드만 든다.
    Reason(&'static str),
}

impl Failure {
    fn into_reply(self) -> UpdateReply {
        match self {
            Failure::Offline => UpdateReply::Offline,
            Failure::Reason(reason) => UpdateReply::Failed { reason },
        }
    }
}

/// 플러그인 오류를 분류한다. 연결 문제는 `Offline`, 나머지는 이유 코드다.
pub fn failure_of(error: &tauri_plugin_updater::Error) -> Failure {
    use tauri_plugin_updater::Error;
    match error {
        // reqwest는 직접 의존이 아니라 이름을 쓸 수 없다. 메서드로 종류만 읽고 판정은 `reqwest_failure`가 한다.
        Error::Reqwest(err) => reqwest_failure(
            err.is_connect() || err.is_timeout() || err.is_request(),
            err.is_decode(),
            err.is_body(),
        ),
        // 배포 서버가 쓸 릴리스를 주지 않았다. 404는 ReleaseNotFound, 빈 응답이나 JSON이 아닌 응답은 Serialization이다.
        Error::ReleaseNotFound
        | Error::Serialization(_)
        | Error::TargetNotFound(_)
        | Error::TargetsNotFound(_) => Failure::Reason("no_release"),
        // 내려받는 중 응답이 성공이 아니었다.
        Error::Network(_) => Failure::Reason("network"),
        // 서명이 맞지 않거나 검증할 수 없다.
        Error::Minisign(_)
        | Error::SignatureUtf8(_)
        | Error::Base64(_)
        | Error::SignedVersionMismatch { .. }
        | Error::MissingSignedVersion => Failure::Reason("signature"),
        _ => Failure::Reason("other"),
    }
}

/// reqwest 오류의 종류를 나눈다. 연결 불가, 시간 초과, 요청 전송 실패는 오프라인이다.
/// 응답은 왔지만 JSON이 아니면 배포 서버가 릴리스를 주지 않은 것이다. 본문을 읽다 끊기면 네트워크 오류다.
fn reqwest_failure(unreachable: bool, decode: bool, body: bool) -> Failure {
    if unreachable {
        Failure::Offline
    } else if decode {
        Failure::Reason("no_release")
    } else if body {
        Failure::Reason("network")
    } else {
        Failure::Reason("other")
    }
}

/// 확인 한 번의 결과. 찾은 업데이트는 `Found`로 돌려 명령이 `pending`에 둔다.
#[derive(Debug, PartialEq)]
enum Checked<U> {
    NotConfigured,
    UpToDate,
    Found(U),
    Failed(Failure),
}

/// 확인 본체. 설정이 없으면 `check`를 부르지 않는다. 시간이 넘으면 연결 불가로 본다.
async fn check_with<U, F, Fut>(configured: bool, check: F) -> Checked<U>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<Option<U>, tauri_plugin_updater::Error>>,
{
    if !configured {
        return Checked::NotConfigured;
    }
    match tokio::time::timeout(CHECK_TIMEOUT, check()).await {
        Err(_elapsed) => Checked::Failed(Failure::Offline),
        Ok(Ok(Some(update))) => Checked::Found(update),
        Ok(Ok(None)) => Checked::UpToDate,
        Ok(Err(error)) => Checked::Failed(failure_of(&error)),
    }
}

/// 다른 확인, 내려받기, 설치가 도는 중의 답.
fn busy() -> UpdateReply {
    UpdateReply::Failed { reason: "busy" }
}

/// 설정 상태와 현재 버전. WebView가 업데이트 메뉴를 보일지 정한다.
#[tauri::command]
pub fn update_status(app: AppHandle) -> UpdaterStatus {
    UpdaterStatus {
        configured: app.state::<UpdaterState>().configured,
        current_version: app.package_info().version.to_string(),
    }
}

/// 새 버전이 있는지 확인한다. 찾은 업데이트는 `pending`에 둔다. 새 확인은 이전 결과와 내려받은 바이트를 버린다.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> UpdateReply {
    let state = app.state::<UpdaterState>();
    let Some(_busy) = state.try_busy() else {
        return busy();
    };
    *state.lock_pending() = Pending::default();
    let handle = app.clone();
    let checked = check_with(state.configured, move || async move {
        handle.updater()?.check().await
    })
    .await;
    match checked {
        Checked::NotConfigured => UpdateReply::NotConfigured,
        Checked::UpToDate => UpdateReply::UpToDate,
        Checked::Failed(failure) => failure.into_reply(),
        Checked::Found(update) => {
            let reply = UpdateReply::Available {
                version: update.version.clone(),
                notes: update.body.clone(),
            };
            state.lock_pending().update = Some(update);
            reply
        }
    }
}

/// 찾은 업데이트를 내려받는다. 진행은 `on_event`로 알리고, 끝나면 바이트를 `pending`에 둔다.
/// 서명 검증은 플러그인의 `download`가 한다. 검증에 실패하면 바이트는 남지 않는다.
#[tauri::command]
pub async fn update_download(app: AppHandle, on_event: Channel<DownloadEvent>) -> UpdateReply {
    let state = app.state::<UpdaterState>();
    let Some(_busy) = state.try_busy() else {
        return busy();
    };
    let Some(update) = state.lock_pending().update.clone() else {
        return UpdateReply::Failed {
            reason: "nothing_to_download",
        };
    };
    state.lock_pending().bytes = None;
    // 플러그인은 조각 길이만 주므로 받은 바이트 수는 여기서 더한다.
    let mut downloaded: u64 = 0;
    let result = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                // 페이지가 사라졌으면 알림은 가지 못한다. 내려받기는 그대로 끝낸다.
                let _ = on_event.send(DownloadEvent::Progress { downloaded, total });
            },
            || {},
        )
        .await;
    match result {
        Ok(bytes) => {
            state.lock_pending().bytes = Some(bytes);
            UpdateReply::Ready
        }
        Err(error) => failure_of(&error).into_reply(),
    }
}

/// 내려받은 바이트를 설치한 뒤 앱을 다시 연다. 설치가 성공하면 엔진을 정상 종료하고 재시작한다.
/// 설치가 실패하면 엔진은 건드리지 않고 오류 분류를 돌려준다. 앱은 그대로 동작한다.
#[tauri::command]
pub async fn update_install_restart(app: AppHandle) -> UpdateReply {
    let state = app.state::<UpdaterState>();
    let Some(_busy) = state.try_busy() else {
        return busy();
    };
    let staged = {
        let pending = state.lock_pending();
        match (&pending.update, &pending.bytes) {
            (Some(update), Some(bytes)) => Some((update.clone(), bytes.clone())),
            _ => None,
        }
    };
    let Some((update, bytes)) = staged else {
        return UpdateReply::Failed {
            reason: "nothing_to_install",
        };
    };
    // 설치는 파일을 옮기는 동기 작업이라 비동기 실행기 스레드에서 돌리지 않는다.
    let installed = tauri::async_runtime::spawn_blocking(move || update.install(bytes)).await;
    match installed {
        Ok(Ok(())) => {
            // main.rs의 `ExitAction::PreventAndShutdown` 가지와 같은 순서다. 엔진을 내리고 종료를 허용한 뒤 다시 연다.
            let supervisor = app.state::<Arc<AppSupervisor>>().inner().clone();
            supervisor.shutdown().await;
            supervisor.allow_exit();
            app.restart()
        }
        Ok(Err(error)) => failure_of(&error).into_reply(),
        // 설치 작업이 패닉했거나 취소됐다. 이유는 `other`로 줄인다.
        Err(_) => UpdateReply::Failed { reason: "other" },
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};

    use serde_json::json;

    use super::*;

    const KEY: &str = "dW50cnVzdGVk";
    const URL: &str = "https://updates.example.invalid/{{target}}/{{current_version}}";

    #[test]
    fn missing_or_non_object_config_is_not_configured() {
        assert!(!is_configured(None));
        assert!(!is_configured(Some(&json!(null))));
        assert!(!is_configured(Some(&json!(URL))));
        assert!(!is_configured(Some(&json!([KEY, URL]))));
    }

    #[test]
    fn a_missing_or_blank_pubkey_is_not_configured() {
        assert!(!is_configured(Some(&json!({ "endpoints": [URL] }))));
        for pubkey in [json!(""), json!("   "), json!("\t\n")] {
            let config = json!({ "pubkey": pubkey, "endpoints": [URL] });
            assert!(!is_configured(Some(&config)), "{config}");
        }
    }

    #[test]
    fn empty_or_broken_endpoints_are_not_configured() {
        assert!(!is_configured(Some(&json!({ "pubkey": KEY }))));
        let broken = [
            json!([]),
            json!([""]),
            json!([URL, "  "]),
            json!([URL, 3]),
            json!(URL),
            json!({ "url": URL }),
            json!(null),
        ];
        for endpoints in broken {
            let config = json!({ "pubkey": KEY, "endpoints": endpoints });
            assert!(!is_configured(Some(&config)), "{config}");
        }
    }

    #[test]
    fn a_wrong_shape_for_the_key_is_not_configured() {
        for pubkey in [json!(5), json!(true), json!([KEY]), json!(null)] {
            let config = json!({ "pubkey": pubkey, "endpoints": [URL] });
            assert!(!is_configured(Some(&config)), "{config}");
        }
    }

    #[test]
    fn a_filled_in_key_and_endpoints_are_configured() {
        assert!(is_configured(Some(
            &json!({ "pubkey": KEY, "endpoints": [URL] })
        )));
        // 앞뒤 공백이 있어도 내용이 있으면 설정된 것이다.
        let padded = json!({ "pubkey": format!("  {KEY} "), "endpoints": [URL, " https://mirror.example.invalid/a"] });
        assert!(is_configured(Some(&padded)));
    }

    #[tokio::test]
    async fn an_unconfigured_check_never_asks_the_plugin() {
        let asked = AtomicBool::new(false);
        let outcome: Checked<()> = check_with(false, || async {
            asked.store(true, Ordering::SeqCst);
            Ok(None)
        })
        .await;
        assert_eq!(outcome, Checked::NotConfigured);
        assert!(!asked.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn a_found_release_and_an_up_to_date_answer_are_kept_apart() {
        let found: Checked<()> = check_with(true, || async { Ok(Some(())) }).await;
        assert_eq!(found, Checked::Found(()));
        let current: Checked<()> = check_with(true, || async { Ok(None) }).await;
        assert_eq!(current, Checked::UpToDate);
    }

    #[tokio::test]
    async fn a_failed_check_keeps_its_reason() {
        let failed: Checked<()> = check_with(true, || async {
            Err(tauri_plugin_updater::Error::ReleaseNotFound)
        })
        .await;
        assert_eq!(failed, Checked::Failed(Failure::Reason("no_release")));
    }

    #[tokio::test(start_paused = true)]
    async fn a_check_that_never_answers_gives_up_as_offline() {
        let hung: Checked<()> = check_with(true, || {
            std::future::pending::<Result<Option<()>, tauri_plugin_updater::Error>>()
        })
        .await;
        assert_eq!(hung, Checked::Failed(Failure::Offline));
    }

    #[test]
    fn the_busy_flag_is_taken_once_and_released_with_its_guard() {
        let state = UpdaterState::new(true);
        let first = state.try_busy();
        assert!(first.is_some());
        assert!(state.try_busy().is_none());
        drop(first);
        assert!(state.try_busy().is_some());
    }

    /// 만들 수 있는 플러그인 오류 변형을 종류별로 본다. 만들 수 없는 변형은 `failure_of`의 `_` 가지나
    /// `reqwest_failure` 시험으로 간접적으로 본다. 이유는 다음과 같다.
    /// - Reqwest: reqwest 크레이트 이름을 쓸 수 없다(직접 의존이 아니다). 판정은 `reqwest_failure`로 본다.
    /// - Minisign, Base64, Semver, Http, InvalidHeaderValue, InvalidHeaderName, Tauri: 각 크레이트의 오류 값을
    ///   이 크레이트에서 만들 수 없다. 이 변형들의 분류는 `failure_of`의 코드 줄을 읽어 확인한다.
    /// - InsecureTransportProtocol, FormatDate, UnsupportedArch, FailedToDetermineExtractPath,
    ///   TempDirNotOnSameMountPoint, BinaryNotFoundInArchive, TempDirNotFound, AuthenticationFailed,
    ///   DebInstallFailed, PackageInstallFailed: 디버그 빌드의 `validate_endpoints`가 http를 허용하는 등
    ///   조건에 기대거나 설치 경로에서만 나오는 값이라 시험 환경에서 얻을 수 없다. 모두 `_` 가지로 `other`다.
    #[test]
    fn errors_that_can_be_built_here_map_to_their_reason() {
        use tauri_plugin_updater::Error;
        let no_release = Failure::Reason("no_release");
        let network = Failure::Reason("network");
        let signature = Failure::Reason("signature");
        let other = Failure::Reason("other");
        let cases = [
            (Error::ReleaseNotFound, no_release),
            (Error::TargetNotFound("darwin-aarch64".into()), no_release),
            (Error::TargetsNotFound(vec!["darwin".into()]), no_release),
            (
                Error::Serialization(
                    serde_json::from_str::<u8>("<html>").expect_err("fixed input is not JSON"),
                ),
                no_release,
            ),
            (
                Error::Network(
                    "Download request failed with status: 500 Internal Server Error".into(),
                ),
                network,
            ),
            (Error::SignatureUtf8("not base64".into()), signature),
            (
                Error::SignedVersionMismatch {
                    signed: "1.0.0".into(),
                    announced: "1.0.1".into(),
                },
                signature,
            ),
            (Error::MissingSignedVersion, signature),
            (Error::EmptyEndpoints, other),
            (Error::UnsupportedOs, other),
            (Error::InvalidUpdaterFormat, other),
            (
                Error::PreviousAppNotRestored(PathBuf::from("/Applications/Fresnel.app")),
                other,
            ),
            (Error::Io(std::io::Error::other("disk full")), other),
            (
                Error::UrlParse(
                    tauri::Url::parse("not a url").expect_err("fixed input does not parse"),
                ),
                other,
            ),
        ];
        for (error, expected) in cases {
            assert_eq!(failure_of(&error), expected, "{error}");
        }
    }

    #[test]
    fn reqwest_error_kinds_split_into_offline_no_release_network_and_other() {
        assert_eq!(reqwest_failure(true, false, false), Failure::Offline);
        assert_eq!(
            reqwest_failure(false, true, false),
            Failure::Reason("no_release")
        );
        assert_eq!(
            reqwest_failure(false, false, true),
            Failure::Reason("network")
        );
        assert_eq!(
            reqwest_failure(false, false, false),
            Failure::Reason("other")
        );
    }

    #[test]
    fn replies_and_events_serialize_as_camel_case_with_a_kind_tag() {
        let reply = |value: UpdateReply| serde_json::to_value(value).expect("reply serializes");
        assert_eq!(
            reply(UpdateReply::NotConfigured),
            json!({ "kind": "notConfigured" })
        );
        assert_eq!(reply(UpdateReply::UpToDate), json!({ "kind": "upToDate" }));
        assert_eq!(
            reply(UpdateReply::Available {
                version: "1.2.0".into(),
                notes: None
            }),
            json!({ "kind": "available", "version": "1.2.0", "notes": null })
        );
        assert_eq!(
            reply(UpdateReply::Available {
                version: "1.2.0".into(),
                notes: Some("fixes".into())
            }),
            json!({ "kind": "available", "version": "1.2.0", "notes": "fixes" })
        );
        assert_eq!(reply(UpdateReply::Offline), json!({ "kind": "offline" }));
        assert_eq!(
            reply(UpdateReply::Failed {
                reason: "signature"
            }),
            json!({ "kind": "failed", "reason": "signature" })
        );
        assert_eq!(reply(UpdateReply::Ready), json!({ "kind": "ready" }));

        let event = |value: DownloadEvent| serde_json::to_value(value).expect("event serializes");
        assert_eq!(
            event(DownloadEvent::Progress {
                downloaded: 512,
                total: Some(2048)
            }),
            json!({ "kind": "progress", "downloaded": 512, "total": 2048 })
        );
        assert_eq!(
            event(DownloadEvent::Progress {
                downloaded: 512,
                total: None
            }),
            json!({ "kind": "progress", "downloaded": 512, "total": null })
        );

        let status = serde_json::to_value(UpdaterStatus {
            configured: false,
            current_version: "0.0.0".into(),
        })
        .expect("status serializes");
        assert_eq!(
            status,
            json!({ "configured": false, "currentVersion": "0.0.0" })
        );
    }
}
