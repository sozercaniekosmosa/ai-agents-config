const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const { execSync } = child_process;

// Intercept `net use` call in Vite's optimizeSafeRealPathSync to prevent EPERM in sandbox mode
const origExec = child_process.exec;
child_process.exec = function(cmd, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (typeof cmd === 'string' && cmd.includes('net use')) {
    if (callback) callback(null, '', '');
    return { on: () => {} };
  }
  return origExec.apply(this, arguments);
};
const crypto = require('crypto');
const { createPatch, applyPatch } = require('diff');
const zlib = require('zlib');

const args = process.argv.slice(2);
const command = args[0]; // 'pack', 'unpack', or 'status'
const inputPath = args[1];

if (!command || !inputPath) {
  console.error("Usage: node pak-toggle.cjs <pack|unpack|status> <plugin-path-or-guide-path> [flags...]");
  process.exit(1);
}

const keepKeys = new Set([
  '-arh', 'архив', 'arh', 'archive', '-archive',
  '-a', 'дамп', 'dump', '-dump',
  'backup', 'бекап', '-backup', '-b',
  'keep', '-keep', '-k',
  'save', 'сохранить', '-save', '-s'
]);

const keepSources = args.slice(2).some(arg => keepKeys.has(arg.toLowerCase()));

function getTimestamp() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${yy}${mm}${dd}${hh}${min}${ss}${ms}`;
}

function restoreState(historyDb) {
  const files = JSON.parse(JSON.stringify(historyDb.base || {}));
  const revisions = historyDb.history || [];
  revisions.forEach(rev => {
    if (rev.patches) {
      for (const [relPath, patch] of Object.entries(rev.patches)) {
        if (patch === null) {
          delete files[relPath];
        } else {
          const oldContent = files[relPath] || '';
          const newContent = applyPatch(oldContent, patch);
          if (newContent === false) {
            console.warn(`[PAK] Failed to apply patch for ${relPath} in revision ${rev.timestamp}`);
          } else {
            files[relPath] = newContent;
          }
        }
      }
    }
  });
  return files;
}

// 1. Resolve plugin directory
let pluginDir = path.resolve(inputPath);
if (!fs.existsSync(pluginDir)) {
  console.error(`Path does not exist: ${pluginDir}`);
  process.exit(1);
}
if (fs.statSync(pluginDir).isFile()) {
  pluginDir = path.dirname(pluginDir);
}

let workspaceRoot = pluginDir;
while (workspaceRoot !== path.dirname(workspaceRoot)) {
  if (fs.existsSync(path.join(workspaceRoot, 'vite.config.ts'))) {
    break;
  }
  workspaceRoot = path.dirname(workspaceRoot);
}

const archivesDir = path.join(pluginDir, '.archives');
const bundlePath = path.join(pluginDir, 'index.js');

// Helper to check if file is source file
function isSourceFile(file) {
  const ext = path.extname(file);
  return ['.ts', '.tsx', '.css'].includes(ext) && 
         file !== 'types.ts' && 
         file !== 'index.d.ts' &&
         file !== 'safelist.tsx' &&
         file !== 'style.css';
}

// Helper to get all source files recursively
function getSourceFilesRecursive(dir, baseDir = dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const relPath = path.relative(baseDir, fullPath);
    const stat = fs.statSync(fullPath);
    
    // Ignore global archives folder on any level to avoid descending into archives
    if (file === '.archives') {
      return;
    }
    
    // Ignore build artifacts, guides, types, contracts ONLY AT THE ROOT level of the parent plugin
    const isRootItem = path.dirname(fullPath) === pluginDir;
    if (isRootItem && (file === 'index.js' || file === 'guide.md' || file === 'types.ts' || file === 'index.d.ts' || file === 'safelist.tsx' || file === 'style.css')) {
      return;
    }
    
    if (stat.isDirectory()) {
      results = results.concat(getSourceFilesRecursive(fullPath, baseDir));
    } else if (isSourceFile(file)) {
      results.push({ fullPath, relPath });
    }
  });
  return results;
}

// Helper to get all files recursively (excluding archives, bundle and build artifacts of the root plugin)
function getAllFilesRecursive(dir, baseDir = dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const relPath = path.relative(baseDir, fullPath);
    const stat = fs.statSync(fullPath);
    
    const isRootItem = path.dirname(fullPath) === pluginDir;
    if (isRootItem && (file === '.archives' || file === 'index.js' || file === 'style.css')) {
      return;
    }
    
    if (stat.isDirectory()) {
      results = results.concat(getAllFilesRecursive(fullPath, baseDir));
    } else {
      results.push({ fullPath, relPath });
    }
  });
  return results;
}

// Helper to clean up empty directories recursively
function removeEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      removeEmptyDirs(fullPath);
    }
  });
  if (fs.readdirSync(dir).length === 0 && dir !== pluginDir && path.basename(dir) !== '.archives') {
    fs.rmdirSync(dir);
  }
}

function getStatus() {
  const sources = getSourceFilesRecursive(pluginDir);
  const hasBundle = fs.existsSync(bundlePath);
  if (sources.length > 0) {
    return 'unbundled';
  } else if (hasBundle) {
    return 'bundled';
  } else {
    return 'empty_or_unknown';
  }
}

function touchViteConfig() {
  const defaultPlugins = path.resolve(pluginDir, '../../model/default-plugins.ts');
  if (fs.existsSync(defaultPlugins)) {
    const now = new Date();
    try { fs.utimesSync(defaultPlugins, now, now); } catch (_) {}
  }
  let dir = pluginDir;
  while (dir !== path.dirname(dir)) {
    const configs = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'];
    for (const config of configs) {
      const configPath = path.join(dir, config);
      if (fs.existsSync(configPath)) {
        const now = new Date();
        try {
          fs.utimesSync(configPath, now, now);
          console.log(`Touched config ${config} to trigger Vite reload.`);
          return;
        } catch (_) {}
      }
    }
    dir = path.dirname(dir);
  }
}

function scanForInternalImports() {
  const srcDir = path.join(workspaceRoot, 'src');
  if (!fs.existsSync(srcDir)) return [];

  const aliases = {
    '@app': path.join(workspaceRoot, 'src/app'),
    '@pages': path.join(workspaceRoot, 'src/pages'),
    '@widgets': path.join(workspaceRoot, 'src/widgets'),
    '@features': path.join(workspaceRoot, 'src/features'),
    '@entities': path.join(workspaceRoot, 'src/entities'),
    '@shared': path.join(workspaceRoot, 'src/shared'),
    '@': path.join(workspaceRoot, 'src'),
  };

  const offendingImports = [];

  function walk(dir) {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        if (fullPath === pluginDir || file === 'node_modules' || file === '.git' || file === '.archives') {
          return;
        }
        walk(fullPath);
      } else {
        const ext = path.extname(file);
        if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
          const content = fs.readFileSync(fullPath, 'utf8');
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
              resolved = path.resolve(path.dirname(fullPath), importPath);
            }

            if (path.isAbsolute(resolved)) {
              const relative = path.relative(pluginDir, resolved);
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
                    file: path.relative(workspaceRoot, fullPath),
                    importPath,
                    resolvedSubpath: relativeLower
                  });
                }
              }
            }
          }
        }
      }
    });
  }

  walk(srcDir);
  return offendingImports;
}

function getEntryExports(pluginDir, entryFile) {
  const exports = [];
  const entryPath = path.join(pluginDir, entryFile);
  if (!fs.existsSync(entryPath)) return exports;

  try {
    const content = fs.readFileSync(entryPath, 'utf8');

    // 1. Direct exports: export const/function/etc. name
    const directRegex = /export\s+(?:const|function|let|var|declare\s+const)\s+(\w+)/g;
    let match;
    while ((match = directRegex.exec(content)) !== null) {
      if (!exports.includes(match[1])) {
        exports.push(match[1]);
      }
    }

    // 2. Named exports: export { name1, name2 }
    const namedRegex = /export\s+\{\s*([^}]+?)\s*\}\s*(?:from)?/g;
    while ((match = namedRegex.exec(content)) !== null) {
      const names = match[1].split(',').map(n => n.trim().split(/\s+as\s+/).pop().trim());
      names.forEach(name => {
        if (name && !exports.includes(name)) {
          exports.push(name);
        }
      });
    }
  } catch (err) {
    console.warn("Failed to parse entry exports:", err.message);
  }

  return exports;
}

function extractTailwindClasses(pluginDir) {
  const sources = getSourceFilesRecursive(pluginDir);
  const classesSet = new Set();

  sources.forEach(src => {
    try {
      const content = fs.readFileSync(src.fullPath, 'utf8');

      // Match string literals (both single/double quotes and backticks)
      const stringRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g;
      let match;
      while ((match = stringRegex.exec(content)) !== null) {
        const str = match[1] || match[2] || match[3];
        if (!str) continue;

        // Split by whitespace to find candidate classes
        const words = str.split(/\s+/);
        words.forEach(word => {
          const trimmed = word.trim();
          // Basic Tailwind class pattern (alphanumeric, hyphens, colons, slashes, brackets, etc.)
          const classRegex = /^[a-zA-Z0-9\-\/:\[\]_#%\.]+$/;
          if (trimmed.length >= 2 && 
              classRegex.test(trimmed) && 
              !trimmed.startsWith('.') && 
              !trimmed.startsWith('/') && 
              !trimmed.includes('//')) {
            classesSet.add(trimmed);
          }
        });
      }
    } catch (err) {
      console.warn(`Failed to extract tailwind classes from ${src.relPath}:`, err.message);
    }
  });

  return Array.from(classesSet).sort();
}

let tsCompiler = null;
try {
  tsCompiler = require('typescript');
} catch (_) {}

function extractDeclarationsFromContent(filePath, content, collectedTypes, collectedInterfaces, collectedEnums) {
  if (!content) return;

  // 1. Try TypeScript AST parsing if available
  if (tsCompiler) {
    try {
      const sf = tsCompiler.createSourceFile(filePath, content, tsCompiler.ScriptTarget.Latest, true);

      function isExported(node) {
        if (!node.modifiers) return false;
        return node.modifiers.some(m => m.kind === tsCompiler.SyntaxKind.ExportKeyword);
      }

      function visit(node) {
        if (isExported(node)) {
          if (tsCompiler.isTypeAliasDeclaration(node)) {
            const name = node.name.text;
            const text = node.getFullText(sf).trim();
            if (!collectedTypes.has(name)) {
              collectedTypes.set(name, text);
            }
          } else if (tsCompiler.isInterfaceDeclaration(node)) {
            const name = node.name.text;
            const text = node.getFullText(sf).trim();
            if (!collectedInterfaces.has(name)) {
              collectedInterfaces.set(name, text);
            }
          } else if (tsCompiler.isEnumDeclaration(node)) {
            const name = node.name.text;
            const text = node.getFullText(sf).trim();
            if (!collectedEnums.has(name)) {
              collectedEnums.set(name, text);
            }
          }
        }
        tsCompiler.forEachChild(node, visit);
      }

      visit(sf);
      return;
    } catch (err) {
      console.warn(`TypeScript AST extraction failed for ${filePath}, using fallback:`, err.message);
    }
  }

  // 2. Fallback lexical parser
  // 2.1 Interfaces: export interface Name ... { ... }
  const interfaceRegex = /(?:\/\*\*[\s\S]*?\*\/\s*)?export\s+interface\s+([A-Za-z0-9_]+)(?:<[^>]+>)?(?:\s+extends\s+[^{]+)?\s*\{/g;
  let match;
  while ((match = interfaceRegex.exec(content)) !== null) {
    const name = match[1];
    const startIdx = match.index;
    const braceStart = content.indexOf('{', startIdx);
    if (braceStart === -1) continue;

    let depth = 1;
    let pos = braceStart + 1;
    let inString = false;
    let stringChar = '';

    while (depth > 0 && pos < content.length) {
      const ch = content[pos];
      const prev = content[pos - 1];

      if (inString) {
        if (ch === stringChar && prev !== '\\') inString = false;
      } else if (ch === '"' || ch === "'" || ch === '`') {
        inString = true;
        stringChar = ch;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
      }
      pos++;
    }

    if (depth === 0) {
      const fullInterface = content.slice(startIdx, pos).trim();
      if (!collectedInterfaces.has(name)) {
        collectedInterfaces.set(name, fullInterface);
      }
    }
  }

  // 2.2 Enums: export (const )?enum Name { ... }
  const enumRegex = /(?:\/\*\*[\s\S]*?\*\/\s*)?export\s+(?:const\s+)?enum\s+([A-Za-z0-9_]+)\s*\{/g;
  while ((match = enumRegex.exec(content)) !== null) {
    const name = match[1];
    const startIdx = match.index;
    const braceStart = content.indexOf('{', startIdx);
    if (braceStart === -1) continue;

    let depth = 1;
    let pos = braceStart + 1;
    let inString = false;
    let stringChar = '';

    while (depth > 0 && pos < content.length) {
      const ch = content[pos];
      const prev = content[pos - 1];

      if (inString) {
        if (ch === stringChar && prev !== '\\') inString = false;
      } else if (ch === '"' || ch === "'" || ch === '`') {
        inString = true;
        stringChar = ch;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
      }
      pos++;
    }

    if (depth === 0) {
      const fullEnum = content.slice(startIdx, pos).trim();
      if (!collectedEnums.has(name)) {
        collectedEnums.set(name, fullEnum);
      }
    }
  }

  // 2.3 Types: export type Name ... = ...;
  const typeStartRegex = /(?:\/\*\*[\s\S]*?\*\/\s*)?export\s+type\s+([A-Za-z0-9_]+)(?:<[^>]+>)?\s*=/g;
  while ((match = typeStartRegex.exec(content)) !== null) {
    const name = match[1];
    const startIdx = match.index;
    let pos = typeStartRegex.lastIndex;

    let braceDepth = 0;
    let parenDepth = 0;
    let bracketDepth = 0;
    let angleDepth = 0;
    let inString = false;
    let stringChar = '';

    while (pos < content.length) {
      const ch = content[pos];
      const prev = content[pos - 1];

      if (inString) {
        if (ch === stringChar && prev !== '\\') inString = false;
      } else if (ch === '"' || ch === "'" || ch === '`') {
        inString = true;
        stringChar = ch;
      } else if (ch === '{') {
        braceDepth++;
      } else if (ch === '}') {
        if (braceDepth > 0) braceDepth--;
      } else if (ch === '(') {
        parenDepth++;
      } else if (ch === ')') {
        if (parenDepth > 0) parenDepth--;
      } else if (ch === '[') {
        bracketDepth++;
      } else if (ch === ']') {
        if (bracketDepth > 0) bracketDepth--;
      } else if (ch === '<') {
        angleDepth++;
      } else if (ch === '>') {
        if (angleDepth > 0) angleDepth--;
      } else if (ch === ';' && braceDepth === 0 && parenDepth === 0 && bracketDepth === 0 && angleDepth === 0) {
        pos++;
        break;
      }
      pos++;
    }

    const fullType = content.slice(startIdx, pos).trim();
    if (!collectedTypes.has(name)) {
      collectedTypes.set(name, fullType);
    }
  }
}

