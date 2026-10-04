/* eslint-disable no-undef */
const fs = require('fs');
const path = require('path');

const STORAGE_ROOT = path.resolve(__dirname, '../storage');

function migrate() {
  if (!fs.existsSync(STORAGE_ROOT)) {
    console.log("Storage root does not exist.");
    return;
  }

  const globalIndexFile = path.join(STORAGE_ROOT, 'confluence_index.json');
  const globalDataFile = path.join(STORAGE_ROOT, 'confluence_data.json');

  let globalIndex = {};
  let globalData = {};

  if (fs.existsSync(globalIndexFile)) {
    globalIndex = JSON.parse(fs.readFileSync(globalIndexFile, 'utf8'));
  }
  if (fs.existsSync(globalDataFile)) {
    globalData = JSON.parse(fs.readFileSync(globalDataFile, 'utf8'));
  }

  const items = fs.readdirSync(STORAGE_ROOT);
  let migratedCount = 0;

  for (const spaceKey of items) {
    const spaceDir = path.join(STORAGE_ROOT, spaceKey);
    if (!fs.statSync(spaceDir).isDirectory()) continue;

    const spaceIndexFile = path.join(spaceDir, 'index.json');
    if (!fs.existsSync(spaceIndexFile)) continue;

    console.log(`Migrating space: ${spaceKey}`);
    const spaceIndex = JSON.parse(fs.readFileSync(spaceIndexFile, 'utf8'));

    for (const pageId in spaceIndex) {
      const pageMeta = spaceIndex[pageId];
      globalIndex[pageId] = pageMeta;

      const dataEntry = {
        base: '',
        current: '',
        conflict: '',
        commits: []
      };

      const basePath = path.join(spaceDir, `${pageId}.base.xhtml`);
      const currentPath = path.join(spaceDir, `${pageId}.current.xhtml`);
      const conflictPath = path.join(spaceDir, `${pageId}.conflict_remote.xhtml`);

      if (fs.existsSync(basePath)) dataEntry.base = fs.readFileSync(basePath, 'utf8');
      if (fs.existsSync(currentPath)) dataEntry.current = fs.readFileSync(currentPath, 'utf8');
      if (fs.existsSync(conflictPath)) dataEntry.conflict = fs.readFileSync(conflictPath, 'utf8');

      globalData[pageId] = dataEntry;
      migratedCount++;
    }

    // Commits history for the space
    const commitsHistoryPath = path.join(spaceDir, 'commits', 'history.json');
    if (fs.existsSync(commitsHistoryPath)) {
      const history = JSON.parse(fs.readFileSync(commitsHistoryPath, 'utf8'));
      for (const h of history) {
        if (h.pageId && globalData[h.pageId]) {
          const patchPath = path.join(spaceDir, 'commits', `${h.pageId}_${h.commitId}.patch`);
          if (fs.existsSync(patchPath)) {
            h.patch = fs.readFileSync(patchPath, 'utf8');
          }
          globalData[h.pageId].commits.push(h);
        }
      }
    }
  }

  fs.writeFileSync(globalIndexFile, JSON.stringify(globalIndex, null, 2), 'utf8');
  fs.writeFileSync(globalDataFile, JSON.stringify(globalData), 'utf8');

  console.log(`Migration complete. Migrated ${migratedCount} pages to confluence_data.json`);
}

migrate();
