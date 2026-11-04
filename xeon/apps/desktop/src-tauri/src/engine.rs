//! 엔진 사이드카 수명 관리 (L4.desktop.spec 4.1 E1~E11, 4.3, 4.4).
//!
//! - spawn은 `Launcher::launch` 한 곳에서만 한다(E1). 운영 구현은 `TauriLauncher`다.
//! - 쓰기는 전용 스레드가 `CommandChild`를 쥐고 한다(relay.rs). 종료 경로는 pid로 프로세스 그룹에
//!   신호를 보내므로 막힌 쓰기 뒤에 줄을 서지 않는다.
//! - 종료 순서: `host.shutdown` 요청 쓰기, stdin 닫기(EOF), 시한까지 대기, 그다음 그룹 SIGKILL(S1).
//!   EOF 처리 기회를 주기 전에 그룹 SIGKILL을 하지 않는다.
//! - 재기동은 10분 창 안의 횟수 상한과 백오프를 따른다(4.4).

use std::collections::VecDeque;
use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::runtime::Handle;
use tokio::sync::{mpsc, watch, Notify};
use tokio::time::{timeout, timeout_at, Instant};

use crate::applog::AppLog;
use crate::desktop_settings::{RESTART_LIMIT_RANGE, SHUTDOWN_GRACE_MS_RANGE};
use crate::env_path::augment_path;
use crate::relay::{
    spawn_pipe_writer, CommandError, PipeHandle, Relay, StdinSink, WRITE_QUEUE_FRAMES,
};
use crate::secret_entry::override_prefix;
use crate::time::{now_ms, rfc3339_utc};

/// `xeon/apps/desktop/sidecar.json`의 `name`과 같아야 한다(test/sidecar-config.test.ts가 대조한다).
pub const SIDECAR_NAME: &str = "fresnel";
/// `sidecar.json`의 `args`와 같아야 한다.
pub const SIDECAR_ARGS: [&str; 2] = ["host", "--stdio"];

/// 엔진 stderr 줄 길이 상한(E10).
const STDERR_LINE_MAX: usize = 8 * 1024;
/// 그룹 SIGKILL 뒤 프로세스 종료 확인을 기다리는 시간.
const KILL_SETTLE: Duration = Duration::from_secs(2);
/// `run_once` 명령이 끝나기를 기다리는 시간. 넘으면 그룹을 죽이고 오류를 돌려준다.
const ONCE_TIMEOUT: Duration = Duration::from_secs(120);
/// `run_once`가 모으는 stdout, stderr 각각의 상한. 넘는 바이트는 버리되 끝까지 읽어 자식이 막히지 않게 한다.
pub const ONCE_OUTPUT_MAX_BYTES: usize = 256 * 1024;
/// 복원 때 엔진이 끝나기를 기다리는 시한은 종료 시한에 이만큼을 더한 값이다.
const RESTORE_SLACK: Duration = Duration::from_secs(5);

// ---------------------------------------------------------------------------------------------
// 공개 상태 (ipc.ts의 EngineStateSchema와 같은 모양)

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineSource {
    Sidecar,
    /// M3 서비스 모드.
    #[allow(dead_code)]
    Service,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EngineExit {
    pub code: Option<i32>,
    pub signal: Option<i32>,
    pub at: String,
}

impl EngineExit {
    fn new(code: Option<i32>, signal: Option<i32>) -> Self {
        Self {
            code,
            signal,
            at: rfc3339_utc(now_ms()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum EngineState {
    Starting {
        source: EngineSource,
        attempt: u32,
    },
    Running {
        source: EngineSource,
        pid: Option<u32>,
    },
    Restarting {
        attempt: u32,
        retry_at: String,
        last_exit: EngineExit,
    },
    Stopping,
    Failed {
        attempts: u32,
        last_exit: EngineExit,
    },
    Stopped,
}

// ---------------------------------------------------------------------------------------------
// 대상 (W-08)

/// 엔진이 붙을 대상. `Local`은 이 컴퓨터의 사이드카(`host --stdio`)다. `Remote`는 `--remote <주소>`를 붙여 띄운다.
/// 토큰은 인자로 넘기지 않는다. 엔진 환경 변수 `FRESNEL_REMOTE_TOKEN`으로만 받는다(host launch-mode.ts).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum EngineTarget {
    #[default]
    Local,
    Remote {
        address: String,
    },
}

impl EngineTarget {
    pub fn is_remote(&self) -> bool {
        matches!(self, EngineTarget::Remote { .. })
    }
}

/// 원격 주소의 길이 상한(바이트).
pub const REMOTE_ADDRESS_MAX_BYTES: usize = 512;

/// 대상을 검사한다. 원격 주소는 공백을 뺀 값이 비어 있지 않고, 512바이트 이하이며, 공백이나 제어 문자가 없어야 한다.
pub fn validate_target(target: &EngineTarget) -> Result<(), CommandError> {
    match target {
        EngineTarget::Local => Ok(()),
        EngineTarget::Remote { address } => {
            let valid = !address.trim().is_empty()
                && address.len() <= REMOTE_ADDRESS_MAX_BYTES
                && !address.chars().any(|c| c.is_whitespace() || c.is_control());
            if valid {
                Ok(())
            } else {
                Err(CommandError::BadRequest)
            }
        }
    }
}

/// 대상에 따라 사이드카 뒤에 붙는 인자. 로컬은 없고, 원격은 `--remote <주소>`다.
pub fn target_args(target: &EngineTarget) -> Vec<String> {
    match target {
        EngineTarget::Local => Vec::new(),
        EngineTarget::Remote { address } => vec!["--remote".to_string(), address.clone()],
    }
}

/// 호스트 인자 뒤에 붙는 것: 안전 모드(로컬 대상에만 `--safe-mode`), 그다음 대상 인자다.
fn engine_flags(target: &EngineTarget, safe_mode: bool) -> Vec<String> {
    let mut flags = Vec::new();
    if safe_mode && !target.is_remote() {
        flags.push("--safe-mode".to_string());
    }
    flags.extend(target_args(target));
    flags
}

/// 사이드카를 띄우는 전체 인자: `host --stdio`, 그다음 `engine_flags`다.
pub fn sidecar_args(target: &EngineTarget, safe_mode: bool) -> Vec<String> {
    SIDECAR_ARGS
        .iter()
        .map(|arg| arg.to_string())
        .chain(engine_flags(target, safe_mode))
        .collect()
}

// ---------------------------------------------------------------------------------------------
// 설정

/// 셸이 읽는 `l4.desktop.engine.*` 값. `main.rs`가 `desktop-settings.json`의 값을 `from_values`로 넣는다(§3.6).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EngineConfig {
    /// 종료 요청 뒤 엔진이 끝나기를 기다리는 시간(`shutdownGraceMs`).
    pub shutdown_grace: Duration,
    /// 10분 창 안의 자동 재기동 횟수 상한(`restartLimit`). 0이면 자동 재기동을 끈다.
    pub restart_limit: u32,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            shutdown_grace: Duration::from_millis(7000),
            restart_limit: 3,
        }
    }
}

impl EngineConfig {
    /// 설정 파일에서 읽은 값을 검사해 쓴다. 없거나 범위 밖이면 그 값만 기본값으로 둔다
    /// (`F.wire-settings.spec` 4.8의 파일 값 규칙과 같다). 범위는 `desktop_settings`의 상수와 같다.
    pub fn from_values(shutdown_grace_ms: Option<i64>, restart_limit: Option<i64>) -> Self {
        let default = Self::default();
        let grace = shutdown_grace_ms
            .filter(|ms| SHUTDOWN_GRACE_MS_RANGE.contains(ms))
            .and_then(|ms| u64::try_from(ms).ok())
            .map_or(default.shutdown_grace, Duration::from_millis);
        let limit = restart_limit
            .filter(|n| RESTART_LIMIT_RANGE.contains(n))
            .and_then(|n| u32::try_from(n).ok())
            .unwrap_or(default.restart_limit);
        Self {
            shutdown_grace: grace,
            restart_limit: limit,
        }
    }
}

// ---------------------------------------------------------------------------------------------
// 재기동 정책

const RESTART_WINDOW: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RestartDecision {
    Restart { attempt: u32, delay: Duration },
    GiveUp { attempts: u32 },
}

/// 10분 창 안의 재기동 횟수를 센다. 1번째는 즉시, 이후 1초, 2초, 4초, 8초 상한이다.
/// 10분 동안 재기동이 없으면 창에서 빠져 횟수가 0으로 돌아간다.
#[derive(Debug)]
pub struct RestartPolicy {
    limit: u32,
    recent: VecDeque<Instant>,
}

impl RestartPolicy {
    pub fn new(limit: u32) -> Self {
        Self {
            limit,
            recent: VecDeque::new(),
        }
    }

    pub fn on_exit(&mut self, now: Instant) -> RestartDecision {
        while let Some(first) = self.recent.front() {
            if now.saturating_duration_since(*first) > RESTART_WINDOW {
                self.recent.pop_front();
            } else {
                break;
            }
        }
        let done = u32::try_from(self.recent.len()).unwrap_or(u32::MAX);
        if done >= self.limit {
            return RestartDecision::GiveUp { attempts: done };
        }
        self.recent.push_back(now);
        let attempt = done + 1;
        RestartDecision::Restart {
            attempt,
            delay: backoff(attempt),
        }
    }

    /// 수동 재기동. 횟수를 0으로 되돌린다.
    pub fn reset(&mut self) {
        self.recent.clear();
    }
}

fn backoff(attempt: u32) -> Duration {
    match attempt {
        0 | 1 => Duration::ZERO,
        2 => Duration::from_secs(1),
        3 => Duration::from_secs(2),
        4 => Duration::from_secs(4),
        _ => Duration::from_secs(8),
    }
}

// ---------------------------------------------------------------------------------------------
// 환경과 프로세스 그룹

/// E7: 엔진 환경에서 `BUN_OPTIONS`만 지우고 나머지는 상속한다. PATH는 `augment_path`로 도구 디렉터리를 덧붙이며,
/// 없으면 맨 뒤에 넣는다. `home`은 사용자 홈 디렉터리다(E6의 cwd와 같다).
pub fn engine_env<I>(vars: I, home: Option<&Path>) -> Vec<(OsString, OsString)>
where
    I: IntoIterator<Item = (OsString, OsString)>,
{
    let mut env: Vec<(OsString, OsString)> = vars
        .into_iter()
        .filter(|(key, _)| key != "BUN_OPTIONS")
        .collect();
    match env.iter().position(|(key, _)| key == "PATH") {
        Some(index) => {
            let (_, value) = &mut env[index];
            let current = std::mem::take(value);
            *value = augment_path(Some(current), home);
        }
        None => env.push((OsString::from("PATH"), augment_path(None, home))),
    }
    env
}

/// 프로세스 그룹 전체에 SIGKILL(Unix) 또는 프로세스 트리 종료(Windows)를 보낸다.
/// 그룹에 남은 프로세스가 없으면 성공이다.
#[cfg(unix)]
pub fn kill_process_group(pid: u32) -> io::Result<()> {
    let pgid = libc::pid_t::try_from(pid)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "pid out of range"))?;
    // 0은 호출자 자신의 그룹, 1은 init이다. 어느 쪽도 엔진 그룹이 아니다.
    if pgid <= 1 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "refusing to signal pgid <= 1",
        ));
    }
    // SAFETY: killpg는 정수 두 개를 받는 시스템 호출이고 메모리를 건드리지 않는다.
    if unsafe { libc::killpg(pgid, libc::SIGKILL) } == 0 {
        return Ok(());
    }
    let err = io::Error::last_os_error();
    if err.raw_os_error() == Some(libc::ESRCH) {
        Ok(())
    } else {
        Err(err)
    }
}

/// Windows는 job 핸들을 `CommandChild`가 쥐고 있어 쓰기 스레드가 소유한 뒤에는 쓸 수 없다.
/// `taskkill /T`로 트리를 끝낸다. kill-on-close job object는 M3 결정 사항이다(L4.desktop.spec 10 미결 7).
#[cfg(windows)]
pub fn kill_process_group(pid: u32) -> io::Result<()> {
    if pid <= 1 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "refusing to signal pid <= 1",
        ));
    }
    let status = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status()?;
    // 종료 코드 128: 이미 없는 프로세스.
    if status.success() || status.code() == Some(128) {
        Ok(())
    } else {
        Err(io::Error::other(format!("taskkill exited with {status}")))
    }
}

// ---------------------------------------------------------------------------------------------
// stderr 줄 나누기 (E10)

/// stderr 바이트를 줄로 나눈다. 줄은 8 KiB에서 자르고 나머지는 버린다.
#[derive(Default)]
pub struct StderrSplitter {
    current: Vec<u8>,
    truncated: bool,
}

impl StderrSplitter {
    pub fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        let mut lines = Vec::new();
        let mut rest = chunk;
        while let Some(at) = memchr::memchr(b'\n', rest) {
            self.append(&rest[..at]);
            lines.push(self.take_line());
            rest = &rest[at + 1..];
        }
        self.append(rest);
        lines
    }

    pub fn finish(&mut self) -> Option<String> {
        if self.current.is_empty() && !self.truncated {
            None
        } else {
            Some(self.take_line())
        }
    }

    fn append(&mut self, bytes: &[u8]) {
        let room = STDERR_LINE_MAX.saturating_sub(self.current.len());
        if bytes.len() > room {
            self.truncated = true;
        }
        self.current.extend_from_slice(&bytes[..bytes.len().min(room)]);
    }

    fn take_line(&mut self) -> String {
        let bytes = std::mem::take(&mut self.current);
        self.truncated = false;
        String::from_utf8_lossy(&bytes).trim_end_matches('\r').to_string()
    }
}

