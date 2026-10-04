/* global process, console, __dirname */
const fs = require("fs");
const path = require("path");

function normalizePath(p, projectRoot) {
  if (!p) return "";
  let clean = p.replace(/\\/g, "/").replace(/^file:\/\/\//i, "");
  const normRoot = projectRoot.replace(/\\/g, "/").replace(/\/$/, "");
  if (clean.toLowerCase().startsWith(normRoot.toLowerCase())) {
    clean = clean.substring(normRoot.length);
  }
  return clean.replace(/^\//, "");
}

function normalizeLineLinks(line, projectRoot) {
  return line.replace(/(\(|`)(file:\/\/\/[^`)]+)(\)|`)/g, (match, prefix, url, suffix) => {
    const relative = normalizePath(url, projectRoot);
    return relative ? prefix + relative + suffix : match;
  });
}

function parseMapLines(mapText, projectRoot) {
  if (!mapText) return [];
  const lines = mapText.split(/\r?\n/);
  const items = [];
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || /^<\/?architecture_map.*?>$/i.test(trimmed)) return;

    const normalizedLine = normalizeLineLinks(line, projectRoot);
    let filePath = "";
    const linkMatch = normalizedLine.match(/\[[^\]]+\]\(([^)]+)\)/);
    if (linkMatch) {
      filePath = linkMatch[1];
    } else {
      const codeMatch = normalizedLine.match(/`([^`]+)`/);
      if (codeMatch) {
        filePath = codeMatch[1];
      }
    }
    const normPath = normalizePath(filePath, projectRoot);
    items.push({ line: normalizedLine, filePath: normPath });
  });
  return items;
}

function mergeArchitectureMaps(sourceMap, existingMap, projectRoot) {
  if (!sourceMap && !existingMap) return "";
  if (!sourceMap) return existingMap;
  if (!existingMap) return sourceMap;

  const sourceItems = parseMapLines(sourceMap, projectRoot);
  const existingItems = parseMapLines(existingMap, projectRoot);

  const mergedItems = [...sourceItems];
  const sourcePaths = new Set(sourceItems.map((item) => item.filePath).filter(Boolean));

  existingItems.forEach((item) => {
    if (item.filePath && sourcePaths.has(item.filePath)) {
      return;
    }
    if (item.filePath) {
      const cleanPath = item.filePath.replace(/#.*$/, "");
      const fullPath = path.join(projectRoot, cleanPath);
      if (fs.existsSync(fullPath)) {
        mergedItems.push(item);
      } else {
        console.log(`[merge] Pruned deleted file from architecture map: ${item.filePath}`);
      }
    } else {
      mergedItems.push(item);
    }
  });

  const outputLines = ["<architecture_map>"];
  const seenLines = new Set();
  mergedItems.forEach((item) => {
    if (!seenLines.has(item.line)) {
      outputLines.push(item.line);
      seenLines.add(item.line);
    }
  });
  outputLines.push("</architecture_map>");
  return outputLines.join("\n");
}

function parseStatusLines(statusText) {
  if (!statusText) return [];
  const lines = statusText.split(/\r?\n/);
  const items = [];
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || /^<\/?feature_status.*?>$/i.test(trimmed)) return;

    let key = trimmed;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx !== -1) {
      key = trimmed.substring(0, colonIdx).replace(/^[-*\s]+/, "").trim().toLowerCase();
    } else {
      key = trimmed.replace(/^[-*\s]+/, "").trim().toLowerCase();
    }
    items.push({ line, key });
  });
  return items;
}

function mergeFeatureStatuses(sourceStatus, existingStatus) {
  if (!sourceStatus && !existingStatus) return "";
  if (!sourceStatus) return existingStatus;
  if (!existingStatus) return sourceStatus;

  const sourceItems = parseStatusLines(sourceStatus);
  const existingItems = parseStatusLines(existingStatus);

  const mergedItems = [...sourceItems];
  const sourceKeys = new Set(sourceItems.map((item) => item.key).filter(Boolean));

  existingItems.forEach((item) => {
    if (item.key && sourceKeys.has(item.key)) {
      return;
    }
    mergedItems.push(item);
  });

  const outputLines = ["<feature_status>"];
  const seenLines = new Set();
  mergedItems.forEach((item) => {
    if (!seenLines.has(item.line)) {
      outputLines.push(item.line);
      seenLines.add(item.line);
    }
  });
  outputLines.push("</feature_status>");
  return outputLines.join("\n");
}

function parseCapabilitiesLines(capsText) {
  if (!capsText) return [];
  const lines = capsText.split(/\r?\n/);
  const items = [];
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || /^<\/?plugin_capabilities_and_contracts.*?>$/i.test(trimmed)) return;

    let key = trimmed;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx !== -1) {
      key = trimmed.substring(0, colonIdx).replace(/^[-*\s]+/, "").trim().toLowerCase();
    } else {
      key = trimmed.replace(/^[-*\s]+/, "").trim().toLowerCase();
    }
    items.push({ line, key });
  });
  return items;
}

