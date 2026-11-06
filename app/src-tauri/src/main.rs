// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's DMA-BUF renderer kills the window at start ("Error 71
    // (Protocol error) dispatching to Wayland display") on several Wayland
    // and NVIDIA setups, KDE Plasma among them. The fallback renderer is
    // fine for a 2D canvas. Set before any thread starts; an explicit value
    // (`=0` to keep the DMA-BUF renderer) wins.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    designtree_app::run()
}
