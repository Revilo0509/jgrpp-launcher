import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
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

interface DownloadProgress {
  version_tag: string;
  downloaded_bytes: number;
  total_bytes: number;
  progress_percent: number;
}

interface AppConfig {
  install_dir: string;
  launch_options: string;
  default_version: string | null;
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
  const [showSettings, setShowSettings] = useState(false);
  const [launchOptions, setLaunchOptions] = useState("");
  const [installDir, setInstallDir] = useState("");
  const [defaultVersion, setDefaultVersion] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState("");
  const [changelog, setChangelog] = useState<string>("");
  const [loadingChangelog, setLoadingChangelog] = useState(false);

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
    
    return () => {
      unlistenProgress.then(fn => fn());
      unlistenComplete.then(fn => fn());
    };
  }, []);

  useEffect(() => {
    if (selectedVersion) {
      loadChangelog(selectedVersion.tag);
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
      setDefaultVersion(cfg.default_version || "");
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

  async function loadChangelog(tag: string) {
    setLoadingChangelog(true);
    try {
      const log = await invoke<string>("fetch_changelog", { versionTag: tag });
      setChangelog(log);
    } catch (err) {
      console.error("Failed to load changelog:", err);
      setChangelog("Failed to load changelog");
    } finally {
      setLoadingChangelog(false);
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
    try {
      setStatusMessage(`Launching ${version.name}...`);
      await invoke("launch_version", { versionTag: version.tag });
      setStatusMessage("Game launched!");
    } catch (err) {
      console.error("Launch failed:", err);
      setStatusMessage(`Launch failed: ${err}`);
    }
  }

  async function handleLaunchDefault() {
    try {
      setStatusMessage("Launching default version...");
      await invoke("launch_default_version");
      setStatusMessage("Game launched!");
    } catch (err) {
      console.error("Launch failed:", err);
      setStatusMessage(`Launch failed: ${err}`);
    }
  }

  async function handleCreateShortcut() {
    if (!selectedVersion) return;
    
    try {
      setStatusMessage("Creating shortcut...");
      const path = await invoke<string>("create_shortcut", { versionTag: selectedVersion.tag });
      setStatusMessage(`Shortcut created: ${path}`);
    } catch (err) {
      console.error("Shortcut failed:", err);
      setStatusMessage(`Shortcut failed: ${err}`);
    }
  }

  async function handleCreateShortcutDefault() {
    if (!config?.default_version) return;
    
    try {
      setStatusMessage("Creating shortcut for default version...");
      const path = await invoke<string>("create_shortcut", { versionTag: config.default_version });
      setStatusMessage(`Shortcut created: ${path}`);
    } catch (err) {
      console.error("Shortcut failed:", err);
      setStatusMessage(`Shortcut failed: ${err}`);
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
          default_version: defaultVersion || null,
        },
      });
      setConfig({
        install_dir: installDir,
        launch_options: launchOptions,
        default_version: defaultVersion || null,
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
    <div className="app" data-tauri-drag-region>
      <header className="header" data-tauri-drag-region>
        <div className="header-left" data-tauri-drag-region>
          <h1>JGRPP Launcher</h1>
          <span className="platform-badge">{platform}</span>
        </div>
        <div className="header-actions">
          {config?.default_version && (
            <>
              <button className="btn-launch-default" onClick={handleLaunchDefault}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5,3 19,12 5,21"></polygon>
                </svg>
                Launch Default
              </button>
              <button className="btn-create-shortcut" onClick={handleCreateShortcutDefault} title="Create shortcut for default version">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"></path>
                  <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"></path>
                </svg>
              </button>
            </>
          )}
          <button className="settings-btn" onClick={() => setShowSettings(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
            </svg>
          </button>
          <div className="window-controls">
            <button className="window-btn minimize" onClick={async () => { const win = getCurrentWindow(); await win.minimize(); }}>
              <svg width="12" height="12" viewBox="0 0 12 12"><rect y="5" width="12" height="2" fill="currentColor"/></svg>
            </button>
            <button className="window-btn maximize" onClick={async () => { const win = getCurrentWindow(); const isMax = await win.isMaximized(); if (isMax) { await win.unmaximize(); } else { await win.maximize(); } }}>
              <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" stroke="currentColor" strokeWidth="2" fill="none"/></svg>
            </button>
            <button className="window-btn close" onClick={async () => { const win = getCurrentWindow(); await win.close(); }}>
              <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 1L11 11M1 11L11 1" stroke="currentColor" strokeWidth="2"/></svg>
            </button>
          </div>
        </div>
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
                className={`version-card ${selectedVersion?.tag === version.tag ? "selected" : ""} ${config?.default_version === version.tag ? "default" : ""}`}
                onClick={() => setSelectedVersion(version)}
              >
                <div className="version-info">
                  <span className="version-name">
                    {version.name}
                    {config?.default_version === version.tag && <span className="default-badge">Default</span>}
                  </span>
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
                        className="btn secondary"
                        onClick={handleCreateShortcut}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"></path>
                          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"></path>
                        </svg>
                        Desktop Shortcut
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

              <div className="changelog-section">
                <h3>Changelog</h3>
                {loadingChangelog ? (
                  <div className="changelog-loading">Loading changelog...</div>
                ) : (
                  <div className="changelog-content">
                    {changelog.split('\n').map((line, i) => {
                      if (line.startsWith('# ')) {
                        return <h4 key={i}>{line.replace('# ', '')}</h4>;
                      } else if (line.startsWith('## ')) {
                        return <h5 key={i}>{line.replace('## ', '')}</h5>;
                      } else if (line.startsWith('- ') || line.startsWith('* ')) {
                        return <li key={i}>{line.replace(/^[-*] /, '')}</li>;
                      } else if (line.trim()) {
                        return <p key={i}>{line}</p>;
                      }
                      return null;
                    })}
                  </div>
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

            <div className="setting-group">
              <label>Default Version</label>
              <select
                value={defaultVersion}
                onChange={(e) => setDefaultVersion(e.target.value)}
              >
                <option value="">None</option>
                {versions.filter(v => v.is_downloaded).map(v => (
                  <option key={v.tag} value={v.tag}>{v.name}</option>
                ))}
              </select>
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
