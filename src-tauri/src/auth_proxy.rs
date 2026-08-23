use reqwest::{
    Client, StatusCode,
    cookie::Jar,
    header::{COOKIE, SET_COOKIE},
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tokio::fs;
use tokio::sync::Mutex;

const SESSION_FILE_NAME: &str = "folio_auth_session.json";

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthProxyResponse {
    pub status: u16,
    pub body: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredSession {
    pub refresh_token: String,
}

#[derive(Deserialize)]
struct TokenRefreshResponseBody {
    pub token: String,
}

/// Holds a reqwest Client with a cookie jar and tracked refresh token
/// so refresh-token cookies survive across requests and app restarts.
pub struct AuthHttpClient {
    client: Client,
    _cookie_jar: Arc<Jar>,
    refresh_token: Option<String>,
}

impl AuthHttpClient {
    pub fn new() -> Self {
        let jar = Arc::new(Jar::default());
        let root_certs = webpki_root_certs::TLS_SERVER_ROOT_CERTS
            .iter()
            .filter_map(|der| reqwest::Certificate::from_der(der.as_ref()).ok());

        let client = Client::builder()
            .cookie_provider(jar.clone())
            .tls_certs_only(root_certs)
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("failed to build reqwest client");
        Self {
            client,
            _cookie_jar: jar,
            refresh_token: None,
        }
    }

    pub fn client(&self) -> &Client {
        &self.client
    }
}

pub type AuthHttpClientState = Mutex<AuthHttpClient>;

fn get_session_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    Ok(base_dir.join(SESSION_FILE_NAME))
}

async fn save_persisted_refresh_token(app: &AppHandle, token: &str) {
    if let Ok(file_path) = get_session_file_path(app) {
        if let Some(parent) = file_path.parent() {
            let _ = fs::create_dir_all(parent).await;
        }
        let session = StoredSession {
            refresh_token: token.to_string(),
        };
        if let Ok(json) = serde_json::to_string(&session) {
            let _ = fs::write(file_path, json).await;
        }
    }
}

async fn load_persisted_refresh_token(app: &AppHandle) -> Option<String> {
    let file_path = get_session_file_path(app).ok()?;
    let content = fs::read_to_string(file_path).await.ok()?;
    let session: StoredSession = serde_json::from_str(&content).ok()?;
    if session.refresh_token.is_empty() {
        None
    } else {
        Some(session.refresh_token)
    }
}

async fn delete_persisted_refresh_token(app: &AppHandle) {
    if let Ok(file_path) = get_session_file_path(app) {
        let _ = fs::remove_file(file_path).await;
    }
}

fn extract_refresh_token(headers: &reqwest::header::HeaderMap) -> Option<Option<String>> {
    for val in headers.get_all(SET_COOKIE) {
        if let Ok(val_str) = val.to_str()
            && let Some(pos) = val_str.find("refresh_token=") {
                let after = &val_str[pos + "refresh_token=".len()..];
                let token_val = after.split(';').next().unwrap_or("").trim();
                let lower = val_str.to_lowercase();
                if token_val.is_empty()
                    || lower.contains("max-age=0")
                    || lower.contains("expires=thu, 01 jan 1970")
                {
                    return Some(None);
                } else {
                    return Some(Some(token_val.to_string()));
                }
            }
    }
    None
}

#[tauri::command]
pub async fn auth_login_proxy(
    app: AppHandle,
    server_url: String,
    email: String,
    password: String,
    state: State<'_, AuthHttpClientState>,
) -> Result<AuthProxyResponse, String> {
    let mut state = state.lock().await;
    let url = format!("{}/api/identity/login", server_url.trim_end_matches('/'));

    let body = serde_json::json!({
        "email": email,
        "password": password,
    });

    let res = state
        .client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    let status = res.status().as_u16();

    if let Some(token_opt) = extract_refresh_token(res.headers()) {
        match token_opt {
            Some(token) => {
                state.refresh_token = Some(token.clone());
                save_persisted_refresh_token(&app, &token).await;
            }
            None => {
                state.refresh_token = None;
                delete_persisted_refresh_token(&app).await;
            }
        }
    }

    let body_text = res.text().await.map_err(|e| e.to_string())?;

    Ok(AuthProxyResponse {
        status,
        body: body_text,
    })
}

#[tauri::command]
pub async fn auth_login_2fa_proxy(
    app: AppHandle,
    server_url: String,
    user_id: String,
    token: String,
    code: String,
    login_type: String,
    state: State<'_, AuthHttpClientState>,
) -> Result<AuthProxyResponse, String> {
    let mut state = state.lock().await;
    let url = format!(
        "{}/api/identity/login-2fa",
        server_url.trim_end_matches('/')
    );

    let body = serde_json::json!({
        "userId": user_id,
        "token": token,
        "code": code,
        "type": login_type,
    });

    let res = state
        .client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    let status = res.status().as_u16();

    if let Some(token_opt) = extract_refresh_token(res.headers()) {
        match token_opt {
            Some(tok) => {
                state.refresh_token = Some(tok.clone());
                save_persisted_refresh_token(&app, &tok).await;
            }
            None => {
                state.refresh_token = None;
                delete_persisted_refresh_token(&app).await;
            }
        }
    }

    let body_text = res.text().await.map_err(|e| e.to_string())?;

    Ok(AuthProxyResponse {
        status,
        body: body_text,
    })
}

#[tauri::command]
pub async fn auth_email_confirm_proxy(
    app: AppHandle,
    server_url: String,
    user_id: String,
    code: String,
    state: State<'_, AuthHttpClientState>,
) -> Result<AuthProxyResponse, String> {
    let mut state = state.lock().await;
    let url = format!(
        "{}/api/identity/email-confirm",
        server_url.trim_end_matches('/')
    );

    let body = serde_json::json!({
        "userId": user_id,
        "code": code,
    });

    let res = state
        .client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    let status = res.status().as_u16();

    if let Some(token_opt) = extract_refresh_token(res.headers()) {
        match token_opt {
            Some(tok) => {
                state.refresh_token = Some(tok.clone());
                save_persisted_refresh_token(&app, &tok).await;
            }
            None => {
                state.refresh_token = None;
                delete_persisted_refresh_token(&app).await;
            }
        }
    }

    let body_text = res.text().await.map_err(|e| e.to_string())?;

    Ok(AuthProxyResponse {
        status,
        body: body_text,
    })
}

#[tauri::command]
pub async fn refresh_access_token(
    app: AppHandle,
    server_url: String,
    state: State<'_, AuthHttpClientState>,
) -> Result<String, String> {
    let mut state = state.lock().await;

    if state.refresh_token.is_none() {
        state.refresh_token = load_persisted_refresh_token(&app).await;
    }

    let current_token = state
        .refresh_token
        .as_ref()
        .ok_or_else(|| "No refresh token available".to_string())?
        .clone();

    let url = format!(
        "{}/api/identity/token/refresh",
        server_url.trim_end_matches('/')
    );

    let res = state
        .client
        .post(&url)
        .header(COOKIE, format!("refresh_token={current_token}"))
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    let status = res.status();

    if let Some(token_opt) = extract_refresh_token(res.headers()) {
        match token_opt {
            Some(tok) => {
                state.refresh_token = Some(tok.clone());
                save_persisted_refresh_token(&app, &tok).await;
            }
            None => {
                state.refresh_token = None;
                delete_persisted_refresh_token(&app).await;
            }
        }
    }

    if !status.is_success() {
        let err_body = res.text().await.unwrap_or_default();
        if status == StatusCode::BAD_REQUEST || status == StatusCode::UNAUTHORIZED {
            state.refresh_token = None;
            delete_persisted_refresh_token(&app).await;
        }
        return Err(format!(
            "Refresh failed with status {}: {}",
            status, err_body
        ));
    }

    let token_res: TokenRefreshResponseBody = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse refresh token response: {e}"))?;

    Ok(token_res.token)
}

#[tauri::command]
pub async fn auth_revoke_token(
    app: AppHandle,
    server_url: String,
    state: State<'_, AuthHttpClientState>,
) -> Result<(), String> {
    let mut state = state.lock().await;

    if state.refresh_token.is_none() {
        state.refresh_token = load_persisted_refresh_token(&app).await;
    }

    let url = format!(
        "{}/api/identity/token/revoke",
        server_url.trim_end_matches('/')
    );

    if let Some(ref current_token) = state.refresh_token {
        let _ = state
            .client
            .post(&url)
            .header(COOKIE, format!("refresh_token={current_token}"))
            .send()
            .await;
    }

    state.refresh_token = None;
    delete_persisted_refresh_token(&app).await;
    *state = AuthHttpClient::new();

    Ok(())
}

#[tauri::command]
pub async fn clear_auth_cookies(
    app: AppHandle,
    state: State<'_, AuthHttpClientState>,
) -> Result<(), String> {
    let mut state = state.lock().await;
    state.refresh_token = None;
    delete_persisted_refresh_token(&app).await;
    *state = AuthHttpClient::new();
    Ok(())
}
