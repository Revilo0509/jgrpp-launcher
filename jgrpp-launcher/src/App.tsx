import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

interface GameVersion {
  tag: string;
  name: string;
  date: string;
  size: number;
  download_url: string;
  is_downloaded: boolean;
  is_running: boolean;
  platform: string;
  archive_type: string;
}

interface AssetStatus {
  has_lang: boolean;
  has_graphics: boolean;
  has_sound: boolean;
  lang_path: string | null;
  graphics_path: string | null;
  sound_path: string | null;
}

interface DownloadProgress {
  version_tag: string;
  downloaded_bytes: number;
  total_bytes: number;
  progress_percent: number;
}

interface AppConfig {
  install_dir: string;
  launch_options: string;
  auto_download_assets: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function App() {
  const [versions, setVersions] = useState<GameVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<GameVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [platform, setPlatform] = useState<string>("");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [assetStatus, setAssetStatus] = useState<AssetStatus | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [launchOptions, setLaunchOptions] = useState("");
  const [installDir, setInstallDir] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    loadData();
    
    const unlistenProgress = listen<DownloadProgress>("download-progress", (event) => {
      setDownloadProgress(event.payload);
    });
    
    const unlistenComplete = listen<string>("download-complete", () => {
      setDownloading(null);
      setDownloadProgress(null);
      setStatusMessage("Download complete!");
      loadVersions();
    });
    
    const unlistenAssets = listen<string>("assets-downloaded", () => {
      setStatusMessage("Assets downloaded!");
      if (selectedVersion) {
        checkAssets(selectedVersion.tag);
      }
    });
    
    return () => {
      unlistenProgress.then(fn => fn());
      unlistenComplete.then(fn => fn());
      unlistenAssets.then(fn => fn());
    };
  }, []);

  useEffect(() => {
    if (selectedVersion) {
      checkAssets(selectedVersion.tag);
    }
  }, [selectedVersion]);

  async function loadData() {
    try {
      const [vers, plat, cfg] = await Promise.all([
        invoke<GameVersion[]>("fetch_releases"),
        invoke<string>("get_platform"),
        invoke<AppConfig>("get_config"),
      ]);
      setVersions(vers);
      setPlatform(plat);
      setConfig(cfg);
      setInstallDir(cfg.install_dir);
      setLaunchOptions(cfg.launch_options);
      if (vers.length > 0) {
        setSelectedVersion(vers[0]);
      }
    } catch (err) {
      console.error("Failed to load data:", err);
      setStatusMessage("Failed to load releases");
    } finally {
      setLoading(false);
    }
  }

  async function loadVersions() {
    try {
      const vers = await invoke<GameVersion[]>("fetch_releases");
      setVersions(vers);
      if (selectedVersion) {
        const updated = vers.find(v => v.tag === selectedVersion.tag);
        if (updated) setSelectedVersion(updated);
      }
    } catch (err) {
      console.error("Failed to reload versions:", err);
    }
  }

  async function checkAssets(versionTag: string) {
    try {
      const status = await invoke<AssetStatus>("check_asset_status", { versionTag });
      setAssetStatus(status);
    } catch (err) {
      console.error("Failed to check assets:", err);
    }
  }

  async function handleDownload(version: GameVersion) {
    try {
      setDownloading(version.tag);
      setStatusMessage(`Downloading ${version.name}...`);
      await invoke("download_version", {
        versionTag: version.tag,
        downloadUrl: version.download_url,
      });
    } catch (err) {
      console.error("Download failed:", err);
      setStatusMessage(`Download failed: ${err}`);
      setDownloading(null);
    }
  }

  async function handleRemove(version: GameVersion) {
    if (!confirm(`Are you sure you want to remove ${version.name}?`)) return;
    
    try {
      setStatusMessage(`Removing ${version.name}...`);
      await invoke("remove_version", { versionTag: version.tag });
      setStatusMessage("Version removed");
      loadVersions();
    } catch (err) {
      console.error("Remove failed:", err);
      setStatusMessage(`Remove failed: ${err}`);
    }
  }

  async function handleLaunch(version: GameVersion) {
    if (!assetStatus?.has_lang || !assetStatus?.has_graphics || !assetStatus?.has_sound) {
      const proceed = confirm("Some assets may be missing. Launch anyway?");
      if (!proceed) return;
    }

    try {
      setStatusMessage(`Launching ${version.name}...`);
      await invoke("launch_version", { versionTag: version.tag });
      setStatusMessage("Game launched!");
    } catch (err) {
      console.error("Launch failed:", err);
      setStatusMessage(`Launch failed: ${err}`);
    }
  }

  async function handleDownloadAssets() {
    if (!selectedVersion) return;
    
    try {
      setStatusMessage("Downloading assets...");
      await invoke("download_assets", { versionTag: selectedVersion.tag });
    } catch (err) {
      console.error("Asset download failed:", err);
      setStatusMessage(`Asset download failed: ${err}`);
    }
  }

  async function handleSelectDirectory() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Install Directory",
      });
      if (selected) {
        setInstallDir(selected as string);
      }
    } catch (err) {
      console.error("Failed to select directory:", err);
    }
  }

  async function handleSaveSettings() {
    try {
      await invoke("set_config", {
        config: {
          install_dir: installDir,
          launch_options: launchOptions,
          auto_download_assets: config?.auto_download_assets ?? true,
        },
      });
      setConfig({
        ...config!,
        install_dir: installDir,
        launch_options: launchOptions,
      });
      setShowSettings(false);
      setStatusMessage("Settings saved");
    } catch (err) {
      console.error("Failed to save settings:", err);
    }
  }

  if (loading) {
    return (
      <div className="app loading">
        <div className="spinner"></div>
        <p>Loading releases...</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1>JGRPP Launcher</h1>
          <span className="platform-badge">{platform}</span>
        </div>
        <button className="settings-btn" onClick={() => setShowSettings(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
          </svg>
        </button>
      </header>

      <main className="main">
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2>Versions</h2>
            <button className="refresh-btn" onClick={loadVersions}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"></path>
              </svg>
            </button>
          </div>
          <div className="version-list">
            {versions.map((version) => (
              <div
                key={version.tag}
                className={`version-card ${selectedVersion?.tag === version.tag ? "selected" : ""}`}
                onClick={() => setSelectedVersion(version)}
              >
                <div className="version-info">
                  <span className="version-name">{version.name}</span>
                  <span className="version-date">{formatDate(version.date)}</span>
                </div>
                <div className="version-status">
                  {version.is_downloaded ? (
                    <span className="status-badge downloaded">Downloaded</span>
                  ) : (
                    <span className="status-badge">{formatBytes(version.size)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="content">
          {selectedVersion && (
            <>
              <div className="version-details">
                <h2>{selectedVersion.name}</h2>
                <p className="version-tag">{selectedVersion.tag}</p>
                <p className="version-meta">
                  Released: {formatDate(selectedVersion.date)} • Size: {formatBytes(selectedVersion.size)}
                </p>
                
                <div className="action-buttons">
                  {!selectedVersion.is_downloaded ? (
                    <button
                      className="btn primary"
                      onClick={() => handleDownload(selectedVersion)}
                      disabled={!!downloading}
                    >
                      {downloading === selectedVersion.tag ? "Downloading..." : "Download"}
                    </button>
                  ) : (
                    <>
                      <button
                        className="btn primary launch"
                        onClick={() => handleLaunch(selectedVersion)}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="5,3 19,12 5,21"></polygon>
                        </svg>
                        Launch
                      </button>
                      <button
                        className="btn danger"
                        onClick={() => handleRemove(selectedVersion)}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>

                {downloading === selectedVersion.tag && downloadProgress && (
                  <div className="progress-container">
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{ width: `${downloadProgress.progress_percent}%` }}
                      ></div>
                    </div>
                    <span className="progress-text">
                      {formatBytes(downloadProgress.downloaded_bytes)} / {formatBytes(downloadProgress.total_bytes)}
                      ({downloadProgress.progress_percent.toFixed(1)}%)
                    </span>
                  </div>
                )}
              </div>

              <div className="asset-section">
                <h3>Asset Status</h3>
                <div className="asset-grid">
                  <div className={`asset-item ${assetStatus?.has_lang ? "ok" : "missing"}`}>
                    <div className="asset-icon">
                      {assetStatus?.has_lang ? (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="20,6 9,17 4,12"></polyline>
                        </svg>
                      ) : (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="15" y1="9" x2="9" y2="15"></line>
                          <line x1="9" y1="9" x2="15" y2="15"></line>
                        </svg>
                      )}
                    </div>
                    <div className="asset-info">
                      <span className="asset-name">Language Files</span>
                      <span className="asset-status">{assetStatus?.has_lang ? "Present" : "Missing"}</span>
                    </div>
                  </div>

                  <div className={`asset-item ${assetStatus?.has_graphics ? "ok" : "missing"}`}>
                    <div className="asset-icon">
                      {assetStatus?.has_graphics ? (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="20,6 9,17 4,12"></polyline>
                        </svg>
                      ) : (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="15" y1="9" x2="9" y2="15"></line>
                          <line x1="9" y1="9" x2="15" y2="15"></line>
                        </svg>
                      )}
                    </div>
                    <div className="asset-info">
                      <span className="asset-name">Graphics</span>
                      <span className="asset-status">{assetStatus?.has_graphics ? "Present" : "Missing"}</span>
                    </div>
                  </div>

                  <div className={`asset-item ${assetStatus?.has_sound ? "ok" : "missing"}`}>
                    <div className="asset-icon">
                      {assetStatus?.has_sound ? (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="20,6 9,17 4,12"></polyline>
                        </svg>
                      ) : (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="15" y1="9" x2="9" y2="15"></line>
                          <line x1="9" y1="9" x2="15" y2="15"></line>
                        </svg>
                      )}
                    </div>
                    <div className="asset-info">
                      <span className="asset-name">Sound Effects</span>
                      <span className="asset-status">{assetStatus?.has_sound ? "Present" : "Missing"}</span>
                    </div>
                  </div>
                </div>

                {selectedVersion.is_downloaded && (!assetStatus?.has_lang || !assetStatus?.has_graphics || !assetStatus?.has_sound) && (
                  <button className="btn secondary" onClick={handleDownloadAssets}>
                    Download Missing Assets
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </main>

      <footer className="footer">
        <span className="status-message">{statusMessage || "Ready"}</span>
        <span className="version-count">{versions.length} versions available</span>
      </footer>

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Settings</h2>
            
            <div className="setting-group">
              <label>Install Directory</label>
              <div className="directory-input">
                <input
                  type="text"
                  value={installDir}
                  onChange={(e) => setInstallDir(e.target.value)}
                  readOnly
                />
                <button onClick={handleSelectDirectory}>Browse</button>
              </div>
            </div>

            <div className="setting-group">
              <label>Launch Options</label>
              <input
                type="text"
                value={launchOptions}
                onChange={(e) => setLaunchOptions(e.target.value)}
                placeholder="e.g., -v -g"
              />
            </div>

            <div className="modal-actions">
              <button className="btn secondary" onClick={() => setShowSettings(false)}>Cancel</button>
              <button className="btn primary" onClick={handleSaveSettings}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
