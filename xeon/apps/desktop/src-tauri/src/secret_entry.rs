//! 모델 키 등록: 번들된 사이드카 바이너리를 `xeon secret add|set <이름>`으로 한 번 실행하고 값을 stdin에 한 번 쓴다
//! (L4.desktop.spec §4.14.1, ADR-0014: 사이드카 바이너리가 곧 xeon CLI다).
//!
//! 값이 지나는 곳은 WebView 입력란, Tauri IPC 본문, 이 프로세스의 요청 버퍼, 자식 stdin 파이프다. 넘지 않는 곳:
//! - argv와 환경 변수. 자식의 인자는 `secret <동작> <이름>`뿐이다.
//! - 앱 로그와 오류 값. 로그에는 이름과 결과 종류만 쓴다. 자식의 stderr는 값이 들어 있으면 버린다.
//! - Rust 쪽 사본. 요청 본문의 조각을 그대로 stdin에 쓴다(복사하지 않는다). `Debug` 출력에는 길이만 있다.
//!
//! 요청 본문은 원시 바이트 `<동작> <이름>\n<값>`이다. 첫 줄바꿈까지가 머리이고 나머지가 값이다(값에 줄바꿈이 있어도 된다).
//! 값의 상한은 파이프 버퍼보다 작게 둔다: 자식이 stdin을 읽지 않고 끝나도 쓰기가 막히지 않는다.

use std::ffi::OsString;
use std::fmt;
use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, State};
use tauri_plugin_shell::ShellExt;
use tokio::runtime::Handle;
use tokio::time::{timeout_at, Instant};

use crate::applog::AppLog;
use crate::engine::{
    engine_env, forward_events, kill_process_group, ChildStdin, EngineEvent, LaunchError, Launched,
    TauriLauncher, SIDECAR_ARGS, SIDECAR_NAME,
};

/// 자식이 끝나기를 기다리는 시한. sops와 age를 부르므로 넉넉하게 둔다.
pub const ENTRY_TIMEOUT: Duration = Duration::from_secs(30);
/// 값의 상한. CLI의 stdin 상한(64 KiB)보다 작고 파이프 버퍼(Linux 64 KiB, macOS 16 KiB 이상)보다 작다.
pub const MAX_VALUE_BYTES: usize = 8 * 1024;
/// 머리(`<동작> <이름>`) 길이 상한. 이름은 최대 64자다.
const MAX_HEAD_BYTES: usize = 80;
/// 사용자에게 보이는 자식 stderr 요약의 상한(문자 수).
const DETAIL_MAX_CHARS: usize = 600;
/// 자식 stderr를 모으는 상한(바이트).
const STDERR_MAX_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryAction {
    Add,
    Set,
}

impl EntryAction {
    fn as_str(self) -> &'static str {
        match self {
            EntryAction::Add => "add",
            EntryAction::Set => "set",
        }
    }
}

/// 검사를 마친 요청. 값은 요청 본문을 빌려 쓴다.
pub struct EntryRequest<'a> {
    pub action: EntryAction,
    pub name: &'a str,
    value: &'a [u8],
}

impl fmt::Debug for EntryRequest<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EntryRequest")
            .field("action", &self.action)
            .field("name", &self.name)
            .field("value", &format_args!("<{} bytes>", self.value.len()))
            .finish()
    }
}

/// WebView로 돌려주는 오류. 직렬화하면 `{"kind": "...", ...}`다(ipc.ts의 `SecretRegisterErrorSchema`와 같은 모양).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SecretEntryError {
    /// 본문 모양, 동작, 이름이 맞지 않는다.
    BadRequest,
    /// 값이 비었다.
    Empty,
    TooLarge,
    /// 이미 등록이 진행 중이다.
    Busy,
    /// 사이드카를 띄우지 못했다.
    Unavailable { detail: String },
    /// 자식이 0이 아닌 코드로 끝났다. `detail`은 자식 stderr의 앞부분이다(값이 들어 있으면 비운다).
    Rejected {
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
        detail: String,
    },
    Timeout,
}

