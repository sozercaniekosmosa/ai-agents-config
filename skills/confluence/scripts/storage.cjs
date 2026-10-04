const fs = require('fs');
const path = require('path');
/* global __dirname */
const Diff = require('./vendor/diff.cjs');

const blockTags = ['p', 'div', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'blockquote', 'pre', 'hr', 'ac:structured-macro', 'ac:rich-text-body', 'ac:parameter'];
const blockRegex = new RegExp(`(<\\/?(?:${blockTags.join('|')})[^>]*>)`, 'gi');

function formatHtmlForDiff(html) {
  if (!html) return '';
  let formatted = html.replace(blockRegex, '\n$1\n');
  formatted = formatted.replace(/\n\s*\n/g, '\n').trim();
  return formatted;
}

const STORAGE_ROOT = path.resolve(__dirname, '../storage');
const INDEX_FILE = path.join(STORAGE_ROOT, 'confluence_index.json');
const DATA_FILE = path.join(STORAGE_ROOT, 'confluence_data.json');

function ensureStorage() {
  if (!fs.existsSync(STORAGE_ROOT)) {
    fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  }
}

function readGlobalIndex() {
  if (fs.existsSync(INDEX_FILE)) {
    return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  }
  return {};
}

function writeGlobalIndex(indexData) {
  ensureStorage();
  fs.writeFileSync(INDEX_FILE, JSON.stringify(indexData, null, 2), 'utf8');
}

function readGlobalData() {
  if (fs.existsSync(DATA_FILE)) {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  }
  return {};
}

function writeGlobalData(data) {
  ensureStorage();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data), 'utf8');
}

function getCurrent(pageData) {
  let content = pageData.base || '';
  if (pageData.local_patches && pageData.local_patches.length > 0) {
    for (const p of pageData.local_patches) {
      if (!p.patch) continue;
      const patched = Diff.applyPatch(content, p.patch);
      if (patched !== false) {
        content = patched;
      }
    }
  }
  return content;
}

/**
 * Initializes or updates local storage based on remote page data.
 */