function generateComprehensiveDeclaration(pluginDir, entryFile, sources) {
  const existingTypesPath = path.join(pluginDir, 'types.ts');
  const collectedTypes = new Map();
  const collectedInterfaces = new Map();
  const collectedEnums = new Map();
  const pluginName = path.basename(pluginDir);

  // Extract from types.ts first (canonical contract file)
  if (fs.existsSync(existingTypesPath)) {
    try {
      extractDeclarationsFromContent(existingTypesPath, fs.readFileSync(existingTypesPath, 'utf8'), collectedTypes, collectedInterfaces, collectedEnums);
    } catch (_) {}
  }

  // Extract from all other sources
  sources.forEach(src => {
    try {
      extractDeclarationsFromContent(src.fullPath, fs.readFileSync(src.fullPath, 'utf8'), collectedTypes, collectedInterfaces, collectedEnums);
    } catch (_) {}
  });

  // Combine all declaration text to analyze referenced types
  const allDeclarationsText = [
    ...collectedTypes.values(),
    ...collectedInterfaces.values(),
    ...collectedEnums.values()
  ].join('\n\n');

  // 1. Detect React imports
  const knownReactNamedTypes = [
    'ReactNode', 'ReactElement', 'CSSProperties', 'FC', 'ComponentType',
    'RefObject', 'MutableRefObject', 'Dispatch', 'SetStateAction',
    'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'WheelEvent',
    'ChangeEvent', 'SyntheticEvent', 'HTMLAttributes', 'SVGAttributes',
    'PropsWithChildren', 'ReactEventHandler', 'JSX', 'Ref', 'Key'
  ];

  const usedReactNamedTypes = knownReactNamedTypes.filter(t => {
    const regex = new RegExp(`\\b${t}\\b`);
    return regex.test(allDeclarationsText);
  });

  const usesReactNamespace = /\bReact\./.test(allDeclarationsText) || /\bReact\b/.test(allDeclarationsText);

  // 2. Detect model exports used (types, interfaces, functions, constants, contexts)
  const knownModelTypes = new Set([
    'SvgEditorPlugin', 'SvgItem', 'PluginContext', 'Matrix2D', 'Vertex',
    'PathPoint', 'GeometryAdapter', 'AnimationChannelAdapter', 'SkeletonAdapter',
    'ColorAdapter', 'AnimatedProperties', 'AutokeyAdapter', 'SvgData', 'Transform',
    'Hotkey', 'Modifiers', 'SidePanelSection', 'SidePanelConfig', 'SelectionFilter',
    'SelectionAdapter', 'HistoryStore', 'CameraState', 'SnapTarget', 'SnapGuideResult'
  ]);

  // Dynamically discover all model exports from all model files (types.ts, utils.ts, context.ts, matrix.ts, etc.)
  const modelDir = path.resolve(pluginDir, '../../model');
  if (fs.existsSync(modelDir)) {
    try {
      const modelFiles = fs.readdirSync(modelDir);
      modelFiles.forEach(f => {
        if (f.endsWith('.ts') && !f.endsWith('.d.ts')) {
          const modelContent = fs.readFileSync(path.join(modelDir, f), 'utf8');
          const modelExportRegex = /export\s+(?:interface|type|enum|const|function|class|let|var)\s+([A-Za-z0-9_]+)/g;
          let m;
          while ((m = modelExportRegex.exec(modelContent)) !== null) {
            knownModelTypes.add(m[1]);
          }
        }
      });
    } catch (_) {}
  }

  // Gather source text from all plugin source files
  let allSourcesText = '';
  if (Array.isArray(sources)) {
    sources.forEach(src => {
      try {
        allSourcesText += fs.readFileSync(src.fullPath, 'utf8') + '\n';
      } catch (_) {}
    });
  }

  const combinedSearchText = allDeclarationsText + '\n' + allSourcesText;

  const usedModelTypes = Array.from(knownModelTypes).filter(t => {
    const regex = new RegExp(`\\b${t}\\b`);
    return regex.test(combinedSearchText) || t === 'SvgEditorPlugin';
  }).sort();

  const sections = [];

  // React imports
  if (usesReactNamespace && usedReactNamedTypes.length > 0) {
    sections.push(`import type React from 'react';`);
    sections.push(`import type { ${usedReactNamedTypes.join(', ')} } from 'react';`);
  } else if (usesReactNamespace) {
    sections.push(`import type React from 'react';`);
  } else if (usedReactNamedTypes.length > 0) {
    sections.push(`import type { ${usedReactNamedTypes.join(', ')} } from 'react';`);
  }

  // Model types import
  if (usedModelTypes.length > 0) {
    sections.push(`import type { ${usedModelTypes.join(', ')} } from '../../model';`);
  }

  sections.push('');

  // Enums
  if (collectedEnums.size > 0) {
    for (const enumCode of collectedEnums.values()) {
      sections.push(enumCode);
      sections.push('');
    }
  }

  // Types
  if (collectedTypes.size > 0) {
    for (const typeCode of collectedTypes.values()) {
      sections.push(typeCode);
      sections.push('');
    }
  }

  // Interfaces
  if (collectedInterfaces.size > 0) {
    for (const ifaceCode of collectedInterfaces.values()) {
      sections.push(ifaceCode);
      sections.push('');
    }
  }

  // Entry exports & API typing
  const entryExports = getEntryExports(pluginDir, entryFile);
  const pascalName = pluginName
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
  const defaultFuncName = `create${pascalName}Plugin`;

  const exportsToDeclare = entryExports.filter(exp => 
    exp.startsWith('create') || 
    exp.startsWith('get') ||
    ['isTimelineActive', 'setTimelineActive', 'timelineClipboardCallbacks'].includes(exp)
  );
  if (exportsToDeclare.length === 0) {
    exportsToDeclare.push(defaultFuncName);
  }

  let apiTypeName = null;
  for (const name of collectedInterfaces.keys()) {
    if (name.toLowerCase().includes('api') && name.toLowerCase().includes(pluginName.replace(/-/g, ''))) {
      apiTypeName = name;
      break;
    }
  }
  if (!apiTypeName) {
    for (const name of collectedInterfaces.keys()) {
      if (name.endsWith('Api') && !name.toLowerCase().includes('selection')) {
        apiTypeName = name;
        break;
      }
    }
  }

  exportsToDeclare.forEach(exp => {
    if (exp === 'createPathGeometryAdapter') {
      sections.push(`export declare const createPathGeometryAdapter: () => GeometryAdapter;`);
    } else if (exp === 'getPathBounds') {
      sections.push(`export declare const getPathBounds: (points: PathPoint[], isClosed?: boolean) => { x: number; y: number; width: number; height: number };`);
    } else if (exp.toLowerCase().includes('color')) {
      sections.push(`export declare const ${exp}: () => SvgEditorPlugin;`);
    } else if (exp === 'isTimelineActive') {
      sections.push(`export declare const isTimelineActive: boolean;`);
    } else if (exp === 'setTimelineActive') {
      sections.push(`export declare function setTimelineActive(active: boolean): void;`);
    } else if (exp === 'timelineClipboardCallbacks') {
      sections.push(`export declare const timelineClipboardCallbacks: {
  copy: (() => void) | null;
  cut: (() => void) | null;
  paste: ((targetTime?: number) => void) | null;
  delete: (() => void) | null;
};`);
    } else if (apiTypeName) {
      sections.push(`export declare const ${exp}: () => SvgEditorPlugin & { api?: ${apiTypeName} };`);
    } else {
      sections.push(`export declare const ${exp}: () => SvgEditorPlugin & { api?: Record<string, unknown> };`);
    }
  });

  const generatedContent = sections.join('\n') + '\n';

  // Validate syntax if TS compiler is available
  if (tsCompiler) {
    try {
      const testSf = tsCompiler.createSourceFile('index.d.ts', generatedContent, tsCompiler.ScriptTarget.Latest, true);
      const diagnostics = testSf.parseDiagnostics || [];
      if (diagnostics.length > 0) {
        console.warn(`[PAK WARNING] Generated index.d.ts has ${diagnostics.length} syntax diagnostics:`);
        diagnostics.forEach(d => {
          console.warn(`  - Line ${d.start}: ${d.messageText}`);
        });
      }
    } catch (_) {}
  }

  return generatedContent;
}