fn valid_name(name: &str) -> bool {
    // `^[a-z][a-z0-9-]{1,63}$` (F.capabilities SECRET_NAME_PATTERN). 첫 글자가 영문 소문자라 `-`로 시작하는 옵션이 될 수 없다.
    let bytes = name.as_bytes();
    (2..=64).contains(&bytes.len())
        && bytes[0].is_ascii_lowercase()
        && bytes[1..]
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

pub fn parse_request(body: &[u8]) -> Result<EntryRequest<'_>, SecretEntryError> {
    let head_end = body
        .iter()
        .take(MAX_HEAD_BYTES + 1)
        .position(|b| *b == b'\n')
        .ok_or(SecretEntryError::BadRequest)?;
    let head = std::str::from_utf8(&body[..head_end]).map_err(|_| SecretEntryError::BadRequest)?;
    let (action, name) = head.split_once(' ').ok_or(SecretEntryError::BadRequest)?;
    let action = match action {
        "add" => EntryAction::Add,
        "set" => EntryAction::Set,
        _ => return Err(SecretEntryError::BadRequest),
    };
    if !valid_name(name) {
        return Err(SecretEntryError::BadRequest);
    }
    let value = &body[head_end + 1..];
    if value.is_empty() {
        return Err(SecretEntryError::Empty);
    }
    if value.len() > MAX_VALUE_BYTES {
        return Err(SecretEntryError::TooLarge);
    }
    Ok(EntryRequest {
        action,
        name,
        value,
    })
}

/// 자식에게 줄 인자. 값은 들어가지 않는다.
pub fn entry_args(request: &EntryRequest<'_>) -> Vec<OsString> {
    vec![
        OsString::from("secret"),
        OsString::from(request.action.as_str()),
        OsString::from(request.name),
    ]
}

/// 개발 빌드의 엔진 덮어쓰기(`XEON_DESKTOP_ENGINE_ARGS`)가 `... host --stdio`로 끝나면 그 앞부분에 `secret ...`을 이어 쓴다.
/// 그 모양이 아니면 덮어쓰지 않고 사이드카를 쓴다.
pub fn override_prefix(args: &[OsString]) -> Option<Vec<OsString>> {
    let host = OsString::from(SIDECAR_ARGS[0]);
    let stdio = OsString::from(SIDECAR_ARGS[1]);
    match args {
        [rest @ .., a, b] if *a == host && *b == stdio => Some(rest.to_vec()),
        _ => None,
    }
}

/// 자식 프로세스를 띄우고 그룹을 끝내는 수단. 운영은 `TauriEntryLauncher`, 시험은 가짜다.
pub trait EntryLauncher: Send + Sync + 'static {
    fn launch(&self, args: &[OsString]) -> Result<Launched, LaunchError>;
    fn kill_group(&self, pid: u32) -> io::Result<()>;
}

pub struct TauriEntryLauncher {
    app: AppHandle,
    runtime: Handle,
}

impl TauriEntryLauncher {
    pub fn new(app: AppHandle, runtime: Handle) -> Self {
        Self { app, runtime }
    }
}

impl EntryLauncher for TauriEntryLauncher {
    fn launch(&self, args: &[OsString]) -> Result<Launched, LaunchError> {
        // 엔진과 같은 작업 폴더, 같은 환경이다. 그래서 같은 홈과 같은 비밀 저장소(설정 폴더의 메타, SOPS 파일, age 키)를 본다.
        let engine = TauriLauncher::new(self.app.clone(), self.runtime.clone());
        let cwd = engine.working_dir()?;
        let shell = self.app.shell();
        let command = match TauriLauncher::dev_override() {
            Some((bin, override_args)) => match override_prefix(&override_args) {
                Some(prefix) => shell.command(bin).args(prefix).args(args),
                None => shell
                    .sidecar(SIDECAR_NAME)
                    .map_err(|e| {
                        LaunchError(format!("sidecar `{SIDECAR_NAME}` is not available: {e}"))
                    })?
                    .args(args),
            },
            None => shell
                .sidecar(SIDECAR_NAME)
                .map_err(|e| LaunchError(format!("sidecar `{SIDECAR_NAME}` is not available: {e}")))?
                .args(args),
        };
        // 엔진과 같은 PATH 보강을 쓴다(E7). sops, age를 Finder로 띄운 앱에서도 찾게 한다.
        let env = engine_env(std::env::vars_os(), Some(cwd.as_path()));
        let (rx, child) = command
            .set_raw_out(true)
            .set_process_group(true)
            .current_dir(cwd)
            .env_clear()
            .envs(env)
            .spawn()
            .map_err(|e| LaunchError(format!("spawn failed: {e}")))?;
        let pid = child.pid();
        let events = forward_events(&self.runtime, rx);
        Ok(Launched {
            pid,
            events,
            stdin: Box::new(ChildStdin(child)),
        })
    }