// ---------------------------------------------------------------------------------------------
// 실행 추상화

pub enum EngineEvent {
    Stdout(Vec<u8>),
    Stderr(Vec<u8>),
    Terminated { code: Option<i32>, signal: Option<i32> },
    Error(String),
}

pub struct Launched {
    pub pid: u32,
    pub events: mpsc::Receiver<EngineEvent>,
    pub stdin: Box<dyn StdinSink>,
}

#[derive(Debug)]
pub struct LaunchError(pub String);

/// `run_once`의 결과. 출력은 앞쪽 `ONCE_OUTPUT_MAX_BYTES`까지만 남는다. 내용은 해석하지 않는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OnceOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// `db_restore`가 WebView에 돌려주는 결과(`{exitCode, stdout, stderr}`). `OnceOutput`을 그대로 옮긴다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// 엔진 프로세스를 띄우고 그룹을 끝내는 수단. 운영은 `TauriLauncher`, 시험은 가짜다.
pub trait Launcher: Send + Sync + 'static {
    /// 엔진을 띄운다. `safe_mode`면 안전 모드로 띄운다(로컬 대상에만 붙는다, `sidecar_args`).
    fn launch(&self, target: &EngineTarget, safe_mode: bool) -> Result<Launched, LaunchError>;
    /// 엔진 프로그램을 `args`로 한 번 돌리고 끝나기를 기다린다. 호스트 인자(`host --stdio`)는 붙이지 않는다.
    /// 호출 스레드를 막으므로 실행 루프 밖(blocking 스레드)에서만 부른다.
    fn run_once(&self, args: &[String]) -> Result<OnceOutput, LaunchError>;
    fn kill_group(&self, pid: u32) -> io::Result<()>;
}

// ---------------------------------------------------------------------------------------------
// 감독자

#[derive(Clone)]
struct Live {
    generation: u64,
    pid: u32,
    pipe: PipeHandle,
    /// 원격 대상으로 띄운 엔진이다. 원격 엔진에는 `host.shutdown`을 보내지 않는다(`stop_engine`).
    remote: bool,
}

#[derive(Default)]
struct Shared {
    generation: u64,
    live: Option<Live>,
    stop_requested: bool,
    shutdown_started: bool,
    exit_allowed: bool,
    failed: bool,
    /// 지금 바라는 대상. 실행 루프가 띄울 때 읽는다.
    target: EngineTarget,
    /// 대상을 바꿀 때마다 1씩 오른다. 실행 루프는 띄울 때의 값과 비교해 대상이 바뀌었는지 안다.
    target_epoch: u64,
    /// 안전 모드로 띄운다. 앱을 켜 둔 동안 남고 자동 재기동에도 쓴다. 원격 대상에는 붙지 않는다(`sidecar_args`).
    safe_mode: bool,
    /// 데이터베이스 복원 중이다. 참인 동안 실행 루프는 엔진을 띄우지 않는다. 복원만 켜고 끈다.
    hold: bool,
    /// 실행 루프가 대상을 읽고 띄워 등록하기까지의 창이 열려 있다. 복원은 이 창이 닫힌 뒤에 보류를 건다.
    launching: bool,
    /// 복원 중에 종료 요청이 와서 끝나기를 기다리는 과제가 이미 있다. 두 번째 요청은 그냥 막는다.
    exit_waits_for_restore: bool,
}

struct Inner<L: Launcher> {
    launcher: L,
    relay: Arc<Relay>,
    config: EngineConfig,
    log: Arc<AppLog>,
    runtime: Handle,
    shared: Mutex<Shared>,
    stop_wake: Notify,
    restart_wake: Notify,
    /// 보류가 바뀌었다. 보류 중 기다리는 실행 루프를 깨운다.
    hold_wake: Notify,
    /// 띄우는 창이 닫혔다(등록 또는 실패). 복원이 창이 닫히기를 기다린다.
    launch_settled: Notify,
    /// 복원 보류가 걸려 있는 동안 참이다. 종료 요청이 복원이 끝나기를 기다릴 때 쓴다.
    held: watch::Sender<bool>,
    /// 마지막으로 끝난 엔진 세대.
    exited: watch::Sender<u64>,
    /// 실행 루프가 끝났다.
    stopped: watch::Sender<bool>,
    /// 대상이 바뀌었다. 실패 대기와 백오프 대기를 깨운다(값은 쓰지 않는다).
    retargeted: watch::Sender<u64>,
}

fn shared<L: Launcher>(inner: &Inner<L>) -> MutexGuard<'_, Shared> {
    inner.shared.lock().unwrap_or_else(|e| e.into_inner())
}

/// `RunEvent::ExitRequested`에서 할 일.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitAction {
    /// 그대로 종료한다.
    Allow,
    /// 종료를 미루고 정상 종료 순서를 시작한다.
    PreventAndShutdown,
    /// 종료를 미룬다. 정상 종료 순서가 이미 진행 중이다.
    Prevent,
    /// 데이터베이스 복원 중이다. 종료를 미루고 `wait_restore_end` 뒤에 다시 종료를 요청한다.
    PreventUntilRestore,
}

pub struct Supervisor<L: Launcher> {
    inner: Arc<Inner<L>>,
}

impl<L: Launcher> Clone for Supervisor<L> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}

pub type AppSupervisor = Supervisor<TauriLauncher>;

impl<L: Launcher> Supervisor<L> {
    pub fn new(
        launcher: L,
        relay: Arc<Relay>,
        config: EngineConfig,
        log: Arc<AppLog>,
        runtime: Handle,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                launcher,
                relay,
                config,
                log,
                runtime,
                shared: Mutex::new(Shared::default()),
                stop_wake: Notify::new(),
                restart_wake: Notify::new(),
                hold_wake: Notify::new(),
                launch_settled: Notify::new(),
                held: watch::channel(false).0,
                exited: watch::channel(0).0,
                stopped: watch::channel(false).0,
                retargeted: watch::channel(0).0,
            }),
        }
    }

    /// 실행 루프를 띄운다. 앱당 한 번 부른다.
    pub fn start(&self) {
        let inner = self.inner.clone();
        self.inner.runtime.spawn(run_loop(inner));
    }

    /// WebView의 stdin 쓰기. 종료 중이면 거부하고, 락은 손잡이를 복제하는 동안만 쥔다.
    pub async fn write(&self, bytes: Vec<u8>) -> Result<(), CommandError> {
        let pipe = {
            let state = shared(&self.inner);
            if state.stop_requested {
                return Err(CommandError::EngineStopping);
            }
            state.live.as_ref().map(|live| live.pipe.clone())
        };
        let pipe = pipe.ok_or(CommandError::EngineNotRunning)?;
        pipe.write_frame(bytes)
            .await
            .map_err(|_| CommandError::EngineNotRunning)
    }

    /// 재기동(W-35, `engine_restart`). `failed`면 확인 없이 다시 띄운다. 살아 있는 엔진은 `confirmed`가 참일 때만
    /// 대상 바꾸기와 같은 길(정상 종료 뒤 재기동, 재기동 횟수에 세지 않음)로 다시 띄운다. 엔진이 없으면 거부한다.
    /// `safe_mode`가 있으면 그 값을 앱을 켜 둔 동안 쓴다. 원격 대상에서 안전 모드를 켜려 하면 확인 여부와 관계없이 `BadRequest`다.
    pub fn restart_manually(
        &self,
        safe_mode: Option<bool>,
        confirmed: bool,
    ) -> Result<(), CommandError> {
        let (epoch, live, safe) = {
            let mut state = shared(&self.inner);
            if state.stop_requested {
                return Err(CommandError::EngineStopping);
            }
            if safe_mode == Some(true) && state.target.is_remote() {
                return Err(CommandError::BadRequest);
            }
            if state.failed {
                if let Some(on) = safe_mode {
                    state.safe_mode = on;
                }
                drop(state);
                self.inner.restart_wake.notify_one();
                return Ok(());
            }
            let Some(live) = state.live.clone() else {
                return Err(CommandError::EngineNotRunning);
            };
            if !confirmed {
                return Err(CommandError::NotConfirmed);
            }
            if let Some(on) = safe_mode {
                state.safe_mode = on;
            }
            state.target_epoch += 1;
            (state.target_epoch, live, state.safe_mode)
        };
        self.inner.log.line(&format!(
            "restart: the live engine restarts, safe mode={safe}"
        ));
        self.end_for_new_epoch(epoch, Some(live));
        Ok(())
    }

    /// 대상 바꾸기(W-08). 같은 대상이면 아무 일도 하지 않는다. 다르면 살아 있는 엔진을 정상 종료 순서로 끝내고,
    /// 실행 루프가 새 대상으로 다시 띄운다. 이 재기동은 자동 재기동 횟수에 세지 않는다.
    /// 주소는 로그에 남기지 않는다(E11).
    pub fn retarget(&self, target: EngineTarget) -> Result<(), CommandError> {
        validate_target(&target)?;
        let (epoch, live) = {
            let mut state = shared(&self.inner);
            if state.stop_requested {
                return Err(CommandError::EngineStopping);
            }
            if state.target == target {
                return Ok(());
            }
            state.target = target;
            state.target_epoch += 1;
            (state.target_epoch, state.live.clone())
        };
        self.inner.log.line("retarget: the engine target changed");
        self.end_for_new_epoch(epoch, live);
        Ok(())
    }

    /// 대상이나 안전 모드가 바뀌었을 때 할 일. 실패 대기와 백오프 대기를 깨우고, 살아 있는 엔진은 정상 종료 순서로 끝낸다.
    /// 실행 루프가 새 세대로 다시 띄운다. 이 재기동은 자동 재기동 횟수에 세지 않는다.
    fn end_for_new_epoch(&self, epoch: u64, live: Option<Live>) {
        // 실패 대기나 백오프 대기 중이면 실행 루프가 깬다. 살아 있는 엔진은 아래 종료 순서가 끝낸다.
        self.inner.retargeted.send_replace(epoch);
        if let Some(live) = live {
            let supervisor = self.clone();
            self.inner.runtime.spawn(async move {
                supervisor
                    .stop_engine(live.generation, live.pid, &live.pipe, !live.remote)
                    .await;
            });
        }
    }

    /// 데이터베이스를 백업 폴더에서 되돌린다(`fresnel db restore <dir> --json`). 살아 있는 엔진은 정상 종료 순서로
    /// 끄고, CLI를 한 번 돌리고, 끝나면 엔진을 다시 띄운다. 종료 코드와 출력은 해석하지 않고 그대로 돌려준다.
    pub async fn restore_database(&self, backup_dir: String) -> Result<RestoreOutput, CommandError> {
        // 과제로 띄워 두면 호출한 쪽이 기다리기를 그만둬도 보류는 CLI가 끝날 때까지 남는다.
        let task = self.inner.runtime.spawn(restore(self.inner.clone(), backup_dir));
        match task.await {
            Ok(result) => result,
            Err(_) => Err(CommandError::StorageFailed),
        }
    }

    pub fn on_exit_requested(&self) -> ExitAction {
        let mut state = shared(&self.inner);
        if state.exit_allowed {
            return ExitAction::Allow;
        }
        if state.hold {
            // 복원 중에는 엔진이 내려가 있어 `live`가 없다. 그대로 허용하면 CLI가 도는 채로 앱이 끝나 결과를 잃는다.
            return if state.exit_waits_for_restore {
                ExitAction::Prevent
            } else {
                state.exit_waits_for_restore = true;
                ExitAction::PreventUntilRestore
            };
        }
        if state.live.is_none() {
            // 살아 있는 엔진이 없다. 대기 중인 재기동도 취소한다.
            state.stop_requested = true;
            drop(state);
            self.inner.stop_wake.notify_one();
            return ExitAction::Allow;
        }
        if state.shutdown_started {
            ExitAction::Prevent
        } else {
            state.shutdown_started = true;
            ExitAction::PreventAndShutdown
        }
    }

    /// 복원 보류가 풀릴 때까지 기다린다. 보류가 없으면 바로 돌아온다. 기다린 뒤에는 종료 요청을 다시 받는다.
    pub async fn wait_restore_end(&self) {
        let mut held = self.inner.held.subscribe();
        // 송신자는 `Inner`가 쥐고 있어 닫히지 않는다. 닫혀도 기다림을 끝내면 된다.
        let _ = held.wait_for(|held| !*held).await;
        shared(&self.inner).exit_waits_for_restore = false;
    }

    /// 두 번째 `ExitRequested`를 막지 않게 한다.
    pub fn allow_exit(&self) {
        shared(&self.inner).exit_allowed = true;
    }

    /// 정상 종료 순서 (L4.desktop.spec 4.3 2~5단계).
    pub async fn shutdown(&self) {
        let inner = &self.inner;
        let live = {
            let mut state = shared(inner);
            state.stop_requested = true;
            state
                .live
                .as_ref()
                .map(|l| (l.generation, l.pid, l.pipe.clone(), l.remote))
        };
        inner.relay.begin_drain();
        inner.stop_wake.notify_one();
        if let Some((generation, pid, pipe, remote)) = live {
            inner.relay.set_state(EngineState::Stopping);
            // 원격 엔진에는 host.shutdown을 보내지 않는다(retarget과 같다). 브리지가 그 줄을 원격 서비스로 넘긴다.
            self.stop_engine(generation, pid, &pipe, !remote).await;
        }
        let mut stopped = inner.stopped.subscribe();
        if timeout(KILL_SETTLE, stopped.wait_for(|done| *done)).await.is_err() {
            inner.log.line("shutdown: run loop did not report stopped in time");
        }
    }

    /// `send_shutdown`이 거짓이면 `host.shutdown` 없이 stdin만 닫는다. 원격 엔진의 브리지는 이 줄을 그대로
    /// 원격 서비스로 넘기므로 원격 서비스가 멈춘다. 브리지는 stdin이 닫히면 원격 연결만 끊고 끝난다(bridge.ts).
    async fn stop_engine(&self, generation: u64, pid: u32, pipe: &PipeHandle, send_shutdown: bool) {
        let inner = &self.inner;
        let deadline = Instant::now() + inner.config.shutdown_grace;
        let mut exited = inner.exited.subscribe();

        // 2~3. host.shutdown 요청 한 줄을 쓰고 stdin을 닫는다. 쓰기가 막혀 있으면 시한이 끊는다.
        if send_shutdown {
            let request = shutdown_request(generation);
            if timeout_at(deadline, pipe.write_shell_frame(request)).await.is_err() {
                inner.log.line("shutdown: stdin write is blocked, skipping to EOF wait");
            }
        }
        if timeout_at(deadline, pipe.close_write()).await.is_err() {
            inner.log.line("shutdown: could not queue stdin close");
        }

        // 4. 엔진이 끝나기를 시한까지 기다린다.
        let finished = timeout_at(deadline, exited.wait_for(|last| *last >= generation))
            .await
            .is_ok();
        if !finished {
            inner.log.line("shutdown: grace period expired, killing the process group");
        }

        // 5. 시한 안에 끝났더라도 그룹에 남은 손자를 정리한다. 남은 것이 없으면 아무 일도 없다.
        if let Err(error) = inner.launcher.kill_group(pid) {
            inner.log.line(&format!("shutdown: kill_group failed: {error}"));
        }
        if !finished && timeout(KILL_SETTLE, exited.wait_for(|last| *last >= generation)).await.is_err() {
            inner.log.line("shutdown: engine termination was not observed after SIGKILL");
        }
    }

    /// 앱이 끝나는 마지막 순간의 방어. 남은 그룹이 있으면 SIGKILL을 보낸다(동기).
    pub fn kill_remaining(&self) {
        let pid = shared(&self.inner).live.as_ref().map(|l| l.pid);
        if let Some(pid) = pid {
            if let Err(error) = self.inner.launcher.kill_group(pid) {
                self.inner.log.line(&format!("exit: kill_group failed: {error}"));
            }
        }
    }
}

