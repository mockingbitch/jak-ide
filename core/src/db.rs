//! Database tool window backend. One connection-per-request, with a typed pool
//! PER ENGINE (MySql/Pg/Sqlite) rather than sqlx's shared `Any` driver — `Any`'s
//! common type mapping can't decode Postgres `NUMERIC`/`NAME` (confirmed against
//! a real Postgres container: it hard-errors fetching any row containing them,
//! which is exactly the kind of column a real schema has everywhere). Each
//! engine gets its own row→JSON cascade using that engine's real type system.
//!
//! Credentials are never persisted or logged here: the frontend holds the
//! connection profile (its password decrypted via Electron safeStorage — see
//! desktop/main.js) and sends the whole profile with every call, so the Rust
//! core stays entirely stateless about secrets.

use std::sync::Arc;

use axum::{routing::post, Json, Router};
use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Column, MySqlPool, PgPool, Row, SqlitePool, ValueRef};

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/db/test", post(test_conn))
        .route("/api/db/tables", post(list_tables))
        .route("/api/db/columns", post(list_columns))
        .route("/api/db/query", post(run_query))
}

// ---- connection ----

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ConnInfo {
    engine: String, // "mysql" | "postgres" | "sqlite"
    host: Option<String>,
    port: Option<u16>,
    user: Option<String>,
    password: Option<String>,
    database: String, // for sqlite, the file path
}

/// Minimal percent-encoding for user/password in a connection URL — only the
/// unreserved set passes through unescaped, so arbitrary secrets are always safe.
fn pct_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn mysql_url(c: &ConnInfo) -> String {
    format!(
        "mysql://{}:{}@{}:{}/{}",
        pct_encode(c.user.as_deref().unwrap_or("root")),
        pct_encode(c.password.as_deref().unwrap_or("")),
        c.host.as_deref().unwrap_or("localhost"),
        c.port.unwrap_or(3306),
        pct_encode(&c.database),
    )
}

fn postgres_url(c: &ConnInfo) -> String {
    format!(
        "postgres://{}:{}@{}:{}/{}",
        pct_encode(c.user.as_deref().unwrap_or("postgres")),
        pct_encode(c.password.as_deref().unwrap_or("")),
        c.host.as_deref().unwrap_or("localhost"),
        c.port.unwrap_or(5432),
        pct_encode(&c.database),
    )
}

/// Two slashes from the scheme + the path's own leading slash gives the correct
/// `sqlite:///abs/path`; a relative path yields `sqlite://rel/path`.
fn sqlite_url(c: &ConnInfo) -> String {
    format!("sqlite://{}", c.database)
}

enum Pool {
    MySql(MySqlPool),
    Postgres(PgPool),
    Sqlite(SqlitePool),
}

impl Pool {
    async fn connect(c: &ConnInfo) -> ApiResult<Pool> {
        let pool = match c.engine.as_str() {
            "mysql" => Pool::MySql(MySqlPool::connect(&mysql_url(c)).await.map_err(conn_err)?),
            "postgres" => Pool::Postgres(PgPool::connect(&postgres_url(c)).await.map_err(conn_err)?),
            "sqlite" => Pool::Sqlite(SqlitePool::connect(&sqlite_url(c)).await.map_err(conn_err)?),
            other => return Err(ApiError::bad(format!("Unknown engine \"{other}\" (expected mysql, postgres, or sqlite)"))),
        };
        Ok(pool)
    }

    async fn close(self) {
        match self {
            Pool::MySql(p) => p.close().await,
            Pool::Postgres(p) => p.close().await,
            Pool::Sqlite(p) => p.close().await,
        }
    }
}

fn conn_err(e: sqlx::Error) -> ApiError {
    ApiError::bad(format!("Connection failed: {e}"))
}
fn query_err(e: sqlx::Error) -> ApiError {
    ApiError::bad(format!("Query failed: {e}"))
}

