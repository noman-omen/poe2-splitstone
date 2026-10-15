# Splitstone desktop (Electron)

Developer notes for the Windows / Linux desktop shell. Players should use the
installer from [GitHub Releases](https://github.com/noman-omen/poe2-splitstone/releases/latest) — see the main README **Download** section.

## Develop

```bash
cd desktop
npm install
npm start          # loads the repo’s index.html
npm test           # log parser + path + overlay-state unit tests
```

## Build

```bash
npm run dist:linux   # AppImage (smoke-test on Linux CI / this machine)
npm run dist:win     # NSIS installer + portable exe (run on Windows or in the release workflow)
```

Artifacts land in `desktop/dist/`. The GitHub Actions workflow `.github/workflows/desktop-release.yml` builds on `windows-latest` when you push a `v*` tag and attaches the installers to the Release.

## Security

- `contextIsolation: true`, `nodeIntegration: false`, sandboxed renderers
- Preload exposes a minimal `window.splitstoneDesktop` API
- File reads are limited to a user-chosen `Client.txt` (basename check)
- Overlay is frameless, always-on-top, click-through (`setIgnoreMouseEvents`)

## Legacy

The Python helper under `helper/` remains supported for browser-only users.
