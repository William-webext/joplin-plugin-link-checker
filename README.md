# Joplin Link Checker Plugin

A Joplin plugin to detect broken external links (link rot) across your notebooks, featuring retry thresholds, customizable ignored domains/IPs, and Internet Archive Wayback Machine integration.

## Features
- **Notebook & Root Scanning**: Scan individual notebooks or your entire database.
- **Hierarchical Tree Selection**: Clearly select sub-notebooks with indented visual hierarchy.
- **Retry Threshold**: Avoid false positives by configuring how many times a link must fail before being flagged as dead.
- **Domain Whitelist**: Automatically skip local IPs (`127.0.0.1`, `192.168.x.x`) or custom domains.
- **Wayback Machine Integration**: Get direct links to historical snapshots of broken pages.
- **Theme Native**: Full support for Dark and Light Joplin themes.

## Installation
Search for **Link Checker** in Joplin's plugin settings (`Tools` > `Options` > `Plugins`) or install the `.jpl` file manually from releases.