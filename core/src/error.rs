use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

/// An API error that serialises to `{ "error": message }` with an HTTP status,
/// matching the JSON-error shape the Node backend used.
#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub message: String,
}

impl ApiError {
    pub fn bad(msg: impl Into<String>) -> Self {
        Self { status: StatusCode::BAD_REQUEST, message: msg.into() }
    }
    pub fn code(status: StatusCode, msg: impl Into<String>) -> Self {
        Self { status, message: msg.into() }
    }
    #[allow(dead_code)] // reserved for handlers added in later increments
    pub fn internal(msg: impl Into<String>) -> Self {
        Self { status: StatusCode::INTERNAL_SERVER_ERROR, message: msg.into() }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

/// Convert std::io errors into a 500 (or 404 for not-found).
impl From<std::io::Error> for ApiError {
    fn from(e: std::io::Error) -> Self {
        let status = match e.kind() {
            std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        ApiError::code(status, e.to_string())
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
