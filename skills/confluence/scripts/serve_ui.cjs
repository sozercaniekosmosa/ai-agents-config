/* eslint-disable no-undef */
const http = require('http');
const fs = require('fs');
const path = require('path');
const storage = require('./storage.cjs');

const PORT = 8080;
const UI_PATH = path.resolve(__dirname, '../web-ui/viewer.html');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  if (req.method === 'GET') {
    if (pathname === '/' || pathname === '/index.html') {
      if (fs.existsSync(UI_PATH)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(UI_PATH));
      } else {
        res.writeHead(404);
        res.end('UI file not found at ' + UI_PATH);
      }
      return;
    }

    const ext = path.extname(pathname);
    if (ext === '.css' || ext === '.js' || ext === '.svg') {
      const filePath = path.join(__dirname, '../web-ui', pathname);
      if (fs.existsSync(filePath)) {
        const contentType = ext === '.css' ? 'text/css' : ext === '.svg' ? 'image/svg+xml' : 'application/javascript';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(fs.readFileSync(filePath));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
      return;
    }

    if (pathname === '/api/tree') {
      try {
        const tree = storage.readGlobalIndex();
        res.writeHead(200, { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
        });
        res.end(JSON.stringify(tree));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    if (pathname === '/api/page') {
      const id = parsedUrl.searchParams.get('id');
      try {
        const page = storage.readLocal(id);
        res.writeHead(200, { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate'
        });
        res.end(JSON.stringify({
          ...page,
          baseUrl: process.env.CONFLUENCE_URL || ''
        }));
      } catch (e) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    if (pathname === '/api/history') {
      const id = parsedUrl.searchParams.get('id');
      try {
        const history = storage.getHistory(id);
        res.writeHead(200, { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate'
        });
        res.end(JSON.stringify(history));
      } catch (e) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    
    if (pathname === '/api/diff') {
      const id = parsedUrl.searchParams.get('id');
      const commitId = parsedUrl.searchParams.get('commitId');
      try {
        const diffText = storage.getPatchDiff(id, commitId);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(diffText);
      } catch (e) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    if (pathname === '/api/diff_rendered') {
      const id = parsedUrl.searchParams.get('id');
      const commitId = parsedUrl.searchParams.get('commitId');
      try {
        const { oldHtml, newHtml } = storage.getHtmlVersions(id, commitId);
        const HtmlDiff = require('./vendor/htmldiff.cjs').default || require('./vendor/htmldiff.cjs');
        const renderedDiff = HtmlDiff.execute(oldHtml, newHtml);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderedDiff);
      } catch (e) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    
    if (pathname === '/api/search') {
      const query = parsedUrl.searchParams.get('q');
      if (!query) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'q parameter required' }));
        return;
      }
      try {
        const indexAll = storage.readGlobalIndex();
        const DATA_FILE = path.resolve(__dirname, '../storage/confluence_data.json');
        let results = [];
        if (fs.existsSync(DATA_FILE)) {
          const dataAll = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
          const queryLower = query.toLowerCase();
          
          for (const pageId in dataAll) {
            const pageData = dataAll[pageId];
            // Simulate current to search
            let content = pageData.base || '';
            if (pageData.local_patches) {
              const Diff = require('./vendor/diff.cjs');
              for (const p of pageData.local_patches) {
                if (p.patch) {
                  const patched = Diff.applyPatch(content, p.patch);
                  if (patched !== false) content = patched;
                }
              }
            }
            
            const contentLower = content.toLowerCase();
            const title = indexAll[pageId] ? indexAll[pageId].title : 'Unknown';
            if (contentLower.includes(queryLower) || title.toLowerCase().includes(queryLower)) {
              let snippet = '';
              const matchIdx = contentLower.indexOf(queryLower);
              if (matchIdx !== -1) {
                const start = Math.max(0, matchIdx - 40);
                const end = Math.min(content.length, matchIdx + queryLower.length + 40);
                snippet = content.substring(start, end).replace(/\n/g, ' ');
              }
              results.push({
                pageId,
                title,
                snippet: snippet ? `...${snippet}...` : 'Matched in title'
              });
            }
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results, totalCount: results.length }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
  }

  if (req.method === 'POST') {
    if (pathname === '/api/sync_server') {
      try {
        const { execSync } = require('child_process');
        execSync('node --env-file=.env scripts/sync_all.cjs', { stdio: 'inherit' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
      return;
    }

    if (pathname === '/api/patch/delete') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const { pageId, commitId } = JSON.parse(body);
          const result = storage.deleteLocalPatch(pageId, commitId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (pathname === '/api/patch/push') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const { pageId, commitId } = JSON.parse(body);
          const { newHtml } = storage.getHtmlVersions(pageId, commitId);
          storage.writeLocal(pageId, newHtml, `Восстановление к версии ${commitId}`);
          const { execSync } = require('child_process');
          execSync(`node --env-file=.env scripts/push_page.cjs ${pageId}`, { stdio: 'inherit' });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Confluence Local UI Server running at http://localhost:${PORT}`);
});
