#!/usr/bin/env node
/* eslint-disable no-undef */
const fs = require('fs');
const path = require('path');
const storage = require('./storage.cjs');

// Переменные считываются строго из process.env (передаются окружением или через node --env-file=.env)
if (process.env.CONFLUENCE_INSECURE_SSL === 'true') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

let CONFLUENCE_URL = (process.env.CONFLUENCE_URL || '').trim();
if (CONFLUENCE_URL && !/^https?:\/\//i.test(CONFLUENCE_URL)) {
  CONFLUENCE_URL = 'https://' + CONFLUENCE_URL;
}
const CONFLUENCE_SPACE = (process.env.CONFLUENCE_SPACE || process.env.CONFLUENCE_DEFAULT_SPACE || '').trim();
const CONFLUENCE_USERNAME = (process.env.CONFLUENCE_USERNAME || '').trim();
const CONFLUENCE_API_TOKEN = (process.env.CONFLUENCE_API_TOKEN || '').trim();

if (!CONFLUENCE_URL || !CONFLUENCE_API_TOKEN) {
  console.error(JSON.stringify({
    success: false,
    error: 'CONFLUENCE_URL and CONFLUENCE_API_TOKEN must be present in process environment variables.'
  }, null, 2));
  process.exit(1);
}

const getAuthHeaders = () => {
  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };

  if (CONFLUENCE_USERNAME) {
    const encoded = Buffer.from(`${CONFLUENCE_USERNAME}:${CONFLUENCE_API_TOKEN}`).toString('base64');
    headers['Authorization'] = `Basic ${encoded}`;
  } else {
    headers['Authorization'] = `Bearer ${CONFLUENCE_API_TOKEN}`;
  }

  return headers;
};

