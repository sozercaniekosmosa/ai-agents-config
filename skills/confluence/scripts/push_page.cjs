/* eslint-disable no-undef */
const storage = require('../scripts/storage.cjs');
const pageId = process.argv[2];

if (!pageId) {
  console.error("No pageId provided.");
  process.exit(1);
}

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

async function pushPage() {
  const localData = storage.preparePush(pageId);
  const content = localData.content;
  const version = localData.index.remoteVersion;
  const title = localData.index.title;

  const url = `${CONFLUENCE_URL}/rest/api/content/${pageId}`;
  
  const payload = {
    version: { number: version + 1 },
    title: title,
    type: 'page',
    body: {
      storage: {
        value: content,
        representation: 'storage'
      }
    }
  };

  console.log(`Pushing page ${pageId} as version ${version + 1}...`);
  
  const res = await fetch(url, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }

  const serverRes = await res.json();
  storage.commitPushSuccess(pageId, serverRes, title);
  console.log(`Successfully pushed page ${pageId}.`);
}

pushPage().catch(err => {
  console.error("Push error:", err);
  process.exit(1);
});
