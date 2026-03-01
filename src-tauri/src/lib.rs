use log::info;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, Write as IoWrite};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use futures_util::stream::StreamExt;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use zip::ZipArchive;
use xz2::read::XzDecoder;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubRelease {
    pub tag_name: String,
    pub name: String,
    pub body: Option<String>,
    pub published_at: String,
    pub assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameVersion {
    pub tag: String,
    pub name: String,
    pub date: String,
    pub size: u64,
    pub download_url: String,
    pub is_downloaded: bool,
    pub is_running: bool,
    pub platform: String,
    pub archive_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetStatus {
    pub has_lang: bool,
    pub has_graphics: bool,
    pub has_sound: bool,
    pub lang_path: Option<String>,
    pub graphics_path: Option<String>,
    pub sound_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub install_dir: String,
    pub launch_options: String,
    pub default_version: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        let default_dir = get_default_install_dir();
        Self {
            install_dir: default_dir,
            launch_options: String::new(),
            default_version: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub version_tag: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub progress_percent: f64,
}

pub struct AppState {
    pub client: Client,
    pub config: Mutex<AppConfig>,
    pub running_versions: Mutex<HashMap<String, u32>>,
}

fn get_default_install_dir() -> String {
    let base = dirs::data_local_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    
    let platform = std::env::consts::OS;
    let dir = match platform {
        "windows" => base.join("JGRPP Launcher"),
        "macos" => base.join("JGRPP Launcher"),
        "linux" => base.join("jgrpp-launcher"),
        _ => base.join("jgrpp-launcher"),
    };
    
    dir.to_string_lossy().to_string()
}

fn get_platform_string() -> String {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    
    match os {
        "windows" => {
            match arch {
                "x86_64" => "windows-win64".to_string(),
                "x86" => "windows-win32".to_string(),
                "aarch64" => "windows-arm64".to_string(),
                _ => "windows-win64".to_string(),
            }
        }
        "macos" => "macos-universal".to_string(),
        "linux" => {
            if cfg!(target_os = "linux") {
                "linux-generic-amd64".to_string()
            } else {
                "linux-generic-amd64".to_string()
            }
        }
        _ => "windows-win64".to_string(),
    }
}

fn get_archive_type(platform: &str) -> &str {
    if platform.starts_with("windows") {
        "zip"
    } else if platform.starts_with("macos") {
        "dmg"
    } else {
        "tar.xz"
    }
}

fn get_executable_name(platform: &str) -> &str {
    if platform.starts_with("windows") {
        "openttd.exe"
    } else if platform.starts_with("macos") {
        "OpenTTD.app"
    } else {
        "openttd"
    }
}

#[tauri::command]
async fn get_config(state: State<'_, Arc<AppState>>) -> Result<AppConfig, String> {
    let config = state.config.lock().await;
    Ok(config.clone())
}

#[tauri::command]
async fn set_config(state: State<'_, Arc<AppState>>, config: AppConfig) -> Result<(), String> {
    let mut current = state.config.lock().await;
    *current = config.clone();
    
    let config_dir = dirs::config_dir()
        .ok_or("Could not find config directory")?
        .join("jgrpp-launcher");
    
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    let config_path = config_dir.join("config.json");
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(config_path, json).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
async fn fetch_releases(state: State<'_, Arc<AppState>>) -> Result<Vec<GameVersion>, String> {
    info!("Fetching releases from GitHub...");
    
    let response = state.client
        .get("https://api.github.com/repos/JGRennison/OpenTTD-patches/releases")
        .header("User-Agent", "JGRPP-Launcher")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch releases: {}", e))?;
    
    let releases: Vec<GithubRelease> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse releases: {}", e))?;
    
    let platform = get_platform_string();
    let config = state.config.lock().await;
    let install_dir = PathBuf::from(&config.install_dir);
    
    fn find_executable(dir: &Path) -> bool {
        if dir.join("openttd.exe").exists() || dir.join("OpenTTD.app").exists() || dir.join("openttd").exists() {
            return true;
        }
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if find_executable(&path) {
                        return true;
                    }
                }
            }
        }
        false
    }
    
    let versions: Vec<GameVersion> = releases
        .iter()
        .filter_map(|release| {
            let asset = release.assets.iter().find(|a| {
                let name = a.name.to_lowercase();
                name.contains(&platform.to_lowercase()) && 
                !name.contains("dedicated") &&
                !name.contains("source")
            })?;
            
            let version_dir = install_dir.join(&release.tag_name);
            let is_downloaded = version_dir.exists() && find_executable(&version_dir);
            
            Some(GameVersion {
                tag: release.tag_name.clone(),
                name: release.name.clone(),
                date: release.published_at.clone(),
                size: asset.size,
                download_url: asset.browser_download_url.clone(),
                is_downloaded,
                is_running: false,
                platform: platform.clone(),
                archive_type: get_archive_type(&platform).to_string(),
            })
        })
        .collect();
    
    info!("Found {} versions for platform {}", versions.len(), platform);
    Ok(versions)
}

#[tauri::command]
async fn download_version(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    version_tag: String,
    download_url: String,
) -> Result<(), String> {
    info!("Downloading version {} from {}", version_tag, download_url);
    
    let config = state.config.lock().await;
    let install_dir = PathBuf::from(&config.install_dir);
    drop(config);
    
    let version_dir = install_dir.join(&version_tag);
    fs::create_dir_all(&version_dir).map_err(|e| format!("Failed to create directory: {}", e))?;
    
    let temp_file = install_dir.join(format!("{}.tmp", version_tag));
    
    let response = state.client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {}", e))?;
    
    let total_size = response.content_length().unwrap_or(0);
    
    let mut file = File::create(&temp_file).map_err(|e| format!("Failed to create temp file: {}", e))?;
    
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    
    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Download error: {}", e))?;
        file.write_all(&chunk).map_err(|e| format!("Write error: {}", e))?;
        downloaded += chunk.len() as u64;
        
        let progress = if total_size > 0 {
            (downloaded as f64 / total_size as f64) * 100.0
        } else {
            0.0
        };
        
        let progress_data = DownloadProgress {
            version_tag: version_tag.clone(),
            downloaded_bytes: downloaded,
            total_bytes: total_size,
            progress_percent: progress,
        };
        
        let _ = app.emit("download-progress", progress_data);
    }
    
    file.flush().map_err(|e| format!("Flush error: {}", e))?;
    drop(file);
    
    info!("Extracting archive to {}", version_dir.display());
    
    let platform_str = get_platform_string();
    let archive_type = get_archive_type(&platform_str);
    
    match archive_type {
        "zip" => {
            extract_zip(&temp_file, &version_dir)?;
        }
        "tar.xz" => {
            extract_tar_xz(&temp_file, &version_dir)?;
            fix_nested_directory(&version_dir)?;
        }
        "dmg" => {
            return Err("DMG extraction requires special handling on macOS. Please extract manually.".to_string());
        }
        _ => {
            return Err(format!("Unsupported archive type: {}", archive_type));
        }
    }
    
    fs::remove_file(&temp_file).ok();
    
    let _ = app.emit("download-complete", version_tag.clone());
    info!("Successfully downloaded and extracted {}", version_tag);
    
    Ok(())
}

fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let file = File::open(zip_path).map_err(|e| format!("Failed to open zip: {}", e))?;
    let reader = BufReader::new(file);
    let mut archive = ZipArchive::new(reader).map_err(|e| format!("Failed to read zip: {}", e))?;
    
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = dest_dir.join(file.name());
        
        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath).ok();
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p).ok();
                }
            }
            let mut outfile = File::create(&outpath).map_err(|e| format!("Failed to create file: {}", e))?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| format!("Failed to extract: {}", e))?;
        }
    }
    
    Ok(())
}

fn extract_tar_xz(tar_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let file = File::open(tar_path).map_err(|e| format!("Failed to open tar.xz: {}", e))?;
    let reader = BufReader::new(file);
    let decoder = XzDecoder::new(reader);
    let mut archive = tar::Archive::new(decoder);
    
    archive.unpack(dest_dir).map_err(|e| format!("Failed to extract tar.xz: {}", e))?;
    
    Ok(())
}

fn fix_nested_directory(version_dir: &Path) -> Result<(), String> {
    let entries = fs::read_dir(version_dir).map_err(|e| e.to_string())?;
    
    let subdirs: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .map(|e| e.path())
        .collect();
    
    if subdirs.len() == 1 {
        let subdir = &subdirs[0];
        info!("Found nested directory: {}. Moving contents up.", subdir.display());
        
        for entry in fs::read_dir(subdir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let src = entry.path();
            let dst = version_dir.join(entry.file_name());
            
            fs::rename(&src, &dst).or_else(|_| {
                fs::copy(&src, &dst)?;
                fs::remove_dir_all(&src)
            }).map_err(|e| format!("Failed to move {}: {}", src.display(), e))?;
        }
        
        fs::remove_dir(subdir).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
async fn remove_version(state: State<'_, Arc<AppState>>, version_tag: String) -> Result<(), String> {
    info!("Removing version {}", version_tag);
    
    let config = state.config.lock().await;
    let version_dir = PathBuf::from(&config.install_dir).join(&version_tag);
    
    if version_dir.exists() {
        fs::remove_dir_all(&version_dir).map_err(|e| format!("Failed to remove version: {}", e))?;
    }
    
    info!("Successfully removed {}", version_tag);
    Ok(())
}

#[tauri::command]
async fn launch_version(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    version_tag: String,
) -> Result<(), String> {
    info!("Launching version {}", version_tag);
    
    let config = state.config.lock().await;
    let version_dir = PathBuf::from(&config.install_dir).join(&version_tag);
    let platform = get_platform_string();
    let executable = get_executable_name(&platform);
    
    fn find_executable_path(dir: &Path, exec_name: &str) -> Option<PathBuf> {
        let path = dir.join(exec_name);
        if path.exists() {
            return Some(path);
        }
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if let Some(found) = find_executable_path(&path, exec_name) {
                        return Some(found);
                    }
                }
            }
        }
        None
    }
    
    let exe_path = find_executable_path(&version_dir, executable).ok_or_else(|| {
        format!("Executable '{}' not found in {}", executable, version_dir.display())
    })?;
    
    if !exe_path.exists() {
        return Err(format!("Executable not found: {}", exe_path.display()));
    }
    
    let mut cmd = Command::new(&exe_path);
    cmd.current_dir(&exe_path.parent().unwrap_or(&version_dir));
    
    if !config.launch_options.is_empty() {
        let options: Vec<&str> = config.launch_options.split_whitespace().collect();
        for opt in options {
            cmd.arg(opt);
        }
    }
    
    let child = cmd.spawn().map_err(|e| format!("Failed to launch: {}", e))?;
    
    let mut running = state.running_versions.lock().await;
    running.insert(version_tag.clone(), child.id());
    
    let _ = app.emit("version-launched", version_tag.clone());
    
    info!("Version {} launched with PID {}", version_tag, child.id());
    Ok(())
}