async function apiRequest(endpoint, method = 'GET', body = null) {
  const url = `${CONFLUENCE_URL.replace(/\/$/, '')}${endpoint}`;
  
  const controller = new AbortController();
  const timeoutMs = parseInt(process.env.CONFLUENCE_TIMEOUT || '30000', 10);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const options = {
    method,
    headers: getAuthHeaders(),
    signal: controller.signal
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`API Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  
  let data;
  const text = await response.text();
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }

  if (!response.ok) {
    const errMsg = typeof data === 'object' && data.message ? data.message : (typeof data === 'object' ? JSON.stringify(data) : data);
    throw new Error(`API Error ${response.status} ${response.statusText}: ${errMsg}`);
  }

  return data;
}

async function handleAction(payload) {
  const { action, ...params } = payload;
  
  switch (action) {
    case 'get_page': {
      if (!params.pageId) throw new Error('pageId is required for get_page');
      const expand = params.expand ? encodeURIComponent(params.expand) : 'body.storage,version,space,ancestors';
      const remotePage = await apiRequest(`/rest/api/content/${params.pageId}?expand=${expand}`);
      
      let local = null;
      try { local = storage.readLocal(params.pageId); } catch { /* ignore */ }
      
      if (local) {
        remotePage._localStatus = local.index.conflict ? 'conflict' : 'synced';
        remotePage._localUpdatedAt = local.index.localUpdatedAt;
      }
      return remotePage;
    }
    
    case 'sync_page': {
      if (!params.pageId) throw new Error('pageId is required for sync_page');
      const expand = params.expand ? encodeURIComponent(params.expand) : 'body.storage,version,space,ancestors';
      const remotePage = await apiRequest(`/rest/api/content/${params.pageId}?expand=${expand}`);
      return storage.syncRemote(params.pageId, remotePage);
    }
    
    case 'get_local_page': {
      if (!params.pageId) throw new Error('pageId is required for get_local_page');
      return storage.readLocal(params.pageId);
    }
      
    case 'get_local_tree': {
      return storage.readGlobalIndex();
    }
      
    case 'search_local': {
      if (!params.query) throw new Error('query is required for search_local');
      const indexAll = storage.readGlobalIndex();
      const fs = require('fs');
      const path = require('path');
      const DATA_FILE = path.resolve(__dirname, '../storage/confluence_data.json');
      if (!fs.existsSync(DATA_FILE)) return { results: [] };
      const dataAll = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      const queryLower = params.query.toLowerCase();
      
      const results = [];
      for (const pageId in dataAll) {
        const pageData = dataAll[pageId];
        const contentLower = (pageData.current || '').toLowerCase();
        if (contentLower.includes(queryLower) || (indexAll[pageId] && indexAll[pageId].title.toLowerCase().includes(queryLower))) {
          // Extract a snippet
          let snippet = '';
          const matchIdx = contentLower.indexOf(queryLower);
          if (matchIdx !== -1) {
            const start = Math.max(0, matchIdx - 40);
            const end = Math.min(pageData.current.length, matchIdx + queryLower.length + 40);
            snippet = pageData.current.substring(start, end).replace(/\n/g, ' ');
          }
          results.push({
            pageId,
            title: indexAll[pageId] ? indexAll[pageId].title : 'Unknown',
            snippet: snippet ? `...${snippet}...` : 'Matched in title'
          });
        }
      }
      return { results, totalCount: results.length };
    }
      
    case 'get_page_by_title': {
      const spaceKey = params.spaceKey || CONFLUENCE_SPACE;
      if (!spaceKey || !params.title) throw new Error('spaceKey and title are required for get_page_by_title');
      const expand = params.expand ? encodeURIComponent(params.expand) : 'body.storage,version,space';
      return await apiRequest(`/rest/api/content?spaceKey=${encodeURIComponent(spaceKey)}&title=${encodeURIComponent(params.title)}&expand=${expand}`);
    }

    case 'get_child_pages':
      if (!params.pageId) throw new Error('pageId is required for get_child_pages');
      return await apiRequest(`/rest/api/content/${params.pageId}/child/page?expand=version,space`);

    case 'get_attachments':
      if (!params.pageId) throw new Error('pageId is required for get_attachments');
      return await apiRequest(`/rest/api/content/${params.pageId}/child/attachment`);

    case 'create_page': {
      const spaceKey = params.spaceKey || CONFLUENCE_SPACE;
      if (!spaceKey || !params.title || !params.content) {
        throw new Error('spaceKey, title, and content are required for create_page');
      }
      const pageData = {
        type: 'page',
        title: params.title,
        space: { key: spaceKey },
        body: {
          storage: {
            value: params.content,
            representation: 'storage'
          }
        }
      };
      if (params.parentId) {
        pageData.ancestors = [{ id: params.parentId }];
      }
      const serverRes = await apiRequest('/rest/api/content', 'POST', pageData);
      
      const expandRes = await apiRequest(`/rest/api/content/${serverRes.id}?expand=body.storage,version,space,ancestors`);
      storage.syncRemote(serverRes.id, expandRes);
      
      return serverRes;
    }
      
    case 'update_page': {
      function notifyConflict(pageId, title, isPush) {
        try {
          const { execSync } = require('child_process');
          const msg = isPush ? `Push failed for ${pageId} (${title}) due to 409 Conflict. Someone else modified it on server.` : `Cannot update ${pageId} (${title}) because local cache is in conflict state.`;
          execSync(`powershell -c "Add-Type -AssemblyName PresentationCore,PresentationFramework; [System.Windows.MessageBox]::Show('${msg}', 'Confluence Conflict', 'OK', 'Warning')"`);
        } catch(e) {
          console.error(e);
        }
      }

      if (!params.pageId || !params.title || !params.content) {
        throw new Error('pageId, title, and content are required for update_page');
      }
      
      let currentPage = await apiRequest(`/rest/api/content/${params.pageId}?expand=version,space,body.storage`);
      
      const syncRes = storage.syncRemote(params.pageId, currentPage);
      if (syncRes.index.conflict) {
        notifyConflict(params.pageId, params.title, false);
        throw new Error(`Cannot update_page for ${params.pageId}. Local cache is in conflict state. Please resolve manually.`);
      }
      
      storage.writeLocal(params.pageId, params.content, params.versionMessage || 'Local update_page call');
      const pushData = storage.preparePush(params.pageId);
      
      let versionNumber = params.versionNumber || ((currentPage.version && currentPage.version.number ? currentPage.version.number : 0) + 1);
      
      const updateData = {
        id: params.pageId,
        type: 'page',
        title: params.title,
        version: { number: versionNumber },
        body: {
          storage: {
            value: pushData.content,
            representation: 'storage'
          }
        }
      };
      if (params.versionMessage) {
        updateData.version.message = params.versionMessage;
      }
      if (params.parentId) {
        updateData.ancestors = [{ id: params.parentId }];
      }
      
      try {
        const serverRes = await apiRequest(`/rest/api/content/${params.pageId}`, 'PUT', updateData);
        storage.commitPushSuccess(params.pageId, serverRes, params.title);
        return serverRes;
      } catch (err) {
        if (err.message && err.message.includes('409')) {
          notifyConflict(params.pageId, params.title, true);
        }
        throw err;
      }
    }
    
    case 'rollback_page': {
      if (!params.pageId || !params.commitId) throw new Error('pageId and commitId are required for rollback_page');
      return storage.rollbackLocal(params.pageId, params.commitId);
    }
    
    case 'get_history': {
      if (!params.pageId) throw new Error('pageId is required for get_history');
      return storage.getHistory(params.pageId);
    }

    case 'delete_page': {
      if (!params.pageId) throw new Error('pageId is required for delete_page');
      const res = await apiRequest(`/rest/api/content/${params.pageId}`, 'DELETE');
      storage.deleteLocal(params.pageId);
      return res;
    }

    case 'search': {
      if (!params.cql) throw new Error('cql is required for search');
      const limit = params.limit ? `&limit=${params.limit}` : '';
      const start = params.start ? `&start=${params.start}` : '';
      const expand = params.expand ? `&expand=${encodeURIComponent(params.expand)}` : '&expand=version,space';
      return await apiRequest(`/rest/api/content/search?cql=${encodeURIComponent(params.cql)}${expand}${limit}${start}`);
    }

    case 'get_spaces': {
      const limit = params.limit ? `?limit=${params.limit}` : '?limit=100';
      const start = params.start ? `&start=${params.start}` : '';
      return await apiRequest(`/rest/api/space${limit}${start}`);
    }

    case 'get_space': {
      const spaceKey = params.spaceKey || CONFLUENCE_SPACE;
      if (!spaceKey) throw new Error('spaceKey is required for get_space');
      return await apiRequest(`/rest/api/space/${encodeURIComponent(spaceKey)}`);
    }

    case 'get_comments':
      if (!params.pageId) throw new Error('pageId is required for get_comments');
      return await apiRequest(`/rest/api/content/${params.pageId}/child/comment?expand=body.storage`);

    case 'create_comment': {
      if (!params.pageId || !params.content) throw new Error('pageId and content are required for create_comment');
      return await apiRequest('/rest/api/content', 'POST', {
        type: 'comment',
        container: { id: params.pageId },
        body: { storage: { value: params.content, representation: 'storage' } }
      });
    }

    case 'get_labels':
      if (!params.pageId) throw new Error('pageId is required for get_labels');
      return await apiRequest(`/rest/api/content/${params.pageId}/label`);

    case 'add_label': {
      if (!params.pageId || !params.label) throw new Error('pageId and label are required for add_label');
      return await apiRequest(`/rest/api/content/${params.pageId}/label`, 'POST', [{
        prefix: 'global',
        name: params.label
      }]);
    }

    case 'get_versions':
      if (!params.pageId) throw new Error('pageId is required for get_versions');
      return await apiRequest(`/rest/api/content/${params.pageId}/version`);

    case 'decompose_page':
    case 'create_subpages': {
      if (!params.parentPageId && !params.parentId) throw new Error('parentPageId is required for decompose_page');
      const parentId = params.parentPageId || params.parentId;
      const parentPage = await apiRequest(`/rest/api/content/${parentId}?expand=space,version,body.storage`);
      const spaceKey = parentPage.space ? parentPage.space.key : CONFLUENCE_SPACE;
      
      const subpages = params.subpages || [];
      if (!Array.isArray(subpages) || subpages.length === 0) {
        throw new Error('subpages array is required for decompose_page');
      }

      const createdPages = [];
      for (const subpage of subpages) {
        if (!subpage.title || !subpage.content) {
          throw new Error('Each subpage must contain title and content');
        }
        const created = await apiRequest('/rest/api/content', 'POST', {
          type: 'page',
          title: subpage.title,
          space: { key: spaceKey },
          ancestors: [{ id: parentId }],
          body: {
            storage: {
              value: subpage.content,
              representation: 'storage'
            }
          }
        });
        
        const createdExpanded = await apiRequest(`/rest/api/content/${created.id}?expand=body.storage,version,space`);
        storage.syncRemote(created.id, createdExpanded);

        if (subpage.labels && Array.isArray(subpage.labels) && subpage.labels.length > 0) {
          const labelPayload = subpage.labels.map(l => ({ prefix: 'global', name: l }));
          await apiRequest(`/rest/api/content/${created.id}/label`, 'POST', labelPayload);
        }

        createdPages.push({
          id: created.id,
          title: created.title,
          url: created._links && created._links.webui ? `${CONFLUENCE_URL.replace(/\/$/, '')}${created._links.webui}` : ''
        });
      }

      if (params.includeChildrenMacro) {
        const currentContent = parentPage.body && parentPage.body.storage ? parentPage.body.storage.value : '';
        if (!currentContent.includes('ac:name="children"')) {
          const childrenMacro = '<p><strong>Подразделы:</strong></p><ac:structured-macro ac:name="children"><ac:parameter ac:name="all">true</ac:parameter></ac:structured-macro>';
          const newContent = `${currentContent}\n${childrenMacro}`;
          const versionNumber = (parentPage.version && parentPage.version.number ? parentPage.version.number : 0) + 1;
          await apiRequest(`/rest/api/content/${parentId}`, 'PUT', {
            id: parentId,
            type: 'page',
            title: parentPage.title,
            version: { number: versionNumber },
            body: { storage: { value: newContent, representation: 'storage' } }
          });
          
          const parentExpanded = await apiRequest(`/rest/api/content/${parentId}?expand=body.storage,version,space`);
          storage.syncRemote(parentId, parentExpanded);
        }
      }

      return { parentId, createdCount: createdPages.length, subpages: createdPages };
    }

    case 'get_page_tree': {
      if (!params.pageId) throw new Error('pageId is required for get_page_tree');
      const maxDepth = params.depth || 2;
      async function buildTree(pageId, currentDepth) {
        const page = await apiRequest(`/rest/api/content/${pageId}?expand=version,space`);
        const node = { id: page.id, title: page.title, children: [] };
        if (currentDepth < maxDepth) {
          const childrenRes = await apiRequest(`/rest/api/content/${pageId}/child/page?expand=version`);
          const children = childrenRes.results || [];
          for (const child of children) {
            const childTree = await buildTree(child.id, currentDepth + 1);
            node.children.push(childTree);
          }
        }
        return node;
      }
      return await buildTree(params.pageId, 1);
    }

    case 'clean_tmp': {
      const tmpDir = path.resolve(__dirname, '../tmp');
      if (fs.existsSync(tmpDir)) {
        const files = fs.readdirSync(tmpDir);
        let deletedCount = 0;
        for (const file of files) {
          if (file !== '.gitignore') {
            fs.unlinkSync(path.join(tmpDir, file));
            deletedCount++;
          }
        }
        return { message: `Cleaned ${deletedCount} file(s) in tmp directory.`, deletedCount };
      }
      return { message: 'tmp directory does not exist.', deletedCount: 0 };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const cleanFlag = args.includes('--clean') || args.includes('--delete-file');
  const cleanTmpFlag = args.includes('--clean-tmp');

  if (cleanTmpFlag) {
    const result = await handleAction({ action: 'clean_tmp' });
    console.log(JSON.stringify({ success: true, data: result }, null, 2));
    return;
  }

  let payloadRaw = '';
  let fileToDelete = null;

  const outIndex = args.indexOf('--out');
  let outFile = null;
  if (outIndex !== -1 && args[outIndex + 1]) {
    outFile = args[outIndex + 1];
  }

  const positionalArgs = args.filter((a, idx) => {
    if (a === '--clean' || a === '--delete-file' || a === '--clean-tmp' || a === '--out') return false;
    if (outIndex !== -1 && idx === outIndex + 1) return false;
    return true;
  });
  const firstArg = positionalArgs[0];

  if (firstArg) {
    let possiblePath = firstArg.startsWith('@') ? firstArg.slice(1) : firstArg;
    let resolvedPath = path.resolve(process.cwd(), possiblePath);
    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
      payloadRaw = fs.readFileSync(resolvedPath, 'utf8');
      if (cleanFlag) {
        fileToDelete = resolvedPath;
      }
    } else {
      payloadRaw = firstArg;
    }
  } else if (!process.stdin.isTTY) {
    payloadRaw = await new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => { data += chunk; });
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', reject);
    });
  } else {
    throw new Error("No payload provided. Provide JSON string, JSON file path, or stdin.");
  }

  payloadRaw = payloadRaw.trim().replace(/^\uFEFF/, '');
  if (!payloadRaw) {
    throw new Error("No payload provided via stdin or command line arguments.");
  }

  let payload;
  try {
    payload = JSON.parse(payloadRaw);
  } catch (err) {
    throw new Error(`Failed to parse JSON payload: ${err.message}`);
  }



  try {
    const result = await handleAction(payload);
    const jsonStr = JSON.stringify({ success: true, data: result }, null, 2);
    if (outFile) {
      const resolvedOut = path.resolve(process.cwd(), outFile);
      fs.writeFileSync(resolvedOut, jsonStr, 'utf8');
      console.log(JSON.stringify({ success: true, message: `Output saved to ${outFile}` }));
    } else {
      console.log(jsonStr);
    }
  } finally {
    if (fileToDelete && fs.existsSync(fileToDelete)) {
      try {
        fs.unlinkSync(fileToDelete);
      } catch (err) {
        console.error(`Failed to delete temporary file ${fileToDelete}: ${err.message}`);
      }
    }
  }
}

main().catch(err => {
  console.error(JSON.stringify({ success: false, error: err.message }, null, 2));
  process.exit(1);
});
