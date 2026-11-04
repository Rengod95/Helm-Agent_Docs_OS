fn main() {
    // 앱 명령에 권한(allow-<명령>)을 만든다. capabilities/default.json이 이름을 적은 명령만 WebView가 부를 수 있다.
    let manifest = tauri_build::AppManifest::new().commands(&[
        "engine_attach",
        "engine_write",
        "engine_ack",
        "engine_restart",
        "engine_detach",
        "engine_retarget",
        "db_restore",
        "desktop_settings_read",
        "desktop_settings_write",
        "secret_register",
        "app_roots_set",
        "open_external",
        "pick_folder",
        "os_reauth",
    ]);
    if let Err(error) =
        tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
    {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}