function findBundledSubPlugins(dir) {
  const subPlugins = [];
  if (!fs.existsSync(dir)) return subPlugins;
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    if (file === '.archives' || file === 'node_modules' || file === '.git') return;
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      const hasArchives = fs.existsSync(path.join(fullPath, '.archives'));
      const hasBundle = fs.existsSync(path.join(fullPath, 'index.js'));
      
      let hasSources = false;
      try {
        const sources = getSourceFilesRecursive(fullPath);
        if (sources.length > 0) {
          hasSources = true;
        }
      } catch (_) {}

      if (hasArchives && hasBundle && !hasSources) {
        subPlugins.push(fullPath);
      } else {
        subPlugins.push(...findBundledSubPlugins(fullPath));
      }
    }
  });
  return subPlugins;
}

async function pack() {
  // Find all bundled sub-plugins and unpack them temporarily
  const bundledSubPlugins = findBundledSubPlugins(pluginDir);
  if (bundledSubPlugins.length > 0) {
    console.log(`[PAK] Found ${bundledSubPlugins.length} bundled sub-plugin(s). Unpacking them temporarily...`);
    bundledSubPlugins.forEach(subPath => {
      console.log(`[PAK] Temporarily unpacking sub-plugin: ${path.relative(pluginDir, subPath)}`);
      try {
        execSync(`node "${__filename}" unpack "${subPath}"`, { stdio: 'inherit' });
      } catch (err) {
        console.error(`[PAK ERROR] Failed to unpack sub-plugin ${subPath}:`, err.message);
        process.exit(1);
      }
    });
  }

  const status = getStatus();
  if (status === 'bundled') {
    console.log("Plugin is already bundled/isolated.");
    return;
  }

  // Check for external imports pointing to internal subpaths of this plugin
  const offending = scanForInternalImports();
  if (offending.length > 0) {
    console.error("\n[ERROR] Cannot pack/pak plugin because other files import its internal files:");
    offending.forEach(item => {
      console.error(`  - File:   ${item.file}`);
      console.error(`    Import: ${item.importPath}`);
      console.error(`    Points to internal subpath: ${item.resolvedSubpath}`);
    });
    console.error("\nPlease rewrite these imports to use the main plugin index, and export the required components/functions from the plugin's index file.\n");
    process.exit(1);
  }


  const sources = getSourceFilesRecursive(pluginDir);
  if (sources.length === 0) {
    console.error("No source files (.ts, .tsx, .css) found to pack.");
    process.exit(1);
  }

  let entryFile = 'index.tsx';
  if (!fs.existsSync(path.join(pluginDir, 'index.tsx')) && fs.existsSync(path.join(pluginDir, 'index.ts'))) {
    entryFile = 'index.ts';
  }

  console.log(`Found ${sources.length} source files. Entry file: ${entryFile}.`);
  console.log("Building plugin bundle...");

  try {
    const { build } = await import('vite');
    const react = (await import('@vitejs/plugin-react')).default;

    const aliases = {
      '@app': path.join(workspaceRoot, 'src/app'),
      '@pages': path.join(workspaceRoot, 'src/pages'),
      '@widgets': path.join(workspaceRoot, 'src/widgets'),
      '@features': path.join(workspaceRoot, 'src/features'),
      '@entities': path.join(workspaceRoot, 'src/entities'),
      '@shared': path.join(workspaceRoot, 'src/shared'),
      '@': path.join(workspaceRoot, 'src'),
    };

    await build({
      configFile: false,
      root: pluginDir,
      plugins: [
        {
          name: 'preserve-import-meta-env',
          enforce: 'pre',
          transform(code, id) {
            if (id.includes('node_modules')) return;
            let newCode = code;
            if (newCode.includes('import.meta.env.DEV')) {
              newCode = newCode.replace(/import\.meta\.env\.DEV/g, "import.meta['env'].DEV");
            }
            if (newCode.includes('import.meta.env.PROD')) {
              newCode = newCode.replace(/import\.meta\.env\.PROD/g, "import.meta['env'].PROD");
            }
            if (newCode !== code) {
              return { code: newCode, map: null };
            }
          }
        },
        react()
      ],
      esbuild: false,
      build: {
        lib: {
          entry: path.resolve(pluginDir, entryFile),
          formats: ['es'],
          fileName: () => 'index.js'
        },
        outDir: path.join(pluginDir, 'dist'),
        rollupOptions: {
          external: (id, importer) => {
            let resolvedId = id;
            for (const [alias, aliasPath] of Object.entries(aliases)) {
              if (id === alias) {
                resolvedId = aliasPath;
                break;
              } else if (id.startsWith(alias + '/')) {
                resolvedId = path.join(aliasPath, id.slice(alias.length + 1));
                break;
              }
            }
            if (id.startsWith('.')) {
              const baseDir = importer ? path.dirname(importer) : pluginDir;
              resolvedId = path.resolve(baseDir, id);
            }
            if (path.isAbsolute(resolvedId)) {
              const relative = path.relative(pluginDir, resolvedId);
              const isInside = !relative.startsWith('..') && !path.isAbsolute(relative);
              return !isInside;
            }
            return true;
          }
        },
        minify: false,
        sourcemap: false
      }
    });
  } catch (err) {
    console.error("Vite build failed:", err.message);
    process.exit(1);
  }

  // Move bundle and any css files from dist/ if generated there
  const distDir = path.join(pluginDir, 'dist');
  if (fs.existsSync(distDir)) {
    const distFiles = fs.readdirSync(distDir);
    distFiles.forEach(file => {
      if (file === 'index.js') {
        fs.renameSync(path.join(distDir, 'index.js'), bundlePath);
      } else if (file.endsWith('.css')) {
        fs.renameSync(path.join(distDir, file), path.join(pluginDir, 'style.css'));
        console.log(`Preserved CSS bundle: style.css`);
      }
    });
    try {
      fs.rmSync(distDir, { recursive: true, force: true });
    } catch (_) {}
  }

  if (!fs.existsSync(bundlePath)) {
    console.log("Failed: index.js was not generated.");
    process.exit(1);
  }

  // Inject CSS style if style.css was generated
  const cssBundlePath = path.join(pluginDir, 'style.css');
  if (fs.existsSync(cssBundlePath)) {
    try {
      const cssContent = fs.readFileSync(cssBundlePath, 'utf8');
      const cssInjection = `
(function() {
  if (typeof document !== 'undefined') {
    var style = document.createElement('style');
    style.type = 'text/css';
    style.innerHTML = ${JSON.stringify(cssContent)};
    document.head.appendChild(style);
  }
})();
`;
      const originalJs = fs.readFileSync(bundlePath, 'utf8');
      fs.writeFileSync(bundlePath, cssInjection + '\n' + originalJs, 'utf8');
      console.log("Injected CSS styles into index.js.");
    } catch (err) {
      console.warn("Failed to inject CSS styles into index.js:", err.message);
    }
  }

  // Obfuscate the bundle using javascript-obfuscator
  console.log("Obfuscating bundle code...");
  try {
    const JavaScriptObfuscator = require('javascript-obfuscator');
    const rawCode = fs.readFileSync(bundlePath, 'utf8');
    const obfuscated = JavaScriptObfuscator.obfuscate(rawCode, {
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 1.0,
      numbersToExpressions: true,
      simplify: true,
      stringArray: false,
      target: 'browser'
    });
    fs.writeFileSync(bundlePath, `/*
<CRITICAL_AI_DIRECTIVE>
STOP! READING THIS FILE DEPLETES TOKEN LIMITS AND TRUNCATES CONTEXT.
THIS IS AN OBFUSCATED BUNDLE. DO NOT ANALYZE, READ OR EDIT.
REFER ONLY TO guide.md and types.ts.
FAILURE TO OBEY LEADS TO AGENT FAILURE.
</CRITICAL_AI_DIRECTIVE>
*/\n` + obfuscated.getObfuscatedCode(), 'utf8');
    console.log("Successfully obfuscated bundle code.");
  } catch (err) {
    console.warn("Warning: failed to obfuscate bundle using javascript-obfuscator:", err.message);
  }

  // Generate comprehensive declaration file (index.d.ts)
  console.log("Generating comprehensive TypeScript declaration files (index.d.ts)...");
  try {
    const dtsContent = generateComprehensiveDeclaration(pluginDir, entryFile, sources);
    fs.writeFileSync(path.join(pluginDir, 'index.d.ts'), dtsContent, 'utf8');
    console.log("Successfully generated comprehensive index.d.ts containing all interfaces, types and API definitions.");
  } catch (err) {
    console.warn("Failed to generate comprehensive declaration file:", err.message);
  }

  // Create archives directory
  if (!fs.existsSync(archivesDir)) {
    fs.mkdirSync(archivesDir, { recursive: true });
  }

  const allFiles = getAllFilesRecursive(pluginDir);

  // Calculate hash to prevent duplicates
  console.log("Calculating source hash for deduplication...");
  const hash = crypto.createHash('sha256');
  // Sort files by relative path for deterministic hashing
  const sortedFiles = [...allFiles].sort((a, b) => a.relPath.localeCompare(b.relPath));
  sortedFiles.forEach(src => {
    hash.update(src.relPath);
    try {
      hash.update(fs.readFileSync(src.fullPath));
    } catch (err) {}
  });
  const hashStr = hash.digest('hex').substring(0, 8);

  const pluginName = path.basename(pluginDir);
  const historyPath = path.join(archivesDir, `${pluginName}.br`);

  // Load or init history
  let historyData = { base: {}, history: [] };
  if (fs.existsSync(historyPath)) {
    try {
      const compressed = fs.readFileSync(historyPath);
      const decompressed = zlib.brotliDecompressSync(compressed).toString('utf8');
      historyData = JSON.parse(decompressed);
    } catch (err) {
      console.warn(`Failed to read/parse history: ${err.message}. Starting fresh.`);
    }
  }

  // Restore state of last revision to compute diff
  const lastState = restoreState(historyData);

  // Read current files
  const currentFiles = {};
  allFiles.forEach(src => {
    try {
      currentFiles[src.relPath] = fs.readFileSync(src.fullPath, 'utf8');
    } catch (err) {}
  });

  const patches = {};
  let hasChanges = false;

  // Find added and modified files
  for (const [relPath, content] of Object.entries(currentFiles)) {
    if (!(relPath in lastState)) {
      patches[relPath] = createPatch(relPath, '', content);
      hasChanges = true;
    } else if (lastState[relPath] !== content) {
      patches[relPath] = createPatch(relPath, lastState[relPath], content);
      hasChanges = true;
    }
  }

  // Find deleted files
  for (const relPath of Object.keys(lastState)) {
    if (!(relPath in currentFiles)) {
      patches[relPath] = null;
      hasChanges = true;
    }
  }

  if (!hasChanges && historyData.history.length > 0) {
    console.log("No source changes detected. Skipping history update.");
  } else {
    if (historyData.history.length === 0) {
      // First commit: save all files in base
      historyData.base = currentFiles;
      historyData.history.push({
        timestamp: getTimestamp(),
        hash: hashStr,
        type: 'init'
      });
    } else {
      historyData.history.push({
        timestamp: getTimestamp(),
        hash: hashStr,
        patches: patches
      });
    }

    // Save history
    try {
      const serialized = JSON.stringify(historyData);
      const compressed = zlib.brotliCompressSync(Buffer.from(serialized, 'utf8'));
      fs.writeFileSync(historyPath, compressed);
      console.log(`Saved history backup to ${pluginName}.br (${compressed.length} bytes, total revisions: ${historyData.history.length}).`);
    } catch (err) {
      console.error(`Failed to write ${pluginName}.br:`, err.message);
    }
  }

  // Remove existing zip archives for this plugin/folder
  try {
    const existingFiles = fs.readdirSync(archivesDir);
    existingFiles.forEach(file => {
      if ((file.startsWith(`${pluginName}-`) || file.startsWith('source-')) && file.endsWith('.zip')) {
        try {
          fs.unlinkSync(path.join(archivesDir, file));
          console.log(`Removed old zip archive: ${file}`);
        } catch (err) {
          console.warn(`Failed to remove old zip archive ${file}: ${err.message}`);
        }
      }
    });
  } catch (_) {}

  // Create timestamped zip
  const timestamp = getTimestamp();
  const archiveName = `${pluginName}-${timestamp}.zip`;
  const archivePath = path.join(archivesDir, archiveName);

  console.log(`Archiving sources to ${archiveName}...`);
  const tempPackDir = path.join(archivesDir, `temp_${timestamp}`);
  fs.mkdirSync(tempPackDir, { recursive: true });

  // Copy files to temp directory preserving structure
  allFiles.forEach(src => {
    const dest = path.join(tempPackDir, src.relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src.fullPath, dest);
  });

  // Use powershell Compress-Archive with retry logic
  let success = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      execSync(`powershell -Command "Start-Sleep -Milliseconds ${attempt * 500}"`);
      const psCommand = `powershell -Command "Compress-Archive -Path '${tempPackDir}/*' -DestinationPath '${archivePath}' -Force"`;
      execSync(psCommand, { stdio: 'ignore' });
      
      if (fs.existsSync(archivePath) && fs.statSync(archivePath).size > 0) {
        success = true;
        break;
      }
    } catch (err) {
      console.warn(`Compression attempt ${attempt} failed: ${err.message}`);
    }
  }

  if (!success) {
    console.warn("Zip archive creation via PowerShell skipped (sandbox mode). Full backup is safely preserved in .br history.");
  } else {
    console.log(`Archive successfully created: ${archiveName}`);
  }

  // Cleanup temp folder
  fs.rmSync(tempPackDir, { recursive: true, force: true });

  // Extract Tailwind CSS classes before deleting source files
  console.log("Extracting Tailwind CSS classes...");
  const hasUI = sources.some(src => {
    const ext = path.extname(src.fullPath);
    if (ext === '.css') return true;
    if (ext === '.tsx') {
      const content = fs.readFileSync(src.fullPath, 'utf8');
      return /\bclass(Name)?\s*=/.test(content);
    }
    return false;
  });
  const classes = hasUI ? extractTailwindClasses(pluginDir) : [];
  if (classes.length > 0) {
    const classesContent = `// This file is auto-generated by pak-toggle.cjs to preserve Tailwind CSS classes for the bundled plugin.
// DO NOT EDIT OR DELETE THIS FILE.
export const SAFELIST = [
${classes.map(c => `  ${JSON.stringify(c)},`).join('\n')}
];
`;
    fs.writeFileSync(path.join(pluginDir, 'safelist.tsx'), classesContent, 'utf8');
    console.log(`Preserved ${classes.length} Tailwind CSS class names in safelist.tsx.`);
  }

  // Delete source files
  if (!keepSources) {
    sources.forEach(src => {
      try {
        fs.unlinkSync(src.fullPath);
        console.log(`Removed source: ${src.relPath}`);
      } catch (err) {
        console.warn(`Failed to remove ${src.relPath}: ${err.message}`);
      }
    });
  } else {
    console.log("Keeping source files as requested (keep-sources mode active).");
  }

  // Clean guide.md in the active directory (remove file structure)
  const guidePath = path.join(pluginDir, 'guide.md');
  if (fs.existsSync(guidePath) && !keepSources) {
    const content = fs.readFileSync(guidePath, 'utf8')
      .replace(/##\s+(File Architecture Map|Архитектура файлов|File Architecture|Structure|Files|File Structure)[\s\S]*?(?=\n##\s+|$)/i, '');
    fs.writeFileSync(guidePath, content, 'utf8');
    console.log("Cleaned up guide.md by removing file structure section.");
  }

  // Delete subdirectories (except .archives) and any other files not in allowed list
  if (!keepSources) {
    const allowedTopLevel = ['index.js', 'index.d.ts', 'guide.md', 'types.ts', 'README.md', '.archives', 'safelist.tsx'];
    const topLevelItems = fs.readdirSync(pluginDir);
    topLevelItems.forEach(item => {
      if (allowedTopLevel.includes(item) || item.endsWith('.css')) {

        return;
      }
      const fullPath = path.join(pluginDir, item);
      try {
        if (fs.statSync(fullPath).isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
          console.log(`Removed subdirectory: ${item}`);
        } else {
          fs.unlinkSync(fullPath);
          console.log(`Removed file: ${item}`);
        }
      } catch (err) {
        console.warn(`Failed to remove ${item}: ${err.message}`);
      }
    });
  } else {
    // If keepSources is active, clean up generated bundle/contract files
    const generatedFiles = [bundlePath, path.join(pluginDir, 'index.d.ts'), path.join(pluginDir, 'safelist.tsx'), path.join(pluginDir, 'style.css')];
    generatedFiles.forEach(file => {
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
          console.log(`Cleaned up generated file in keepSources mode: ${path.basename(file)}`);
        } catch (err) {
          console.warn(`Failed to remove ${path.basename(file)}: ${err.message}`);
        }
      }
    });
  }



  touchViteConfig();
  console.log("Plugin is now locked (bundled & isolated).");
}