#[tauri::command]
async fn check_asset_status(
    state: State<'_, Arc<AppState>>,
    version_tag: String,
) -> Result<AssetStatus, String> {
    let config = state.config.lock().await;
    let version_dir = PathBuf::from(&config.install_dir).join(&version_tag);
    
    fn find_dir_recursive(base: &Path, name: &str) -> Option<PathBuf> {
        let path = base.join(name);
        if path.is_dir() {
            return Some(path);
        }
        if let Ok(entries) = fs::read_dir(base) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if let Some(found) = find_dir_recursive(&path, name) {
                        return Some(found);
                    }
                }
            }
        }
        None
    }
    
    fn find_file_recursive(base: &Path, name: &str) -> Option<PathBuf> {
        let path = base.join(name);
        if path.exists() {
            return Some(path);
        }
        if let Ok(entries) = fs::read_dir(base) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if let Some(found) = find_file_recursive(&path, name) {
                        return Some(found);
                    }
                }
            }
        }
        None
    }
    
    let lang_dir = find_dir_recursive(&version_dir, "lang");
    let has_lang = lang_dir.as_ref().map(|d| fs::read_dir(d).map(|mut e| e.next().is_some()).unwrap_or(false)).unwrap_or(false);
    
    let mut lang_path = None;
    if let Some(ref dir) = lang_dir {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if name.contains("english") || name.contains("base") || name.ends_with(".lng") {
                    lang_path = Some(entry.path().to_string_lossy().to_string());
                    break;
                }
            }
        }
    }
    
    let graphics_patterns = ["gm", "graphics", "sample.cat"];
    let mut graphics_path = None;
    let mut has_graphics = false;
    
    for pattern in &graphics_patterns {
        if let Some(path) = find_file_recursive(&version_dir, pattern) {
            has_graphics = true;
            graphics_path = Some(path.to_string_lossy().to_string());
            break;
        }
    }
    
    let sfx_dir = find_dir_recursive(&version_dir, "sfx");
    let has_sound = sfx_dir.as_ref().map(|d| fs::read_dir(d).map(|mut e| e.next().is_some()).unwrap_or(false)).unwrap_or(false);
    
    let mut sound_path = None;
    if let Some(ref dir) = sfx_dir {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if name.ends_with(".sfx") || name.ends_with(".ogg") || name.ends_with(".wav") {
                    sound_path = Some(entry.path().to_string_lossy().to_string());
                    break;
                }
            }
        }
    }
    
    Ok(AssetStatus {
        has_lang,
        has_graphics,
        has_sound,
        lang_path,
        graphics_path,
        sound_path,
    })
}

