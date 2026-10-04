const fs = require('fs');
const path = require('path');

let workspaceRoot = path.resolve(__dirname, '../../..');
const srcDir = path.join(workspaceRoot, 'src');

if (!fs.existsSync(srcDir)) {
  console.error("src directory not found");
  process.exit(0);
}

const aliases = {
  '@app': path.join(workspaceRoot, 'src/app'),
  '@pages': path.join(workspaceRoot, 'src/pages'),
  '@widgets': path.join(workspaceRoot, 'src/widgets'),
  '@features': path.join(workspaceRoot, 'src/features'),
  '@entities': path.join(workspaceRoot, 'src/entities'),
  '@shared': path.join(workspaceRoot, 'src/shared'),
  '@': path.join(workspaceRoot, 'src'),
};

const extensions = [
  '.ts', '.tsx', '.js', '.jsx', '.css', '.svg', '.json',
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx'
];

function resolveImportToFile(resolvedPath) {
  if (fs.existsSync(resolvedPath)) {
    const stat = fs.statSync(resolvedPath);
    if (stat.isFile()) return resolvedPath;
  }
  for (const ext of extensions) {
    const p = resolvedPath + ext;
    if (fs.existsSync(p)) {
      const stat = fs.statSync(p);
      if (stat.isFile()) return p;
    }
  }
  return null;
}

// Find all directories in src/widgets/svg-editor/plugins (including subdirectories)
// that contain index.ts or index.tsx
const modules = [];

function findModules(dir) {
  if (!fs.existsSync(dir)) return;
  const list = fs.readdirSync(dir);
  let hasIndex = false;
  
  for (const file of list) {
    if (file === 'index.ts' || file === 'index.tsx') {
      hasIndex = true;
      break;
    }
  }
  
  if (hasIndex) {
    modules.push(dir);
  }
  
  // Recurse into subdirectories
  for (const file of list) {
    const fullPath = path.join(dir, file);
    if (file !== 'node_modules' && file !== '.git' && file !== '.archives' && fs.statSync(fullPath).isDirectory()) {
      findModules(fullPath);
    }
  }
}

findModules(path.join(srcDir, 'widgets/svg-editor/plugins'));

const offendingImports = [];
const allSourceFiles = new Set();
const usedFiles = new Set();

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const importRegex = /from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1] || match[2] || match[3];
    if (!importPath) continue;

    let resolved = importPath;
    for (const [alias, aliasPath] of Object.entries(aliases)) {
      if (importPath === alias) {
        resolved = aliasPath;
        break;
      } else if (importPath.startsWith(alias + '/')) {
        resolved = path.join(aliasPath, importPath.slice(alias.length + 1));
        break;
      }
    }

    if (importPath.startsWith('.')) {
      resolved = path.resolve(path.dirname(filePath), importPath);
    }

    if (path.isAbsolute(resolved)) {
      const resolvedFile = resolveImportToFile(resolved);
      if (resolvedFile) {
        usedFiles.add(path.resolve(resolvedFile));
      }

      // Check which module contains this resolved path
      for (const mod of modules) {
        // If the file itself is inside this module, skip
        if (filePath.startsWith(mod + path.sep) || filePath === mod) {
          continue;
        }
        
        const relative = path.relative(mod, resolved);
        const isInside = !relative.startsWith('..') && !path.isAbsolute(relative) && relative !== '';
        
        if (isInside) {
          const relativeLower = relative.toLowerCase().replace(/\\/g, '/');
          const isEntryFile = relativeLower === 'index' || 
                              relativeLower === 'index.ts' || 
                              relativeLower === 'index.tsx' || 
                              relativeLower === 'types' || 
                              relativeLower === 'types.ts';
          if (!isEntryFile) {
            offendingImports.push({
              file: path.relative(workspaceRoot, filePath),
              importPath,
              modulePath: path.relative(workspaceRoot, mod),
              resolvedSubpath: relativeLower
            });
          }
        }
      }
    }
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (file === 'node_modules' || file === '.git' || file === '.archives') {
        return;
      }
      walk(fullPath);
    } else {
      const ext = path.extname(file);
      if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
        allSourceFiles.add(path.resolve(fullPath));
        checkFile(fullPath);
      }
    }
  });
}

walk(srcDir);

// Filter dead files
const deadFiles = [];
const entryPoints = [
  path.join(srcDir, 'main.tsx'),
  path.join(srcDir, 'index.tsx'),
  path.join(srcDir, 'main.ts'),
  path.join(srcDir, 'index.ts'),
  path.join(srcDir, 'vite-env.d.ts'),
];
const normalizedEntryPoints = entryPoints.map(p => path.resolve(p));

function isInsidePackedPlugin(filePath) {
  let currentDir = path.dirname(filePath);
  const pluginsDir = path.join(srcDir, 'widgets/svg-editor/plugins');
  
  while (currentDir.startsWith(pluginsDir)) {
    if (fs.existsSync(path.join(currentDir, 'index.js'))) {
      return true;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  return false;
}

allSourceFiles.forEach(file => {
  if (normalizedEntryPoints.includes(file)) return;
  if (file.endsWith('.d.ts')) return;

  const filename = path.basename(file);
  if (filename === 'safelist.tsx') return;

  if (filename.includes('.test.') || filename.includes('.spec.') || filename === 'setupTests.ts' || filename === 'setupTests.js') {
    return;
  }

  if (isInsidePackedPlugin(file)) return;

  if (!usedFiles.has(file)) {
    deadFiles.push(path.relative(workspaceRoot, file));
  }
});

let hasErrors = false;

if (offendingImports.length > 0) {
  console.error("\n[ARCH ERROR] Found illegal cross-module internal imports:");
  offendingImports.forEach(item => {
    console.error(`  - File:   ${item.file}`);
    console.error(`    Module: ${item.modulePath}`);
    console.error(`    Import: ${item.importPath} (points to internal: ${item.resolvedSubpath})`);
  });
  console.error("\nFix these imports to go through the module's main index file.\n");
  hasErrors = true;
}

if (deadFiles.length > 0) {
  console.error("\n[DEAD CODE ERROR] Found unused (dead) files:");
  deadFiles.forEach(file => {
    console.error(`  - ${file}`);
  });
  console.error("\nRemove these files or import them if they are needed.\n");
  hasErrors = true;
}

if (hasErrors) {
  process.exit(1);
} else {
  console.log("[ARCH CHECK] All imports conform to architectural rules. No dead files found.");
  process.exit(0);
}