    fn kill_group(&self, pid: u32) -> io::Result<()> {
        kill_process_group(pid)
    }
}

/// 한 번에 하나만 등록한다. 운영 상태로 관리한다.
pub struct SecretEntry<L: EntryLauncher> {
    launcher: L,
    busy: AtomicBool,
    log: Arc<AppLog>,
    timeout: Duration,
}

pub type AppSecretEntry = SecretEntry<TauriEntryLauncher>;

struct BusyGuard<'a>(&'a AtomicBool);

impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl<L: EntryLauncher> SecretEntry<L> {
    pub fn new(launcher: L, log: Arc<AppLog>, timeout: Duration) -> Self {
        Self {
            launcher,
            busy: AtomicBool::new(false),
            log,
            timeout,
        }
    }

    /// 본문을 검사하고, 자식을 띄우고, 값을 stdin에 한 번 쓰고 닫은 뒤, 끝나기를 기다린다.
    pub async fn register(&self, body: &[u8]) -> Result<(), SecretEntryError> {
        let request = parse_request(body)?;
        if self.busy.swap(true, Ordering::AcqRel) {
            return Err(SecretEntryError::Busy);
        }
        let _guard = BusyGuard(&self.busy);
        let result = self.run(&request).await;
        let outcome = match &result {
            Ok(()) => "ok".to_string(),
            Err(SecretEntryError::Rejected { exit_code, .. }) => {
                format!("rejected (exit {})", exit_code.map_or("none".into(), |c| c.to_string()))
            }
            Err(SecretEntryError::Unavailable { .. }) => "unavailable".to_string(),
            Err(SecretEntryError::Timeout) => "timeout".to_string(),
            Err(other) => format!("{other:?}"),
        };
        // 이름과 결과 종류만 쓴다. 값과 자식의 출력은 쓰지 않는다.
        self.log.line(&format!(
            "secret entry {} {}: {outcome}",
            request.action.as_str(),
            request.name
        ));
        result
    }

    async fn run(&self, request: &EntryRequest<'_>) -> Result<(), SecretEntryError> {
        let args = entry_args(request);
        let Launched {
            pid,
            mut events,
            mut stdin,
        } = self
            .launcher
            .launch(&args)
            .map_err(|e| SecretEntryError::Unavailable { detail: e.0 })?;
        // 한 번 쓰고 바로 닫는다(EOF). 쓰기 실패는 자식이 이미 끝난 경우라 종료 코드를 기다려 알린다.
        let wrote = stdin.write_all(request.value);
        drop(stdin);
        let deadline = Instant::now() + self.timeout;
        let mut stderr: Vec<u8> = Vec::new();
        let code = loop {
            match timeout_at(deadline, events.recv()).await {
                Err(_) => {
                    // 시한 안에 끝나지 않았다. 그룹째 끝낸다(자식이 부른 sops와 age 포함).
                    if self.launcher.kill_group(pid).is_err() {
                        self.log.line("secret entry: the group could not be killed");
                    }
                    return Err(SecretEntryError::Timeout);
                }
                Ok(None) => break None,
                Ok(Some(EngineEvent::Terminated { code, .. })) => break code,
                Ok(Some(EngineEvent::Stderr(bytes))) => {
                    let room = STDERR_MAX_BYTES.saturating_sub(stderr.len());
                    stderr.extend_from_slice(&bytes[..bytes.len().min(room)]);
                }
                Ok(Some(EngineEvent::Stdout(_) | EngineEvent::Error(_))) => {}
            }
        };
        if code == Some(0) && wrote.is_ok() {
            return Ok(());
        }
        Err(SecretEntryError::Rejected {
            exit_code: code,
            detail: summarize(&stderr, request.value),
        })
    }
}