function syncRemote(pageId, remotePageData) {
  ensureStorage();
  const spaceKey = remotePageData.space?.key || 'DEFAULT';

  let indexAll = readGlobalIndex();
  let dataAll = readGlobalData();
  
  let pageIndex = indexAll[pageId];
  if (!dataAll[pageId]) {
    dataAll[pageId] = { base: '', local_patches: [], server_history: [] };
  }
  let pageData = dataAll[pageId];

  // Migrate legacy fields if they exist
  if (pageData.current !== undefined) {
    if (pageData.current !== pageData.base) {
      const patch = Diff.createPatch('content.xhtml', pageData.base, pageData.current, 'old', 'new', { context: 0 });
      pageData.local_patches = [{
        commitId: Date.now().toString(),
        msg: 'Legacy migrated edit',
        timestamp: new Date().toISOString(),
        patch
      }];
    }
    delete pageData.current;
    delete pageData.conflict;
    delete pageData.commits;
  }
  if (!pageData.local_patches) pageData.local_patches = [];

  const remoteVersion = remotePageData.version?.number || 1;
  const remoteWhen = remotePageData.version?.when || '';
  const remoteContent = formatHtmlForDiff(remotePageData.body?.storage?.value || '');
  const title = remotePageData.title || '';
  let parentId = null;
  if (remotePageData.ancestors && remotePageData.ancestors.length > 0) {
    parentId = remotePageData.ancestors[remotePageData.ancestors.length - 1].id;
  }

  if (!pageIndex) {
    pageIndex = {
      pageId: String(pageId),
      spaceKey,
      title,
      remoteVersion,
      remoteUpdatedAt: remoteWhen,
      localUpdatedAt: new Date().toISOString(),
      headCommitId: 'init',
      parentId
    };
    pageData.base = remoteContent;
    pageData.local_patches = [];
    if (!pageData.server_history) pageData.server_history = [];
    
    pageData.server_history.push({
      commitId: `svr-${remoteVersion}-${Date.now()}`,
      msg: `Initial Server Sync (v${remoteVersion})`,
      timestamp: new Date(remoteWhen || Date.now()).toISOString(),
      patch: Diff.createPatch('server.xhtml', '', remoteContent, 'empty', 'init', { context: 0 }),
      version: remoteVersion
    });
    
    indexAll[pageId] = pageIndex;
    writeGlobalIndex(indexAll);
    writeGlobalData(dataAll);
    return { status: 'synced_initial', index: pageIndex };
  }

  if (remoteVersion > pageIndex.remoteVersion) {
    let currentLocalContent = getCurrent(pageData);
    let baseContent = pageData.base;
    
    if (!pageData.server_history) pageData.server_history = [];
    const serverPatchText = Diff.createPatch('server.xhtml', baseContent, remoteContent, 'old_server', 'new_server', { context: 0 });
    pageData.server_history.push({
      commitId: `svr-${remoteVersion}-${Date.now()}`,
      msg: `Server Update (v${remoteVersion})`,
      timestamp: new Date(remoteWhen || Date.now()).toISOString(),
      patch: serverPatchText,
      version: remoteVersion
    });

    if (currentLocalContent === baseContent) {
      pageData.base = remoteContent;
      pageData.local_patches = [];
      pageIndex.remoteVersion = remoteVersion;
      pageIndex.remoteUpdatedAt = remoteWhen;
      pageIndex.title = title || pageIndex.title;
      pageIndex.parentId = parentId || pageIndex.parentId;
      pageIndex.conflict = false;
      
      indexAll[pageId] = pageIndex;
      writeGlobalIndex(indexAll);
      writeGlobalData(dataAll);
      return { status: 'synced_fast_forward', index: pageIndex };
    } else {
      const localDiff = Diff.createPatch('content.xhtml', baseContent, currentLocalContent, 'base', 'current', { context: 0 });
      const patchedNewRemote = Diff.applyPatch(remoteContent, localDiff);

      if (patchedNewRemote === false) {
        // Conflict: save server content as a special conflict patch from our local current
        pageData.conflict_patch = Diff.createPatch('conflict.xhtml', currentLocalContent, remoteContent, 'local', 'remote', { context: 0 });
        pageIndex.conflict = true;
        pageIndex.conflictRemoteWhen = remoteWhen;
        
        indexAll[pageId] = pageIndex;
        writeGlobalIndex(indexAll);
        writeGlobalData(dataAll);
        return { status: 'synced_conflict', index: pageIndex };
      }

      // Merged: rewrite base and compress local changes into a single patch against new base
      pageData.base = remoteContent;
      const newLocalPatch = Diff.createPatch('content.xhtml', remoteContent, patchedNewRemote, 'old', 'new', { context: 0 });
      pageData.local_patches = [{
        commitId: Date.now().toString(),
        msg: 'Auto-merged local changes',
        timestamp: new Date().toISOString(),
        patch: newLocalPatch
      }];
      
      pageIndex.remoteVersion = remoteVersion;
      pageIndex.remoteUpdatedAt = remoteWhen;
      pageIndex.title = title || pageIndex.title;
      pageIndex.parentId = parentId || pageIndex.parentId;
      pageIndex.conflict = false;
      pageIndex.headCommitId = pageData.local_patches[0].commitId;
      
      indexAll[pageId] = pageIndex;
      writeGlobalIndex(indexAll);
      writeGlobalData(dataAll);
      return { status: 'synced_merged', index: pageIndex };
    }
  } else if (parentId) {
    // Also update parentId if missing
    pageIndex.parentId = parentId;
    indexAll[pageId] = pageIndex;
    writeGlobalIndex(indexAll);
  }

  return { status: 'up_to_date', index: pageIndex };
}

function readLocal(pageId) {
  let indexAll = readGlobalIndex();
  let pageIndex = indexAll[pageId];
  if (!pageIndex) {
    throw new Error(`Local cache for page ${pageId} not found in index. Sync first.`);
  }
  
  let dataAll = readGlobalData();
  let pageData = dataAll[pageId];
  if (!pageData) {
    throw new Error(`Local data for page ${pageId} not found. Sync first.`);
  }
  
  return { content: getCurrent(pageData), index: pageIndex };
}