/// Identifiers (table names) are validated against this allowlist rather than
/// bound as query parameters — placeholder syntax (`?` vs `$1`) isn't uniform
/// across engines, and a plain alphanumeric+underscore charset can't carry any
/// SQL metacharacter, so straight interpolation is safe.
fn is_safe_ident(s: &str) -> bool {
    !s.is_empty() && s.len() <= 128 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

// ---- generic row → JSON (one cascade per engine's native type system) ----

fn cell_mysql(row: &sqlx::mysql::MySqlRow, idx: usize) -> Value {
    let Ok(raw) = row.try_get_raw(idx) else { return Value::Null };
    if raw.is_null() {
        return Value::Null;
    }
    if let Ok(v) = row.try_get::<i64, usize>(idx) {
        return json!(v);
    }
    if let Ok(v) = row.try_get::<u64, usize>(idx) {
        return json!(v);
    }
    if let Ok(v) = row.try_get::<f64, usize>(idx) {
        return json!(v);
    }
    if let Ok(v) = row.try_get::<bool, usize>(idx) {
        return json!(v);
    }
    if let Ok(v) = row.try_get::<Decimal, usize>(idx) {
        return json!(v.to_string());
    }
    if let Ok(v) = row.try_get::<NaiveDateTime, usize>(idx) {
        return json!(v.to_string());
    }
    if let Ok(v) = row.try_get::<NaiveDate, usize>(idx) {
        return json!(v.to_string());
    }
    if let Ok(v) = row.try_get::<NaiveTime, usize>(idx) {
        return json!(v.to_string());
    }
    if let Ok(v) = row.try_get::<String, usize>(idx) {
        return json!(v);
    }
    if let Ok(v) = row.try_get::<Vec<u8>, usize>(idx) {
        return bytes_to_json(v);
    }
    Value::Null
}

fn cell_pg(row: &sqlx::postgres::PgRow, idx: usize) -> Value {
    let Ok(raw) = row.try_get_raw(idx) else { return Value::Null };
    if raw.is_null() {
        return Value::Null;
    }
    if let Ok(v) = row.try_get::<i64, usize>(idx) {
        return json!(v);
    }
    if let Ok(v) = row.try_get::<i32, usize>(idx) {
        return json!(v);
    }
    if let Ok(v) = row.try_get::<f64, usize>(idx) {
        return json!(v);
    }
    if let Ok(v) = row.try_get::<bool, usize>(idx) {
        return json!(v);
    }
    if let Ok(v) = row.try_get::<Decimal, usize>(idx) {
        return json!(v.to_string());
    }
    if let Ok(v) = row.try_get::<NaiveDateTime, usize>(idx) {
        return json!(v.to_string());
    }
    if let Ok(v) = row.try_get::<NaiveDate, usize>(idx) {
        return json!(v.to_string());
    }
    if let Ok(v) = row.try_get::<NaiveTime, usize>(idx) {
        return json!(v.to_string());
    }
    // information_schema identifier columns are Postgres's pseudo-type `name`,
    // which only decodes via `String` — worth trying even after the numeric
    // attempts above so ordinary text columns aren't shadowed by them.
    if let Ok(v) = row.try_get::<String, usize>(idx) {
        return json!(v);
    }
    if let Ok(v) = row.try_get::<Vec<u8>, usize>(idx) {
        return bytes_to_json(v);
    }
    Value::Null
}

fn cell_sqlite(row: &sqlx::sqlite::SqliteRow, idx: usize) -> Value {
    let Ok(raw) = row.try_get_raw(idx) else { return Value::Null };
    if raw.is_null() {
        return Value::Null;
    }
    if let Ok(v) = row.try_get::<i64, usize>(idx) {
        return json!(v);
    }
    if let Ok(v) = row.try_get::<f64, usize>(idx) {
        return json!(v);
    }
    if let Ok(v) = row.try_get::<bool, usize>(idx) {
        return json!(v);
    }
    if let Ok(v) = row.try_get::<String, usize>(idx) {
        return json!(v);
    }
    if let Ok(v) = row.try_get::<Vec<u8>, usize>(idx) {
        return bytes_to_json(v);
    }
    Value::Null
}

/// Some drivers/columns only decode as raw bytes even though the content is
/// text (e.g. certain MySQL information_schema columns) — try UTF-8 first and
/// only fall back to a hex blob for genuinely non-textual binary data.
fn bytes_to_json(v: Vec<u8>) -> Value {
    match String::from_utf8(v) {
        Ok(s) => json!(s),
        Err(e) => {
            let hex: String = e.into_bytes().iter().map(|b| format!("{b:02x}")).collect();
            json!(format!("0x{hex}"))
        }
    }
}

struct Fetched {
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
}

async fn fetch(pool: &Pool, sql: &str) -> Result<Fetched, sqlx::Error> {
    Ok(match pool {
        Pool::MySql(p) => {
            let rows = sqlx::query(sql).fetch_all(p).await?;
            let columns = rows.first().map(|r| r.columns().iter().map(|c| c.name().to_string()).collect()).unwrap_or_default();
            Fetched { columns, rows: rows.iter().map(|r| (0..r.columns().len()).map(|i| cell_mysql(r, i)).collect()).collect() }
        }
        Pool::Postgres(p) => {
            let rows = sqlx::query(sql).fetch_all(p).await?;
            let columns = rows.first().map(|r| r.columns().iter().map(|c| c.name().to_string()).collect()).unwrap_or_default();
            Fetched { columns, rows: rows.iter().map(|r| (0..r.columns().len()).map(|i| cell_pg(r, i)).collect()).collect() }
        }
        Pool::Sqlite(p) => {
            let rows = sqlx::query(sql).fetch_all(p).await?;
            let columns = rows.first().map(|r| r.columns().iter().map(|c| c.name().to_string()).collect()).unwrap_or_default();
            Fetched { columns, rows: rows.iter().map(|r| (0..r.columns().len()).map(|i| cell_sqlite(r, i)).collect()).collect() }
        }
    })
}

/// Read one cell as a string (list_tables / list_columns only ever deal with
/// identifier/text/flag columns — SQLite's PRAGMA notnull flag decodes as a
/// JSON number rather than a string, so this covers both).
fn text_col0(fetched: &Fetched, row_idx: usize, col_idx: usize) -> String {
    match fetched.rows.get(row_idx).and_then(|r| r.get(col_idx)) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}

// ---- handlers ----

async fn test_conn(Json(c): Json<ConnInfo>) -> ApiResult<Json<Value>> {
    let pool = Pool::connect(&c).await?;
    pool.close().await;
    Ok(Json(json!({ "ok": true })))
}

async fn list_tables(Json(c): Json<ConnInfo>) -> ApiResult<Json<Vec<String>>> {
    let pool = Pool::connect(&c).await?;
    let sql: &str = match c.engine.as_str() {
        "sqlite" => "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        "mysql" => "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name",
        "postgres" => "SELECT table_name::text FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
        other => return Err(ApiError::bad(format!("Unknown engine \"{other}\""))),
    };
    let fetched = fetch(&pool, sql).await.map_err(query_err)?;
    pool.close().await;
    let names = (0..fetched.rows.len()).map(|i| text_col0(&fetched, i, 0)).collect();
    Ok(Json(names))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ColumnsBody {
    #[serde(flatten)]
    conn: ConnInfo,
    table: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ColumnInfo {
    name: String,
    data_type: String,
    nullable: bool,
}

async fn list_columns(Json(b): Json<ColumnsBody>) -> ApiResult<Json<Vec<ColumnInfo>>> {
    if !is_safe_ident(&b.table) {
        return Err(ApiError::bad("Invalid table name"));
    }
    let pool = Pool::connect(&b.conn).await?;
    let sql = match b.conn.engine.as_str() {
        "sqlite" => format!("PRAGMA table_info({})", b.table),
        "mysql" => format!(
            "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = '{}' AND table_schema = DATABASE() ORDER BY ordinal_position",
            b.table
        ),
        "postgres" => format!(
            "SELECT column_name::text, data_type::text, is_nullable::text FROM information_schema.columns WHERE table_name = '{}' AND table_schema = 'public' ORDER BY ordinal_position",
            b.table
        ),
        other => return Err(ApiError::bad(format!("Unknown engine \"{other}\""))),
    };
    let fetched = fetch(&pool, &sql).await.map_err(query_err)?;
    pool.close().await;

    // PRAGMA table_info columns, in order: cid, name, type, notnull, dflt_value, pk.
    // information_schema queries above select column_name, data_type, is_nullable.
    let (name_idx, type_idx, null_idx) = if b.conn.engine == "sqlite" { (1, 2, 3) } else { (0, 1, 2) };
    let cols = (0..fetched.rows.len())
        .map(|i| {
            let nullable = if b.conn.engine == "sqlite" {
                text_col0(&fetched, i, null_idx) == "0" // PRAGMA notnull: 0 = nullable
            } else {
                text_col0(&fetched, i, null_idx).eq_ignore_ascii_case("YES")
            };
            ColumnInfo { name: text_col0(&fetched, i, name_idx), data_type: text_col0(&fetched, i, type_idx), nullable }
        })
        .collect();
    Ok(Json(cols))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueryBody {
    #[serde(flatten)]
    conn: ConnInfo,
    sql: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QueryResult {
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    row_count: usize,
    truncated: bool,
    affected: Option<u64>,
}

const MAX_ROWS: usize = 500;

async fn run_query(Json(b): Json<QueryBody>) -> ApiResult<Json<QueryResult>> {
    let trimmed = b.sql.trim();
    if trimmed.is_empty() {
        return Err(ApiError::bad("Empty query"));
    }
    let pool = Pool::connect(&b.conn).await?;

    // Statements that return a result set go through fetch_all; everything else
    // (INSERT/UPDATE/DELETE/DDL) goes through execute() and reports rows affected.
    let first_word = trimmed.split_whitespace().next().unwrap_or("").to_uppercase();
    let is_select = matches!(first_word.as_str(), "SELECT" | "WITH" | "PRAGMA" | "SHOW" | "EXPLAIN");

    let out = if is_select {
        match fetch(&pool, trimmed).await {
            Ok(f) => {
                let row_count = f.rows.len();
                let truncated = row_count > MAX_ROWS;
                let rows = f.rows.into_iter().take(MAX_ROWS).collect();
                QueryResult { columns: f.columns, rows, row_count, truncated, affected: None }
            }
            Err(e) => {
                pool.close().await;
                return Err(query_err(e));
            }
        }
    } else {
        let affected = match &pool {
            Pool::MySql(p) => sqlx::query(trimmed).execute(p).await.map(|r| r.rows_affected()),
            Pool::Postgres(p) => sqlx::query(trimmed).execute(p).await.map(|r| r.rows_affected()),
            Pool::Sqlite(p) => sqlx::query(trimmed).execute(p).await.map(|r| r.rows_affected()),
        };
        match affected {
            Ok(n) => QueryResult { columns: vec![], rows: vec![], row_count: 0, truncated: false, affected: Some(n) },
            Err(e) => {
                pool.close().await;
                return Err(query_err(e));
            }
        }
    };
    pool.close().await;
    Ok(Json(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn(engine: &str) -> ConnInfo {
        ConnInfo {
            engine: engine.to_string(),
            host: Some("db.local".to_string()),
            port: Some(1234),
            user: Some("u@1".to_string()),
            password: Some("p@ss w/ord!".to_string()),
            database: "mydb".to_string(),
        }
    }

    #[test]
    fn builds_mysql_url_with_percent_encoded_credentials() {
        assert_eq!(mysql_url(&conn("mysql")), "mysql://u%401:p%40ss%20w%2Ford%21@db.local:1234/mydb");
    }

    #[test]
    fn builds_postgres_url() {
        let url = postgres_url(&conn("postgres"));
        assert!(url.starts_with("postgres://u%401:"));
        assert!(url.ends_with("@db.local:1234/mydb"));
    }

    #[test]
    fn builds_sqlite_url_for_absolute_and_relative_paths() {
        let mut c = conn("sqlite");
        c.database = "/tmp/x.db".to_string();
        assert_eq!(sqlite_url(&c), "sqlite:///tmp/x.db");
        c.database = "rel/x.db".to_string();
        assert_eq!(sqlite_url(&c), "sqlite://rel/x.db");
    }

    #[test]
    fn identifier_allowlist_rejects_sql_metacharacters() {
        assert!(is_safe_ident("users"));
        assert!(is_safe_ident("_private_table"));
        assert!(!is_safe_ident(""));
        assert!(!is_safe_ident("users; DROP TABLE users"));
        assert!(!is_safe_ident("users'--"));
        assert!(!is_safe_ident("a b"));
    }

    /// End-to-end round trip against a real (temp-file) SQLite database — the
    /// same fetch()/cell_sqlite() path list_tables/list_columns/run_query use.
    #[tokio::test]
    async fn sqlite_round_trip_create_insert_select() {
        let path = std::env::temp_dir().join(format!("jakide-db-test-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        std::fs::write(&path, []).unwrap();

        let c = ConnInfo { engine: "sqlite".into(), host: None, port: None, user: None, password: None, database: path.to_string_lossy().into_owned() };

        let pool = Pool::connect(&c).await.expect("connect");
        if let Pool::Sqlite(p) = &pool {
            sqlx::query("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER)").execute(p).await.expect("create table");
            sqlx::query("INSERT INTO users (name, age) VALUES ('Ada', 30), ('Grace', 40)").execute(p).await.expect("insert");
        }
        pool.close().await;

        let tables = list_tables(Json(c.clone())).await.expect("list_tables").0;
        assert_eq!(tables, vec!["users".to_string()]);

        let cols = list_columns(Json(ColumnsBody { conn: c.clone(), table: "users".into() })).await.expect("list_columns").0;
        let names: Vec<&str> = cols.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["id", "name", "age"]);
        assert!(!cols[1].nullable); // name TEXT NOT NULL
        assert!(cols[2].nullable); // age INTEGER, no constraint


        let result = run_query(Json(QueryBody { conn: c.clone(), sql: "SELECT name, age FROM users ORDER BY name".into() })).await.expect("run_query").0;
        assert_eq!(result.columns, vec!["name".to_string(), "age".to_string()]);
        assert_eq!(result.row_count, 2);
        assert_eq!(result.rows[0][0], json!("Ada"));
        assert_eq!(result.rows[1][0], json!("Grace"));

        let insert = run_query(Json(QueryBody { conn: c, sql: "INSERT INTO users (name, age) VALUES ('Alan', 41)".into() })).await.expect("run_query insert").0;
        assert_eq!(insert.affected, Some(1));

        let _ = std::fs::remove_file(&path);
    }
}