#[tauri::command]
async fn download_assets(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    version_tag: String,
) -> Result<(), String> {
    info!("Downloading assets for {}", version_tag);
    
    let config = state.config.lock().await;
    let version_dir = PathBuf::from(&config.install_dir).join(&version_tag);
    
    let lang_dir = version_dir.join("lang");
    if !lang_dir.exists() {
        fs::create_dir_all(&lang_dir).map_err(|e| e.to_string())?;
    }
    
    let gm_dir = version_dir.join("gm");
    if !gm_dir.exists() {
        fs::create_dir_all(&gm_dir).map_err(|e| e.to_string())?;
    }
    
    let sfx_dir = version_dir.join("sfx");
    if !sfx_dir.exists() {
        fs::create_dir_all(&sfx_dir).map_err(|e| e.to_string())?;
    }
    
    let base_url = "https://cdn.openttd.org";
    
    let lang_urls = vec![
        format!("{}/lang/0.50.0/english.lng", base_url),
    ];
    
    let graphics_urls = vec![
        format!("{}/gm/0.50.0/sample.cat", base_url),
    ];
    
    let sound_urls = vec![
        format!("{}/sfx/0.50.0/wooden.wav", base_url),
    ];
    
    for url in &lang_urls {
        let filename = url.split('/').last().unwrap_or("english.lng");
        let path = lang_dir.join(filename);
        if !path.exists() {
            download_file(&state.client, url, &path).await?;
        }
    }
    
    for url in &graphics_urls {
        let filename = url.split('/').last().unwrap_or("sample.cat");
        let path = gm_dir.join(filename);
        if !path.exists() {
            download_file(&state.client, url, &path).await?;
        }
    }
    
    for url in &sound_urls {
        let filename = url.split('/').last().unwrap_or("wooden.wav");
        let path = sfx_dir.join(filename);
        if !path.exists() {
            download_file(&state.client, url, &path).await?;
        }
    }
    
    let _ = app.emit("assets-downloaded", &version_tag);
    info!("Assets downloaded for {}", version_tag);
    
    Ok(())
}