function writeLocal(pageId, newContent, commitMsg = 'Local edit') {
  newContent = formatHtmlForDiff(newContent);
  let indexAll = readGlobalIndex();
  let pageIndex = indexAll[pageId];
  if (!pageIndex) {
    throw new Error(`Local cache for page ${pageId} not found. Sync first.`);
  }

  let dataAll = readGlobalData();
  let pageData = dataAll[pageId];
  if (!pageData) {
    throw new Error(`Local data for page ${pageId} not found. Sync first.`);
  }

  const oldContent = getCurrent(pageData);
  if (oldContent === newContent) {
    return { status: 'no_change' };
  }

  const commitId = Date.now().toString();
  const patchData = Diff.createPatch('current.xhtml', oldContent, newContent, 'old', 'new', { context: 0 });
  
  if (!pageData.local_patches) pageData.local_patches = [];
  pageData.local_patches.push({
    commitId,
    msg: commitMsg,
    timestamp: new Date().toISOString(),
    patch: patchData
  });
  
  pageIndex.localUpdatedAt = new Date().toISOString();
  pageIndex.headCommitId = commitId;
  
  indexAll[pageId] = pageIndex;
  
  writeGlobalIndex(indexAll);
  writeGlobalData(dataAll);

  return { status: 'committed', commitId };
}

function preparePush(pageId) {
  return readLocal(pageId);
}

function commitPushSuccess(pageId, serverRes, title) {
  let indexAll = readGlobalIndex();
  let pageIndex = indexAll[pageId];
  if (!pageIndex) {
    throw new Error(`Local cache for page ${pageId} not found. Sync first.`);
  }

  let dataAll = readGlobalData();
  let pageData = dataAll[pageId];
  
  pageIndex.remoteVersion = serverRes.version?.number || pageIndex.remoteVersion;
  pageIndex.remoteUpdatedAt = serverRes.version?.when || pageIndex.remoteUpdatedAt;
  if (title) pageIndex.title = title;
  pageIndex.conflict = false;
  
  // Collapse patches into base
  const oldBase = pageData.base || '';
  const newBase = getCurrent(pageData);
  
  if (oldBase !== newBase) {
    const Diff = require('./vendor/diff.cjs');
    const patchContent = Diff.createPatch('current.xhtml', oldBase, newBase, 'old', 'new', { context: 0 });
    if (!pageData.server_history) pageData.server_history = [];
    pageData.server_history.push({
      version: pageIndex.remoteVersion,
      commitId: `svr-${pageIndex.remoteVersion}-${Date.now()}`,
      patch: patchContent,
      msg: 'Pushed local changes',
      timestamp: new Date().toISOString()
    });
  }
  
  pageData.base = newBase;
  pageData.local_patches = [];
  delete pageData.conflict_patch;
  
  indexAll[pageId] = pageIndex;
  
  writeGlobalIndex(indexAll);
  writeGlobalData(dataAll);
  
  return pageIndex;
}

function deleteLocal(pageId) {
  let indexAll = readGlobalIndex();
  let dataAll = readGlobalData();
  
  if (indexAll[pageId] || dataAll[pageId]) {
    delete indexAll[pageId];
    delete dataAll[pageId];
    writeGlobalIndex(indexAll);
    writeGlobalData(dataAll);
  }
}

function rollbackLocal(pageId, targetCommitId) {
  let indexAll = readGlobalIndex();
  let dataAll = readGlobalData();
  
  let pageData = dataAll[pageId];
  let pageIndex = indexAll[pageId];
  if (!pageData || !pageIndex) throw new Error("Page not found");

  if (!pageData.local_patches) return { status: 'no_patches' };

  const targetIdx = pageData.local_patches.findIndex(p => p.commitId === targetCommitId);
  if (targetIdx === -1 && targetCommitId !== 'init') {
    throw new Error("Commit not found");
  }

  if (targetCommitId === 'init') {
    pageData.local_patches = [];
    pageIndex.headCommitId = 'init';
  } else {
    pageData.local_patches = pageData.local_patches.slice(0, targetIdx + 1);
    pageIndex.headCommitId = targetCommitId;
  }
  
  pageIndex.conflict = false;
  delete pageData.conflict_patch;
  
  writeGlobalIndex(indexAll);
  writeGlobalData(dataAll);
  
  return { status: 'rolled_back', headCommitId: pageIndex.headCommitId };
}

function getHistory(pageId) {
  let dataAll = readGlobalData();
  let pageData = dataAll[pageId];
  if (!pageData) throw new Error("Page not found");
  
  const serverHistory = (pageData.server_history || []).map(p => ({
    commitId: p.commitId,
    msg: p.msg,
    timestamp: p.timestamp,
    source: 'server',
    version: p.version
  }));
  
  const localHistory = (pageData.local_patches || []).map(p => ({
    commitId: p.commitId,
    msg: p.msg,
    timestamp: p.timestamp,
    source: 'local'
  }));

  // Combine and sort by timestamp ascending
  const combined = [...serverHistory, ...localHistory].sort((a, b) => {
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });
  
  return combined;
}