/// 셸이 stdin에 쓰는 종료 요청 한 줄. id는 `shell:shutdown:<n>` 꼴이다.
fn shutdown_request(generation: u64) -> Vec<u8> {
    format!(
        "{{\"jsonrpc\":\"2.0\",\"id\":\"shell:shutdown:{generation}\",\"method\":\"host.shutdown\",\"params\":{{\"reason\":\"client_exit\"}}}}\n"
    )
    .into_bytes()
}

async fn run_loop<L: Launcher>(inner: Arc<Inner<L>>) {
    let mut policy = RestartPolicy::new(inner.config.restart_limit);
    let mut attempt: u32 = 0;
    // 재기동 정책을 맞춘 대상 세대. 대상이 바뀌면(W-08) 재기동 횟수를 0으로 되돌린다.
    let mut policy_epoch: u64 = 0;
    loop {
        // 복원 중이면 띄우지 않고 기다린다. 기다리다 종료 요청이 오면 나간다.
        if !wait_while_held(&inner).await {
            break;
        }
        // 대상과 세대는 같은 락에서 읽는다. 종료 요청이 있으면 띄우지 않는다. 보류가 다시 걸렸으면 기다리러 돌아간다.
        // 띄우는 창(`launching`)은 아래에서 등록이나 실패로 닫는다. 복원은 이 창이 닫힌 뒤에 보류를 건다.
        let (target, epoch, safe_mode) = {
            let mut state = shared(&inner);
            if state.stop_requested {
                break;
            }
            if state.hold {
                continue;
            }
            state.launching = true;
            (state.target.clone(), state.target_epoch, state.safe_mode)
        };
        if epoch != policy_epoch {
            policy.reset();
            attempt = 0;
            policy_epoch = epoch;
        }
        inner.relay.set_state(EngineState::Starting {
            source: EngineSource::Sidecar,
            attempt,
        });
        let launched = match inner.launcher.launch(&target, safe_mode) {
            Ok(launched) => launched,
            Err(LaunchError(message)) => {
                // 바이너리 없음, 실행 권한 없음, triple 불일치는 되풀이해도 같다. 재기동하지 않는다(spec 5).
                end_launch(&inner);
                inner.log.line(&format!("launch failed: {message}"));
                if !fail_and_wait(&inner, attempt, EngineExit::new(None, None), epoch).await {
                    break;
                }
                policy.reset();
                attempt = 0;
                continue;
            }
        };
        let pid = launched.pid;
        let pipe = match spawn_pipe_writer(launched.stdin, WRITE_QUEUE_FRAMES) {
            Ok(pipe) => pipe,
            Err(error) => {
                inner.log.line(&format!("stdin writer thread failed: {error}"));
                if let Err(kill) = inner.launcher.kill_group(pid) {
                    inner.log.line(&format!("kill_group failed: {kill}"));
                }
                end_launch(&inner);
                if !fail_and_wait(&inner, attempt, EngineExit::new(None, None), epoch).await {
                    break;
                }
                policy.reset();
                attempt = 0;
                continue;
            }
        };
        let (generation, stale) = {
            let mut state = shared(&inner);
            // 등록과 창 닫기를 같은 락에서 한다. 복원은 창이 닫힌 뒤의 `live`를 보고 이 엔진을 끈다.
            state.launching = false;
            state.generation += 1;
            state.failed = false;
            let generation = state.generation;
            // 띄우는 사이에 대상이 바뀌었으면 이 엔진은 새 대상과 맞지 않는다. 아래에서 정상 종료 순서로 끝낸다.
            let stale = (state.target_epoch != epoch).then(|| pipe.clone());
            state.live = Some(Live {
                generation,
                pid,
                pipe,
                remote: target.is_remote(),
            });
            (generation, stale)
        };
        inner.launch_settled.notify_one();
        inner.log.line(&format!("engine[{generation}] started pid={pid}"));
        inner.relay.set_state(EngineState::Running {
            source: EngineSource::Sidecar,
            pid: Some(pid),
        });
        if let Some(stale_pipe) = stale {
            // 대상을 바꾸는 요청이 이 엔진의 live 등록보다 먼저 들어왔다. 그 요청은 이 엔진을 못 본 채 지나갔으므로 여기서 끝낸다.
            let supervisor = Supervisor {
                inner: inner.clone(),
            };
            let send_shutdown = !target.is_remote();
            inner.runtime.spawn(async move {
                supervisor
                    .stop_engine(generation, pid, &stale_pipe, send_shutdown)
                    .await;
            });
        }

        let exit = pump(&inner, generation, launched.events).await;

        shared(&inner).live = None;
        inner.exited.send_replace(generation);
        inner.log.line(&format!(
            "engine[{generation}] exited code={:?} signal={:?}",
            exit.code, exit.signal
        ));
        let (stopping, current, held) = {
            let state = shared(&inner);
            (state.stop_requested, state.target_epoch, state.hold)
        };
        if stopping {
            break;
        }
        if current != epoch {
            // 대상을 바꾸려고 끝낸 엔진이다. 자동 재기동 횟수에 세지 않고 새 대상으로 바로 띄운다.
            policy.reset();
            policy_epoch = current;
            attempt = 1;
            inner.relay.set_state(EngineState::Restarting {
                attempt,
                retry_at: rfc3339_utc(now_ms()),
                last_exit: exit,
            });
            continue;
        }
        if held {
            // 복원 때문에 끝낸 엔진이다. 자동 재기동 횟수에 세지 않는다. 보류가 풀리면 맨 위에서 다시 띄운다.
            continue;
        }
        match policy.on_exit(Instant::now()) {
            RestartDecision::Restart { attempt: next, delay } => {
                attempt = next;
                let retry_at = rfc3339_utc(now_ms() + u64::try_from(delay.as_millis()).unwrap_or(0));
                inner.relay.set_state(EngineState::Restarting {
                    attempt: next,
                    retry_at,
                    last_exit: exit,
                });
                if !delay.is_zero() {
                    // 구독은 대상을 보기 전에 한다. 그 뒤에 바뀐 대상은 구독이 알려 준다.
                    let mut retargeted = inner.retargeted.subscribe();
                    if shared(&inner).target_epoch == epoch {
                        tokio::select! {
                            () = tokio::time::sleep(delay) => {}
                            () = inner.stop_wake.notified() => {}
                            _ = retargeted.changed() => {}
                        }
                    }
                }
            }
            RestartDecision::GiveUp { attempts } => {
                if !fail_and_wait(&inner, attempts, exit, epoch).await {
                    break;
                }
                policy.reset();
                attempt = 0;
            }
        }
    }
    inner.relay.set_state(EngineState::Stopped);
    inner.stopped.send_replace(true);
}

/// 복원 보류가 풀릴 때까지 기다린다. 기다리는 동안 상태는 `stopped`다. 종료 요청이 오면 거짓을 돌려준다.
async fn wait_while_held<L: Launcher>(inner: &Arc<Inner<L>>) -> bool {
    loop {
        {
            let state = shared(inner);
            if state.stop_requested {
                return false;
            }
            if !state.hold {
                return true;
            }
        }
        inner.relay.set_state(EngineState::Stopped);
        tokio::select! {
            () = inner.hold_wake.notified() => {}
            () = inner.stop_wake.notified() => {}
        }
    }
}

/// 띄우는 창을 닫는다. 복원이 창이 닫히기를 기다리고 있으면 깨운다.
fn end_launch<L: Launcher>(inner: &Inner<L>) {
    shared(inner).launching = false;
    inner.launch_settled.notify_one();
}

/// 복원 보류의 손잡이. 떨어지면(정상, 오류, 취소 모두) 보류를 풀고 실행 루프를 깨운다.
struct HoldGuard<L: Launcher> {
    inner: Arc<Inner<L>>,
}

impl<L: Launcher> Drop for HoldGuard<L> {
    fn drop(&mut self) {
        shared(&self.inner).hold = false;
        self.inner.held.send_replace(false);
        self.inner.hold_wake.notify_one();
    }
}

/// 복원 보류를 건다. 띄우는 창이 닫힐 때까지 기다린 뒤에 건다. 그래서 보류가 걸린 뒤에는 새 엔진이 생기지 않는다.
/// 걸린 순간의 살아 있는 엔진을 돌려준다.
async fn begin_hold<L: Launcher>(inner: &Arc<Inner<L>>) -> Result<Option<Live>, CommandError> {
    let deadline = Instant::now() + inner.config.shutdown_grace + RESTORE_SLACK;
    loop {
        let settled = inner.launch_settled.notified();
        {
            let mut state = shared(inner);
            if state.stop_requested {
                return Err(CommandError::EngineStopping);
            }
            if state.target.is_remote() {
                return Err(CommandError::RemoteTarget);
            }
            if state.hold {
                return Err(CommandError::Busy);
            }
            if !state.launching {
                state.hold = true;
                inner.held.send_replace(true);
                return Ok(state.live.clone());
            }
        }
        if timeout_at(deadline, settled).await.is_err() {
            return Err(CommandError::EngineStopping);
        }
    }
}

/// 복원 본체. `Supervisor::restore_database`가 따로 띄운 과제에서 돈다.
async fn restore<L: Launcher>(
    inner: Arc<Inner<L>>,
    backup_dir: String,
) -> Result<RestoreOutput, CommandError> {
    let live = begin_hold(&inner).await?;
    // 여기서부터는 어떤 경로로 끝나도 보류가 풀린다.
    let _hold = HoldGuard {
        inner: inner.clone(),
    };
    if let Some(live) = live {
        inner.relay.set_state(EngineState::Stopping);
        let deadline = Instant::now() + inner.config.shutdown_grace + RESTORE_SLACK;
        let mut exited = inner.exited.subscribe();
        // 원격 엔진에는 host.shutdown을 보내지 않는다(stop_engine과 같다).
        Supervisor {
            inner: inner.clone(),
        }
        .stop_engine(live.generation, live.pid, &live.pipe, !live.remote)
        .await;
        if timeout_at(deadline, exited.wait_for(|last| *last >= live.generation))
            .await
            .is_err()
        {
            inner.log.line("db restore: the engine did not exit in time");
            return Err(CommandError::EngineStopping);
        }
    }
    let worker = inner.clone();
    let args = vec![
        "db".to_string(),
        "restore".to_string(),
        backup_dir,
        "--json".to_string(),
    ];
    let ran = tokio::task::spawn_blocking(move || worker.launcher.run_once(&args)).await;
    let output = match ran {
        Ok(Ok(output)) => output,
        Ok(Err(LaunchError(message))) => {
            inner.log.line(&format!("db restore could not run: {message}"));
            return Err(CommandError::StorageFailed);
        }
        Err(_) => return Err(CommandError::StorageFailed),
    };
    inner
        .log
        .line(&format!("db restore finished exit={}", output.exit_code));
    Ok(RestoreOutput {
        exit_code: output.exit_code,
        stdout: output.stdout,
        stderr: output.stderr,
    })
}

