# Agent Browser Recorder 🦀

A Chrome extension that records your web interactions and translates them into [agent-browser](https://agent-browser.dev/) CLI commands.

## How It Works

1. **Click Record** — Start capturing your clicks, typing, selections, scrolls, and navigation
2. **Browse normally** — The extension tracks every interaction with smart element selectors
3. **Stop & Export** — Get a ready-to-run shell script or batch JSON of `agent-browser` commands

## Features

- 🎯 **Smart Selectors** — Prioritizes `data-testid`, ARIA roles, labels, and accessible names over fragile CSS paths
- ⌨️ **Full Interaction Capture** — Clicks, typing, selects, checkboxes, scrolls, keyboard shortcuts, navigation
- 🔴 **Visual Feedback** — Recording indicator and click highlights on the page
- 📤 **Multiple Export Formats** — Shell script, batch JSON, or copy commands to clipboard
- ⚡ **Keyboard Shortcut** — `Ctrl+Shift+R` (Mac: `Cmd+Shift+R`) to toggle recording

## Installation

### From Source (Development)

```bash
# Clone the repo
git clone https://github.com/your-username/agent-browser-recorder.git
cd agent-browser-recorder

# Generate icons (requires Pillow)
python3 generate_icons.py

# Build
chmod +x build.sh
./build.sh
```

Then in Chrome:
1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `build/` directory

## Usage

1. Navigate to the page you want to record
2. Click the extension icon (🦀) in the toolbar
3. Click **Record** (or press `Ctrl+Shift+R`)
4. Interact with the page as you normally would
5. Click **Stop** when done
6. Export as:
   - **Shell Script** — A `#!/bin/bash` script with `agent-browser` commands
   - **Batch JSON** — A JSON array for `agent-browser batch --json`
   - **Copy Commands** — Raw commands to clipboard

## Generated Command Examples

| Your Action | Generated Command |
|---|---|
| Click "Submit" button | `agent-browser find text 'Submit' click` |
| Type in email field | `agent-browser find label 'Email' 'user@example.com'` |
| Select dropdown option | `agent-browser select [name='country'] 'US'` |
| Check a checkbox | `agent-browser check [data-testid='agree']` |
| Scroll down 500px | `agent-browser scroll down 500` |
| Navigate to URL | `agent-browser open 'https://example.com'` |
| Press Enter | `agent-browser press Enter` |

## Architecture

```
src/
├── manifest.json              # Chrome Extension Manifest V3
├── background/
│   └── service-worker.js      # Recording state management
├── content/
│   ├── recorder.js            # Event capture & selector generation
│   └── recorder.css           # Recording indicator styles
├── popup/
│   ├── popup.html             # Extension popup UI
│   ├── popup.css              # Popup styles
│   └── popup.js               # Popup logic & export
├── lib/
│   ├── selector.js            # CSS selector builder & AB locator strategy
│   └── translator.js          # Action → agent-browser command translation
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

## Selector Strategy

The extension uses a priority-based selector strategy to generate the most robust `agent-browser` commands:

1. `data-testid` → `find testid <id> <action>`
2. ARIA role + name → `find role <role> <action> --name <name>`
3. Label text → `find label <text> <action>`
4. Placeholder → `find placeholder <text> <action>`
5. Link/button text → `find text <text> <action>`
6. CSS selector (fallback) → direct CSS selector

## Requirements

- Chrome 110+ (Manifest V3 support)
- [agent-browser CLI](https://agent-browser.dev/) installed for running exported commands

## License

MIT
