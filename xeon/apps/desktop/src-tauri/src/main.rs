// 릴리스 빌드에서 Windows 콘솔 창을 띄우지 않는다.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Xeon 데스크톱 셸. 앱 조립, RunEvent 처리, Unix 신호 처리기 (L4.desktop.plan 2).
//! 엔진 수명은 engine.rs, 바이트 릴레이와 `engine_*` 명령은 relay.rs가 맡는다.

mod applog;
mod engine;
mod relay;
mod time;

use std::sync::Arc;

use tauri::{Manager, RunEvent, WindowEvent};

use crate::applog::AppLog;
use crate::engine::{
    AppSupervisor, EngineConfig, EngineState, ExitAction, Supervisor, TauriLauncher,
};
use crate::relay::Relay;

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            relay::engine_attach,
            relay::engine_write,
            relay::engine_ack,
            relay::engine_restart,
            relay::engine_detach
        ])
        .setup(|app| {
            let log = Arc::new(AppLog::open(app.path().app_log_dir().ok().as_deref()));
            let relay = Arc::new(Relay::new(EngineState::Stopped));
            let runtime = tauri::async_runtime::handle().inner().clone();
            let launcher = TauriLauncher::new(app.handle().clone(), runtime.clone());
            let supervisor: Arc<AppSupervisor> = Arc::new(Supervisor::new(
                launcher,
                relay.clone(),
                EngineConfig::default(),
                log.clone(),
                runtime,
            ));
            app.manage(relay);
            app.manage(supervisor.clone());
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
        RunEvent::ExitRequested { api, .. } => {
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
        _ => {}
    });
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
