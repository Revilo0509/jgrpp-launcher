# JGRPP Launcher - Specification Document

## 1. Project Overview

- **Project Name**: JGRPP Launcher
- **Type**: Cross-platform Desktop Application
- **Core Functionality**: A version manager and launcher for JGRPP (OpenTTD-patches) that can download, run, and remove different versions of the game. Ensures required assets (languages, sounds, graphics) are available before launching.
- **Target Users**: OpenTTD/JGRPP players who want to manage multiple versions of the game easily.

## 2. UI/UX Specification

### Layout Structure

- **Single Window Application**: Main window with responsive layout
- **Header**: App title, current platform indicator, settings gear icon
- **Main Content**: 
  - Left panel: Version list with download status
  - Right panel: Version details and actions
- **Footer**: Status bar showing download progress, disk usage

### Visual Design

- **Color Palette**:
  - Primary Background: `#1a1a2e` (dark navy)
  - Secondary Background: `#16213e` (darker blue)
  - Card Background: `#0f3460` (deep blue)
  - Accent Color: `#e94560` (coral red)
  - Success Color: `#00d9a0` (mint green)
  - Warning Color: `#f39c12` (amber)
  - Text Primary: `#eaeaea` (off-white)
  - Text Secondary: `#a0a0a0` (gray)

- **Typography**:
  - Font Family: System fonts (Segoe UI on Windows, SF Pro on macOS, Ubuntu on Linux)
  - Headings: 24px bold
  - Subheadings: 18px semibold
  - Body: 14px regular
  - Small: 12px regular

- **Spacing**: 8px base unit, multiples of 8 for padding/margins

- **Visual Effects**:
  - Cards with subtle box-shadow: `0 4px 6px rgba(0,0,0,0.3)`
  - Smooth transitions on hover (200ms ease)
  - Progress bars with gradient fill
  - Hover effects: slight scale (1.02) and brightness increase

### Components

1. **Version Card**:
   - Version number (bold)
   - Release date
   - Download size
   - Status badge (Not Downloaded / Downloaded / Running)
   - Download/Delete button
   - Launch button (only when downloaded)

2. **Status Bar**:
   - Current action description
   - Progress bar (when downloading)
   - Disk usage indicator

3. **Settings Panel** (modal or slide-out):
   - Install directory path
   - Custom launch options
   - Auto-download assets toggle

4. **Asset Status Panel**:
   - Shows status of required files (lang, sound, graphics)
   - Download buttons for missing assets
   - "Check for updates" button

## 3. Functional Specification

### Core Features

1. **Version Fetching**:
   - Fetch release list from GitHub API
   - Parse assets for current platform
   - Display all available versions

2. **Download Management**:
   - Download version zip/dmg/deb based on platform
   - Show progress with percentage
   - Resume support for interrupted downloads
   - Extract archives to install directory

3. **Asset Management**:
   - Check for required files in game directory:
     - `lang/` directory (language files)
     - `gm/` directory (graphics - sample.cat)
     - `sfx/` directory (sound effects)
   - Download missing assets from OpenTTD CDN
   - Provide bundled base set option

4. **Launch Functionality**:
   - Launch OpenTTD executable with proper working directory
   - Pass through command-line arguments
   - Track running status

5. **Version Removal**:
   - Delete installed version files
   - Keep shared assets (if multiple versions)

### Platform-Specific Behavior

- **Windows**:
  - Detect Windows version (x64, x86, ARM64)
  - Download `.zip` files
  - Use `openttd.exe` as executable

- **macOS**:
  - Download `.dmg` files
  - Mount DMG and copy app to Applications
  - Use `.app` bundle

- **Linux**:
  - Download `.tar.xz` or `.deb` packages
  - Extract to ~/.local/share/jgrpp-launcher/versions/

### Data Flow

1. App starts → Load cached versions → Fetch fresh from GitHub
2. User clicks download → Backend downloads → Extracts → Updates status
3. User clicks launch → Check assets → Run executable → Update status to "Running"
4. User clicks remove → Confirm dialog → Delete files → Update status

### Key Modules (Rust Backend)

- `github.rs`: GitHub API client for releases
- `downloader.rs`: Async file downloader with progress
- `extractor.rs`: Archive extraction (zip, tar.xz, dmg)
- `launcher.rs`: Process spawning and management
- `assets.rs`: Asset detection and download
- `config.rs`: Settings persistence

### Edge Cases

- Network failure during download → Retry with resume
- Disk full → Show error, cleanup partial files
- Version already running → Disable launch, show "Running"
- Corrupted download → Re-download with force flag
- Missing assets → Prompt user before launch

## 4. Acceptance Criteria

- [ ] App launches and displays version list within 3 seconds
- [ ] All available versions are shown with correct platform assets
- [ ] Download shows real progress and completes successfully
- [ ] Extracted game launches without errors
- [ ] Missing assets are detected and can be downloaded
- [ ] Version removal works and frees disk space
- [ ] App works on Windows, macOS, and Linux
- [ ] Single .exe file generated for Windows
- [ ] UI is responsive and shows all states clearly

## 5. Technical Stack

- **Framework**: Tauri 2.x (Rust backend + WebView frontend)
- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: CSS Modules or styled-components
- **State Management**: React hooks (useState, useEffect)
- **Build**: Tauri bundler for single executable
