import joplin from 'api';
import { SettingItemType, MenuItemLocation } from 'api/types';
import { extractLinks, checkLink } from './linkChecker';

interface LinkHistory {
  [url: string]: { failures: number; lastChecked: string };
}

interface FolderNode {
  id: string;
  title: string;
  parent_id: string;
  children?: FolderNode[];
}

joplin.plugins.register({
  onStart: async () => {

    let cancelRequested = false;

    // 1. SETTINGS REGISTRATION
    await joplin.settings.registerSection('linkCheckerSection', {
      label: 'Link Checker',
      iconName: 'fas fa-link',
    });

    await joplin.settings.registerSettings({
      'maxFailures': {
        value: 3,
        type: SettingItemType.Int,
        section: 'linkCheckerSection',
        public: true,
        label: 'Failure threshold before marking a link as Dead',
      },
      'ignoredDomains': {
        value: 'localhost, 127.0.0.1, 10., 192.168., 172.16.',
        type: SettingItemType.String,
        section: 'linkCheckerSection',
        public: true,
        label: 'Ignored domains / IP prefixes (comma-separated)',
        description: 'URLs containing or starting with these domains or IPs will be skipped.',
      },
      'failureHistory': {
        value: '{}',
        type: SettingItemType.String,
        section: 'linkCheckerSection',
        public: false,
        label: 'Failure History',
      },
    });

    // 2. CREATE PANEL
    const panel = await joplin.views.panels.create('linkCheckerPanel');
    let isPanelVisible = true;

    // Genera l'albero gerarchico dei taccuini
    async function getFoldersDropdownHtml(selectedFolderId: string = 'ALL'): Promise<string> {
      let page = 1;
      let allFolders: FolderNode[] = [];
      while (true) {
        const res = await joplin.data.get(['folders'], { fields: ['id', 'title', 'parent_id'], page: page++ });
        allFolders = allFolders.concat(res.items);
        if (!res.has_more) break;
      }

      const folderMap: { [id: string]: FolderNode } = {};
      allFolders.forEach(f => {
        f.children = [];
        folderMap[f.id] = f;
      });

      const rootFolders: FolderNode[] = [];
      allFolders.forEach(f => {
        if (f.parent_id && folderMap[f.parent_id]) {
          folderMap[f.parent_id].children!.push(f);
        } else {
          rootFolders.push(f);
        }
      });

      function renderFolderOptions(nodes: FolderNode[], depth = 0): string {
        let html = '';
        for (const node of nodes) {
          const indent = '&nbsp;&nbsp;&nbsp;&nbsp;'.repeat(depth) + (depth > 0 ? '└─ ' : '');
          const isSelected = node.id === selectedFolderId ? 'selected' : '';
          html += `<option value="${node.id}" ${isSelected}>${indent}${node.title}</option>`;
          if (node.children && node.children.length > 0) {
            html += renderFolderOptions(node.children, depth + 1);
          }
        }
        return html;
      }

      const treeOptions = renderFolderOptions(rootFolders);
      const isAllSelected = selectedFolderId === 'ALL' ? 'selected' : '';
      return `
        <select id="folderSelect" class="joplin-input">
          <option value="ALL" ${isAllSelected}>-- All Notebooks (Root) --</option>
          ${treeOptions}
        </select>
      `;
    }

    // CSS con azzeramento del layout WebView e scrollbar personalizzata visibile
    function getPanelStyles(): string {
      return `
        <style>
          html, body {
            height: 100%;
            margin: 0;
            padding: 0;
            overflow: hidden;
            font-family: var(--joplin-font-family, sans-serif);
            font-size: var(--joplin-font-size, 13px);
            color: var(--joplin-color);
            background-color: var(--joplin-background-color);
          }
          .main-wrapper {
            display: flex;
            flex-direction: column;
            height: 100vh;
            box-sizing: border-box;
          }
          h3, h4 {
            color: var(--joplin-color);
            margin-top: 0;
          }
          .header-section {
            padding: 12px;
            flex-shrink: 0;
            border-bottom: 1px solid var(--joplin-divider-color, #444);
          }
          .results-section {
            padding: 12px;
            flex-grow: 1;
            overflow-y: scroll; /* Forza sempre la scrollbar visibile */
            max-height: calc(100vh - 180px); /* Limite tassativo per attivare lo scroll */
          }
          /* Custom Scrollbar per tematismi Webkit */
          .results-section::-webkit-scrollbar {
            width: 8px;
          }
          .results-section::-webkit-scrollbar-track {
            background: var(--joplin-background-color-2, #222);
          }
          .results-section::-webkit-scrollbar-thumb {
            background: var(--joplin-divider-color, #666);
            border-radius: 4px;
          }
          .joplin-input {
            width: 100%;
            padding: 8px;
            margin-bottom: 10px;
            background-color: var(--joplin-background-color-2, #2a2a2a);
            color: var(--joplin-color, #ffffff);
            border: 1px solid var(--joplin-divider-color, #555);
            border-radius: 4px;
            box-sizing: border-box;
            font-size: 13px;
            font-weight: 600;
            opacity: 1 !important;
            outline: none;
          }
          .joplin-input option {
            background-color: var(--joplin-background-color-2, #2a2a2a);
            color: var(--joplin-color, #ffffff);
            font-weight: normal;
          }
          .btn-primary {
            padding: 8px 12px;
            cursor: pointer;
            width: 100%;
            background-color: var(--joplin-button-background-color, #2b5c8f);
            color: var(--joplin-button-color, #ffffff);
            border: none;
            border-radius: 4px;
            font-weight: bold;
          }
          .btn-danger {
            padding: 8px 12px;
            cursor: pointer;
            width: 100%;
            background-color: #D32F2F;
            color: #ffffff;
            border: none;
            border-radius: 4px;
            font-weight: bold;
          }
          .btn-secondary {
            padding: 6px 10px;
            cursor: pointer;
            width: 100%;
            background-color: transparent;
            color: var(--joplin-color-faded, #888);
            border: 1px solid var(--joplin-divider-color, #555);
            border-radius: 4px;
            font-size: 11px;
            margin-top: 6px;
          }
          .btn-secondary:hover {
            color: var(--joplin-color);
            border-color: var(--joplin-color);
          }
          a {
            color: var(--joplin-url-color, #1565C0);
            text-decoration: underline;
          }
          .error-text {
            color: var(--joplin-color-error, #D32F2F);
            font-weight: bold;
          }
          .wayback-link {
            color: var(--joplin-color-correct, #2E7D32);
            font-weight: bold;
          }
          .result-item {
            border-bottom: 1px solid var(--joplin-divider-color, #ccc);
            padding: 10px 0;
          }
          .sub-text {
            color: var(--joplin-color-faded, #777);
            font-size: 11px;
          }
        </style>
      `;
    }

    async function renderInitialUI(messageText = '') {
      const dropdownHtml = await getFoldersDropdownHtml('ALL');
      await joplin.views.panels.setHtml(panel, `
        ${getPanelStyles()}
        <div class="main-wrapper">
          <div class="header-section">
            <h3>Link Checker</h3>
            <label style="font-size: 12px; display: block; margin-bottom: 4px; font-weight: bold;">Select Notebook:</label>
            ${dropdownHtml}
            <button id="scanBtn" class="btn-primary" onclick="const fId = document.getElementById('folderSelect').value; webviewApi.postMessage({name: 'startScan', folderId: fId});">Start Scan</button>
            <button id="resetBtn" class="btn-secondary" onclick="webviewApi.postMessage({name: 'resetHistory'});">Reset Failure History</button>
          </div>
          <div class="results-section" id="results">
            ${messageText}
          </div>
        </div>
      `);
    }

    await renderInitialUI();

    // 3. COMMAND & MENU TO SHOW/HIDE PANEL
    await joplin.commands.register({
      name: 'toggleLinkCheckerPanel',
      label: 'Toggle Link Checker Panel',
      execute: async () => {
        isPanelVisible = !isPanelVisible;
        await joplin.views.panels.show(panel, isPanelVisible);
      },
    });

    await joplin.views.menuItems.create('menuItemToggleLinkChecker', 'toggleLinkCheckerPanel', MenuItemLocation.View);

    // Helper per verificare se un URL deve essere ignorato
    function isUrlIgnored(urlString: string, ignoredList: string[]): boolean {
      try {
        const hostname = new URL(urlString).hostname.toLowerCase();
        return ignoredList.some(ignored => ignored && (hostname === ignored || hostname.startsWith(ignored) || hostname.includes(ignored)));
      } catch {
        return false;
      }
    }

    // 4. SCAN LOGIC
    async function runScan(targetFolderId: string) {
      cancelRequested = false;

      const maxFailures = await joplin.settings.value('maxFailures');
      const ignoredRaw = await joplin.settings.value('ignoredDomains');
      const ignoredList = (ignoredRaw || '').split(',').map((s: string) => s.trim().toLowerCase()).filter((s: string) => s.length > 0);

      const historyRaw = await joplin.settings.value('failureHistory');
      const history: LinkHistory = JSON.parse(historyRaw || '{}');
      const today = new Date().toISOString().split('T')[0];

      let notes: any[] = [];
      if (targetFolderId === 'ALL') {
        let page = 1;
        while (true) {
          const res = await joplin.data.get(['notes'], { fields: ['id', 'title', 'body'], page: page++ });
          notes = notes.concat(res.items);
          if (!res.has_more) break;
        }
      } else {
        const res = await joplin.data.get(['folders', targetFolderId, 'notes'], { fields: ['id', 'title', 'body'] });
        notes = res.items;
      }

      const totalNotes = notes.length;
      let resultsHtml = '';
      let wasStopped = false;

      for (let i = 0; i < totalNotes; i++) {
        if (cancelRequested) {
          wasStopped = true;
          break;
        }

        const note = notes[i];
        const progressPercent = Math.round(((i + 1) / totalNotes) * 100);

        const dropdownHtml = await getFoldersDropdownHtml(targetFolderId);
        await joplin.views.panels.setHtml(panel, `
          ${getPanelStyles()}
          <div class="main-wrapper">
            <div class="header-section">
              <h3>Link Checker</h3>
              <label style="font-size: 12px; display: block; margin-bottom: 4px; font-weight: bold;">Select Notebook:</label>
              ${dropdownHtml}
              <button class="btn-danger" onclick="webviewApi.postMessage({name: 'stopScan'});">Stop Scan</button>
              <button class="btn-secondary" disabled>Reset Failure History</button>
              
              <div style="margin-top: 10px;">
                <div style="font-size:12px; margin-bottom: 4px;">Scanning note ${i + 1} of ${totalNotes} (${progressPercent}%)</div>
                <progress value="${progressPercent}" max="100" style="width:100%;"></progress>
              </div>
            </div>
            <div class="results-section">
              ${resultsHtml}
            </div>
          </div>
        `);

        const links = extractLinks(note.body || '');
        for (const url of links) {
          if (cancelRequested) {
            wasStopped = true;
            break;
          }

          if (isUrlIgnored(url, ignoredList)) {
            continue;
          }

          const currentFails = history[url] ? history[url].failures : 0;
          const res = await checkLink(url, currentFails, maxFailures);

          history[url] = { failures: res.failCount, lastChecked: today };

          if (res.isDead) {
            resultsHtml += `
              <div class="result-item">
                <strong>Note:</strong> 
                <a href="#" onclick="webviewApi.postMessage({name: 'openNote', noteId: '${note.id}'})">${note.title}</a><br/>
                <span class="error-text">[Error ${res.status}]</span> <br/>
                <a href="${res.url}" target="_blank" style="word-break: break-all;">${res.url}</a><br/>
                <span class="sub-text">(Failed ${res.failCount} times)</span>
                ${res.waybackUrl ? `<br/><a href="${res.waybackUrl}" target="_blank" class="wayback-link">[Recover from Wayback Machine]</a>` : ''}
              </div>
            `;
          }
        }
      }

      await joplin.settings.setValue('failureHistory', JSON.stringify(history));

      const dropdownHtml = await getFoldersDropdownHtml(targetFolderId);
      let statusNotice = '';
      if (wasStopped) {
        statusNotice = '<p class="error-text" style="margin-bottom: 10px;">Scan stopped by user.</p>';
      }

      const finalMsg = resultsHtml ? resultsHtml : '<p class="wayback-link">All checked links are working!</p>';
      await joplin.views.panels.setHtml(panel, `
        ${getPanelStyles()}
        <div class="main-wrapper">
          <div class="header-section">
            <h3>Link Checker</h3>
            <label style="font-size: 12px; display: block; margin-bottom: 4px; font-weight: bold;">Select Notebook:</label>
            ${dropdownHtml}
            <button class="btn-primary" onclick="const fId = document.getElementById('folderSelect').value; webviewApi.postMessage({name: 'startScan', folderId: fId});">Start Scan</button>
            <button class="btn-secondary" onclick="webviewApi.postMessage({name: 'resetHistory'});">Reset Failure History</button>
          </div>
          <div class="results-section">
            ${statusNotice}
            <h4>Broken Links Found:</h4>
            ${finalMsg}
          </div>
        </div>
      `);
    }

    // MESSAGES HANDLER
    await joplin.views.panels.onMessage(panel, async (message: any) => {
      if (message.name === 'startScan') {
        await runScan(message.folderId);
      } else if (message.name === 'stopScan') {
        cancelRequested = true;
      } else if (message.name === 'openNote') {
        await joplin.commands.execute('openNote', message.noteId);
      } else if (message.name === 'resetHistory') {
        await joplin.settings.setValue('failureHistory', '{}');
        await renderInitialUI('<p style="color: var(--joplin-color-correct, #2E7D32);">Failure history cleared successfully!</p>');
      }
    });

  },
});