/// `failed`로 두고 수동 재기동, 종료, 대상 바꾸기를 기다린다. 다시 띄울 때면 참이다.
/// `epoch`는 이 엔진을 띄울 때의 대상 세대다. 그 뒤에 대상이 바뀌었으면 기다리지 않는다.
async fn fail_and_wait<L: Launcher>(
    inner: &Arc<Inner<L>>,
    attempts: u32,
    last_exit: EngineExit,
    epoch: u64,
) -> bool {
    // 구독은 대상을 보기 전에 한다. 그 사이에 바뀐 대상도, 그 뒤에 바뀐 대상도 놓치지 않는다.
    let mut retargeted = inner.retargeted.subscribe();
    {
        let mut state = shared(inner);
        if state.stop_requested {
            return false;
        }
        if state.target_epoch != epoch {
            return true;
        }
        state.failed = true;
    }
    inner.relay.set_state(EngineState::Failed {
        attempts,
        last_exit,
    });
    tokio::select! {
        () = inner.restart_wake.notified() => !shared(inner).stop_requested,
        () = inner.stop_wake.notified() => false,
        _ = retargeted.changed() => true,
    }
}

/// 엔진 이벤트를 소비한다. stdout은 세대 전용 스트림으로, stderr는 줄 단위 로그로 보낸다.
async fn pump<L: Launcher>(
    inner: &Arc<Inner<L>>,
    generation: u64,
    mut events: mpsc::Receiver<EngineEvent>,
) -> EngineExit {
    let mut stream = inner.relay.open_stream();
    let mut stderr = StderrSplitter::default();
    let mut exit = None;
    while let Some(event) = events.recv().await {
        match event {
            EngineEvent::Stdout(bytes) => stream.push(bytes).await,
            EngineEvent::Stderr(bytes) => {
                for line in stderr.push(&bytes) {
                    inner.log.line(&format!("engine[{generation}] stderr: {line}"));
                }
            }
            EngineEvent::Terminated { code, signal } => {
                exit = Some(EngineExit::new(code, signal));
                break;
            }
            EngineEvent::Error(message) => {
                inner.log.line(&format!("engine[{generation}] event error: {message}"));
            }
        }
    }
    if let Some(line) = stderr.finish() {
        inner.log.line(&format!("engine[{generation}] stderr: {line}"));
    }
    // E11: 프레임 내용은 남기지 않고 바이트 수만 남긴다.
    let stats = stream.finish();
    inner.log.line(&format!(
        "engine[{generation}] relay forwarded={}B dropped={}B dropped_tail={}B overflowed_lines={}",
        stats.forwarded_bytes, stats.dropped_bytes, stats.dropped_tail_bytes, stats.overflowed_lines
    ));
    exit.unwrap_or_else(|| EngineExit::new(None, None))
}

// ---------------------------------------------------------------------------------------------
// Tauri 구현

/// `CommandChild`를 감싼 stdin. 떨어뜨리면(drop) 파이프가 닫혀 EOF가 된다(플러그인은 drop에서 프로세스를 죽이지 않는다).
pub(crate) struct ChildStdin(pub(crate) CommandChild);

impl StdinSink for ChildStdin {
    fn write_all(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.0.write(bytes).map_err(io::Error::other)
    }
}

/// 플러그인의 이벤트 채널을 용량 1의 채널로 한 번 더 거친다. 소비가 느리면 플러그인의 읽기 스레드까지 멈춘다.
pub(crate) fn forward_events(
    runtime: &Handle,
    mut rx: mpsc::Receiver<CommandEvent>,
) -> mpsc::Receiver<EngineEvent> {
    let (tx, events) = mpsc::channel(1);
    runtime.spawn(async move {
        while let Some(event) = rx.recv().await {
            let mapped = match event {
                CommandEvent::Stdout(bytes) => EngineEvent::Stdout(bytes),
                CommandEvent::Stderr(bytes) => EngineEvent::Stderr(bytes),
                CommandEvent::Terminated(payload) => EngineEvent::Terminated {
                    code: payload.code,
                    signal: payload.signal,
                },
                CommandEvent::Error(message) => EngineEvent::Error(message),
                _ => continue,
            };
            if tx.send(mapped).await.is_err() {
                break;
            }
        }
    });
    events
}

pub struct TauriLauncher {
    app: AppHandle,
    runtime: Handle,
}

impl TauriLauncher {
    pub fn new(app: AppHandle, runtime: Handle) -> Self {
        Self { app, runtime }
    }

    /// E6: 사용자 홈 디렉터리의 절대 경로.
    pub(crate) fn working_dir(&self) -> Result<PathBuf, LaunchError> {
        let home = self
            .app
            .path()
            .home_dir()
            .map_err(|e| LaunchError(format!("home directory is unknown: {e}")))?;
        if home.is_absolute() {
            Ok(home)
        } else {
            Err(LaunchError(format!("home directory is not absolute: {}", home.display())))
        }
    }

    #[cfg(debug_assertions)]
    pub(crate) fn dev_override() -> Option<(OsString, Vec<OsString>)> {
        let bin = std::env::var_os("FRESNEL_DESKTOP_ENGINE_BIN").filter(|v| !v.is_empty())?;
        let args = std::env::var("FRESNEL_DESKTOP_ENGINE_ARGS")
            .map(|text| text.split_whitespace().map(OsString::from).collect())
            .unwrap_or_default();
        Some((bin, args))
    }

    #[cfg(not(debug_assertions))]
    pub(crate) fn dev_override() -> Option<(OsString, Vec<OsString>)> {
        None
    }
}

impl TauriLauncher {
    /// 사이드카 명령을 만든다. 이름이 없으면 오류다.
    fn sidecar_command(&self) -> Result<tauri_plugin_shell::process::Command, LaunchError> {
        self.app
            .shell()
            .sidecar(SIDECAR_NAME)
            .map_err(|e| LaunchError(format!("sidecar `{SIDECAR_NAME}` is not available: {e}")))
    }

    /// 명령을 엔진과 같은 작업 폴더와 환경으로 띄운다(E6, E7). 그룹으로 묶고 stdout은 원시 바이트로 받는다.
    fn spawn_child(
        &self,
        command: tauri_plugin_shell::process::Command,
    ) -> Result<Launched, LaunchError> {
        let cwd = self.working_dir()?;
        // cwd는 홈 디렉터리다(E6). PATH 보강에도 이 값을 쓴다.
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
}

/// `run_once`의 이벤트를 모은다. 출력은 상한까지만 남기고 끝까지 읽는다. 종료 코드가 없으면(신호로 끝남) -1이다.
async fn collect_once(events: &mut mpsc::Receiver<EngineEvent>) -> Result<OnceOutput, LaunchError> {
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    while let Some(event) = events.recv().await {
        match event {
            EngineEvent::Stdout(bytes) => push_capped(&mut stdout, &bytes),
            EngineEvent::Stderr(bytes) => push_capped(&mut stderr, &bytes),
            EngineEvent::Terminated { code, .. } => {
                return Ok(OnceOutput {
                    exit_code: code.unwrap_or(-1),
                    stdout: String::from_utf8_lossy(&stdout).into_owned(),
                    stderr: String::from_utf8_lossy(&stderr).into_owned(),
                });
            }
            EngineEvent::Error(_) => {}
        }
    }
    Err(LaunchError(
        "the command ended without an exit event".into(),
    ))
}

/// 상한까지만 덧붙인다. 넘는 바이트는 버린다.
fn push_capped(buffer: &mut Vec<u8>, chunk: &[u8]) {
    let room = ONCE_OUTPUT_MAX_BYTES.saturating_sub(buffer.len());
    buffer.extend_from_slice(&chunk[..chunk.len().min(room)]);
}

impl Launcher for TauriLauncher {
    fn launch(&self, target: &EngineTarget, safe_mode: bool) -> Result<Launched, LaunchError> {
        // 개발 덮어쓰기 인자(`FRESNEL_DESKTOP_ENGINE_ARGS`)는 이미 `host --stdio`로 끝나므로 그 뒤에 플래그만 붙인다.
        let command = match Self::dev_override() {
            Some((bin, args)) => self
                .app
                .shell()
                .command(bin)
                .args(args)
                .args(engine_flags(target, safe_mode)),
            None => self
                .sidecar_command()?
                .args(sidecar_args(target, safe_mode)),
        };
        self.spawn_child(command)
    }

    /// 호스트 인자 없이 같은 프로그램을 `args`로 돌린다. 개발 덮어쓰기는 `host --stdio` 앞부분만 쓴다(secret_entry와 같다).
    fn run_once(&self, args: &[String]) -> Result<OnceOutput, LaunchError> {
        let command = match Self::dev_override() {
            Some((bin, override_args)) => match override_prefix(&override_args) {
                Some(prefix) => self.app.shell().command(bin).args(prefix).args(args),
                None => self.sidecar_command()?.args(args),
            },
            None => self.sidecar_command()?.args(args),
        };
        let Launched {
            pid,
            mut events,
            stdin,
        } = self.spawn_child(command)?;
        // 입력은 없다. stdin을 떨어뜨려 닫는다.
        drop(stdin);
        match self
            .runtime
            .block_on(timeout(ONCE_TIMEOUT, collect_once(&mut events)))
        {
            Ok(output) => output,
            Err(_) => {
                let killed = self.kill_group(pid);
                Err(LaunchError(format!(
                    "the command did not finish in {} s and was killed (group kill: {killed:?})",
                    ONCE_TIMEOUT.as_secs()
                )))
            }
        }
    }

