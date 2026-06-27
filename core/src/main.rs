//! JakIDE Rust core — an axum HTTP sidecar that replaces the Node backend for
//! the file engine + project management (Phase 1, strangler-fig migration).

mod error;
mod files;
mod fonts;
mod health;
mod paths;
mod projects;
mod state;

use std::sync::Arc;

use axum::Router;
use state::AppState;

#[tokio::main]
async fn main() {
    let st = Arc::new(AppState::from_env());
    projects::record_open(&st.root()); // seed recents with the boot folder

    let app = Router::new()
        .merge(health::router())
        .merge(files::router())
        .merge(projects::router())
        .merge(fonts::router())
        .with_state(st.clone());

    let port: u16 = std::env::var("JAKIDE_CORE_PORT")
        .ok()
        .or_else(|| std::env::var("PORT").ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or(8787);
    let addr = format!("127.0.0.1:{port}");

    let listener = tokio::net::TcpListener::bind(&addr).await.expect("failed to bind");
    eprintln!("JakIDE core listening on http://{addr}  (root: {})", st.root().display());
    axum::serve(listener, app).await.expect("server error");
}
