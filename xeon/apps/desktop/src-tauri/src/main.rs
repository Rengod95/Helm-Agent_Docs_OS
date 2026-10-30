// 릴리스 빌드에서 Windows 콘솔 창을 띄우지 않는다.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Xeon 데스크톱 셸. 앱 조립, RunEvent 처리, Unix 신호 처리기 (L4.desktop.plan 2).
//! 엔진 수명은 engine.rs, 바이트 릴레이와 `engine_*` 명령은 relay.rs가 맡는다.

mod applog;
mod desktop_settings;
mod engine;
mod env_path;
#[cfg(debug_assertions)]
mod inspect;
mod relay;
mod secret_entry;
mod time;
mod window;

use std::sync::Arc;

use tauri::{Manager, RunEvent, WindowEvent};

use crate::applog::AppLog;
use crate::desktop_settings::{should_prevent_exit, CloseBehavior};
use crate::engine::{
    AppSupervisor, EngineConfig, EngineState, ExitAction, Supervisor, TauriLauncher,
};
use crate::relay::Relay;
use crate::secret_entry::{AppSecretEntry, SecretEntry, TauriEntryLauncher, ENTRY_TIMEOUT};

fn main() {
    let builder = tauri::Builder::default()
        // 단일 실행(G2-09): 두 번째 실행은 이 콜백을 첫 인스턴스에 알리고 스스로 끝난다. 엔진도 DB도 하나만 쓴다.
        // 다른 플러그인보다 먼저 등록해야 두 번째 인스턴스가 나머지 초기화를 하기 전에 끝난다.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            reopen_main(app);
        }))
        .plugin(tauri_plugin_shell::init());
    // 디버그 빌드의 로그 파일(Phase 1 원격 점검). 릴리스는 applog.rs의 로그만 쓴다.
    #[cfg(debug_assertions)]
    let builder = builder.plugin(debug_log_plugin());
    let app = builder
        .invoke_handler(tauri::generate_handler![
            relay::engine_attach,
            relay::engine_write,
            relay::engine_ack,
            relay::engine_restart,
            relay::engine_detach,
            secret_entry::secret_register
        ])
        .setup(|app| {
            let log = Arc::new(AppLog::open(app.path().app_log_dir().ok().as_deref()));
            // 시작 줄. 이름과 버전만 쓴다(경로, 프레임 내용 없음, E11). 디버그 로그 파일이 비지 않게 한다.
            log.line(&format!(
                "{} {} started",
                env!("CARGO_PKG_NAME"),
                env!("CARGO_PKG_VERSION")
            ));
            // 데스크톱 설정 파일(§3.6, §4.2 1단계). 파일이 없으면 기본값이다. 틀린 값은 그 키만 기본값을 쓰고 진단을 남긴다.
            let config_dir = app.path().app_config_dir().ok();
            let (settings, diagnostics) = desktop_settings::load(config_dir.as_deref());
            for diagnostic in &diagnostics {
                log.line(diagnostic);
            }
            let relay = Arc::new(Relay::new(EngineState::Stopped));
            let runtime = tauri::async_runtime::handle().inner().clone();
            let launcher = TauriLauncher::new(app.handle().clone(), runtime.clone());
            let entry_launcher = TauriEntryLauncher::new(app.handle().clone(), runtime.clone());
            let supervisor: Arc<AppSupervisor> = Arc::new(Supervisor::new(
                launcher,
                relay.clone(),
                EngineConfig::from_values(settings.shutdown_grace_ms, settings.restart_limit),
                log.clone(),
                runtime,
            ));
            let entry: Arc<AppSecretEntry> =
                Arc::new(SecretEntry::new(entry_launcher, log.clone(), ENTRY_TIMEOUT));
            app.manage(entry);
            app.manage(relay.clone());
            app.manage(supervisor.clone());
            app.manage(settings.close_behavior);
            app.manage(log.clone());
            #[cfg(all(debug_assertions, unix))]
            start_inspect(app.handle(), &relay, &log);
            #[cfg(unix)]
            install_signal_handlers(app.handle().clone(), supervisor.clone(), log);
            supervisor.start();
            Ok(())
        })
        .build(tauri::generate_context!());
    let app = match app {
        Ok(app) => app,
        Err(error) => {
            eprintln!("xeon-desktop: failed to build the app: {error}");
            std::process::exit(1);
        }
    };

    app.run(|handle, event| match event {
        RunEvent::ExitRequested { code, api, .. } => {
            let behavior = *handle.state::<CloseBehavior>();
            if should_prevent_exit(behavior, code) {
                // 트레이 유지: 창이 모두 닫혀 생긴 종료다. WebView는 이미 없고, 셸과 엔진과 진행 중 turn은 남는다 (§4.3, §6).
                api.prevent_exit();
                return;
            }
            let supervisor = handle.state::<Arc<AppSupervisor>>().inner().clone();
            match supervisor.on_exit_requested() {
                ExitAction::Allow => {}
                ExitAction::Prevent => api.prevent_exit(),
                ExitAction::PreventAndShutdown => {
                    api.prevent_exit();
                    let handle = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        supervisor.shutdown().await;
                        supervisor.allow_exit();
                        handle.exit(0);
                    });
                }
            }
        }
        RunEvent::WindowEvent {
            event: WindowEvent::Destroyed,
            ..
        } => {
            // 페이지가 사라졌다. 신용을 기다리는 송신이 남지 않게 연결을 끊는다.
            handle.state::<Arc<Relay>>().detach_current();
        }
        RunEvent::Exit => {
            // 정상 종료 순서를 거치지 못한 경우의 마지막 방어. 이미 정리됐으면 아무 일도 없다.
            handle.state::<Arc<AppSupervisor>>().kill_remaining();
        }
        // macOS Dock 클릭: 트레이 유지 뒤 창이 없으면 메인 창을 다시 만든다.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => reopen_main(handle),
        _ => {}
    });
}

