//! Container detail view — `docker inspect` parsed into the fields the panel
//! actually shows (ports, mounts, env, labels, networks), rather than the raw
//! ~200-key blob Docker returns.

use axum::extract::Path;
use axum::Json;
use serde_json::{json, Value};

use crate::error::{ApiError, ApiResult};

use super::run;

pub async fn inspect_container(Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let out = run(&["inspect", &id]).await?;
    if !out.ok {
        let msg = out.stderr.trim();
        return Err(ApiError::bad(if msg.is_empty() { "docker inspect failed".to_string() } else { msg.to_string() }));
    }
    let arr: Vec<Value> = serde_json::from_str(&out.stdout).map_err(|e| ApiError::bad(format!("Failed to parse docker inspect output: {e}")))?;
    let raw = arr.into_iter().next().ok_or_else(|| ApiError::bad("Container not found"))?;
    Ok(Json(summarize(&raw)))
}

fn str_at<'a>(v: &'a Value, pointer: &str) -> &'a str {
    v.pointer(pointer).and_then(Value::as_str).unwrap_or("")
}

/// Port bindings: `{"80/tcp": [{"HostIp":"0.0.0.0","HostPort":"8080"}, ...]}` (or
/// `null`/empty when the port isn't published) → readable "host → container" lines.
fn format_ports(raw: &Value) -> Vec<String> {
    let Some(obj) = raw.pointer("/NetworkSettings/Ports").and_then(Value::as_object) else { return Vec::new() };
    let mut out = Vec::new();
    for (container_port, bindings) in obj {
        match bindings.as_array().filter(|a| !a.is_empty()) {
            Some(arr) => {
                for b in arr {
                    let host_ip = b.get("HostIp").and_then(Value::as_str).unwrap_or("0.0.0.0");
                    let host_port = b.get("HostPort").and_then(Value::as_str).unwrap_or("");
                    out.push(format!("{host_ip}:{host_port} → {container_port}"));
                }
            }
            None => out.push(format!("{container_port} (not published)")),
        }
    }
    out.sort();
    out
}

fn format_mounts(raw: &Value) -> Vec<String> {
    raw.get("Mounts")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|m| {
                    let src = m.get("Source").and_then(Value::as_str).unwrap_or("");
                    let dst = m.get("Destination").and_then(Value::as_str).unwrap_or("");
                    let rw = m.get("RW").and_then(Value::as_bool).unwrap_or(true);
                    format!("{src} → {dst} ({})", if rw { "rw" } else { "ro" })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn format_env(raw: &Value) -> Vec<String> {
    raw.pointer("/Config/Env")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

fn format_networks(raw: &Value) -> Vec<String> {
    raw.pointer("/NetworkSettings/Networks")
        .and_then(Value::as_object)
        .map(|obj| {
            obj.iter()
                .map(|(name, net)| format!("{name} ({})", net.get("IPAddress").and_then(Value::as_str).unwrap_or("")))
                .collect()
        })
        .unwrap_or_default()
}

fn format_labels(raw: &Value) -> Vec<String> {
    raw.pointer("/Config/Labels")
        .and_then(Value::as_object)
        .map(|obj| obj.iter().map(|(k, v)| format!("{k}={}", v.as_str().unwrap_or(""))).collect())
        .unwrap_or_default()
}

fn format_command(raw: &Value) -> String {
    raw.pointer("/Config/Cmd")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" "))
        .unwrap_or_default()
}

fn summarize(raw: &Value) -> Value {
    json!({
        "id": str_at(raw, "/Id"),
        "name": str_at(raw, "/Name").trim_start_matches('/'),
        "image": str_at(raw, "/Config/Image"),
        "command": format_command(raw),
        "created": str_at(raw, "/Created"),
        "state": str_at(raw, "/State/Status"),
        "startedAt": str_at(raw, "/State/StartedAt"),
        "finishedAt": str_at(raw, "/State/FinishedAt"),
        "restartCount": raw.get("RestartCount").and_then(Value::as_i64).unwrap_or(0),
        "platform": str_at(raw, "/Platform"),
        "ipAddress": str_at(raw, "/NetworkSettings/IPAddress"),
        "ports": format_ports(raw),
        "mounts": format_mounts(raw),
        "env": format_env(raw),
        "labels": format_labels(raw),
        "networks": format_networks(raw),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Value {
        json!({
            "Id": "abc123def456",
            "Name": "/web-1",
            "Created": "2026-06-30T10:00:00Z",
            "Platform": "linux",
            "RestartCount": 2,
            "Config": {
                "Image": "nginx:1.27",
                "Cmd": ["nginx", "-g", "daemon off;"],
                "Env": ["PATH=/usr/bin", "NGINX_VERSION=1.27"],
                "Labels": {"com.example.env": "prod"}
            },
            "State": { "Status": "running", "StartedAt": "2026-06-30T10:00:05Z", "FinishedAt": "0001-01-01T00:00:00Z" },
            "NetworkSettings": {
                "IPAddress": "172.17.0.2",
                "Ports": {
                    "80/tcp": [{"HostIp": "0.0.0.0", "HostPort": "8080"}],
                    "443/tcp": null
                },
                "Networks": { "bridge": { "IPAddress": "172.17.0.2" } }
            },
            "Mounts": [{"Source": "/host/data", "Destination": "/data", "RW": true}]
        })
    }

    #[test]
    fn summarizes_the_fields_the_panel_needs() {
        let s = summarize(&sample());
        assert_eq!(s["name"], "web-1"); // leading slash stripped
        assert_eq!(s["image"], "nginx:1.27");
        assert_eq!(s["command"], "nginx -g daemon off;");
        assert_eq!(s["state"], "running");
        assert_eq!(s["restartCount"], 2);
        assert_eq!(s["ports"], json!(["0.0.0.0:8080 → 80/tcp", "443/tcp (not published)"]));
        assert_eq!(s["mounts"], json!(["/host/data → /data (rw)"]));
        assert_eq!(s["env"], json!(["PATH=/usr/bin", "NGINX_VERSION=1.27"]));
        assert_eq!(s["labels"], json!(["com.example.env=prod"]));
        assert_eq!(s["networks"], json!(["bridge (172.17.0.2)"]));
    }

    #[test]
    fn missing_fields_degrade_to_empty_rather_than_erroring() {
        let s = summarize(&json!({}));
        assert_eq!(s["id"], "");
        assert_eq!(s["ports"], json!([]));
        assert_eq!(s["restartCount"], 0);
    }
}