async fn download_file(
    client: &Client,
    url: &str,
    dest: &Path,
) -> Result<(), String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to download {}: {}", url, e))?;
    
    let content = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    
    let mut file = File::create(dest).map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(&content).map_err(|e| format!("Failed to write file: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn get_install_directory(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let config = state.config.lock().await;
    Ok(config.install_dir.clone())
}

#[tauri::command]
async fn set_install_directory(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<(), String> {
    let mut config = state.config.lock().await;
    config.install_dir = path;
    Ok(())
}

#[tauri::command]
fn get_platform() -> String {
    get_platform_string()
}

pub fn load_config() -> AppConfig {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("jgrpp-launcher");
    
    let config_path = config_dir.join("config.json");
    
    if config_path.exists() {
        if let Ok(content) = fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str(&content) {
                return config;
            }
        }
    }
    
    AppConfig::default()
}

#[tauri::command]
async fn fetch_changelog(state: State<'_, Arc<AppState>>, version_tag: String) -> Result<String, String> {
    let tag = version_tag.trim_start_matches("jgrpp-");
    let url = format!("https://raw.githubusercontent.com/JGRennison/OpenTTD-patches/{}/jgrpp-changelog.md", tag);
    
    let response = state.client
        .get(&url)
        .header("User-Agent", "JGRPP-Launcher")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch changelog: {}", e))?;
    
    let changelog = response
        .text()
        .await
        .map_err(|e| format!("Failed to read changelog: {}", e))?;
    
    Ok(changelog)
}

#[tauri::command]
async fn create_shortcut(
    state: State<'_, Arc<AppState>>,
    version_tag: String,
) -> Result<String, String> {
    info!("Creating shortcut for {}", version_tag);
    
    let config = state.config.lock().await;
    let version_dir = PathBuf::from(&config.install_dir).join(&version_tag);
    let platform = get_platform_string();
    let executable = get_executable_name(&platform);
    
    fn find_executable_path(dir: &Path, exec_name: &str) -> Option<PathBuf> {
        let path = dir.join(exec_name);
        if path.exists() {
            return Some(path);
        }
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if let Some(found) = find_executable_path(&path, exec_name) {
                        return Some(found);
                    }
                }
            }
        }
        None
    }
    
    let exe_path = find_executable_path(&version_dir, executable).ok_or_else(|| {
        format!("Executable not found for {}", version_tag)
    })?;
    
    let exe_path_str = exe_path.to_string_lossy().to_string();
    
    let desktop_dir = dirs::desktop_dir().ok_or("Could not find desktop directory")?;
    let shortcut_name = format!("JGRPP {}", version_tag);
    let shortcut_path = desktop_dir.join(&shortcut_name);
    
    #[cfg(target_os = "windows")]
    {
        let batch_content = format!(
            "@echo off\n\"{}\" %*",
            exe_path_str.replace("\\", "\\\\")
        );
        fs::write(shortcut_path.with_extension("bat"), batch_content)
            .map_err(|e| format!("Failed to create shortcut: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        let desktop_entry = format!(
            "[Desktop Entry]\nType=Application\nName={}\nExec={} %U\nTerminal=false\nCategories=Game;",
            shortcut_name,
            exe_path_str
        );
        let sp = shortcut_path.clone();
        fs::write(&sp, desktop_entry)
            .map_err(|e| format!("Failed to create shortcut: {}", e))?;
        
        let _ = Command::new("chmod")
            .arg("+x")
            .arg(&sp)
            .output();
    }
    
    #[cfg(target_os = "macos")]
    {
        return Err("macOS shortcuts should use the app bundle".to_string());
    }
    
    info!("Shortcut created at {}", shortcut_path.display());
    Ok(shortcut_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn launch_default_version(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let default_version = {
        let config = state.config.lock().await;
        config.default_version.clone()
    };
    
    if let Some(version) = default_version {
        return launch_version(app, state, version).await;
    }
    
    Err("No default version set".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    
    info!("Starting JGRPP Launcher...");
    
    let config = load_config();
    info!("Config loaded: install_dir = {}", config.install_dir);
    
    let state = Arc::new(AppState {
        client: Client::new(),
        config: Mutex::new(config),
        running_versions: Mutex::new(HashMap::new()),
    });
    
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_config,
            fetch_releases,
            download_version,
            remove_version,
            launch_version,
            fetch_changelog,
            create_shortcut,
            launch_default_version,
            get_install_directory,
            set_install_directory,
            get_platform,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