/// 자식 stderr의 앞부분을 사용자에게 보일 한 덩어리로 만든다. 값이 한 글자라도 그대로 들어 있으면 전부 비운다.
fn summarize(stderr: &[u8], value: &[u8]) -> String {
    if !value.is_empty() && stderr.windows(value.len()).any(|window| window == value) {
        return String::new();
    }
    String::from_utf8_lossy(stderr)
        .chars()
        .map(|c| if c.is_control() && c != '\n' { ' ' } else { c })
        .take(DETAIL_MAX_CHARS)
        .collect::<String>()
        .trim()
        .to_string()
}

/// 키 등록 명령. 본문은 원시 바이트 `<동작> <이름>\n<값>`이다. 인자는 이 모양 하나뿐이라 값이 JSON 문자열로 복사되지 않는다.
#[tauri::command]
pub async fn secret_register(
    entry: State<'_, Arc<AppSecretEntry>>,
    request: Request<'_>,
) -> Result<(), SecretEntryError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(SecretEntryError::BadRequest);
    };
    entry.register(bytes).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::EngineEvent;
    use crate::relay::StdinSink;
    use std::sync::Mutex;
    use tokio::sync::mpsc;

    const FAKE_VALUE: &str = "fake-key-not-a-real-secret-0001";

    /// 쓴 횟수와 바이트, 닫힘(drop)을 기록하는 stdin 대역.
    struct RecordingStdin {
        shared: Arc<Mutex<Written>>,
    }

    #[derive(Default)]
    struct Written {
        writes: Vec<Vec<u8>>,
        closed: bool,
    }

    impl StdinSink for RecordingStdin {
        fn write_all(&mut self, bytes: &[u8]) -> io::Result<()> {
            self.shared.lock().expect("lock").writes.push(bytes.to_vec());
            Ok(())
        }
    }

    impl Drop for RecordingStdin {
        fn drop(&mut self) {
            self.shared.lock().expect("lock").closed = true;
        }
    }

    enum Script {
        /// stderr 조각을 보낸 뒤 이 코드로 끝난다.
        Exit(i32, Vec<String>),
        /// 끝나지 않는다.
        Hang,
        FailToLaunch,
    }

    struct FakeLauncher {
        script: Script,
        argv: Mutex<Vec<Vec<OsString>>>,
        written: Arc<Mutex<Written>>,
        killed: Mutex<Vec<u32>>,
        /// `Hang`에서 이벤트 채널을 열어 두는 송신단.
        keep: Mutex<Vec<mpsc::Sender<EngineEvent>>>,
    }

    impl FakeLauncher {
        fn new(script: Script) -> Arc<Self> {
            Arc::new(Self {
                script,
                argv: Mutex::new(Vec::new()),
                written: Arc::new(Mutex::new(Written::default())),
                killed: Mutex::new(Vec::new()),
                keep: Mutex::new(Vec::new()),
            })
        }
    }

    impl EntryLauncher for Arc<FakeLauncher> {
        fn launch(&self, args: &[OsString]) -> Result<Launched, LaunchError> {
            self.argv.lock().expect("lock").push(args.to_vec());
            let (tx, events) = mpsc::channel(16);
            match &self.script {
                Script::FailToLaunch => return Err(LaunchError("sidecar is not available".into())),
                Script::Exit(code, chunks) => {
                    for chunk in chunks {
                        tx.try_send(EngineEvent::Stderr(chunk.clone().into_bytes()))
                            .expect("room");
                    }
                    tx.try_send(EngineEvent::Terminated {
                        code: Some(*code),
                        signal: None,
                    })
                    .expect("room");
                }
                Script::Hang => self.keep.lock().expect("lock").push(tx),
            }
            Ok(Launched {
                pid: 4242,
                events,
                stdin: Box::new(RecordingStdin {
                    shared: self.written.clone(),
                }),
            })
        }

        fn kill_group(&self, pid: u32) -> io::Result<()> {
            self.killed.lock().expect("lock").push(pid);
            Ok(())
        }
    }

    fn entry(launcher: &Arc<FakeLauncher>, wait: Duration) -> SecretEntry<Arc<FakeLauncher>> {
        SecretEntry::new(launcher.clone(), Arc::new(AppLog::open(None)), wait)
    }

    fn body(head: &str, value: &str) -> Vec<u8> {
        let mut bytes = head.as_bytes().to_vec();
        bytes.push(b'\n');
        bytes.extend_from_slice(value.as_bytes());
        bytes
    }

    #[tokio::test]
    async fn the_value_goes_to_stdin_once_and_never_into_argv() {
        let launcher = FakeLauncher::new(Script::Exit(0, vec![]));
        let result = entry(&launcher, ENTRY_TIMEOUT)
            .register(&body("add anthropic-api-key", FAKE_VALUE))
            .await;
        assert_eq!(result, Ok(()));
        let argv = launcher.argv.lock().expect("lock");
        assert_eq!(argv.len(), 1);
        assert_eq!(
            argv[0],
            vec![
                OsString::from("secret"),
                OsString::from("add"),
                OsString::from("anthropic-api-key")
            ]
        );
        assert!(argv[0]
            .iter()
            .all(|arg| !arg.to_string_lossy().contains(FAKE_VALUE)));
        let written = launcher.written.lock().expect("lock");
        assert_eq!(written.writes, vec![FAKE_VALUE.as_bytes().to_vec()]);
        assert!(written.closed, "stdin must be closed so the child sees EOF");
    }

    #[tokio::test]
    async fn set_is_passed_through_and_the_value_may_contain_newlines() {
        let launcher = FakeLauncher::new(Script::Exit(0, vec![]));
        let result = entry(&launcher, ENTRY_TIMEOUT)
            .register(&body("set openai-api-key", "line-one\nline-two"))
            .await;
        assert_eq!(result, Ok(()));
        assert_eq!(launcher.argv.lock().expect("lock")[0][1], OsString::from("set"));
        assert_eq!(
            launcher.written.lock().expect("lock").writes,
            vec![b"line-one\nline-two".to_vec()]
        );
    }

    #[tokio::test]
    async fn a_failing_child_reports_its_exit_code_and_message() {
        let launcher = FakeLauncher::new(Script::Exit(
            1,
            vec![
                "비밀 제공자(sops)를 쓸 수 없다 ".to_string(),
                "(not_registered)\n".to_string(),
            ],
        ));
        let result = entry(&launcher, ENTRY_TIMEOUT)
            .register(&body("add anthropic-api-key", FAKE_VALUE))
            .await;
        assert_eq!(
            result,
            Err(SecretEntryError::Rejected {
                exit_code: Some(1),
                detail: "비밀 제공자(sops)를 쓸 수 없다 (not_registered)".into(),
            })
        );
    }

    #[tokio::test]
    async fn child_output_that_contains_the_value_is_dropped_entirely() {
        let echo = format!("값 {FAKE_VALUE} 을 저장하지 못했다\n");
        let launcher = FakeLauncher::new(Script::Exit(1, vec![echo]));
        let result = entry(&launcher, ENTRY_TIMEOUT)
            .register(&body("add anthropic-api-key", FAKE_VALUE))
            .await;
        assert_eq!(
            result,
            Err(SecretEntryError::Rejected {
                exit_code: Some(1),
                detail: String::new(),
            })
        );
        let shown = format!("{result:?}");
        assert!(!shown.contains(FAKE_VALUE));
    }

    #[tokio::test]
    async fn a_launch_failure_is_unavailable_and_nothing_is_written() {
        let launcher = FakeLauncher::new(Script::FailToLaunch);
        let result = entry(&launcher, ENTRY_TIMEOUT)
            .register(&body("add anthropic-api-key", FAKE_VALUE))
            .await;
        assert_eq!(
            result,
            Err(SecretEntryError::Unavailable {
                detail: "sidecar is not available".into()
            })
        );
        assert!(launcher.written.lock().expect("lock").writes.is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn a_child_that_never_ends_is_killed_by_group_after_the_deadline() {
        let launcher = FakeLauncher::new(Script::Hang);
        let result = entry(&launcher, Duration::from_secs(5))
            .register(&body("add anthropic-api-key", FAKE_VALUE))
            .await;
        assert_eq!(result, Err(SecretEntryError::Timeout));
        assert_eq!(*launcher.killed.lock().expect("lock"), vec![4242]);
    }

    #[tokio::test(start_paused = true)]
    async fn only_one_registration_runs_at_a_time_and_the_gate_reopens() {
        let launcher = FakeLauncher::new(Script::Hang);
        let service = Arc::new(entry(&launcher, Duration::from_secs(5)));
        let first = {
            let service = service.clone();
            tokio::spawn(async move {
                service
                    .register(&body("add anthropic-api-key", FAKE_VALUE))
                    .await
            })
        };
        tokio::task::yield_now().await;
        let second = service
            .register(&body("add openai-api-key", FAKE_VALUE))
            .await;
        assert_eq!(second, Err(SecretEntryError::Busy));
        assert_eq!(first.await.expect("join"), Err(SecretEntryError::Timeout));
        // 끝난 뒤에는 다시 받는다(두 번째 호출은 자식을 띄우지 않았다)
        assert_eq!(launcher.argv.lock().expect("lock").len(), 1);
        let again = service
            .register(&body("add openai-api-key", FAKE_VALUE))
            .await;
        assert_eq!(again, Err(SecretEntryError::Timeout));
    }

    #[test]
    fn requests_with_a_bad_shape_are_rejected_before_any_process_starts() {
        let bad_heads = [
            "remove anthropic-api-key",
            "add",
            "add -rf",
            "add --yes",
            "add Anthropic",
            "add a",
            "add ../x",
            "add name with space",
            "add anthropic-api-key ",
        ];
        for head in bad_heads {
            assert_eq!(
                parse_request(&body(head, FAKE_VALUE)).err(),
                Some(SecretEntryError::BadRequest),
                "{head}"
            );
        }
        assert_eq!(
            parse_request(b"add anthropic-api-key").err(),
            Some(SecretEntryError::BadRequest)
        );
        assert_eq!(
            parse_request(&body("add anthropic-api-key", "")).err(),
            Some(SecretEntryError::Empty)
        );
        let long = "x".repeat(MAX_VALUE_BYTES + 1);
        assert_eq!(
            parse_request(&body("add anthropic-api-key", &long)).err(),
            Some(SecretEntryError::TooLarge)
        );
        let at_limit = "x".repeat(MAX_VALUE_BYTES);
        assert!(parse_request(&body("add anthropic-api-key", &at_limit)).is_ok());
    }

    #[test]
    fn the_request_debug_output_has_the_length_but_not_the_value() {
        let bytes = body("add anthropic-api-key", FAKE_VALUE);
        let request = parse_request(&bytes).expect("valid");
        let shown = format!("{request:?}");
        assert!(!shown.contains(FAKE_VALUE));
        assert!(shown.contains(&format!("<{} bytes>", FAKE_VALUE.len())));
    }

    #[test]
    fn errors_serialize_to_the_shape_the_page_parses() {
        let rejected = SecretEntryError::Rejected {
            exit_code: Some(1),
            detail: "x".into(),
        };
        assert_eq!(
            serde_json::to_string(&rejected).expect("json"),
            r#"{"kind":"rejected","exitCode":1,"detail":"x"}"#
        );
        assert_eq!(
            serde_json::to_string(&SecretEntryError::TooLarge).expect("json"),
            r#"{"kind":"too-large"}"#
        );
        assert_eq!(
            serde_json::to_string(&SecretEntryError::Unavailable { detail: "d".into() })
                .expect("json"),
            r#"{"kind":"unavailable","detail":"d"}"#
        );
    }

    #[test]
    fn the_dev_override_keeps_only_the_prefix_before_host_stdio() {
        let os = |parts: &[&str]| parts.iter().map(OsString::from).collect::<Vec<_>>();
        assert_eq!(
            override_prefix(&os(&["apps/cli/src/main.ts", "host", "--stdio"])),
            Some(os(&["apps/cli/src/main.ts"]))
        );
        assert_eq!(override_prefix(&os(&["host", "--stdio"])), Some(vec![]));
        assert_eq!(override_prefix(&os(&["apps/cli/src/main.ts"])), None);
    }
}
