> **AI-generated**

# JGRPP Launcher

A cross-platform desktop application for managing and launching JGRPP (OpenTTD-patches) versions.

## Features

- Download, run, and remove different JGRPP versions
- Automatic asset management (languages, sounds, graphics)
- Cross-platform support (Windows, Linux)
- Clean, modern dark-themed UI

## Downloads

Pre-built binaries are available on the [Releases](https://github.com/olive/jgrpp-launcher/releases) page.

## Development

### Prerequisites

- Node.js 20+
- Rust 1.70+
- Platform-specific build dependencies:

**Linux:**
```bash
sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libxdo-dev libssl-dev
```

### Setup

```bash
npm install
```

### Run in Development

```bash
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

## Usage

1. Launch the application
2. Select a JGRPP version from the list
3. Click Download to install it
4. (Optional) Download required assets if prompted
5. Click Launch to start the game

## Configuration

Settings are stored in your user data directory:
- Windows: `%APPDATA%\com.jgrpp.launcher`
- Linux: `~/.local/share/com.jgrpp.launcher`

## License

MIT