function mergeCapabilitiesAndContracts(sourceCaps, existingCaps) {
  if (!sourceCaps && !existingCaps) return "";
  if (!sourceCaps) return existingCaps;
  if (!existingCaps) return sourceCaps;

  const sourceItems = parseCapabilitiesLines(sourceCaps);
  const existingItems = parseCapabilitiesLines(existingCaps);

  const mergedItems = [...sourceItems];
  const sourceKeys = new Set(sourceItems.map((item) => item.key).filter(Boolean));

  existingItems.forEach((item) => {
    if (item.key && sourceKeys.has(item.key)) {
      return;
    }
    mergedItems.push(item);
  });

  const outputLines = ["<plugin_capabilities_and_contracts>"];
  const seenLines = new Set();
  mergedItems.forEach((item) => {
    if (!seenLines.has(item.line)) {
      outputLines.push(item.line);
      seenLines.add(item.line);
    }
  });
  outputLines.push("</plugin_capabilities_and_contracts>");
  return outputLines.join("\n");
}

function merge() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const positionalArgs = args.filter((a) => !a.startsWith("--"));

  if (positionalArgs.length < 2) {
    console.log("Usage: node merge-guides.cjs <targetFile> <sourceFile> [--delete]");
    process.exit(1);
  }

  const projectRoot = process.cwd();
  const targetFile = positionalArgs[0];
  const sourceFile = positionalArgs[1];
  const shouldDeleteSource = flags.has("--delete");

  const targetPath = path.isAbsolute(targetFile) ? targetFile : path.resolve(projectRoot, targetFile);
  const sourcePath = path.isAbsolute(sourceFile) ? sourceFile : path.resolve(projectRoot, sourceFile);

  if (!fs.existsSync(sourcePath)) {
    console.error(`Error: Source file not found: ${sourcePath}`);
    process.exit(1);
  }

  const sessionsMap = {};
  let existingMap = "";
  let existingStatus = "";
  let existingCapabilities = "";

  // 1. Parse existing target file
  if (fs.existsSync(targetPath)) {
    const mergedContent = fs.readFileSync(targetPath, "utf8");
    const mapMatch = mergedContent.match(/<architecture_map>([\s\S]*?)<\/architecture_map>/i);
    if (mapMatch) existingMap = mapMatch[0].trim();
    const statusMatch = mergedContent.match(/<feature_status>([\s\S]*?)<\/feature_status>/i);
    if (statusMatch) existingStatus = statusMatch[0].trim();
    const capsMatch = mergedContent.match(/<plugin_capabilities_and_contracts>([\s\S]*?)<\/plugin_capabilities_and_contracts>/i);
    if (capsMatch) existingCapabilities = capsMatch[0].trim();

    const parts = mergedContent.split(/## Сессия /g);
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const firstNewLine = part.indexOf("\n");
      if (firstNewLine === -1) continue;
      const headerLine = part.substring(0, firstNewLine).trim();
      const rest = part.substring(firstNewLine).trim();
      const match = headerLine.match(/^(\d+):\s*(.+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        const name = match[2].trim().replace(/\s+/g, "-");
        const content = rest.replace(/<\/handoff_context>/gi, "").trim();
        sessionsMap[num] = { num, name, content, fromMerged: true };
      }
    }
  }

  // 2. Parse source file
  const sourceContent = fs.readFileSync(sourcePath, "utf8");
  let sourceMap = "";
  const mapMatchSrc = sourceContent.match(/<architecture_map>([\s\S]*?)<\/architecture_map>/i);
  if (mapMatchSrc) sourceMap = mapMatchSrc[0].trim();
  let sourceStatus = "";
  const statusMatchSrc = sourceContent.match(/<feature_status>([\s\S]*?)<\/feature_status>/i);
  if (statusMatchSrc) sourceStatus = statusMatchSrc[0].trim();
  let sourceCapabilities = "";
  const capsMatchSrc = sourceContent.match(/<plugin_capabilities_and_contracts>([\s\S]*?)<\/plugin_capabilities_and_contracts>/i);
  if (capsMatchSrc) sourceCapabilities = capsMatchSrc[0].trim();

  let inner = sourceContent;
  const startMatch = sourceContent.match(/<handoff_context[^>]*>/i);
  const endMatch = sourceContent.match(/<\/handoff_context>/i);
  if (startMatch && endMatch) {
    inner = sourceContent.substring(startMatch.index + startMatch[0].length, endMatch.index);
  }

  inner = inner.replace(/<architecture_map>[\s\S]*?<\/architecture_map>/gi, "");
  inner = inner.replace(/<feature_status>[\s\S]*?<\/feature_status>/gi, "");
  inner = inner.replace(/<plugin_capabilities_and_contracts>[\s\S]*?<\/plugin_capabilities_and_contracts>/gi, "");
  inner = inner.replace(/^\s*<!--[\s\S]*?-->/gi, "");
  inner = inner.replace(/^\s*>\s*\[!WARNING\](?:\r?\n>\s*.*)*/gi, "");
  inner = inner.replace(/^##\s+Сессия\s+\d+:\s*.*$/gim, "");
  inner = inner.trim();

  const srcBaseName = path.basename(sourceFile);
  const srcMatch = srcBaseName.match(/^([a-zA-Z0-9_-]+?)-(\d+)-(.+)\.md$/);
  let srcNum, srcName;
  if (srcMatch) {
    srcNum = parseInt(srcMatch[2], 10);
    srcName = srcMatch[3];
  } else {
    srcName = srcBaseName.replace(/\.md$/, "");
    const existingNums = Object.keys(sessionsMap).map(Number);
    srcNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
  }

  const normalizedName = srcName.toLowerCase().replace(/\s+/g, "-");
  const existingSession = Object.values(sessionsMap).find(
    (s) => s.name.toLowerCase().replace(/\s+/g, "-") === normalizedName,
  );

  if (existingSession) {
    sessionsMap[existingSession.num] = {
      num: existingSession.num,
      name: existingSession.name,
      content: inner,
      fromMerged: false,
    };
  } else {
    let finalNum = srcNum;
    if (sessionsMap[finalNum]) {
      const maxNum = Math.max(0, ...Object.keys(sessionsMap).map(Number));
      finalNum = maxNum + 1;
    }
    sessionsMap[finalNum] = {
      num: finalNum,
      name: srcName,
      content: inner,
      fromMerged: false,
    };
  }

  // 3. Build merged output
  const sortedSessions = Object.values(sessionsMap).sort((a, b) => a.num - b.num);
  let mergedContent = "";
  sortedSessions.forEach((session, idx) => {
    let content = session.content;
    if (idx !== sortedSessions.length - 1) {
      content = content.replace(/<inactive_backlog[^>]*>[\s\S]*?<\/inactive_backlog>/gi, "").trim();
      content = content.replace(/<workspace_state[^>]*>[\s\S]*?<\/workspace_state>/gi, "").trim();
      content = content.replace(/<next_action[^>]*>[\s\S]*?<\/next_action>/gi, "").trim();
    }
    const paddedNum = String(session.num).padStart(2, "0");
    const formattedName = session.name.replace(/-/g, " ");
    mergedContent += `\n\n## Сессия ${paddedNum}: ${formattedName}\n\n${content}`;
  });

  const finalMap = mergeArchitectureMaps(sourceMap, existingMap, projectRoot);
  const mapOutput = finalMap ? `\n\n${finalMap}` : "";
  const finalStatus = mergeFeatureStatuses(sourceStatus, existingStatus);
  const statusOutput = finalStatus ? `\n\n${finalStatus}` : "";
  const finalCaps = mergeCapabilitiesAndContracts(sourceCapabilities, existingCapabilities);
  const capsOutput = finalCaps ? `\n\n${finalCaps}` : "";

  const output = `<handoff_context read_only="true" action="wait_for_user_command">
<!-- 
AI INSTRUCTION: READ-ONLY MODE. DO NOT CODE, DO NOT EDIT FILES, DO NOT RUN COMMANDS, DO NOT CREATE PLANS.
YOU MUST ONLY PARSE THIS FILE TO RESTORE CONTEXT AND IMMEDIATELY WAIT FOR THE USER'S EXPLICIT INPUT.
-->

> [!WARNING]
> **CRITICAL AI INSTRUCTION / КРИТИЧЕСКАЯ ИНСТРУКЦИЯ ИИ:**
> - **EN**: READ-ONLY. Do not write code, modify files, run commands, or create plans. Wait for explicit user instructions.
> - **RU**: ТОЛЬКО ЧТЕНИЕ. Запрещено писать код, изменять файлы, выполнять команды или создавать планы. Ожидайте прямых указаний пользователя.

> [!IMPORTANT]
> **CRITICAL AI DIRECTIVE / КРИТИЧЕСКАЯ ДИРЕКТИВА ИИ:**
> - **EN**: This file is strictly for **storing static context and architecture reference** of the plugin. It is **NOT** a guide to action, a task checklist, a development plan, or instructions to execute. Do **NOT** attempt to implement, modify, test, or run anything described in this file unless explicitly requested by the user. If this file is referenced in the chat prefix with two minuses (\`-- [path]/guide.md\`), the entire plugin is STRICTLY FORBIDDEN from being modified.
> - **RU**: Этот файл предназначен исключительно для **хранения статического контекста и описания архитектуры** плагина. Он **НЕ** является руководством к действию, списком задач, планом или инструкцией для выполнения. **ЗАПРЕЩЕНО** пытаться реализовывать, изменять, тестировать или запускать что-либо из описанного в этом файле без явного указания пользователя. Если на этот файл гайда ссылаются в чате с префиксом из двух минусов (\`-- [path]/guide.md\`), данный плагин СТРОГО ЗАПРЕЩЕНО изменять.
${mapOutput}${statusOutput}${capsOutput}${mergedContent}

</handoff_context>\n`;

  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  fs.writeFileSync(targetPath, output, "utf8");
  console.log(`Successfully merged into: ${targetPath}`);

  if (shouldDeleteSource) {
    fs.unlinkSync(sourcePath);
    console.log(`Deleted source file: ${sourcePath}`);
  }
}

merge();
