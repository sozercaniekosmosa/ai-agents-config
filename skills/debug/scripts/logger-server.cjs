/**
 * Zero-dependency standalone debug log server for the debug skill.
 * Listens for incoming POST /log requests from browser runtime [DEBUG] hooks
 * and appends them to .agents/skills/debug/.logs/runtime.log.
 * Uses .cjs extension to ensure CommonJS execution across all Node.js projects.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.DEBUG_PORT ? parseInt(process.env.DEBUG_PORT, 10) : 9998;
const LOG_DIR = path.join(__dirname, '../.logs');
const LOG_FILE = path.join(LOG_DIR, 'runtime.log');
const PORT_FILE = path.join(LOG_DIR, 'port.json');
const REPORT_FILE = path.join(LOG_DIR, 'debug-report.json');
const SUMMARY_MD_FILE = path.join(LOG_DIR, 'debug-summary.md');
const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB payload safety limit
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes auto-shutdown on idle

let idleTimer = null;
let lastLogMessage = '';
let repeatCount = 0;
let lastLogTime = '';

const reportData = {
  sessionStart: new Date().toISOString(),
  lastLogTime: '',
  totalLogsCount: 0,
  categories: {},
  errors: [],
  eventLeaks: [],
  renderStorms: {}
};

function resetIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  idleTimer = setTimeout(() => {
    console.log(`[DEBUG-SERVER] No logs received for ${IDLE_TIMEOUT_MS / 60 / 1000} minutes. Auto-terminating due to idle timeout...`);
    cleanupAndExit();
  }, IDLE_TIMEOUT_MS);
}

// Ensure log directory exists and reset runtime log on session start
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
  fs.writeFileSync(LOG_FILE, `=== DEBUG SESSION STARTED [${new Date().toISOString()}] ===\n`, 'utf-8');
  fs.writeFileSync(PORT_FILE, JSON.stringify({ port: PORT }), 'utf-8');
  fs.writeFileSync(REPORT_FILE, JSON.stringify(reportData, null, 2), 'utf-8');
} catch (err) {
  console.error('[DEBUG-SERVER] Failed to initialize log metadata:', err);
}

function flushBufferedLog() {
  if (repeatCount > 0) {
    try {
      let finalLine = '';
      if (repeatCount > 1) {
        finalLine = `[${lastLogTime}] (repeated ${repeatCount} times) ${lastLogMessage}\n`;
      } else {
        finalLine = `[${lastLogTime}] ${lastLogMessage}\n`;
      }
      fs.appendFileSync(LOG_FILE, finalLine, 'utf-8');
      updateReportStats(lastLogMessage, repeatCount, lastLogTime);
    } catch (err) {
      console.error('[DEBUG-SERVER] Failed to flush buffered log:', err);
    }
    repeatCount = 0;
    lastLogMessage = '';
  }
}

function queueLog(message, timestamp) {
  const cleanMsg = message.trim();
  if (cleanMsg === lastLogMessage) {
    repeatCount++;
    lastLogTime = timestamp;
  } else {
    flushBufferedLog();
    lastLogMessage = cleanMsg;
    repeatCount = 1;
    lastLogTime = timestamp;
  }
}

function updateReportStats(message, count, timestamp) {
  reportData.lastLogTime = timestamp;
  reportData.totalLogsCount += count;

  let category = 'GENERAL';
  const catMatch = message.match(/^\[([A-Z_0-9\-]+)(?:\s+[^\]]+)?\]/);
  if (catMatch) {
    category = catMatch[1];
  } else if (message.toLowerCase().includes('error') || message.toLowerCase().includes('exception')) {
    category = 'ERROR';
  }

  reportData.categories[category] = (reportData.categories[category] || 0) + count;

  if (category === 'ERROR' || category === 'UNCAUGHT_ERROR' || category === 'UNHANDLED_PROMISE') {
    const existingErr = reportData.errors.find(e => e.message === message);
    if (existingErr) {
      existingErr.count += count;
      existingErr.lastSeen = timestamp;
    } else {
      reportData.errors.push({
        message: message,
        count: count,
        lastSeen: timestamp
      });
    }
  }

  if (category === 'DEBUG_EVENT_LEAK') {
    const existingLeak = reportData.eventLeaks.find(l => l.message === message);
    if (existingLeak) {
      existingLeak.count += count;
      existingLeak.lastSeen = timestamp;
    } else {
      reportData.eventLeaks.push({
        message: message,
        count: count,
        lastSeen: timestamp
      });
    }
  }

  if (category === 'DEBUG_RENDER_TRACKER') {
    const compMatch = message.match(/^\[DEBUG_RENDER_TRACKER\s+([^\]]+)\]/);
    if (compMatch) {
      const compName = compMatch[1];
      reportData.renderStorms[compName] = (reportData.renderStorms[compName] || 0) + count;
    }
  }

  try {
    fs.writeFileSync(REPORT_FILE, JSON.stringify(reportData, null, 2), 'utf-8');
  } catch (err) {}
}

function generateSummaryMd() {
  try {
    let md = `# Отчет сессии отладки Lab2d (Debug Session Summary)\n\n`;
    md += `- **Старт сессии:** ${reportData.sessionStart}\n`;
    md += `- **Последняя активность:** ${reportData.lastLogTime || 'нет'}\n`;
    md += `- **Всего логов обработано:** ${reportData.totalLogsCount}\n\n`;

    md += `## Статистика по категориям\n\n`;
    md += `| Категория | Количество логов |\n`;
    md += `|---|---|\n`;
    for (const cat in reportData.categories) {
      md += `| \`${cat}\` | ${reportData.categories[cat]} |\n`;
    }
    md += `\n`;

    if (reportData.errors.length > 0) {
      md += `## ❌ Зафиксированные ошибки\n\n`;
      reportData.errors.forEach(err => {
        md += `### Ошибка (повторилась ${err.count} раз)\n`;
        md += `Последний раз замечена в \`${err.lastSeen}\`:\n`;
        md += `\`\`\`\n${err.message}\n\`\`\`\n\n`;
      });
    }

    if (Object.keys(reportData.renderStorms).length > 0) {
      md += `## ⚛️ Рендеринг React-компонентов\n\n`;
      md += `| Компонент | Количество рендеров |\n`;
      md += `|---|---|\n`;
      for (const comp in reportData.renderStorms) {
        md += `| \`${comp}\` | ${reportData.renderStorms[comp]} |\n`;
      }
      md += `\n`;
    }

    if (reportData.eventLeaks.length > 0) {
      md += `## 🦴 Подозрения на утечки подписок (Event Leaks)\n\n`;
      reportData.eventLeaks.forEach(leak => {
        md += `- **Сообщение:** ${leak.message} (повторений: ${leak.count}, последнее: \`${leak.lastSeen}\`)\n`;
      });
      md += `\n`;
    }

    fs.writeFileSync(SUMMARY_MD_FILE, md, 'utf-8');
    console.log(`[DEBUG-SERVER] Saved markdown summary to ${SUMMARY_MD_FILE}`);
  } catch (err) {
    console.error('[DEBUG-SERVER] Failed to generate summary.md:', err);
  }
}

function formatStateChange(prefix, payload) {
  try {
    const parsed = JSON.parse(payload);
    let output = `${prefix}\n`;
    for (const key in parsed) {
      const change = parsed[key];
      if (change && typeof change === 'object' && 'from' in change && 'to' in change) {
        const fromStr = JSON.stringify(change.from);
        const toStr = JSON.stringify(change.to);
        output += `  ● ${key}:\n`;
        output += `    - from: ${fromStr}\n`;
        output += `    + to:   ${toStr}\n`;
      } else {
        output += `  ● ${key}: ${JSON.stringify(change)}\n`;
      }
    }
    return output.trim();
  } catch (e) {
    return `${prefix} ${payload}`;
  }
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || '';
  
  // Safe CORS verification: Allow only localhost and 127.0.0.1 on any port
  const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (isLocalOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'POST' && req.url === '/snapshot') {
    let body = '';
    let bodySize = 0;

    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > 5 * 1024 * 1024) {
        req.destroy();
        res.writeHead(413, { 'Content-Type': 'text/plain' });
        res.end('Payload Too Large');
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      if (bodySize > 5 * 1024 * 1024) return;
      try {
        const SNAPSHOT_FILE = path.join(LOG_DIR, 'crash-snapshot.svg');
        fs.writeFileSync(SNAPSHOT_FILE, body, 'utf-8');
        console.log(`[DEBUG-SERVER] Saved Visual Snapshot to ${SNAPSHOT_FILE}`);
        
        const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
        fs.appendFileSync(LOG_FILE, `[${timestamp}] [SNAPSHOT] Visual canvas snapshot saved to .logs/crash-snapshot.svg\n`, 'utf-8');
        
        resetIdleTimer();
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      } catch (err) {
        console.error('[DEBUG-SERVER] Failed to save snapshot:', err);
        res.writeHead(500);
        res.end('Error writing snapshot');
      }
    });

    req.on('error', () => {
      res.writeHead(400);
      res.end('Bad Request');
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    let bodySize = 0;

    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY_BYTES) {
        req.destroy();
        res.writeHead(413, { 'Content-Type': 'text/plain' });
        res.end('Payload Too Large');
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      if (bodySize > MAX_BODY_BYTES) return;

      try {
        const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
        let messages = [];

        if (body.trim().startsWith('[')) {
          try {
            const batch = JSON.parse(body);
            if (Array.isArray(batch)) {
              messages = batch.map(item => typeof item === 'string' ? item : JSON.stringify(item));
            }
          } catch {}
        }

        if (messages.length === 0) {
          // Clean Vite HMR cache queries from log output (?t=123456)
          let cleanBody = body.replace(/(\.tsx?|\.jsx?)\?t=\d+/g, '$1');
          
          // Try to pretty-print JSON payload in tagged logs for better human readability
          const jsonMatch = cleanBody.match(/^(\[[A-Z_0-9\-]+\]\s*)([\s\S]+)$/);
          if (jsonMatch) {
            const prefix = jsonMatch[1];
            const payload = jsonMatch[2].trim();
            if (payload.startsWith('{') || payload.startsWith('[')) {
              if (prefix.includes('DEBUG_STATE_CHANGE')) {
                cleanBody = formatStateChange(prefix.trim(), payload);
              } else {
                try {
                  const parsed = JSON.parse(payload);
                  const formattedPayload = JSON.stringify(parsed, null, 2);
                  cleanBody = `${prefix}\n${formattedPayload}`;
                } catch (e) {
                  // Keep original if not valid JSON
                }
              }
            }
          }
          messages.push(cleanBody);
        }

        for (const msg of messages) {
          queueLog(msg, timestamp);
        }
        
        // Reset the idle timer on successful log insertion
        resetIdleTimer();

        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      } catch (err) {
        console.error('[DEBUG-SERVER] Failed to append log:', err);
        res.writeHead(500);
        res.end('Error writing log');
      }
    });

    req.on('error', () => {
      res.writeHead(400);
      res.end('Bad Request');
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[DEBUG-SERVER] Port ${PORT} is already in use. Specify another port via DEBUG_PORT env var.`);
  } else {
    console.error('[DEBUG-SERVER] Server error:', err);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[DEBUG-SERVER] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[DEBUG-SERVER] Writing logs to ${LOG_FILE}`);
  resetIdleTimer(); // Initialize idle timer on startup
});

const cleanupAndExit = () => {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  flushBufferedLog();
  generateSummaryMd();
  try {
    if (fs.existsSync(PORT_FILE)) {
      fs.unlinkSync(PORT_FILE);
    }
  } catch (err) {
    console.error('[DEBUG-SERVER] Failed to delete port.json file:', err);
  }
  server.close(() => process.exit(0));
};

process.on('SIGTERM', cleanupAndExit);
process.on('SIGINT', cleanupAndExit);