/// 메인 창을 다시 연다(없으면 만든다). 두 번째 실행과 macOS Dock 클릭이 쓴다. 만들지 못하면 앱 로그에 남긴다.
fn reopen_main(app: &tauri::AppHandle) {
    if !window::ensure_main(app) {
        if let Some(log) = app.try_state::<Arc<AppLog>>() {
            log.line("main window is missing and could not be created");
        }
    }
}

/// SIGTERM, SIGINT를 받으면 `app.exit(0)`으로 정상 종료 순서를 탄다(S1: 처리기가 없으면 `RunEvent`가 오지 않는다).
/// 종료 중에 신호가 한 번 더 오면 그룹을 바로 죽이고 끝낸다.
#[cfg(unix)]
fn install_signal_handlers(
    handle: tauri::AppHandle,
    supervisor: Arc<AppSupervisor>,
    log: Arc<AppLog>,
) {
    use signal_hook::consts::{SIGINT, SIGTERM};
    use signal_hook::iterator::Signals;

    let mut signals = match Signals::new([SIGTERM, SIGINT]) {
        Ok(signals) => signals,
        Err(error) => {
            log.line(&format!("signal handlers were not installed: {error}"));
            return;
        }
    };
    let spawned = std::thread::Builder::new()
        .name("signals".into())
        .spawn(move || {
            let mut first = true;
            for signal in signals.forever() {
                if first {
                    first = false;
                    log.line(&format!("signal {signal}: starting the shutdown sequence"));
                    handle.exit(0);
                } else {
                    log.line(&format!("signal {signal} again: killing the engine group now"));
                    supervisor.kill_remaining();
                    std::process::exit(130);
                }
            }
        });
    if spawned.is_err() {
        eprintln!("xeon-desktop: signal thread could not start");
    }
}

/// 디버그 전용 로그 플러그인: 로그 폴더(`LogDir`)의 파일과 표준 출력. 파일은 하나만 두고 2 MB에서 새로 시작한다.
/// 받는 줄은 `AppLog::line`이 `log` 크레이트로 내는 줄과 시작 줄이다(spec §4.15 로그 파일 행).
#[cfg(debug_assertions)]
fn debug_log_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
    tauri_plugin_log::Builder::new()
        .targets([
            Target::new(TargetKind::LogDir {
                file_name: Some("xeon-desktop-debug".into()),
            }),
            Target::new(TargetKind::Stdout),
        ])
        .rotation_strategy(RotationStrategy::KeepOne)
        .max_file_size(2_000_000)
        .level(tauri_plugin_log::log::LevelFilter::Info)
        .build()
}

/// 디버그 전용 원격 점검 소켓을 연다(`inspect`). 릴리스 빌드에는 이 함수도 호출도 없다.
#[cfg(all(debug_assertions, unix))]
fn start_inspect(app: &tauri::AppHandle, relay: &Arc<Relay>, log: &Arc<AppLog>) {
    let Ok(log_dir) = app.path().app_log_dir() else {
        log.line("debug inspect did not start: no log directory");
        return;
    };
    let path = inspect::socket_path(&log_dir, std::env::var("XEON_DESKTOP_INSPECT_SOCKET").ok());
    let probe = Arc::new(inspect::AppProbe {
        app: app.clone(),
        relay: relay.clone(),
        log_dir: Some(log_dir),
        started: std::time::Instant::now(),
    });
    inspect::serve(
        tauri::async_runtime::handle().inner(),
        path,
        probe,
        log.clone(),
    );
}
