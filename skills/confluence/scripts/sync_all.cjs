/* eslint-disable no-undef */
const storage = require('../scripts/storage.cjs');

const CONFLUENCE_URL = (process.env.CONFLUENCE_URL || '').trim().replace(/\/$/, '');
const CONFLUENCE_USERNAME = (process.env.CONFLUENCE_USERNAME || '').trim();
const CONFLUENCE_API_TOKEN = (process.env.CONFLUENCE_API_TOKEN || '').trim();

if (process.env.CONFLUENCE_INSECURE_SSL === 'true') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const getAuthHeaders = () => {
  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };
  if (CONFLUENCE_USERNAME) {
    const encoded = Buffer.from(`${CONFLUENCE_USERNAME}:${CONFLUENCE_API_TOKEN}`).toString('base64');
    headers['Authorization'] = `Basic ${encoded}`;
  } else if (CONFLUENCE_API_TOKEN) {
    headers['Authorization'] = `Bearer ${CONFLUENCE_API_TOKEN}`;
  }
  return headers;
};

async function syncAll() {
  console.log('Fetching list of pages in space IN...');
  const searchUrl = `${CONFLUENCE_URL}/rest/api/content/search?cql=space="IN" AND type="page"&limit=100`;
  const res = await fetch(searchUrl, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const searchResult = await res.json();
  const pages = searchResult.results || [];
  
  console.log(`Found ${pages.length} pages. Starting sync...`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < pages.length; i++) {
    const pageId = pages[i].id;
    try {
      const url = `${CONFLUENCE_URL}/rest/api/content/${pageId}?expand=body.storage,version,space,ancestors`;
      const resPage = await fetch(url, { headers: getAuthHeaders() });
      if (!resPage.ok) throw new Error(`HTTP ${resPage.status}`);
      const remotePageData = await resPage.json();
      const syncRes = storage.syncRemote(pageId, remotePageData);
      successCount++;
      console.log(`[${i+1}/${pages.length}] Synced ${pageId} -> ${syncRes.status}`);
    } catch (err) {
      failCount++;
      console.error(`[${i+1}/${pages.length}] Failed ${pageId}: ${err.message}`);
    }
  }

  console.log(`\nSync complete. Success: ${successCount}, Failed: ${failCount}`);
}

syncAll().catch(err => {
  console.error("Sync error:", err);
  process.exit(1);
});