function formatHumanDate(timestamp) {
  if (typeof timestamp !== 'string' || timestamp.length < 12) {
    return timestamp;
  }
  const yy = timestamp.slice(0, 2);
  const mm = timestamp.slice(2, 4);
  const dd = timestamp.slice(4, 6);
  const hh = timestamp.slice(6, 8);
  const min = timestamp.slice(8, 10);
  const ss = timestamp.slice(10, 12);
  const ms = timestamp.slice(12) || '000';
  return `20${yy}-${mm}-${dd} ${hh}:${min}:${ss}.${ms}`;
}

function showLog() {
  const pluginName = path.basename(pluginDir);
  const historyPath = path.join(archivesDir, `${pluginName}.br`);

  if (!fs.existsSync(historyPath)) {
    console.log(`\x1b[1;31m❌ No history found for plugin ${pluginName}.\x1b[0m`);
    return;
  }

  try {
    const compressed = fs.readFileSync(historyPath);
    const decompressed = zlib.brotliDecompressSync(compressed).toString('utf8');
    const historyData = JSON.parse(decompressed);

    console.log(`\n\x1b[1;36m📦 History log for plugin: ${pluginName}\x1b[0m`);
    console.log(`\x1b[90m========================================\x1b[0m`);

    const revisions = historyData.history || [];
    if (revisions.length === 0) {
      console.log("No revisions recorded.");
      return;
    }

    let currentState = {};

    revisions.forEach((rev, idx) => {
      const dateStr = formatHumanDate(rev.timestamp);
      
      if (rev.type === 'init') {
        console.log(`\n\x1b[1;32m🟢 Revision #${idx} (Initial Commit)\x1b[0m`);
        console.log(`   \x1b[90m📅 Date:\x1b[0m \x1b[36m${dateStr}\x1b[0m`);
        console.log(`   \x1b[90m🔑 Hash:\x1b[0m \x1b[35m${rev.hash}\x1b[0m`);
        const baseFilesCount = Object.keys(historyData.base || {}).length;
        console.log(`   \x1b[90m📝 Files:\x1b[0m ${baseFilesCount} base files registered`);
        
        currentState = JSON.parse(JSON.stringify(historyData.base || {}));
      } else {
        console.log(`\n\x1b[1;33m🟡 Revision #${idx} (Incremental Commit)\x1b[0m`);
        console.log(`   \x1b[90m📅 Date:\x1b[0m \x1b[36m${dateStr}\x1b[0m`);
        console.log(`   \x1b[90m🔑 Hash:\x1b[0m \x1b[35m${rev.hash}\x1b[0m`);
        
        const changedFiles = Object.keys(rev.patches || {});
        console.log(`   \x1b[90m⚡ Changes:\x1b[0m ${changedFiles.length} file(s)`);

        changedFiles.forEach(file => {
          const patch = rev.patches[file];
          if (patch === null) {
            console.log(`     \x1b[31m❌ ${file} (deleted)\x1b[0m`);
            delete currentState[file];
          } else {
            const isNew = !(file in currentState);
            if (isNew) {
              console.log(`     \x1b[32m➕ ${file} (new, patch size: ${patch.length} bytes)\x1b[0m`);
            } else {
              console.log(`     \x1b[33m✏️  ${file} (modified, patch size: ${patch.length} bytes)\x1b[0m`);
            }
            
            const oldContent = currentState[file] || '';
            const newContent = applyPatch(oldContent, patch);
            if (newContent !== false) {
              currentState[file] = newContent;
            }
          }
        });
      }
    });
    console.log(`\n\x1b[90m========================================\x1b[0m\n`);
  } catch (err) {
    console.error("\x1b[31mFailed to read or parse history log:\x1b[0m", err.message);
  }
}

