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

const updates = {
    "1048988": "<ac:structured-macro ac:name=\"info\"><ac:rich-text-body><p><strong>Описание:</strong> В данном разделе должно быть задокументировано визуальное состояние, переходы (State Flow) и интерактивные сценарии взаимодействия для компонента ObjectModelOverview.</p></ac:rich-text-body></ac:structured-macro>",
    "1048990": "<ac:structured-macro ac:name=\"info\"><ac:rich-text-body><p><strong>Описание:</strong> В данном разделе должны быть описаны ключевые бизнес-правила, логика валидации и доменные ограничения, применяемые в ObjectModelOverview.</p></ac:rich-text-body></ac:structured-macro>",
    "1048991": "<ac:structured-macro ac:name=\"info\"><ac:rich-text-body><p><strong>Описание:</strong> Раздел предназначен для фиксации нестандартных сценариев поведения системы (Edge Cases), обработки ошибок и инструкций по отладке компонента ObjectModelOverview.</p></ac:rich-text-body></ac:structured-macro>",
    "1048992": "<ac:structured-macro ac:name=\"info\"><ac:rich-text-body><p><strong>Описание:</strong> Здесь фиксируются планы по развитию (RoadMap), технический долг и запланированные к реализации функции для ObjectModelOverview.</p></ac:rich-text-body></ac:structured-macro>",
    "1048938": "<ac:structured-macro ac:name=\"info\"><ac:rich-text-body><p><strong>Описание:</strong> Данный раздел содержит информацию об обработке граничных случаев (Edge Cases) и методах решения проблем (Troubleshooting) компонента ObjectModelSidebar.</p></ac:rich-text-body></ac:structured-macro>"
};

for (const [pageId, infoMacro] of Object.entries(updates)) {
    console.log(`Fetching page ${pageId}...`);
    const pageData = runMiddle({ action: 'get_page', pageId });
    if (pageData && pageData.body && pageData.body.storage) {
        let content = pageData.body.storage.value || "";
        
        // Prevent double insertion
        if (!content.includes('ac:name="info"')) {
            content = infoMacro + "\n" + content;
            
            console.log(`Updating page ${pageId}...`);
            const updatePayload = {
                action: "update_page",
                pageId: pageId,
                title: pageData.title,
                content: content,
                versionMessage: "Добавлено краткое описание раздела"
            };
            const updateResult = runMiddle(updatePayload);
            if (updateResult) {
                console.log(`Successfully updated page ${pageId}`);
            } else {
                console.error(`Failed to update page ${pageId}`);
            }
        } else {
            console.log(`Page ${pageId} already has an info macro.`);
        }
    }
}
console.log("All updates completed.");