    fn kill_group(&self, pid: u32) -> io::Result<()> {
        kill_process_group(pid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::relay::{Sink, SinkClosed};
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::Condvar;

    // ----- 순수 로직 -----

    #[test]
    fn engine_state_serializes_to_the_ipc_schema() {
        let exit = EngineExit {
            code: Some(1),
            signal: None,
            at: "2026-10-24T00:00:00.000Z".into(),
        };
        let cases = [
            (
                EngineState::Starting { source: EngineSource::Sidecar, attempt: 2 },
                r#"{"kind":"starting","source":"sidecar","attempt":2}"#,
            ),
            (
                EngineState::Running { source: EngineSource::Sidecar, pid: Some(42) },
                r#"{"kind":"running","source":"sidecar","pid":42}"#,
            ),
            (
                EngineState::Restarting {
                    attempt: 1,
                    retry_at: "2026-10-24T00:00:01.000Z".into(),
                    last_exit: exit.clone(),
                },
                r#"{"kind":"restarting","attempt":1,"retryAt":"2026-10-24T00:00:01.000Z","lastExit":{"code":1,"signal":null,"at":"2026-10-24T00:00:00.000Z"}}"#,
            ),
            (EngineState::Stopping, r#"{"kind":"stopping"}"#),
            (
                EngineState::Failed { attempts: 3, last_exit: exit },
                r#"{"kind":"failed","attempts":3,"lastExit":{"code":1,"signal":null,"at":"2026-10-24T00:00:00.000Z"}}"#,
            ),
            (EngineState::Stopped, r#"{"kind":"stopped"}"#),
        ];
        for (state, expected) in cases {
            assert_eq!(serde_json::to_string(&state).expect("json"), expected);
        }
    }

    #[test]
    fn restart_policy_backs_off_then_gives_up() {
        let mut policy = RestartPolicy::new(3);
        let t = Instant::now();
        assert_eq!(policy.on_exit(t), RestartDecision::Restart { attempt: 1, delay: Duration::ZERO });
        assert_eq!(policy.on_exit(t), RestartDecision::Restart { attempt: 2, delay: Duration::from_secs(1) });
        assert_eq!(policy.on_exit(t), RestartDecision::Restart { attempt: 3, delay: Duration::from_secs(2) });
        // D-05: restartLimit + 1번째 종료는 failed.
        assert_eq!(policy.on_exit(t), RestartDecision::GiveUp { attempts: 3 });
    }

    #[test]
    fn restart_policy_backoff_caps_at_eight_seconds() {
        let mut policy = RestartPolicy::new(10);
        let t = Instant::now();
        let delays: Vec<u64> = (0..7)
            .map(|_| match policy.on_exit(t) {
                RestartDecision::Restart { delay, .. } => delay.as_secs(),
                RestartDecision::GiveUp { .. } => u64::MAX,
            })
            .collect();
        assert_eq!(delays, [0, 1, 2, 4, 8, 8, 8]);
    }

    #[test]
    fn restart_policy_counts_only_the_last_ten_minutes() {
        let mut policy = RestartPolicy::new(1);
        let t = Instant::now();
        assert!(matches!(policy.on_exit(t), RestartDecision::Restart { .. }));
        assert!(matches!(policy.on_exit(t + Duration::from_secs(599)), RestartDecision::GiveUp { .. }));
        // 10분 넘게 재기동이 없었다: 횟수가 0으로 돌아간다.
        assert!(matches!(
            policy.on_exit(t + Duration::from_secs(601)),
            RestartDecision::Restart { attempt: 1, .. }
        ));
    }

    #[test]
    fn restart_limit_zero_disables_automatic_restarts() {
        let mut policy = RestartPolicy::new(0);
        assert_eq!(policy.on_exit(Instant::now()), RestartDecision::GiveUp { attempts: 0 });
    }

    #[test]
    fn manual_restart_resets_the_count() {
        let mut policy = RestartPolicy::new(1);
        let t = Instant::now();
        policy.on_exit(t);
        assert!(matches!(policy.on_exit(t), RestartDecision::GiveUp { .. }));
        policy.reset();
        assert!(matches!(policy.on_exit(t), RestartDecision::Restart { attempt: 1, .. }));
    }

    #[test]
    fn config_uses_defaults_for_missing_or_out_of_range_values() {
        let default = EngineConfig::default();
        assert_eq!(default.shutdown_grace, Duration::from_millis(7000));
        assert_eq!(default.restart_limit, 3);
        assert_eq!(EngineConfig::from_values(None, None), default);
        assert_eq!(EngineConfig::from_values(Some(999), Some(11)), default);
        assert_eq!(EngineConfig::from_values(Some(180_001), Some(-1)), default);
        let custom = EngineConfig::from_values(Some(5000), Some(0));
        assert_eq!(custom.shutdown_grace, Duration::from_millis(5000));
        assert_eq!(custom.restart_limit, 0);
    }

    #[test]
    fn engine_env_removes_only_bun_options() {
        let vars = vec![
            (OsString::from("PATH"), OsString::from("/bin")),
            (OsString::from("BUN_OPTIONS"), OsString::from("--inspect")),
            (OsString::from("BUN_OPTIONS_X"), OsString::from("keep")),
            (OsString::from("HOME"), OsString::from("/home/u")),
        ];
        let kept: Vec<String> = engine_env(vars, None)
            .into_iter()
            .map(|(k, _)| k.to_string_lossy().into_owned())
            .collect();
        assert_eq!(kept, ["PATH", "BUN_OPTIONS_X", "HOME"]);
    }

    #[cfg(unix)]
    #[test]
    fn engine_env_adds_the_tool_dirs_to_the_path_in_place_or_last() {
        let pair = |k: &str, v: &str| (OsString::from(k), OsString::from(v));
        // Finder로 띄운 앱: PATH가 있으면 제자리에서 보강되고, BUN_OPTIONS는 빠진다.
        let finder = vec![
            pair("HOME", "/Users/u"),
            pair("PATH", "/usr/bin:/bin:/usr/sbin:/sbin"),
            pair("BUN_OPTIONS", "--inspect"),
        ];
        assert_eq!(
            engine_env(finder, Some(Path::new("/Users/u"))),
            vec![
                pair("HOME", "/Users/u"),
                pair(
                    "PATH",
                    "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/Users/u/.local/bin:/Users/u/.nix-profile/bin"
                ),
            ]
        );
        // PATH가 없으면 맨 뒤에 넣는다.
        assert_eq!(
            engine_env(vec![pair("HOME", "/Users/u")], Some(Path::new("/Users/u"))),
            vec![
                pair("HOME", "/Users/u"),
                pair(
                    "PATH",
                    "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/Users/u/.local/bin:/Users/u/.nix-profile/bin"
                ),
            ]
        );
    }

    #[test]
    fn stderr_lines_split_across_chunks_and_truncate_at_8_kib() {
        let mut splitter = StderrSplitter::default();
        assert_eq!(splitter.push(b"one\ntw"), ["one"]);
        assert_eq!(splitter.push(b"o\r\n"), ["two"]);
        let mut long = vec![b'x'; STDERR_LINE_MAX + 100];
        long.extend_from_slice(b"\nnext\n");
        let lines = splitter.push(&long);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].len(), STDERR_LINE_MAX);
        assert_eq!(lines[1], "next");
        assert_eq!(splitter.push(b"no newline"), Vec::<String>::new());
        assert_eq!(splitter.finish().as_deref(), Some("no newline"));
        assert_eq!(splitter.finish(), None);
    }

    #[test]
    fn shutdown_request_is_one_json_rpc_line() {
        let line = String::from_utf8(shutdown_request(7)).expect("utf8");
        assert!(line.ends_with('\n'));
        let value: serde_json::Value = serde_json::from_str(line.trim_end()).expect("json");
        assert_eq!(value["id"], "shell:shutdown:7");
        assert_eq!(value["method"], "host.shutdown");
        assert_eq!(value["params"]["reason"], "client_exit");
    }

    #[cfg(unix)]
    #[test]
    fn kill_process_group_refuses_pgid_zero_and_one() {
        assert!(kill_process_group(0).is_err());
        assert!(kill_process_group(1).is_err());
    }

    /// 실제 프로세스 그룹: 엔진 흉내(`sh`)와 같은 그룹의 손자가 함께 끝난다. 이미 없는 그룹은 성공이다.
    #[cfg(unix)]
    #[test]
    fn kill_process_group_ends_the_leader_and_its_group_members() {
        use std::os::unix::process::CommandExt;
        use std::process::{Command, Stdio};
        let mut leader = Command::new("sh")
            .args(["-c", "sleep 30 & echo $!; wait"])
            .stdout(Stdio::piped())
            .process_group(0)
            .spawn()
            .expect("spawn sh");
        let mut out = String::new();
        {
            use std::io::{BufRead, BufReader};
            let stdout = leader.stdout.take().expect("stdout");
            BufReader::new(stdout).read_line(&mut out).expect("grandchild pid");
        }
        let grandchild: i32 = out.trim().parse().expect("pid");
        let pid = leader.id();
        kill_process_group(pid).expect("kill group");
        leader.wait().expect("reap leader");
        let alive = |pid: i32| unsafe { libc::kill(pid, 0) } == 0;
        let mut gone = false;
        for _ in 0..100 {
            // 손자는 init에 입양된 뒤 수거된다. 좀비로 남는 짧은 시간을 기다린다.
            if !alive(grandchild) {
                gone = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(gone, "grandchild {grandchild} survived the group kill");
        kill_process_group(pid).expect("a group with no members is not an error");
    }

    // ----- 감독자: 가짜 엔진 -----

    #[derive(Clone)]
    struct EngineHandle {
        pid: u32,
        events: mpsc::Sender<EngineEvent>,
        written: Arc<Mutex<Vec<u8>>>,
        stdin_closed: Arc<AtomicBool>,
        gate: Arc<(Mutex<bool>, Condvar)>,
        /// 사건 순서를 남긴다(`FakeLauncher::calls`와 같은 줄).
        calls: Arc<Mutex<Vec<String>>>,
    }

    impl EngineHandle {
        async fn stdout(&self, bytes: &[u8]) {
            self.events.send(EngineEvent::Stdout(bytes.to_vec())).await.expect("send");
        }
        async fn crash(&self, code: i32) {
            self.events
                .send(EngineEvent::Terminated { code: Some(code), signal: None })
                .await
                .expect("send");
        }
        fn written(&self) -> String {
            String::from_utf8_lossy(&self.written.lock().expect("lock")).into_owned()
        }
    }

    struct FakeStdin {
        handle: EngineHandle,
        exit_on_eof: bool,
    }

    impl StdinSink for FakeStdin {
        fn write_all(&mut self, bytes: &[u8]) -> io::Result<()> {
            let (lock, cv) = &*self.handle.gate;
            let mut open = lock.lock().expect("lock");
            while !*open {
                open = cv.wait(open).expect("wait");
            }
            if String::from_utf8_lossy(bytes).contains("host.shutdown") {
                self.handle
                    .calls
                    .lock()
                    .expect("lock")
                    .push(format!("shutdown:{}", self.handle.pid));
            }
            self.handle.written.lock().expect("lock").extend_from_slice(bytes);
            Ok(())
        }
    }

    impl Drop for FakeStdin {
        fn drop(&mut self) {
            self.handle.stdin_closed.store(true, Ordering::SeqCst);
            self.handle
                .calls
                .lock()
                .expect("lock")
                .push(format!("stdin-closed:{}", self.handle.pid));
            if self.exit_on_eof {
                // EOF를 읽은 엔진이 체크포인트하고 끝난다.
                let _ = self.handle.events.try_send(EngineEvent::Terminated { code: Some(0), signal: None });
            }
        }
    }

    #[derive(Clone, Copy)]
    struct Behavior {
        exit_on_eof: bool,
        /// 참이면 stdin 쓰기가 `release`(또는 kill_group)까지 막힌다.
        block_writes: bool,
    }

    struct FakeLauncher {
        behavior: Behavior,
        launches: AtomicU32,
        fail_launch: AtomicBool,
        handles: Mutex<Vec<EngineHandle>>,
        /// 띄울 때 받은 대상을 순서대로 남긴다.
        targets: Mutex<Vec<EngineTarget>>,
        /// 띄울 때 받은 안전 모드를 순서대로 남긴다.
        safe_modes: Mutex<Vec<bool>>,
        killed: Mutex<Vec<u32>>,
        /// `launch`가 한 번 불리기 전에 실행한다(띄우는 사이의 대상 바꾸기를 재현한다).
        on_launch: Mutex<Option<Box<dyn FnOnce() + Send>>>,
        /// kill_group이 불렸을 때 엔진을 종료시킨다.
        die_on_kill: bool,
        /// 사건 순서: `launch:<pid>`, `shutdown:<pid>`, `stdin-closed:<pid>`, `kill:<pid>`, `run-once:<인자>`.
        calls: Arc<Mutex<Vec<String>>>,
        /// `run_once`의 결과. 한 번 쓰고 나면 기본값(종료 코드 0, 빈 출력)으로 돌아간다.
        once: Mutex<Option<Result<OnceOutput, LaunchError>>>,
        /// 닫혀 있으면 `run_once`가 열릴 때까지 기다린다. 처음에는 열려 있다.
        once_gate: Arc<(Mutex<bool>, Condvar)>,
    }

    impl FakeLauncher {
        fn new(behavior: Behavior, die_on_kill: bool) -> Arc<Self> {
            Arc::new(Self {
                behavior,
                launches: AtomicU32::new(0),
                fail_launch: AtomicBool::new(false),
                handles: Mutex::new(Vec::new()),
                targets: Mutex::new(Vec::new()),
                safe_modes: Mutex::new(Vec::new()),
                killed: Mutex::new(Vec::new()),
                on_launch: Mutex::new(None),
                die_on_kill,
                calls: Arc::new(Mutex::new(Vec::new())),
                once: Mutex::new(None),
                once_gate: Arc::new((Mutex::new(true), Condvar::new())),
            })
        }
        fn handle(&self, n: usize) -> EngineHandle {
            self.handles.lock().expect("lock")[n].clone()
        }
        fn calls(&self) -> Vec<String> {
            self.calls.lock().expect("lock").clone()
        }
        fn close_once_gate(&self) {
            *self.once_gate.0.lock().expect("lock") = false;
        }
        fn open_once_gate(&self) {
            *self.once_gate.0.lock().expect("lock") = true;
            self.once_gate.1.notify_all();
        }
    }

    impl Launcher for Arc<FakeLauncher> {
        fn launch(&self, target: &EngineTarget, safe_mode: bool) -> Result<Launched, LaunchError> {
            let hook = self.on_launch.lock().expect("lock").take();
            if let Some(hook) = hook {
                hook();
            }
            if self.fail_launch.load(Ordering::SeqCst) {
                return Err(LaunchError("no such binary".into()));
            }
            self.targets.lock().expect("lock").push(target.clone());
            self.safe_modes.lock().expect("lock").push(safe_mode);
            let n = self.launches.fetch_add(1, Ordering::SeqCst) + 1;
            let pid = 1000 + n;
            self.calls.lock().expect("lock").push(format!("launch:{pid}"));
            let (tx, rx) = mpsc::channel(8);
            let handle = EngineHandle {
                pid,
                events: tx,
                written: Arc::new(Mutex::new(Vec::new())),
                stdin_closed: Arc::new(AtomicBool::new(false)),
                gate: Arc::new((Mutex::new(!self.behavior.block_writes), Condvar::new())),
                calls: self.calls.clone(),
            };
            self.handles.lock().expect("lock").push(handle.clone());
            Ok(Launched {
                pid,
                events: rx,
                stdin: Box::new(FakeStdin { handle, exit_on_eof: self.behavior.exit_on_eof }),
            })
        }

        fn run_once(&self, args: &[String]) -> Result<OnceOutput, LaunchError> {
            self.calls
                .lock()
                .expect("lock")
                .push(format!("run-once:{}", args.join(" ")));
            {
                let (lock, cv) = &*self.once_gate;
                let mut open = lock.lock().expect("lock");
                while !*open {
                    open = cv.wait(open).expect("wait");
                }
            }
            let scripted = self.once.lock().expect("lock").take();
            scripted.unwrap_or(Ok(OnceOutput {
                exit_code: 0,
                stdout: String::new(),
                stderr: String::new(),
            }))
        }

        fn kill_group(&self, pid: u32) -> io::Result<()> {
            self.killed.lock().expect("lock").push(pid);
            self.calls.lock().expect("lock").push(format!("kill:{pid}"));
            if self.die_on_kill {
                // 그룹의 pid로 엔진을 찾는다. 나중에 뜬 엔진을 잘못 끝내지 않도록 마지막 것을 고르지 않는다.
                let found = self
                    .handles
                    .lock()
                    .expect("lock")
                    .iter()
                    .find(|h| h.pid == pid)
                    .cloned();
                if let Some(handle) = found {
                    // 막힌 쓰기를 풀고 프로세스를 끝낸다.
                    *handle.gate.0.lock().expect("lock") = true;
                    handle.gate.1.notify_all();
                    let _ = handle.events.try_send(EngineEvent::Terminated { code: None, signal: Some(9) });
                }
            }
            Ok(())
        }
    }

    #[derive(Default)]
    struct NullSink {
        states: Mutex<Vec<EngineState>>,
        bytes: Mutex<Vec<u8>>,
    }
    impl Sink for NullSink {
        fn send_bytes(&self, bytes: Vec<u8>) -> Result<(), SinkClosed> {
            self.bytes.lock().expect("lock").extend(bytes);
            Ok(())
        }
        fn send_state(&self, state: &EngineState) -> Result<(), SinkClosed> {
            self.states.lock().expect("lock").push(state.clone());
            Ok(())
        }
    }

    struct Rig {
        launcher: Arc<FakeLauncher>,
        supervisor: Supervisor<Arc<FakeLauncher>>,
        relay: Arc<Relay>,
        sink: Arc<NullSink>,
    }

    fn rig(behavior: Behavior, die_on_kill: bool, restart_limit: u32) -> Rig {
        let launcher = FakeLauncher::new(behavior, die_on_kill);
        let relay = Arc::new(Relay::new(EngineState::Stopped));
        let sink = Arc::new(NullSink::default());
        relay.attach(sink.clone());
        let config = EngineConfig {
            shutdown_grace: Duration::from_millis(7000),
            restart_limit,
        };
        let supervisor = Supervisor::new(
            launcher.clone(),
            relay.clone(),
            config,
            Arc::new(AppLog::open(None)),
            Handle::current(),
        );
        Rig { launcher, supervisor, relay, sink }
    }

    async fn until<F: Fn() -> bool>(what: &str, f: F) {
        for _ in 0..500 {
            if f() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("timed out waiting for {what}");
    }

    fn kinds(sink: &NullSink) -> Vec<String> {
        sink.states
            .lock()
            .expect("lock")
            .iter()
            .map(|s| {
                serde_json::to_value(s).expect("json")["kind"].as_str().expect("kind").to_string()
            })
            .collect()
    }

    const EOF_EXIT: Behavior = Behavior { exit_on_eof: true, block_writes: false };

    #[tokio::test(start_paused = true)]
    async fn engine_output_reaches_the_page_and_state_goes_running() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        rig.launcher.handle(0).stdout(b"{\"hello\":1}\n").await;
        until("bytes", || !rig.sink.bytes.lock().expect("lock").is_empty()).await;
        assert_eq!(*rig.sink.bytes.lock().expect("lock"), b"{\"hello\":1}\n");
        assert_eq!(kinds(&rig.sink), ["starting", "running"]);
    }

    #[tokio::test(start_paused = true)]
    async fn crashes_restart_with_backoff_then_fail_and_manual_restart_recovers() {
        let rig = rig(EOF_EXIT, true, 2);
        rig.supervisor.start();
        for n in 0..3usize {
            until("launch", || rig.launcher.launches.load(Ordering::SeqCst) as usize > n).await;
            until("running", || rig.launcher.handles.lock().expect("lock").len() > n).await;
            // 상태가 running이 된 뒤에 죽인다.
            tokio::time::sleep(Duration::from_millis(10)).await;
            rig.launcher.handle(n).crash(1).await;
        }
        until("failed", || kinds(&rig.sink).last().map(String::as_str) == Some("failed")).await;
        // limit 2: 최초 1번 + 자동 재기동 2번 = 3번 뜨고, 세 번째 종료에서 failed가 된다.
        assert_eq!(rig.launcher.launches.load(Ordering::SeqCst), 3);
        let seen = kinds(&rig.sink);
        assert_eq!(
            seen,
            ["starting", "running", "restarting", "starting", "running", "restarting", "starting", "running", "failed"]
        );
        assert!(matches!(rig.relay.state(), EngineState::Failed { attempts: 2, .. }));
        // 수동 재기동. 확인 없이도 failed에서는 다시 뜬다.
        assert_eq!(rig.supervisor.restart_manually(None, false), Ok(()));
        until("relaunch", || rig.launcher.launches.load(Ordering::SeqCst) == 4).await;
        until("running again", || {
            kinds(&rig.sink).last().map(String::as_str) == Some("running")
        })
        .await;
        assert_eq!(
            rig.supervisor.restart_manually(None, false),
            Err(CommandError::NotConfirmed)
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_missing_binary_fails_without_retrying() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.launcher.fail_launch.store(true, Ordering::SeqCst);
        rig.supervisor.start();
        until("failed", || kinds(&rig.sink).last().map(String::as_str) == Some("failed")).await;
        tokio::time::sleep(Duration::from_secs(60)).await;
        assert_eq!(rig.launcher.launches.load(Ordering::SeqCst), 0);
        assert_eq!(kinds(&rig.sink), ["starting", "failed"]);
    }

    // 쓰기 스레드가 실제 시간으로 도는 경로라 가상 시계를 쓰지 않는다.
    #[tokio::test]
    async fn graceful_shutdown_writes_the_request_then_eof_and_does_not_wait_for_the_grace() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        let engine = rig.launcher.handle(0);
        let started = Instant::now();
        rig.supervisor.shutdown().await;
        assert!(started.elapsed() < Duration::from_secs(5), "ended on EOF, not on the grace deadline");
        let written = engine.written();
        assert!(written.contains("\"method\":\"host.shutdown\""), "{written}");
        assert!(engine.stdin_closed.load(Ordering::SeqCst));
        // 시한 안에 끝났더라도 남은 손자를 위해 그룹 SIGKILL을 한 번 보낸다.
        assert_eq!(*rig.launcher.killed.lock().expect("lock"), [1001]);
        assert_eq!(kinds(&rig.sink).last().map(String::as_str), Some("stopped"));
        assert!(kinds(&rig.sink).contains(&"stopping".to_string()));
        // 종료 중 쓰기는 거부한다.
        assert_eq!(rig.supervisor.write(b"x\n".to_vec()).await, Err(CommandError::EngineStopping));
    }

    #[tokio::test(start_paused = true)]
    async fn an_engine_that_ignores_eof_is_killed_only_after_the_grace_period() {
        let rig = rig(Behavior { exit_on_eof: false, block_writes: false }, true, 3);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        let started = Instant::now();
        rig.supervisor.shutdown().await;
        let waited = started.elapsed();
        assert!(waited >= Duration::from_millis(7000), "EOF 처리 기회 없이 죽이면 안 된다: {waited:?}");
        assert!(waited < Duration::from_millis(7000 + 2500));
        assert_eq!(*rig.launcher.killed.lock().expect("lock"), [1001]);
        assert_eq!(kinds(&rig.sink).last().map(String::as_str), Some("stopped"));
    }

    /// 조건 2: stdin 쓰기가 막힌 채여도 종료 경로가 진행하고, 쓰기를 부른 쪽도 락에 묶이지 않는다.
    #[tokio::test(start_paused = true)]
    async fn shutdown_proceeds_while_a_stdin_write_is_blocked() {
        let rig = rig(Behavior { exit_on_eof: false, block_writes: true }, true, 3);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        // 엔진이 stdin을 읽지 않는다. 쓰기 하나가 쓰기 스레드에서 막히고 나머지는 대기열에 쌓인다.
        for n in 0..4 {
            rig.supervisor.write(format!("{{\"n\":{n}}}\n").into_bytes()).await.expect("queued");
        }
        let supervisor = rig.supervisor.clone();
        let shutdown = tokio::spawn(async move { supervisor.shutdown().await });
        // 락을 쥔 쪽이 없으므로 종료 경로가 시한(7초)까지 가서 그룹을 죽이고 끝난다.
        timeout(Duration::from_secs(20), shutdown).await.expect("shutdown finished").expect("join");
        assert_eq!(*rig.launcher.killed.lock().expect("lock"), [1001]);
        assert_eq!(kinds(&rig.sink).last().map(String::as_str), Some("stopped"));
    }

    // 쓰기 스레드가 실제 시간으로 도는 경로라 가상 시계를 쓰지 않는다.
    #[tokio::test]
    async fn exit_requested_prevents_once_then_allows() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        assert_eq!(rig.supervisor.on_exit_requested(), ExitAction::PreventAndShutdown);
        assert_eq!(rig.supervisor.on_exit_requested(), ExitAction::Prevent);
        rig.supervisor.shutdown().await;
        rig.supervisor.allow_exit();
        assert_eq!(rig.supervisor.on_exit_requested(), ExitAction::Allow);
    }

    #[tokio::test(start_paused = true)]
    async fn exit_during_a_restart_backoff_cancels_the_restart() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        rig.launcher.handle(0).crash(1).await; // 1번째 재기동은 즉시
        until("second launch", || rig.launcher.launches.load(Ordering::SeqCst) == 2).await;
        until("second running", || kinds(&rig.sink).iter().filter(|k| *k == "running").count() == 2).await;
        rig.launcher.handle(1).crash(1).await; // 2번째는 1초 백오프
        until("restarting", || kinds(&rig.sink).last().map(String::as_str) == Some("restarting")).await;
        assert_eq!(rig.supervisor.on_exit_requested(), ExitAction::Allow);
        tokio::time::sleep(Duration::from_secs(30)).await;
        assert_eq!(rig.launcher.launches.load(Ordering::SeqCst), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn restarted_engine_starts_with_a_fresh_line_buffer() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        rig.launcher.handle(0).stdout(b"{\"id\":\"1\",\"resu").await;
        rig.launcher.handle(0).crash(1).await;
        until("second", || rig.launcher.launches.load(Ordering::SeqCst) == 2).await;
        until("second handle", || rig.launcher.handles.lock().expect("lock").len() == 2).await;
        rig.launcher.handle(1).stdout(b"{\"id\":\"2\"}\n").await;
        until("bytes", || !rig.sink.bytes.lock().expect("lock").is_empty()).await;
        assert_eq!(*rig.sink.bytes.lock().expect("lock"), b"{\"id\":\"2\"}\n");
    }

    // ----- 대상 (W-08) -----

    fn remote(address: &str) -> EngineTarget {
        EngineTarget::Remote {
            address: address.to_string(),
        }
    }

    #[test]
    fn engine_target_reads_the_ipc_shape_and_writes_it_back() {
        let parsed: EngineTarget =
            serde_json::from_str(r#"{"kind":"remote","address":"tcp://host:1234"}"#).expect("json");
        assert_eq!(parsed, remote("tcp://host:1234"));
        let local: EngineTarget = serde_json::from_str(r#"{"kind":"local"}"#).expect("json");
        assert_eq!(local, EngineTarget::Local);
        assert_eq!(
            serde_json::to_value(&local).expect("json"),
            serde_json::json!({"kind": "local"})
        );
        assert_eq!(
            serde_json::to_value(remote("tcp://host:1234")).expect("json"),
            serde_json::json!({"kind": "remote", "address": "tcp://host:1234"})
        );
        assert!(serde_json::from_str::<EngineTarget>(r#"{"kind":"sidecar"}"#).is_err());
    }

    #[test]
    fn target_validation_accepts_addresses_and_rejects_empty_blank_spaced_and_oversized() {
        assert_eq!(validate_target(&EngineTarget::Local), Ok(()));
        for ok in [
            "tcp://host:1234",
            "unix:/tmp/fresnel.sock",
            "ssh://me@build/home/me/s.sock",
        ] {
            assert_eq!(validate_target(&remote(ok)), Ok(()), "{ok}");
        }
        // 길이는 바이트로 잰다. 한글 170자는 510바이트, 171자는 513바이트다.
        assert_eq!(
            validate_target(&remote(&"a".repeat(REMOTE_ADDRESS_MAX_BYTES))),
            Ok(())
        );
        assert_eq!(validate_target(&remote(&"가".repeat(170))), Ok(()));
        let oversized = ["a".repeat(REMOTE_ADDRESS_MAX_BYTES + 1), "가".repeat(171)];
        for bad in oversized {
            assert_eq!(
                validate_target(&remote(&bad)),
                Err(CommandError::BadRequest),
                "{} bytes",
                bad.len()
            );
        }
        for bad in [
            "",
            "   ",
            "\t",
            "tcp://host 1234",
            " tcp://host:1234",
            "tcp://host:1234\n",
            "tcp://host\u{0}:1",
            "tcp://host:1234\u{7f}",
        ] {
            assert_eq!(
                validate_target(&remote(bad)),
                Err(CommandError::BadRequest),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn sidecar_args_add_safe_mode_to_a_local_engine_and_the_remote_address_to_a_remote_one() {
        assert_eq!(target_args(&EngineTarget::Local), Vec::<String>::new());
        assert_eq!(
            sidecar_args(&EngineTarget::Local, false),
            ["host", "--stdio"]
        );
        assert_eq!(
            sidecar_args(&EngineTarget::Local, true),
            ["host", "--stdio", "--safe-mode"]
        );
        assert_eq!(
            sidecar_args(&remote("tcp://host:1234"), false),
            ["host", "--stdio", "--remote", "tcp://host:1234"]
        );
        // 안전 모드는 로컬 엔진에만 붙는다. 원격 대상에서 켜져 있어도 플래그는 빠진다.
        assert_eq!(
            sidecar_args(&remote("tcp://host:1234"), true),
            ["host", "--stdio", "--remote", "tcp://host:1234"]
        );
    }

    /// 같은 대상을 다시 고르면 아무 일도 없다. 바꾸는 중에 같은 대상을 또 골라도 한 번만 바뀐다.
    #[tokio::test(start_paused = true)]
    async fn retarget_to_the_current_target_does_not_restart_the_engine() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || {
            kinds(&rig.sink).contains(&"running".to_string())
        })
        .await;
        assert_eq!(rig.supervisor.retarget(EngineTarget::Local), Ok(()));
        tokio::time::sleep(Duration::from_secs(30)).await;
        assert_eq!(rig.launcher.launches.load(Ordering::SeqCst), 1);
        assert_eq!(kinds(&rig.sink), ["starting", "running"]);
        assert!(rig.launcher.killed.lock().expect("lock").is_empty());

        let target = remote("tcp://host:1234");
        assert_eq!(rig.supervisor.retarget(target.clone()), Ok(()));
        assert_eq!(rig.supervisor.retarget(target.clone()), Ok(()));
        until("relaunch", || {
            rig.launcher.launches.load(Ordering::SeqCst) == 2
        })
        .await;
        tokio::time::sleep(Duration::from_secs(30)).await;
        assert_eq!(rig.launcher.launches.load(Ordering::SeqCst), 2);
        assert_eq!(
            *rig.launcher.targets.lock().expect("lock"),
            [EngineTarget::Local, target]
        );
    }

    /// 살아 있는 엔진은 정상 종료 순서로 끝나고, 새 대상으로 한 번 다시 뜬다. 대상 바꾸기는 재기동 횟수에 세지 않는다.
    #[tokio::test(start_paused = true)]
    async fn retarget_stops_the_running_engine_and_launches_the_new_target() {
        // 한도 1: 바꾸기가 횟수를 먹었다면 아래 충돌이 자동 재기동 없이 failed가 된다.
        let rig = rig(EOF_EXIT, true, 1);
        rig.supervisor.start();
        until("running", || {
            kinds(&rig.sink).contains(&"running".to_string())
        })
        .await;
        let target = remote("tcp://build.local:1234");
        assert_eq!(rig.supervisor.retarget(target.clone()), Ok(()));
        until("second running", || {
            kinds(&rig.sink).iter().filter(|k| *k == "running").count() == 2
        })
        .await;
        assert_eq!(
            *rig.launcher.targets.lock().expect("lock"),
            [EngineTarget::Local, target.clone()]
        );
        assert_eq!(
            kinds(&rig.sink),
            ["starting", "running", "restarting", "starting", "running"]
        );
        // 이전 엔진은 host.shutdown과 stdin 닫기로 끝났고 그룹은 한 번 정리했다.
        let old = rig.launcher.handle(0);
        assert!(
            old.written().contains("\"method\":\"host.shutdown\""),
            "{}",
            old.written()
        );
        assert!(old.stdin_closed.load(Ordering::SeqCst));
        assert_eq!(*rig.launcher.killed.lock().expect("lock"), [1001]);
        assert!(matches!(
            rig.relay.state(),
            EngineState::Running {
                pid: Some(1002),
                ..
            }
        ));

        // 새 엔진이 죽으면 한도 1 안에서 한 번 자동 재기동한다. 바꾸기가 횟수를 쓰지 않았기 때문이다.
        rig.launcher.handle(1).crash(1).await;
        until("third launch", || {
            rig.launcher.launches.load(Ordering::SeqCst) == 3
        })
        .await;
        until("running again", || {
            kinds(&rig.sink).last().map(String::as_str) == Some("running")
        })
        .await;
        assert_eq!(
            *rig.launcher.targets.lock().expect("lock"),
            [EngineTarget::Local, target.clone(), target]
        );
        assert_eq!(
            kinds(&rig.sink),
            [
                "starting",
                "running",
                "restarting",
                "starting",
                "running",
                "restarting",
                "starting",
                "running"
            ]
        );
    }

    /// 띄우는 사이에 대상이 바뀌면, 그 엔진은 낡은 대상으로 뜬 것이므로 끝내고 새 대상으로 다시 띄운다.
    #[tokio::test(start_paused = true)]
    async fn a_retarget_during_launch_replaces_the_engine_that_was_just_started() {
        let rig = rig(EOF_EXIT, true, 3);
        let target = remote("tcp://host:1234");
        let supervisor = rig.supervisor.clone();
        let requested = target.clone();
        *rig.launcher.on_launch.lock().expect("lock") = Some(Box::new(move || {
            let _ = supervisor.retarget(requested);
        }));
        rig.supervisor.start();
        until("second running", || {
            rig.launcher.launches.load(Ordering::SeqCst) == 2
                && kinds(&rig.sink).iter().filter(|k| *k == "running").count() == 2
        })
        .await;
        assert_eq!(
            *rig.launcher.targets.lock().expect("lock"),
            [EngineTarget::Local, target.clone()]
        );
        assert_eq!(
            kinds(&rig.sink),
            ["starting", "running", "restarting", "starting", "running"]
        );
        assert_eq!(*rig.launcher.killed.lock().expect("lock"), [1001]);
        assert!(matches!(
            rig.relay.state(),
            EngineState::Running {
                pid: Some(1002),
                ..
            }
        ));
    }

    /// failed 상태에서 대상을 바꾸면 기다리지 않고 새 대상으로 띄운다. 자동 재기동이 꺼져 있어도 된다.
    #[tokio::test(start_paused = true)]
    async fn retarget_from_failed_relaunches_with_the_new_target() {
        let rig = rig(EOF_EXIT, true, 0);
        rig.supervisor.start();
        until("running", || {
            kinds(&rig.sink).contains(&"running".to_string())
        })
        .await;
        rig.launcher.handle(0).crash(1).await;
        until("failed", || {
            kinds(&rig.sink).last().map(String::as_str) == Some("failed")
        })
        .await;
        assert_eq!(rig.launcher.launches.load(Ordering::SeqCst), 1);

        let target = remote("tcp://host:1234");
        assert_eq!(rig.supervisor.retarget(target.clone()), Ok(()));
        until("relaunch", || {
            rig.launcher.launches.load(Ordering::SeqCst) == 2
        })
        .await;
        until("running again", || {
            kinds(&rig.sink).last().map(String::as_str) == Some("running")
        })
        .await;
        assert_eq!(
            *rig.launcher.targets.lock().expect("lock"),
            [EngineTarget::Local, target]
        );
        assert_eq!(
            kinds(&rig.sink),
            ["starting", "running", "failed", "starting", "running"]
        );
    }

    /// 백오프 대기 중에 대상을 바꾸면 1초를 기다리지 않고 새 대상으로 바로 띄운다.
    #[tokio::test(start_paused = true)]
    async fn retarget_during_a_backoff_wait_relaunches_at_once() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || {
            kinds(&rig.sink).contains(&"running".to_string())
        })
        .await;
        rig.launcher.handle(0).crash(1).await; // 1번째 재기동은 즉시
        until("second running", || {
            rig.launcher.handles.lock().expect("lock").len() == 2
                && kinds(&rig.sink).iter().filter(|k| *k == "running").count() == 2
        })
        .await;
        rig.launcher.handle(1).crash(1).await; // 2번째 재기동은 1초 백오프
        until("restarting", || {
            kinds(&rig.sink).last().map(String::as_str) == Some("restarting")
        })
        .await;

        let target = remote("tcp://host:1234");
        let asked_at = Instant::now();
        assert_eq!(rig.supervisor.retarget(target.clone()), Ok(()));
        until("third launch", || {
            rig.launcher.launches.load(Ordering::SeqCst) == 3
        })
        .await;
        assert!(
            asked_at.elapsed() < Duration::from_secs(1),
            "the 1s backoff was not cut short: {:?}",
            asked_at.elapsed()
        );
        assert_eq!(
            *rig.launcher.targets.lock().expect("lock"),
            [EngineTarget::Local, EngineTarget::Local, target]
        );
    }

    #[tokio::test]
    async fn retarget_is_refused_once_the_shutdown_has_started() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || {
            kinds(&rig.sink).contains(&"running".to_string())
        })
        .await;
        rig.supervisor.shutdown().await;
        assert_eq!(
            rig.supervisor.retarget(remote("tcp://host:1234")),
            Err(CommandError::EngineStopping)
        );
        // 검사는 상태 검사보다 먼저다. 잘못된 주소는 종료 중이어도 BadRequest다.
        assert_eq!(
            rig.supervisor.retarget(remote("")),
            Err(CommandError::BadRequest)
        );
        assert_eq!(
            *rig.launcher.targets.lock().expect("lock"),
            [EngineTarget::Local]
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_bad_remote_address_is_refused_and_the_engine_keeps_running() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || {
            kinds(&rig.sink).contains(&"running".to_string())
        })
        .await;
        assert_eq!(
            rig.supervisor.retarget(remote("tcp://host 1234")),
            Err(CommandError::BadRequest)
        );
        tokio::time::sleep(Duration::from_secs(30)).await;
        assert_eq!(rig.launcher.launches.load(Ordering::SeqCst), 1);
        assert_eq!(kinds(&rig.sink), ["starting", "running"]);
    }

    /// 원격 엔진을 떼어 낼 때는 `host.shutdown`을 보내지 않는다. 브리지가 그 줄을 원격 서비스로 넘기기 때문이다.
    /// stdin만 닫으면 브리지가 원격 연결만 끊고 끝난다. 로컬 엔진은 그대로 `host.shutdown`으로 끝난다.
    #[tokio::test(start_paused = true)]
    async fn leaving_a_remote_engine_only_closes_its_stdin() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || {
            kinds(&rig.sink).contains(&"running".to_string())
        })
        .await;
        let remote_target = remote("tcp://host:1234");
        assert_eq!(rig.supervisor.retarget(remote_target.clone()), Ok(()));
        until("remote running", || {
            rig.launcher.launches.load(Ordering::SeqCst) == 2
                && kinds(&rig.sink).iter().filter(|k| *k == "running").count() == 2
        })
        .await;
        assert_eq!(rig.supervisor.retarget(EngineTarget::Local), Ok(()));
        until("local again", || {
            rig.launcher.launches.load(Ordering::SeqCst) == 3
                && kinds(&rig.sink).iter().filter(|k| *k == "running").count() == 3
        })
        .await;

        let remote_engine = rig.launcher.handle(1);
        assert_eq!(remote_engine.written(), "");
        assert!(remote_engine.stdin_closed.load(Ordering::SeqCst));
        assert!(rig
            .launcher
            .handle(0)
            .written()
            .contains("\"method\":\"host.shutdown\""));
        assert_eq!(*rig.launcher.killed.lock().expect("lock"), [1001, 1002]);
        assert_eq!(
            *rig.launcher.targets.lock().expect("lock"),
            [EngineTarget::Local, remote_target, EngineTarget::Local]
        );
    }

    /// 원격 엔진이 떠 있는 채 앱을 끝내도 `host.shutdown`을 보내지 않는다. 종료 순서(`shutdown`)는 떼어 낼 때와 같다.
    #[tokio::test]
    async fn quitting_with_a_remote_engine_only_closes_its_stdin() {
        let rig = rig(EOF_EXIT, true, 3);
        let remote_target = remote("tcp://host:1234");
        assert_eq!(rig.supervisor.retarget(remote_target.clone()), Ok(()));
        rig.supervisor.start();
        until("remote running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        let engine = rig.launcher.handle(0);
        assert_eq!(rig.supervisor.on_exit_requested(), ExitAction::PreventAndShutdown);
        rig.supervisor.shutdown().await;
        assert_eq!(engine.written(), "");
        assert!(engine.stdin_closed.load(Ordering::SeqCst));
        assert_eq!(kinds(&rig.sink).last().map(String::as_str), Some("stopped"));
        assert_eq!(*rig.launcher.targets.lock().expect("lock"), [remote_target]);
    }

    // ----- 재기동과 안전 모드 (W-35) -----

    fn running_count(sink: &NullSink) -> usize {
        kinds(sink).iter().filter(|k| *k == "running").count()
    }

    /// 살아 있는 엔진은 확인 없이 다시 띄우지 않는다. 확인 없이 안전 모드를 켜지도 않는다.
    #[tokio::test(start_paused = true)]
    async fn a_running_engine_is_not_restarted_without_confirmation() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || running_count(&rig.sink) == 1).await;
        assert_eq!(
            rig.supervisor.restart_manually(None, false),
            Err(CommandError::NotConfirmed)
        );
        assert_eq!(
            rig.supervisor.restart_manually(Some(true), false),
            Err(CommandError::NotConfirmed)
        );
        tokio::time::sleep(Duration::from_secs(30)).await;
        assert_eq!(rig.launcher.launches.load(Ordering::SeqCst), 1);
        assert!(rig.launcher.killed.lock().expect("lock").is_empty());
        assert!(!shared(&rig.supervisor.inner).safe_mode);
        assert_eq!(kinds(&rig.sink), ["starting", "running"]);
    }

    /// 확인을 받은 재기동은 대상 바꾸기와 같은 길로 간다. 새 엔진은 안전 모드로 뜨고, 재기동은 자동 재기동 횟수를 쓰지 않는다.
    #[tokio::test(start_paused = true)]
    async fn a_confirmed_restart_relaunches_in_safe_mode_without_using_a_restart() {
        // 한도 1: 재기동이 횟수를 먹었다면 아래 충돌은 자동 재기동 없이 failed가 된다.
        let rig = rig(EOF_EXIT, true, 1);
        rig.supervisor.start();
        until("running", || running_count(&rig.sink) == 1).await;
        assert_eq!(rig.supervisor.restart_manually(Some(true), true), Ok(()));
        until("second running", || running_count(&rig.sink) == 2).await;
        assert_eq!(
            *rig.launcher.targets.lock().expect("lock"),
            [EngineTarget::Local, EngineTarget::Local]
        );
        assert_eq!(
            *rig.launcher.safe_modes.lock().expect("lock"),
            [false, true]
        );
        assert_eq!(*rig.launcher.killed.lock().expect("lock"), [1001]);
        assert!(rig
            .launcher
            .handle(0)
            .written()
            .contains("\"method\":\"host.shutdown\""));
        assert_eq!(
            kinds(&rig.sink),
            ["starting", "running", "restarting", "starting", "running"]
        );
        // 새 엔진이 죽으면 한도 1을 그대로 쓴 자동 재기동이 한 번 뜬다. 안전 모드는 그대로 남는다.
        rig.launcher.handle(1).crash(1).await;
        until("third launch", || {
            rig.launcher.launches.load(Ordering::SeqCst) == 3
        })
        .await;
        until("third running", || running_count(&rig.sink) == 3).await;
        assert_eq!(
            *rig.launcher.safe_modes.lock().expect("lock"),
            [false, true, true]
        );
        assert!(matches!(
            rig.relay.state(),
            EngineState::Running {
                pid: Some(1003),
                ..
            }
        ));
    }

    /// 안전 모드는 앱을 켜 두는 동안 남는다. `safeMode`를 생략하면 그대로 두고, `false`로 부르면 끈다.
    #[tokio::test(start_paused = true)]
    async fn safe_mode_lasts_until_it_is_turned_off() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || running_count(&rig.sink) == 1).await;
        assert_eq!(rig.supervisor.restart_manually(Some(true), true), Ok(()));
        until("running 2", || running_count(&rig.sink) == 2).await;
        assert_eq!(rig.supervisor.restart_manually(None, true), Ok(()));
        until("running 3", || running_count(&rig.sink) == 3).await;
        assert_eq!(rig.supervisor.restart_manually(Some(false), true), Ok(()));
        until("running 4", || running_count(&rig.sink) == 4).await;
        assert_eq!(
            *rig.launcher.safe_modes.lock().expect("lock"),
            [false, true, true, false]
        );
    }

