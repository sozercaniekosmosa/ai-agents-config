/**
 * Utility script to inject debug blocks into source code files automatically.
 * Usage: node .agents/skills/debug/scripts/inject.cjs <filepath> <functionName> <logType>
 * logType can be: log, performance, timeline
 */

const fs = require('fs');
const path = require('path');

const filepathArg = process.argv[2];
const functionName = process.argv[3];
const logType = process.argv[4] || 'log';

if (!filepathArg || !functionName) {
  console.error('Usage: node inject.cjs <filepath> <functionName> [log, performance, timeline, render-tracker, event-listener]');
  process.exit(1);
}

const absolutePath = path.resolve(process.cwd(), filepathArg);
if (!fs.existsSync(absolutePath)) {
  console.error(`Error: File not found at ${absolutePath}`);
  process.exit(1);
}

function findFunctionBodyEnd(content, startIndex) {
  let depth = 1;
  for (let i = startIndex; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

try {
  let content = fs.readFileSync(absolutePath, 'utf-8');

  // Define regexes to find various function declarations
  const pattern1 = new RegExp(`(function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{)`);
  const pattern2 = new RegExp(`(const\\s+${functionName}\\s*=\\s*\\([^)]*\\)\\s*=>\\s*\\{)`);
  const pattern3 = new RegExp(`(const\\s+${functionName}\\s*=\\s*function\\s*\\([^)]*\\)\\s*\\{)`);
  const pattern4 = new RegExp(`(${functionName}\\s*\\([^)]*\\)\\s*\\{)`); // Method in object/class

  let match = content.match(pattern1) || content.match(pattern2) || content.match(pattern3) || content.match(pattern4);

  if (!match) {
    console.error(`Error: Function "${functionName}" not found or signature too complex in ${filepathArg}`);
    process.exit(1);
  }

  const matchedSignature = match[1];
  const signatureIndex = content.indexOf(matchedSignature);
  const bodyStartIndex = signatureIndex + matchedSignature.length;

  const isTypeScript = filepathArg.endsWith('.ts') || filepathArg.endsWith('.tsx');
  const winCast = isTypeScript ? '(window as any)' : 'window';
  const isArrow = matchedSignature.includes('=>');

  let startHook = '';
  let endHook = '';

  if (logType === 'log') {
    const argsSelector = isArrow 
      ? `'arrow-function'` 
      : `typeof arguments !== 'undefined' ? JSON.stringify(Array.from(arguments).map(x => typeof x === 'function' ? 'fn' : x)) : 'no-arguments'`;
    startHook = `\n  // === START DEBUG AGENT ===\n  console.log('[DEBUG_START ${functionName}] INPUT:', ${argsSelector});\n  // === END DEBUG AGENT ===\n`;
    endHook = `\n  // === START DEBUG AGENT ===\n  console.log('[DEBUG_END ${functionName}]');\n  // === END DEBUG AGENT ===\n`;
  } else if (logType === 'performance') {
    startHook = `\n  // === START DEBUG AGENT ===\n  const __perf_${functionName} = performance.now();\n  // === END DEBUG AGENT ===\n`;
    endHook = `\n  // === START DEBUG AGENT ===\n  console.log('[DEBUG_PERFORMANCE] ${functionName} took:', (performance.now() - __perf_${functionName}).toFixed(2) + 'ms');\n  // === END DEBUG AGENT ===\n`;
  } else if (logType === 'timeline') {
    startHook = `\n  // === START DEBUG AGENT ===\n  console.log('[DEBUG_TIMELINE] ${functionName} triggered at:', performance.now().toFixed(3));\n  // === END DEBUG AGENT ===\n`;
  } else if (logType === 'render-tracker') {
    startHook = `\n  // === START DEBUG AGENT ===\n  if (typeof window !== 'undefined') {\n    const _ref = ${winCast}.__RENDERS__ = ${winCast}.__RENDERS__ || {};\n    _ref['${functionName}'] = (_ref['${functionName}'] || 0) + 1;\n    console.log('[DEBUG_RENDER_TRACKER ${functionName}] Render #' + _ref['${functionName}']);\n  }\n  // === END DEBUG AGENT ===\n`;
  } else if (logType === 'event-listener') {
    startHook = `\n  // === START DEBUG AGENT ===\n  console.log('[DEBUG_EVENT_LEAK ${functionName}] Event registered from stack:', new Error().stack?.split('\\n')[2]?.trim());\n  // === END DEBUG AGENT ===\n`;
  }

  // Inject start hook
  let newContent = content.slice(0, bodyStartIndex) + startHook + content.slice(bodyStartIndex);

  // If endHook is defined, try to inject it before return statement(s) inside this function
  if (endHook) {
    const actualBodyStart = bodyStartIndex + startHook.length;
    const bodyEndIndex = findFunctionBodyEnd(newContent, actualBodyStart);

    if (bodyEndIndex !== -1) {
      const bodyContent = newContent.slice(actualBodyStart, bodyEndIndex);
      const returnRegex = /(\breturn\b[^;]*;)/;
      const returnMatch = bodyContent.match(returnRegex);

      if (returnMatch) {
        const returnStatement = returnMatch[1];
        const returnIndexInBody = bodyContent.lastIndexOf(returnStatement);
        const beforeReturn = bodyContent.slice(0, returnIndexInBody);
        const afterReturn = bodyContent.slice(returnIndexInBody);
        
        newContent = newContent.slice(0, actualBodyStart) + beforeReturn + endHook + afterReturn + newContent.slice(bodyEndIndex);
        console.log(`[INJECT] Injected both START and END hooks into function "${functionName}"`);
      } else {
        // No return statement found, insert endHook at the end of the function body
        newContent = newContent.slice(0, bodyEndIndex) + endHook + newContent.slice(bodyEndIndex);
        console.log(`[INJECT] Injected START and END hooks (no return found, placed at the end of function body)`);
      }
    } else {
      console.log(`[INJECT] Injected START hook. Could not determine function body boundaries to inject END hook.`);
    }
  } else {
    console.log(`[INJECT] Injected START hook into function "${functionName}"`);
  }

  fs.writeFileSync(absolutePath, newContent, 'utf-8');
  console.log(`[INJECT-SUCCESS] Successfully modified ${filepathArg}`);
} catch (err) {
  console.error(`[INJECT-FAILED] Error writing to ${filepathArg}:`, err);
  process.exit(1);
}
