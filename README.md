# Joplin Link Checker Plugin

A powerful, native Joplin plugin to scan your notebooks for broken external links (link rot), manage exceptions, auto-fix typos, and recover lost pages with the Wayback Machine.

![Version](https://img.shields.io/npm/v/joplin-plugin-link-checker)
![License](https://img.shields.io/github/license/YOUR_USERNAME/joplin-plugin-link-checker)

---

## Key Features

- **Hierarchical Notebook Selection**: Scan your entire root database or select specific notebooks and sub-notebooks using a visual indented tree.
- **Smart Bot Detection & Anti-Block**: Built-in 6-second timeout per request and advanced Chromium headers (`Sec-Fetch-*`, `User-Agent`) to prevent false positives on Cloudflare-protected sites like Stack Overflow (HTTP 403 bypass).
- **Scan Summary & Persistent Results**: Get instant statistics on notes scanned, total links checked, and dead links found. Switch between views without losing your scan results using the **Last Results** button.
- **Wayback Machine Recovery**: One-click direct access to historical snapshots on `archive.org` for confirmed dead links.

---

## Action Buttons (Per Broken Link)

When a dead link is detected, the plugin provides immediate inline tools:

- **Ignore Domain**: Adds the link's domain/IP to your exception list and hides it from future scans.
- **Ignore Link**: Ignores the specific URL while storing the original note title and ID for tracking.
- **Fix Typo (`. `)**: Automatically edits the note via Joplin API to fix missing spaces after periods (e.g., converts `attento.se` into `attento. se`).
- **Delete Note**: Permanently deletes the note from your Joplin database (with confirmation).

---

## Panel Control Toolbar

Four compact navigation buttons in the side panel give you full management capabilities without opening global settings:

1. **Last Results**: Instantly returns to the resoconto/summary of your latest scan.
2. **Ignored Dom.**: View all blacklisted domains, add new domains/IP prefixes manually, or remove existing ones.
3. **Ignored Links**: View all ignored URLs along with direct links to their source notes, add URLs manually, or remove them.
4. **Reset Hist.**: Adjust your **Max Failures Threshold** (how many times a link must fail before being marked dead) and clear the retry history cache.

---

## Installation

### Method 1: Official Plugin Store (Recommended)
1. Open Joplin and navigate to **Tools** > **Options** > **Plugins** (on macOS: **Joplin** > **Preferences** > **Plugins**).
2. Search for `Link Checker`.
3. Click **Install** and restart Joplin.

### Method 2: Manual Installation
1. Download the latest `.jpl` file from the [Releases](https://github.com/YOUR_USERNAME/joplin-plugin-link-checker/releases) section.
2. In Joplin, go to **Tools** > **Options** > **Plugins**.
3. Click the gear icon (**Manage plugins**) in the top right and select **Install from file**.
4. Select the downloaded `.jpl` file and restart Joplin.

---

## Usage Guide

1. Open the panel via **View** > **Toggle Link Checker Panel**.
2. Select your target notebook from the dropdown hierarchy.
3. Click **Start Scan** (or click **Stop Scan** at any time to interrupt and view partial results).
4. Review found broken links and use inline action buttons to resolve, ignore, or fix typos directly.

---

## License

MIT License. Feel free to contribute or report issues on the GitHub repository!