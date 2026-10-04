/**
 * Standalone utility to clean up debug agent hooks and logs from the source code.
 * Searches recursively through files and removes blocks wrapped in debug markers:
 * // === START DEBUG AGENT ===
 * ...
 * // === END DEBUG AGENT ===
 */

const fs = require('fs');
const path = require('path');

function findProjectRoot(startDir) {
  let current = startDir;
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json')) || fs.existsSync(path.join(current, '.git'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return process.cwd();
}

const rootDir = findProjectRoot(__dirname);
const TARGET_DIR = path.join(rootDir, 'src');
const FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.html', '.css'];

// Regex to match debug blocks (including trailing newlines)
const DEBUG_BLOCK_REGEX = /\/\/\s*===\s*START DEBUG AGENT\s*===[\s\S]*?\/\/\s*===\s*END DEBUG AGENT\s*===\r?\n?/g;

// Regex fallback for legacy debug hooks if they were inserted without markers
const LEGACY_HOOK_REGEX = /\/\*\s*\[DEBUG-HOOK\][\s\S]*?typeof\s+window\s*!==\s*'undefined'[\s\S]*?__DEBUG_HOOK__[\s\S]*?\}\r?\n?/g;

// Keywords that indicate leftover debug code
const DEBUG_KEYWORDS = [
  'START DEBUG AGENT',
  'END DEBUG AGENT',
  '__DEBUG_HOOK__',
  '__DEBUG_TOAST__',
  'debug-agent-toast',
  'DEBUG_START',
  'DEBUG_END',
  'DEBUG_STATE_CHANGE',
  'DEBUG_TIMELINE',
  'DEBUG_PERFORMANCE',
  'DEBUG_RENDER_TRACKER',
  'DEBUG_EVENT_LEAK'
];

function cleanFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    let newContent = content;

    // Remove marked debug blocks
    if (DEBUG_BLOCK_REGEX.test(newContent)) {
      newContent = newContent.replace(DEBUG_BLOCK_REGEX, '');
    }

    // Remove legacy debug hooks if found
    if (newContent.includes('[DEBUG-HOOK]') && LEGACY_HOOK_REGEX.test(newContent)) {
      newContent = newContent.replace(LEGACY_HOOK_REGEX, '');
    }

    // Clean up single-line debug logs if any remain outside blocks
    const lines = newContent.split(/\r?\n/);
    const cleanedLines = lines.filter(line => {
      // Check if line contains any of the single-line log indicators
      return !line.includes('[DEBUG_START') && 
             !line.includes('[DEBUG_END') &&
             !line.includes('[DEBUG_STATE_CHANGE') &&
             !line.includes('[DEBUG_TIMELINE') &&
             !line.includes('[DEBUG_PERFORMANCE') &&
             !line.includes('[DEBUG_RENDER_TRACKER') &&
             !line.includes('[DEBUG_EVENT_LEAK');
    });

    newContent = cleanedLines.join('\n');

    if (newContent !== content) {
      fs.writeFileSync(filePath, newContent, 'utf-8');
      console.log(`[CLEANUP] Cleaned: ${path.relative(process.cwd(), filePath)}`);
      return true;
    }
  } catch (err) {
    console.error(`[CLEANUP] Failed to process file ${filePath}:`, err);
  }
  return false;
}

function walkDir(dir, callback) {
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        if (file !== 'node_modules' && file !== '.git' && file !== 'dist') {
          walkDir(fullPath, callback);
        }
      } else if (stat.isFile()) {
        if (FILE_EXTENSIONS.includes(path.extname(fullPath))) {
          callback(fullPath);
        }
      }
    }
  } catch (err) {
    console.error(`[CLEANUP] Error walking directory ${dir}:`, err);
  }
}

console.log(`[CLEANUP] Starting cleanup in: ${TARGET_DIR}`);
let totalCleaned = 0;
walkDir(TARGET_DIR, (filePath) => {
  if (cleanFile(filePath)) {
    totalCleaned++;
  }
});
console.log(`[CLEANUP] Finished initial pass. Cleaned ${totalCleaned} files.`);

// Verification pass (double check)
console.log(`[CLEANUP] Starting verification pass...`);
const leftovers = [];

walkDir(TARGET_DIR, (filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const keyword of DEBUG_KEYWORDS) {
        if (line.includes(keyword)) {
          leftovers.push({
            file: path.relative(process.cwd(), filePath),
            line: index + 1,
            keyword,
            content: line.trim()
          });
          break;
        }
      }
    });
  } catch (err) {
    console.error(`[CLEANUP-VERIFY] Failed to read ${filePath}:`, err);
  }
});

// Clean up temporary extracted_* directories in .logs folder
const logsDir = path.join(__dirname, '..', '.logs');
if (fs.existsSync(logsDir)) {
  try {
    const items = fs.readdirSync(logsDir);
    for (const item of items) {
      if (item.startsWith('extracted_')) {
        const fullPath = path.join(logsDir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
          console.log(`[CLEANUP] Removed temporary extracted directory: ${item}`);
        }
      }
    }
  } catch (err) {
    console.error(`[CLEANUP] Failed to clean temporary directories in .logs:`, err);
  }
}

if (leftovers.length > 0) {
  console.error(`\n[CLEANUP-WARNING] CRITICAL: Leftover debug markers or logs detected!`);
  leftovers.forEach(item => {
    console.error(`  at ${item.file}:${item.line} (found keyword '${item.keyword}'): "${item.content}"`);
  });
  process.exit(1);
} else {
  console.log(`[CLEANUP-SUCCESS] Verification complete. Zero debug leftovers found in source files.`);
}