    /// 원격 대상에는 안전 모드를 켜지 않는다. 그 요청은 확인 여부와 관계없이 `bad-request`이고, 엔진은 그대로 둔다.
    #[tokio::test(start_paused = true)]
    async fn safe_mode_is_refused_for_a_remote_target() {
        let rig = rig(EOF_EXIT, true, 3);
        assert_eq!(rig.supervisor.retarget(remote("tcp://host:1234")), Ok(()));
        rig.supervisor.start();
        until("running", || running_count(&rig.sink) == 1).await;
        assert_eq!(
            rig.supervisor.restart_manually(Some(true), true),
            Err(CommandError::BadRequest)
        );
        assert_eq!(
            rig.supervisor.restart_manually(Some(true), false),
            Err(CommandError::BadRequest)
        );
        tokio::time::sleep(Duration::from_secs(30)).await;
        assert_eq!(rig.launcher.launches.load(Ordering::SeqCst), 1);
        assert!(!shared(&rig.supervisor.inner).safe_mode);
        assert_eq!(kinds(&rig.sink), ["starting", "running"]);
    }

    /// `failed`에서는 확인 없이 다시 띄운다. 안전 모드를 함께 주면 다음 엔진이 안전 모드로 뜬다.
    #[tokio::test(start_paused = true)]
    async fn a_failed_engine_restarts_without_confirmation_and_takes_safe_mode() {
        let rig = rig(EOF_EXIT, true, 0);
        rig.supervisor.start();
        until("running", || running_count(&rig.sink) == 1).await;
        rig.launcher.handle(0).crash(1).await;
        until("failed", || {
            kinds(&rig.sink).last().map(String::as_str) == Some("failed")
        })
        .await;
        assert_eq!(rig.supervisor.restart_manually(Some(true), false), Ok(()));
        until("relaunch", || {
            rig.launcher.launches.load(Ordering::SeqCst) == 2
        })
        .await;
        until("running again", || running_count(&rig.sink) == 2).await;
        assert_eq!(
            *rig.launcher.safe_modes.lock().expect("lock"),
            [false, true]
        );
        assert_eq!(
            kinds(&rig.sink),
            ["starting", "running", "failed", "starting", "running"]
        );
    }