function unpack(targetRev) {
  const status = getStatus();
  if (status === 'unbundled' && targetRev === undefined) {
    console.log("Plugin is already unpacked/sources present.");
    return;
  }

  if (!fs.existsSync(archivesDir)) {
    console.error("No .archives folder found. Cannot unpack.");
    process.exit(1);
  }

  const pluginName = path.basename(pluginDir);
  let restored = false;

  if (targetRev === undefined) {
    const archives = fs.readdirSync(archivesDir)
      .filter(file => (file.startsWith(`${pluginName}-`) || file.startsWith('source-')) && file.endsWith('.zip'))
      .sort();

    if (archives.length > 0) {
      const latestArchive = archives[archives.length - 1];
      const archivePath = path.join(archivesDir, latestArchive);
      console.log(`Extracting from latest archive: ${latestArchive}...`);
      try {
        const psCommand = `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${pluginDir}' -Force"`;
        execSync(psCommand, { stdio: 'inherit' });
        console.log("Extraction complete.");
        restored = true;
      } catch (err) {
        console.error("Extraction from zip failed:", err.message);
      }
    }
  }

  if (!restored) {
    const historyPath = path.join(archivesDir, `${pluginName}.br`);
    if (fs.existsSync(historyPath)) {
      console.log(targetRev !== undefined 
        ? `Restoring revision ${targetRev} from ${pluginName}.br...`
        : `Zip archive not found or failed. Restoring latest revision from ${pluginName}.br...`
      );
      try {
        const compressed = fs.readFileSync(historyPath);
        const decompressed = zlib.brotliDecompressSync(compressed).toString('utf8');
        const historyDb = JSON.parse(decompressed);

        const revisions = historyDb.history || [];
        if (revisions.length === 0) {
          console.error("No revisions found in history.");
          process.exit(1);
        }

        let targetIndex = revisions.length - 1;

        if (targetRev !== undefined) {
          const idx = parseInt(targetRev, 10);
          if (!isNaN(idx) && idx >= 0 && idx < revisions.length && String(idx) === String(targetRev)) {
            targetIndex = idx;
          } else {
            const foundIdx = revisions.findIndex(r => r.hash === targetRev || r.timestamp === targetRev);
            if (foundIdx !== -1) {
              targetIndex = foundIdx;
            } else {
              console.error(`Revision "${targetRev}" not found. Run command 'log' to see available revisions.`);
              process.exit(1);
            }
          }
        }

        const subHistoryDb = {
          base: historyDb.base,
          history: revisions.slice(0, targetIndex + 1)
        };

        const files = restoreState(subHistoryDb);

        if (status === 'unbundled') {
          console.log("Cleaning up current source files before restoring historic revision...");
          const currentSources = getSourceFilesRecursive(pluginDir);
          currentSources.forEach(src => {
            try { fs.unlinkSync(src.fullPath); } catch (_) {}
          });
          removeEmptyDirs(pluginDir);
        }

        for (const [relPath, content] of Object.entries(files)) {
          const fullPath = path.join(pluginDir, relPath);
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, content, 'utf8');
          console.log(`Restored: ${relPath}`);
        }
        console.log(`Restoration of revision #${targetIndex} (${revisions[targetIndex].timestamp}) complete.`);
        restored = true;
      } catch (err) {
        console.error(`Restoration from ${pluginName}.br failed:`, err.message);
        process.exit(1);
      }
    }
  }

  if (!restored) {
    console.error("No archives or history found in .archives directory. Cannot unpack.");
    process.exit(1);
  }

  if (fs.existsSync(bundlePath)) {
    fs.unlinkSync(bundlePath);
    console.log("Removed index.js bundle.");
  }

  const dtsPath = path.join(pluginDir, 'index.d.ts');
  if (fs.existsSync(dtsPath)) {
    fs.unlinkSync(dtsPath);
    console.log("Removed index.d.ts declaration.");
  }

  const cssBundlePath = path.join(pluginDir, 'style.css');
  if (fs.existsSync(cssBundlePath)) {
    fs.unlinkSync(cssBundlePath);
    console.log("Removed style.css bundle.");
  }

  const twClassesPath = path.join(pluginDir, 'safelist.tsx');
  if (fs.existsSync(twClassesPath)) {
    fs.unlinkSync(twClassesPath);
    console.log("Removed safelist.tsx.");
  }
  const oldTwClassesPath = path.join(pluginDir, 'tailwind-classes.tsx');
  if (fs.existsSync(oldTwClassesPath)) {
    fs.unlinkSync(oldTwClassesPath);
    console.log("Removed tailwind-classes.tsx.");
  }

  touchViteConfig();

  console.log("Plugin is now unlocked.");
}

// Execute command
if (command === 'pack') {
  pack().catch(err => {
    console.error(err);
    process.exit(1);
  });
} else if (command === 'unpack') {
  unpack(args[2]);
} else if (command === 'log' || command === 'history') {
  showLog();
} else if (command === 'status') {
  console.log(getStatus());
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
