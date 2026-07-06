//! JakIDE Rust core — an axum HTTP sidecar that replaces the Node backend for
//! the file engine + project management (Phase 1, strangler-fig migration).

mod ai;
mod auth;
mod code_intelligence;
mod db;
mod docker;
mod error;
mod files;
mod fonts;
mod git;
mod health;
mod index;
mod lsp;
mod paths;
mod projects;
mod proxy;
mod run;
mod runner;
mod search;
mod shells;
mod state;
mod symbols;
mod terminal;
mod watch;

use std::sync::Arc;

use axum::Router;
use state::AppState;

#[tokio::main]
async fn main() {
    let st = Arc::new(AppState::from_env());
    projects::record_open(&st.root()); // seed recents with the boot folder
    st.reindex(); // build the file index for the boot folder in the background
    watch::spawn(st.clone()); // live-update the index as files change

    let app = Router::new()
        .merge(health::router())
        .merge(files::router())
        .merge(projects::router())
        .merge(fonts::router())
        .merge(search::router())
        .merge(symbols::router())
        .merge(code_intelligence::router())
        .merge(git::router())
        .merge(docker::router())
        .merge(db::router())
        .merge(terminal::router())
        .merge(run::router())
        .merge(runner::router())
        .merge(lsp::router())
        .merge(auth::router())
        .merge(ai::router())
        // Static renderer (+ direct-API AI) still served by Node.
        .fallback(proxy::handler)
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