function getPatchDiff(pageId, commitId) {
  let dataAll = readGlobalData();
  let pageData = dataAll[pageId];
  if (!pageData) throw new Error("Page not found");

  const serverPatch = (pageData.server_history || []).find(p => p.commitId === commitId);
  if (serverPatch) return serverPatch.patch;
  
  const localPatch = (pageData.local_patches || []).find(p => p.commitId === commitId);
  if (localPatch) return localPatch.patch;
  
  throw new Error("Patch not found");
}

function deleteLocalPatch(pageId, commitId) {
  // === START DEBUG AGENT ===
  console.log('[DEBUG_START deleteLocalPatch] INPUT:', typeof arguments !== 'undefined' ? JSON.stringify(Array.from(arguments).map(x => typeof x === 'function' ? 'fn' : x)) : 'no-arguments');
  // === END DEBUG AGENT ===

  let indexAll = readGlobalIndex();
  let dataAll = readGlobalData();
  
  let pageData = dataAll[pageId];
  let pageIndex = indexAll[pageId];
  if (!pageData || !pageIndex) throw new Error("Page not found");

  const targetIdx = (pageData.local_patches || []).findIndex(p => p.commitId === commitId);
  if (targetIdx !== -1) {
    pageData.local_patches = pageData.local_patches.slice(0, targetIdx);
    pageIndex.headCommitId = pageData.local_patches.length > 0 ? pageData.local_patches[pageData.local_patches.length - 1].commitId : 'init';
    
    pageIndex.conflict = false;
    delete pageData.conflict_patch;
    
    writeGlobalIndex(indexAll);
    writeGlobalData(dataAll);
    
    
  // === START DEBUG AGENT ===
  console.log('[DEBUG_END deleteLocalPatch]');
  // === END DEBUG AGENT ===
return { status: 'deleted', headCommitId: pageIndex.headCommitId };
  }

  const serverIdx = (pageData.server_history || []).findIndex(p => p.commitId === commitId);
  if (serverIdx !== -1) {
    pageData.server_history.splice(serverIdx, 1);
    writeGlobalIndex(indexAll);
    writeGlobalData(dataAll);
    return { status: 'deleted' };
  }

  throw new Error("Commit not found");
}

function getHtmlVersions(pageId, commitId) {
  let dataAll = readGlobalData();
  let pageData = dataAll[pageId];
  if (!pageData) throw new Error("Page not found");

  const Diff = require('./vendor/diff.cjs');

  const serverPatchIdx = (pageData.server_history || []).findIndex(p => p.commitId === commitId);
  if (serverPatchIdx !== -1) {
    let current = pageData.base || '';
    for (let i = pageData.server_history.length - 1; i > serverPatchIdx; i--) {
       const p = pageData.server_history[i];
       if (!p.patch) continue;
       const parsed = Diff.parsePatch(p.patch);
       if (parsed && parsed.length > 0) {
          const reversed = Diff.reversePatch(parsed[0]);
          const revApplied = Diff.applyPatch(current, [reversed]);
          if (revApplied !== false) current = revApplied;
       }
    }
    let newHtml = current;
    let oldHtml = current;
    const targetPatch = pageData.server_history[serverPatchIdx];
    if (targetPatch.patch) {
      const parsedTarget = Diff.parsePatch(targetPatch.patch);
      if (parsedTarget && parsedTarget.length > 0) {
          const reversedTarget = Diff.reversePatch(parsedTarget[0]);
          const revApplied = Diff.applyPatch(newHtml, [reversedTarget]);
          if (revApplied !== false) oldHtml = revApplied;
      }
    }
    return { oldHtml, newHtml };
  }

  let content = pageData.base || '';
  let oldHtml = content;
  let newHtml = content;
  
  if (pageData.local_patches && pageData.local_patches.length > 0) {
    for (const p of pageData.local_patches) {
      oldHtml = newHtml;
      if (p.patch) {
        const patched = Diff.applyPatch(oldHtml, p.patch);
        if (patched !== false) {
          newHtml = patched;
        }
      }
      if (p.commitId === commitId) {
        break;
      }
    }
  }
  return { oldHtml, newHtml };
}

module.exports = {
  deleteLocal,
  syncRemote,
  readLocal,
  writeLocal,
  preparePush,
  commitPushSuccess,
  readGlobalIndex,
  rollbackLocal,
  getHistory,
  getPatchDiff,
  deleteLocalPatch,
  getHtmlVersions
};
