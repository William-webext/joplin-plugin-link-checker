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
      'ignoredUrls': {
        value: '',
        type: SettingItemType.String,
        section: 'linkCheckerSection',
        public: true,
        label: 'Ignored specific URLs (comma-separated)',
        description: 'Manual list of exact URLs to skip.',
      },
      'ignoredLinksMetadata': {
        value: '[]',
        type: SettingItemType.String,
        section: 'linkCheckerSection',
        public: false,
        label: 'Ignored Links Metadata',
      },
      'lastScanCache': {
        value: '<p class="sub-text">No previous scan data available.</p>',
        type: SettingItemType.String,
        section: 'linkCheckerSection',
        public: false,
        label: 'Last Scan Cache',
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

    function escapeHtml(text: string) {
      return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    function getPanelStyles(): string {
      return `
        <style>
          html, body {
            height: 100%; margin: 0; padding: 0; overflow: hidden;
            font-family: var(--joplin-font-family, sans-serif);
            font-size: var(--joplin-font-size, 13px);
            color: var(--joplin-color); background-color: var(--joplin-background-color);
          }
          .main-wrapper { display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; }
          h3, h4 { color: var(--joplin-color); margin-top: 0; }
          .header-section { padding: 12px; flex-shrink: 0; border-bottom: 1px solid var(--joplin-divider-color, #444); }
          .results-section { padding: 12px; flex-grow: 1; overflow-y: scroll; max-height: calc(100vh - 200px); }
          .results-section::-webkit-scrollbar { width: 8px; }
          .results-section::-webkit-scrollbar-track { background: var(--joplin-background-color-2, #222); }
          .results-section::-webkit-scrollbar-thumb { background: var(--joplin-divider-color, #666); border-radius: 4px; }
          
          .joplin-input { width: 100%; padding: 8px; margin-bottom: 10px; background-color: var(--joplin-background-color-2, #2a2a2a); color: var(--joplin-color, #ffffff); border: 1px solid var(--joplin-divider-color, #555); border-radius: 4px; box-sizing: border-box; font-size: 13px; font-weight: 600; outline: none; }
          .joplin-input option { background-color: var(--joplin-background-color-2, #2a2a2a); color: var(--joplin-color, #ffffff); font-weight: normal; }
          
          .btn-primary { padding: 8px 12px; cursor: pointer; width: 100%; background-color: var(--joplin-button-background-color, #2b5c8f); color: var(--joplin-button-color, #ffffff); border: none; border-radius: 4px; font-weight: bold; }
          .btn-danger { padding: 8px 12px; cursor: pointer; width: 100%; background-color: #D32F2F; color: #ffffff; border: none; border-radius: 4px; font-weight: bold; }
          
          .btn-group { display: flex; justify-content: space-between; gap: 4px; margin-top: 10px; }
          .btn-small { flex: 1; padding: 5px 2px; cursor: pointer; background-color: transparent; color: var(--joplin-color-faded, #888); border: 1px solid var(--joplin-divider-color, #555); border-radius: 4px; font-size: 10px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .btn-small:hover:not(:disabled) { color: var(--joplin-color); border-color: var(--joplin-color); }
          .btn-small:disabled { opacity: 0.5; cursor: not-allowed; }
          
          .btn-action { padding: 4px 8px; font-size: 11px; background-color: var(--joplin-background-color-2); color: var(--joplin-color); border: 1px solid var(--joplin-divider-color); border-radius: 3px; cursor: pointer; margin-right: 4px; margin-top: 5px; }
          .btn-action:hover { background-color: var(--joplin-divider-color); }
          .btn-remove { background-color: #D32F2F; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 10px; flex-shrink: 0; }
          
          .summary-box { background-color: var(--joplin-background-color-2, #2a2a2a); padding: 10px; border-radius: 4px; margin-bottom: 12px; border: 1px solid var(--joplin-divider-color, #444); font-size: 12px; }
          .form-box { background-color: var(--joplin-background-color-2, #2a2a2a); padding: 10px; border-radius: 4px; margin-bottom: 15px; border: 1px solid var(--joplin-divider-color, #444); }
          .list-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--joplin-divider-color, #ccc); font-size: 12px; }
          .list-item-text { word-break: break-all; margin-right: 10px; }
          
          a { color: var(--joplin-url-color, #1565C0); text-decoration: underline; }
          .error-text { color: var(--joplin-color-error, #D32F2F); font-weight: bold; }
          .wayback-link { color: var(--joplin-color-correct, #2E7D32); font-weight: bold; }
          .result-item { border-bottom: 1px solid var(--joplin-divider-color, #ccc); padding: 10px 0; }
          .sub-text { color: var(--joplin-color-faded, #777); font-size: 11px; }
        </style>
      `;
    }

    function getHeaderHtml(dropdownHtml: string, isScanning: boolean = false, progressPercent: number = 0, currentIndex: number = 0, totalNotes: number = 0) {
      const scanBtnAction = isScanning ? "webviewApi.postMessage({name: 'stopScan'});" : "const fId = document.getElementById('folderSelect').value; webviewApi.postMessage({name: 'startScan', folderId: fId});";
      
      let progressHtml = '';
      if (isScanning) {
        progressHtml = `
          <div style="margin-top: 10px;">
            <div style="font-size:12px; margin-bottom: 4px;">Scanning note ${currentIndex} of ${totalNotes} (${progressPercent}%)</div>
            <progress value="${progressPercent}" max="100" style="width:100%;"></progress>
          </div>
        `;
      }

      return `
        <div class="header-section">
          <h3>Link Checker</h3>
          <label style="font-size: 12px; display: block; margin-bottom: 4px; font-weight: bold;">Select Notebook:</label>
          ${dropdownHtml}
          <button class="${isScanning ? 'btn-danger' : 'btn-primary'}" onclick="${scanBtnAction}">${isScanning ? 'Stop Scan' : 'Start Scan'}</button>
          
          ${progressHtml}

          <div class="btn-group">
            <button class="btn-small" ${isScanning ? 'disabled' : ''} onclick="const fId = document.getElementById('folderSelect').value; webviewApi.postMessage({name: 'showLastScan', folderId: fId});" title="Last Scan Results">Last Results</button>
            <button class="btn-small" ${isScanning ? 'disabled' : ''} onclick="const fId = document.getElementById('folderSelect').value; webviewApi.postMessage({name: 'showDomains', folderId: fId});" title="Show Ignored Domains">Ignored Dom.</button>
            <button class="btn-small" ${isScanning ? 'disabled' : ''} onclick="const fId = document.getElementById('folderSelect').value; webviewApi.postMessage({name: 'showLinks', folderId: fId});" title="Show Ignored Links">Ignored Links</button>
            <button class="btn-small" ${isScanning ? 'disabled' : ''} onclick="const fId = document.getElementById('folderSelect').value; webviewApi.postMessage({name: 'showReset', folderId: fId});" title="Reset History & Settings">Reset Hist.</button>
          </div>
        </div>
      `;
    }

    async function renderInitialUI(messageText = '') {
      const dropdownHtml = await getFoldersDropdownHtml('ALL');
      const content = messageText || await joplin.settings.value('lastScanCache');
      await joplin.views.panels.setHtml(panel, `
        ${getPanelStyles()}
        <div class="main-wrapper">
          ${getHeaderHtml(dropdownHtml)}
          <div class="results-section" id="results">${content}</div>
        </div>
      `);
    }

    async function renderResetView(folderId: string, feedbackMsg: string = '') {
      const dropdownHtml = await getFoldersDropdownHtml(folderId);
      const maxFailures = await joplin.settings.value('maxFailures');

      const content = `
        <h4 style="margin-bottom: 10px;">Failure History & Threshold</h4>
        ${feedbackMsg ? `<div style="margin-bottom: 10px;">${feedbackMsg}</div>` : ''}

        <div class="form-box">
          <label style="font-size: 11px; font-weight: bold; display: block; margin-bottom: 4px;">Max Failures Threshold:</label>
          <input type="number" id="maxFailuresInput" class="joplin-input" value="${maxFailures}" min="1" max="20" style="margin-bottom: 8px;"/>
          <button class="btn-primary" onclick="const val = document.getElementById('maxFailuresInput').value; webviewApi.postMessage({name: 'saveMaxFailures', value: val, folderId: document.getElementById('folderSelect').value});">Save Threshold</button>
        </div>

        <div class="form-box">
          <label style="font-size: 11px; font-weight: bold; display: block; margin-bottom: 4px;">Clear Scan History:</label>
          <p class="sub-text" style="margin-top:0; margin-bottom: 8px;">Resets accumulated failure counts for all checked links.</p>
          <button class="btn-danger" onclick="webviewApi.postMessage({name: 'confirmResetHistory', folderId: document.getElementById('folderSelect').value});">Reset Failure History</button>
        </div>
      `;

      await joplin.views.panels.setHtml(panel, `${getPanelStyles()}<div class="main-wrapper">${getHeaderHtml(dropdownHtml)}<div class="results-section">${content}</div></div>`);
    }

    async function renderDomainsView(folderId: string) {
      const dropdownHtml = await getFoldersDropdownHtml(folderId);
      const current = await joplin.settings.value('ignoredDomains');
      const list = current.split(',').map((s: string) => s.trim()).filter(Boolean);
      
      let itemsHtml = `
        <h4 style="margin-bottom: 10px;">Ignored Domains</h4>
        <div class="form-box">
          <label style="font-size: 11px; font-weight: bold; display: block; margin-bottom: 4px;">Add Domain or IP Prefix:</label>
          <input type="text" id="newDomainInput" class="joplin-input" placeholder="e.g. example.com or 192.168." style="margin-bottom: 8px;"/>
          <button class="btn-primary" onclick="const val = document.getElementById('newDomainInput').value.trim(); if(val) webviewApi.postMessage({name: 'addDomainManual', domain: encodeURIComponent(val), folderId: document.getElementById('folderSelect').value});">Add Domain</button>
        </div>
      `;

      if (list.length === 0) {
        itemsHtml += '<p class="sub-text">No ignored domains yet.</p>';
      } else {
        for (const domain of list) {
          const safeDomain = encodeURIComponent(domain);
          itemsHtml += `
            <div class="list-item">
              <span class="list-item-text">${escapeHtml(domain)}</span>
              <button class="btn-remove" onclick="webviewApi.postMessage({name: 'removeDomain', domain: '${safeDomain}', folderId: document.getElementById('folderSelect').value})">Remove</button>
            </div>
          `;
        }
      }

      await joplin.views.panels.setHtml(panel, `${getPanelStyles()}<div class="main-wrapper">${getHeaderHtml(dropdownHtml)}<div class="results-section">${itemsHtml}</div></div>`);
    }

    async function renderLinksView(folderId: string) {
      const dropdownHtml = await getFoldersDropdownHtml(folderId);
      const current = await joplin.settings.value('ignoredLinksMetadata');
      let list = [];
      try { list = JSON.parse(current); } catch { list = []; }
      
      let itemsHtml = `
        <h4 style="margin-bottom: 10px;">Ignored Links</h4>
        <div class="form-box">
          <label style="font-size: 11px; font-weight: bold; display: block; margin-bottom: 4px;">Add URL to Ignore:</label>
          <input type="text" id="newLinkInput" class="joplin-input" placeholder="https://example.com/page" style="margin-bottom: 8px;"/>
          <button class="btn-primary" onclick="const val = document.getElementById('newLinkInput').value.trim(); if(val) webviewApi.postMessage({name: 'addLinkManual', url: encodeURIComponent(val), folderId: document.getElementById('folderSelect').value});">Add Link</button>
        </div>
      `;

      if (list.length === 0) {
        itemsHtml += '<p class="sub-text">No manually ignored links yet.</p>';
      } else {
        for (const item of list) {
          const safeUrl = encodeURIComponent(item.url);
          const noteLabel = item.noteId ? `<a href="#" onclick="webviewApi.postMessage({name: 'openNote', noteId: '${item.noteId}'})" style="font-weight: bold; font-size: 13px;">${escapeHtml(item.noteTitle)}</a>` : `<span style="font-weight: bold; font-size: 13px;">${escapeHtml(item.noteTitle)}</span>`;
          
          itemsHtml += `
            <div class="list-item" style="flex-direction: column; align-items: flex-start;">
              <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                ${noteLabel}
                <button class="btn-remove" onclick="webviewApi.postMessage({name: 'removeLink', url: '${safeUrl}', folderId: document.getElementById('folderSelect').value})">Remove</button>
              </div>
              <a href="${item.url}" target="_blank" class="sub-text" style="word-break: break-all; text-decoration: none;">${escapeHtml(item.url)}</a>
            </div>
          `;
        }
      }

      await joplin.views.panels.setHtml(panel, `${getPanelStyles()}<div class="main-wrapper">${getHeaderHtml(dropdownHtml)}<div class="results-section">${itemsHtml}</div></div>`);
    }

    await renderInitialUI();

    await joplin.commands.register({
      name: 'toggleLinkCheckerPanel',
      label: 'Toggle Link Checker Panel',
      execute: async () => {
        isPanelVisible = !isPanelVisible;
        await joplin.views.panels.show(panel, isPanelVisible);
      },
    });

    await joplin.views.menuItems.create('menuItemToggleLinkChecker', 'toggleLinkCheckerPanel', MenuItemLocation.View);

    function isUrlIgnored(urlString: string, ignoredList: string[]): boolean {
      try {
        const hostname = new URL(urlString).hostname.toLowerCase();
        return ignoredList.some(ignored => ignored && (hostname === ignored || hostname.startsWith(ignored) || hostname.includes(ignored)));
      } catch { return false; }
    }

    // SCAN LOGIC
    async function runScan(targetFolderId: string) {
      cancelRequested = false;
      const maxFailures = await joplin.settings.value('maxFailures');
      
      const ignoredRaw = await joplin.settings.value('ignoredDomains');
      const ignoredList = (ignoredRaw || '').split(',').map((s: string) => s.trim().toLowerCase()).filter((s: string) => s.length > 0);

      const ignoredUrlsRaw = await joplin.settings.value('ignoredUrls');
      const ignoredUrlsList = (ignoredUrlsRaw || '').split(',').map((s: string) => s.trim().toLowerCase()).filter((s: string) => s.length > 0);
      
      const ignoredLinksMetaRaw = await joplin.settings.value('ignoredLinksMetadata');
      let ignoredLinksMeta = [];
      try { ignoredLinksMeta = JSON.parse(ignoredLinksMetaRaw); } catch { ignoredLinksMeta = []; }
      const jsonIgnoredUrls = ignoredLinksMeta.map((i: any) => i.url.toLowerCase());

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
      let totalLinksChecked = 0;
      let totalDeadLinksFound = 0;
      let resultsHtml = '';
      let wasStopped = false;
      let globalLinkIndex = 0;

      for (let i = 0; i < totalNotes; i++) {
        if (cancelRequested) { wasStopped = true; break; }

        const note = notes[i];
        const progressPercent = Math.round(((i + 1) / totalNotes) * 100);
        const dropdownHtml = await getFoldersDropdownHtml(targetFolderId);
        
        await joplin.views.panels.setHtml(panel, `
          ${getPanelStyles()}
          <div class="main-wrapper">
            ${getHeaderHtml(dropdownHtml, true, progressPercent, i + 1, totalNotes)}
            <div class="results-section">${resultsHtml}</div>
          </div>
        `);

        const links = extractLinks(note.body || '');
        for (const url of links) {
          globalLinkIndex++;
          if (cancelRequested) { wasStopped = true; break; }

          if (ignoredUrlsList.includes(url.toLowerCase()) || jsonIgnoredUrls.includes(url.toLowerCase()) || isUrlIgnored(url, ignoredList)) {
            continue;
          }

          totalLinksChecked++;
          const currentFails = history[url] ? history[url].failures : 0;
          const res = await checkLink(url, currentFails, maxFailures);

          history[url] = { failures: res.failCount, lastChecked: today };

          if (res.isDead) {
            totalDeadLinksFound++;
            const safeUrl = encodeURIComponent(res.url);
            const safeTitle = encodeURIComponent(note.title);
            resultsHtml += `
              <div class="result-item" id="link-res-${globalLinkIndex}">
                <strong>Note:</strong> <a href="#" onclick="webviewApi.postMessage({name: 'openNote', noteId: '${note.id}'})">${escapeHtml(note.title)}</a><br/>
                <span class="error-text">[Error ${res.status}]</span> <br/>
                <a href="${res.url}" target="_blank" style="word-break: break-all;">${escapeHtml(res.url)}</a><br/>
                <span class="sub-text">(Failed ${res.failCount} times)</span>
                ${res.waybackUrl ? `<br/><a href="${res.waybackUrl}" target="_blank" class="wayback-link">[Recover from Wayback Machine]</a>` : ''}
                
                <div style="margin-top: 6px;">
                  <button class="btn-action" onclick="document.getElementById('link-res-${globalLinkIndex}').style.display='none'; webviewApi.postMessage({name: 'ignoreDomain', url: '${safeUrl}'});">Ignore Domain</button>
                  <button class="btn-action" onclick="document.getElementById('link-res-${globalLinkIndex}').style.display='none'; webviewApi.postMessage({name: 'ignoreUrl', url: '${safeUrl}', noteId: '${note.id}', noteTitle: '${safeTitle}'});">Ignore Link</button>
                  <button class="btn-action" onclick="document.getElementById('link-res-${globalLinkIndex}').style.display='none'; webviewApi.postMessage({name: 'fixInNote', noteId: '${note.id}', url: '${safeUrl}'});">Fix Typo (. )</button>
                  <button class="btn-action" style="color: var(--joplin-color-error, #D32F2F);" onclick="if(confirm('Are you sure you want to delete note &quot;${escapeHtml(note.title)}&quot;?')) { document.getElementById('link-res-${globalLinkIndex}').style.display='none'; webviewApi.postMessage({name: 'deleteNote', noteId: '${note.id}'}); }">Delete Note</button>
                </div>
              </div>
            `;
          }
        }
      }

      await joplin.settings.setValue('failureHistory', JSON.stringify(history));

      const dropdownHtml = await getFoldersDropdownHtml(targetFolderId);
      let statusNotice = wasStopped ? '<p class="error-text" style="margin-bottom: 10px;">Scan stopped by user.</p>' : '';
      
      const summaryHtml = `
        <div class="summary-box">
          <strong>Scan Summary:</strong><br/>
          • Notes scanned: <b>${totalNotes}</b><br/>
          • Links checked: <b>${totalLinksChecked}</b><br/>
          • Dead links found: <b style="color: ${totalDeadLinksFound > 0 ? 'var(--joplin-color-error, #D32F2F)' : 'var(--joplin-color-correct, #2E7D32)'};">${totalDeadLinksFound}</b>
        </div>
      `;

      const finalMsg = resultsHtml ? resultsHtml : '<p class="wayback-link">All checked links are working!</p>';
      const fullViewHtml = `
        ${statusNotice}
        ${summaryHtml}
        <h4>Broken Links Found:</h4>
        ${finalMsg}
      `;

      await joplin.settings.setValue('lastScanCache', fullViewHtml);

      await joplin.views.panels.setHtml(panel, `
        ${getPanelStyles()}
        <div class="main-wrapper">
          ${getHeaderHtml(dropdownHtml)}
          <div class="results-section">
            ${fullViewHtml}
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
      
      // ELIMINA NOTA
      } else if (message.name === 'deleteNote') {
        try {
          await joplin.data.delete(['notes', message.noteId]);
        } catch (e) {
          console.error("Error deleting note:", e);
        }

      // FIX TYPO NELLA NOTA
      } else if (message.name === 'fixInNote') {
        try {
          const noteId = message.noteId;
          const urlString = decodeURIComponent(message.url);
          const note = await joplin.data.get(['notes', noteId], { fields: ['id', 'body'] });
          
          if (note && note.body) {
            let body = note.body;
            const cleanUrl = urlString.replace(/^https?:\/\//i, '');
            const fixedText = cleanUrl.replace(/\.([a-zA-Z0-9])/g, '. $1');
            
            function escapeRegExp(str: string) {
              return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }

            const mdLinkRegex = new RegExp(`\\[[^\\]]*\\]\\(${escapeRegExp(urlString)}\\)`, 'gi');
            body = body.replace(mdLinkRegex, fixedText);
            body = body.replace(new RegExp(escapeRegExp(urlString), 'gi'), fixedText);
            body = body.replace(new RegExp(escapeRegExp(cleanUrl), 'gi'), fixedText);

            await joplin.data.put(['notes', noteId], null, { body });
          }
        } catch (e) {
          console.error("Error fixing typo in note:", e);
        }

      // VISTE
      } else if (message.name === 'showReset') {
        await renderResetView(message.folderId);
      } else if (message.name === 'showLastScan') {
        const lastCache = await joplin.settings.value('lastScanCache');
        await renderInitialUI(lastCache);
      } else if (message.name === 'showDomains') {
        await renderDomainsView(message.folderId);
      } else if (message.name === 'showLinks') {
        await renderLinksView(message.folderId);

      // AZIONI SUI TENTATIVI / RESET
      } else if (message.name === 'saveMaxFailures') {
        const val = parseInt(message.value, 10);
        if (!isNaN(val) && val > 0) {
          await joplin.settings.setValue('maxFailures', val);
          await renderResetView(message.folderId, '<p style="color: var(--joplin-color-correct, #2E7D32); font-weight: bold;">Threshold updated successfully!</p>');
        }
      } else if (message.name === 'confirmResetHistory') {
        await joplin.settings.setValue('failureHistory', '{}');
        await renderResetView(message.folderId, '<p style="color: var(--joplin-color-correct, #2E7D32); font-weight: bold;">Failure history cleared successfully!</p>');

      // ECCEZIONI E AGGIUNTA MANUALE
      } else if (message.name === 'addDomainManual') {
        const domain = decodeURIComponent(message.domain);
        const current = await joplin.settings.value('ignoredDomains');
        const list = current.split(',').map((s: string) => s.trim()).filter(Boolean);
        if (!list.includes(domain)) {
          list.push(domain);
          await joplin.settings.setValue('ignoredDomains', list.join(', '));
        }
        await renderDomainsView(message.folderId);
      } else if (message.name === 'addLinkManual') {
        const urlString = decodeURIComponent(message.url);
        const current = await joplin.settings.value('ignoredLinksMetadata');
        let list = [];
        try { list = JSON.parse(current); } catch { list = []; }
        
        if (!list.find((item: any) => item.url === urlString)) {
          list.push({ url: urlString, noteId: '', noteTitle: 'Manual Entry' });
          await joplin.settings.setValue('ignoredLinksMetadata', JSON.stringify(list));
        }
        await renderLinksView(message.folderId);

      } else if (message.name === 'ignoreDomain') {
        try {
          const urlString = decodeURIComponent(message.url);
          const hostname = new URL(urlString).hostname;
          const current = await joplin.settings.value('ignoredDomains');
          const list = current.split(',').map((s: string) => s.trim()).filter(Boolean);
          if (!list.includes(hostname)) {
            list.push(hostname);
            await joplin.settings.setValue('ignoredDomains', list.join(', '));
          }
        } catch (e) {}
      } else if (message.name === 'ignoreUrl') {
        const urlString = decodeURIComponent(message.url);
        const noteId = message.noteId;
        const noteTitle = decodeURIComponent(message.noteTitle);
        const current = await joplin.settings.value('ignoredLinksMetadata');
        let list = [];
        try { list = JSON.parse(current); } catch { list = []; }
        
        if (!list.find((item: any) => item.url === urlString)) {
          list.push({ url: urlString, noteId, noteTitle });
          await joplin.settings.setValue('ignoredLinksMetadata', JSON.stringify(list));
        }

      // RIMOZIONI
      } else if (message.name === 'removeDomain') {
        const domainToRemove = decodeURIComponent(message.domain);
        const current = await joplin.settings.value('ignoredDomains');
        let list = current.split(',').map((s: string) => s.trim()).filter(Boolean);
        list = list.filter((d: string) => d !== domainToRemove);
        await joplin.settings.setValue('ignoredDomains', list.join(', '));
        await renderDomainsView(message.folderId);
      } else if (message.name === 'removeLink') {
        const urlToRemove = decodeURIComponent(message.url);
        const current = await joplin.settings.value('ignoredLinksMetadata');
        let list = [];
        try { list = JSON.parse(current); } catch { list = []; }
        list = list.filter((item: any) => item.url !== urlToRemove);
        await joplin.settings.setValue('ignoredLinksMetadata', JSON.stringify(list));
        await renderLinksView(message.folderId);
      }
    });

  },
});