    /// 엔진이 없고 `failed`도 아니면 재기동을 거부한다. 이때 안전 모드도 저장하지 않는다.
    #[tokio::test]
    async fn a_restart_with_no_engine_to_restart_is_not_running() {
        let rig = rig(EOF_EXIT, true, 3);
        assert_eq!(
            rig.supervisor.restart_manually(Some(true), true),
            Err(CommandError::EngineNotRunning)
        );
        assert_eq!(
            rig.supervisor.restart_manually(None, false),
            Err(CommandError::EngineNotRunning)
        );
        assert!(!shared(&rig.supervisor.inner).safe_mode);
        assert!(rig.launcher.calls().is_empty());
    }

    #[tokio::test]
    async fn a_restart_is_refused_once_the_shutdown_has_started() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || running_count(&rig.sink) == 1).await;
        rig.supervisor.shutdown().await;
        assert_eq!(
            rig.supervisor.restart_manually(None, true),
            Err(CommandError::EngineStopping)
        );
    }

    // ----- 데이터베이스 복원 -----

    fn restore_call(dir: &str) -> String {
        format!("run-once:db restore {dir} --json")
    }

    fn empty_output() -> RestoreOutput {
        RestoreOutput {
            exit_code: 0,
            stdout: String::new(),
            stderr: String::new(),
        }
    }

    fn spawn_restore(
        supervisor: &Supervisor<Arc<FakeLauncher>>,
        dir: &str,
    ) -> tokio::task::JoinHandle<Result<RestoreOutput, CommandError>> {
        let supervisor = supervisor.clone();
        let dir = dir.to_string();
        tokio::spawn(async move { supervisor.restore_database(dir).await })
    }

    /// 복원 중에는 엔진이 내려가 `live`가 없어도 종료를 막는다. 첫 요청은 복원이 끝나기를 기다리는 과제를 시키고,
    /// 두 번째부터는 그냥 막는다. 복원이 끝나면 다시 요청한 종료는 통과한다.
    #[tokio::test]
    async fn an_exit_request_during_the_restore_waits_for_it_to_end() {
        let rig = rig(EOF_EXIT, true, 0);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        rig.launcher.close_once_gate();
        let restore = spawn_restore(&rig.supervisor, "/backups/a");
        until("cli ran", || rig.launcher.calls().contains(&restore_call("/backups/a"))).await;
        assert_eq!(rig.supervisor.on_exit_requested(), ExitAction::PreventUntilRestore);
        assert_eq!(rig.supervisor.on_exit_requested(), ExitAction::Prevent);
        let waiter = {
            let supervisor = rig.supervisor.clone();
            tokio::spawn(async move { supervisor.wait_restore_end().await })
        };
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!waiter.is_finished());
        rig.launcher.open_once_gate();
        assert_eq!(restore.await.expect("join"), Ok(empty_output()));
        timeout(Duration::from_secs(5), waiter).await.expect("waiter ends").expect("join");
        assert!(!shared(&rig.supervisor.inner).exit_waits_for_restore);
    }

    /// 복원 중에는 엔진을 다시 띄우지 않고, 끝나면 다시 띄운다. 복원 때문에 끝난 엔진은 자동 재기동 횟수에 세지 않는다(한도 0으로 본다).
    #[tokio::test]
    async fn the_hold_keeps_the_engine_down_during_the_restore_and_does_not_count_as_a_crash() {
        let rig = rig(EOF_EXIT, true, 0);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        rig.launcher.close_once_gate();
        let restore = spawn_restore(&rig.supervisor, "/backups/a");
        until("cli ran", || rig.launcher.calls().contains(&restore_call("/backups/a"))).await;
        // CLI가 도는 동안 엔진은 내려가 있고 다시 뜨지 않는다.
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(rig.launcher.launches.load(Ordering::SeqCst), 1);
        assert_eq!(rig.relay.state(), EngineState::Stopped);
        rig.launcher.open_once_gate();
        assert_eq!(restore.await.expect("join"), Ok(empty_output()));
        until("relaunch", || rig.launcher.launches.load(Ordering::SeqCst) == 2).await;
        until("running again", || {
            kinds(&rig.sink).last().map(String::as_str) == Some("running")
        })
        .await;
        assert_eq!(
            kinds(&rig.sink),
            ["starting", "running", "stopping", "stopped", "starting", "running"]
        );
    }

    /// 살아 있는 엔진은 종료 요청, stdin 닫기, 종료, 그룹 정리가 끝난 뒤에 CLI가 돈다. 다시 띄우는 것은 CLI가 끝난 뒤다.
    #[tokio::test]
    async fn the_live_engine_is_stopped_before_the_cli_runs() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        let output = rig.supervisor.restore_database("/backups/a".into()).await;
        assert_eq!(output, Ok(empty_output()));
        until("relaunch", || rig.launcher.launches.load(Ordering::SeqCst) == 2).await;
        assert_eq!(
            rig.launcher.calls(),
            [
                "launch:1001",
                "shutdown:1001",
                "stdin-closed:1001",
                "kill:1001",
                "run-once:db restore /backups/a --json",
                "launch:1002",
            ]
        );
    }

    /// CLI를 돌리지 못하면 오류를 돌려주고, 보류를 풀고, 엔진을 다시 띄운다.
    #[tokio::test]
    async fn a_command_that_cannot_run_clears_the_hold_and_the_engine_starts_again() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        *rig.launcher.once.lock().expect("lock") = Some(Err(LaunchError("spawn failed".into())));
        assert_eq!(
            rig.supervisor.restore_database("/backups/a".into()).await,
            Err(CommandError::StorageFailed)
        );
        assert!(!shared(&rig.supervisor.inner).hold);
        until("relaunch", || rig.launcher.launches.load(Ordering::SeqCst) == 2).await;
        until("running again", || {
            kinds(&rig.sink).last().map(String::as_str) == Some("running")
        })
        .await;
    }

    /// CLI의 종료 코드와 출력은 해석하지 않고 그대로 돌려준다. 종료 코드 3(엔진이 쥐고 있음)도 명령 오류가 아니다.
    #[tokio::test]
    async fn the_exit_code_and_the_output_come_back_unchanged() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        let stdout = "{\"ok\":false,\"error\":\"engine_running\"}\n";
        let stderr = "refused\n";
        *rig.launcher.once.lock().expect("lock") = Some(Ok(OnceOutput {
            exit_code: 3,
            stdout: stdout.into(),
            stderr: stderr.into(),
        }));
        let output = rig.supervisor.restore_database("/backups/a".into()).await;
        assert_eq!(
            output,
            Ok(RestoreOutput {
                exit_code: 3,
                stdout: stdout.into(),
                stderr: stderr.into(),
            })
        );
        assert!(rig.launcher.calls().contains(&restore_call("/backups/a")));
        until("relaunch", || rig.launcher.launches.load(Ordering::SeqCst) == 2).await;
    }

    #[test]
    fn the_restore_output_serializes_to_the_camel_case_shape() {
        let output = RestoreOutput {
            exit_code: 3,
            stdout: "o".into(),
            stderr: "e".into(),
        };
        assert_eq!(
            serde_json::to_value(output).expect("json"),
            serde_json::json!({"exitCode": 3, "stdout": "o", "stderr": "e"})
        );
    }

    /// 원격 대상이면 복원을 거부하고 엔진은 건드리지 않는다. 복원은 이 컴퓨터의 데이터 폴더에만 적용된다.
    #[tokio::test]
    async fn a_remote_target_is_refused_without_stopping_the_engine() {
        let rig = rig(EOF_EXIT, true, 3);
        assert_eq!(rig.supervisor.retarget(remote("tcp://host:1234")), Ok(()));
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        assert_eq!(
            rig.supervisor.restore_database("/backups/a".into()).await,
            Err(CommandError::RemoteTarget)
        );
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(rig.launcher.calls(), ["launch:1001"]);
        assert!(!shared(&rig.supervisor.inner).hold);
        assert_eq!(kinds(&rig.sink), ["starting", "running"]);
    }

    /// 복원이 도는 동안 다른 복원은 거부한다. 첫 복원은 끝까지 간다.
    #[tokio::test]
    async fn a_second_restore_while_one_runs_is_busy() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        rig.launcher.close_once_gate();
        let first = spawn_restore(&rig.supervisor, "/backups/a");
        until("cli ran", || rig.launcher.calls().contains(&restore_call("/backups/a"))).await;
        assert_eq!(
            rig.supervisor.restore_database("/backups/b".into()).await,
            Err(CommandError::Busy)
        );
        rig.launcher.open_once_gate();
        assert_eq!(first.await.expect("join"), Ok(empty_output()));
    }

    #[tokio::test]
    async fn a_restore_after_the_shutdown_started_is_refused() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        rig.supervisor.shutdown().await;
        assert_eq!(
            rig.supervisor.restore_database("/backups/a".into()).await,
            Err(CommandError::EngineStopping)
        );
        assert!(!rig.launcher.calls().iter().any(|c| c.starts_with("run-once")));
    }

    /// 엔진이 끝나지 않으면 시한이 지난 뒤 복원을 포기한다. CLI는 돌리지 않고 보류는 풀린다.
    #[tokio::test(start_paused = true)]
    async fn a_restore_gives_up_when_the_engine_never_exits() {
        let rig = rig(Behavior { exit_on_eof: false, block_writes: false }, false, 3);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        assert_eq!(
            rig.supervisor.restore_database("/backups/a".into()).await,
            Err(CommandError::EngineStopping)
        );
        assert!(!shared(&rig.supervisor.inner).hold);
        assert!(!rig.launcher.calls().iter().any(|c| c.starts_with("run-once")));
    }

    /// CLI 출력은 앞쪽 256 KiB까지만 남고, 끝까지 읽는다. 종료 신호로 끝나면 종료 코드는 -1이다.
    #[tokio::test]
    async fn the_command_output_is_capped_and_the_exit_code_is_kept() {
        let (tx, mut rx) = mpsc::channel(8);
        tx.send(EngineEvent::Stdout(vec![b'a'; ONCE_OUTPUT_MAX_BYTES + 10]))
            .await
            .expect("send");
        tx.send(EngineEvent::Stderr(b"warn".to_vec())).await.expect("send");
        tx.send(EngineEvent::Terminated { code: Some(0), signal: None })
            .await
            .expect("send");
        let output = collect_once(&mut rx).await.expect("output");
        assert_eq!(output.stdout.len(), ONCE_OUTPUT_MAX_BYTES);
        assert_eq!(output.stderr, "warn");
        assert_eq!(output.exit_code, 0);
    }

    #[tokio::test]
    async fn a_signal_exit_is_minus_one_and_a_missing_exit_event_is_an_error() {
        let (tx, mut rx) = mpsc::channel(8);
        tx.send(EngineEvent::Terminated { code: None, signal: Some(9) })
            .await
            .expect("send");
        assert_eq!(collect_once(&mut rx).await.expect("output").exit_code, -1);
        let (tx, mut rx) = mpsc::channel::<EngineEvent>(8);
        drop(tx);
        assert!(collect_once(&mut rx).await.is_err());
    }
}
