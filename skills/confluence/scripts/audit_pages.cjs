const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const envFile = path.resolve(__dirname, '../.env');
const middleScript = path.resolve(__dirname, 'middle.cjs');
const tmpDir = path.resolve(__dirname, '../tmp');

function runMiddle(payload) {
    const payloadPath = path.join(tmpDir, 'temp_payload.json');
    const outPath = path.join(tmpDir, 'temp_out.json');
    fs.writeFileSync(payloadPath, JSON.stringify(payload), 'utf8');
    
    try {
        execSync(`node --env-file="${envFile}" "${middleScript}" "${payloadPath}" --out "${outPath}" --clean`, { stdio: 'pipe' });
        const result = JSON.parse(fs.readFileSync(outPath, 'utf8'));
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        return result.data;
    } catch (err) {
        console.error("Error executing middle.cjs:", err.message);
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        return null;
    }
}

function flattenTree(node, acc = []) {
    acc.push({ id: node.id, title: node.title });
    if (node.children && node.children.length > 0) {
        node.children.forEach(child => flattenTree(child, acc));
    }
    return acc;
}

console.log("Fetching page tree...");
const treeData = runMiddle({ action: 'get_page_tree', pageId: '327683', depth: 5 });
if (!treeData) {
    console.error("Failed to fetch tree.");
    process.exit(1);
}

const allPages = flattenTree(treeData);
console.log(`Found ${allPages.length} pages. Fetching content for each...`);

const report = [];

for (const page of allPages) {
    console.log(`Fetching page ${page.id}: ${page.title}`);
    const pageData = runMiddle({ action: 'get_page', pageId: page.id });
    if (pageData && pageData.body && pageData.body.storage) {
        const content = pageData.body.storage.value || "";
        
        // Check if it has an info macro or a reasonable introductory paragraph
        const hasInfoMacro = content.includes('<ac:structured-macro ac:name="info"');
        const hasParagraph = content.includes('<p>');
        const textLength = content.replace(/<[^>]*>?/gm, '').trim().length;
        
        if (textLength < 50 || (!hasInfoMacro && !hasParagraph)) {
            report.push({
                id: page.id,
                title: page.title,
                needsDescription: true,
                currentPreview: content.substring(0, 200)
            });
        }
    }
}

fs.writeFileSync(path.join(tmpDir, 'audit_report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`Audit complete. Found ${report.length} pages needing descriptions.`);
