function getByPath(obj, path, fallback = undefined) {
    if (!path) return fallback;
    const parts = path.split('.').filter(Boolean);
    let current = obj;
    for (const part of parts) {
        if (current == null) return fallback;
        if (part.endsWith(']')) {
            const m = part.match(/^([^\[]+)\[(\d+)\]$/);
            if (!m) return fallback;
            current = current[m[1]];
            current = Array.isArray(current) ? current[Number(m[2])] : undefined;
        } else {
            current = current[part];
        }
    }
    return current === undefined ? fallback : current;
}

function setByPath(obj, path, value) {
    const parts = path.split('.').filter(Boolean);
    if (!parts.length) return;
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!Object.prototype.hasOwnProperty.call(current, part) || typeof current[part] !== 'object' || current[part] === null) {
            current[part] = {};
        }
        current = current[part];
    }
    current[parts[parts.length - 1]] = value;
}

function normalizeBaseUrl(baseUrl) {
    if (!baseUrl) return '';
    return baseUrl.replace(/\/+$/, '');
}

function buildMessages({ systemPrompt, userText, imageDataUrl }) {
    const messages = [];
    if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({
        role: 'user',
        content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: imageDataUrl } }
        ]
    });
    return messages;
}

function extractTextFromChoice(choice) {
    const content = choice?.message?.content;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
        const texts = content
            .map((part) => {
                if (!part) return '';
                if (typeof part === 'string') return part;
                if (typeof part.text === 'string') return part.text;
                return '';
            })
            .filter(Boolean);
        return texts.join('\n').trim();
    }
    return '';
}

function extractTextDeep(value) {
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) {
        return value.map((item) => extractTextDeep(item)).filter(Boolean).join('\n').trim();
    }
    if (value && typeof value === 'object') {
        const candidates = [value.text, value.content, value.output_text, value.reasoning_content, value.refusal];
        for (const c of candidates) {
            const got = extractTextDeep(c);
            if (got) return got;
        }
    }
    return '';
}

function extractTextFromPayload(payload, preferredPath) {
    if (preferredPath) {
        const preferredValue = getByPath(payload, preferredPath, '');
        const preferredText = extractTextDeep(preferredValue);
        if (preferredText) return preferredText;
    }

    const fallbackPaths = [
        'choices[0].message.content',
        'choices[0].message.reasoning_content',
        'choices[0].message.refusal',
        'output_text',
        'response.output_text',
        'data.output_text'
    ];
    for (const path of fallbackPaths) {
        const value = getByPath(payload, path, '');
        const text = extractTextDeep(value);
        if (text) return text;
    }

    if (Array.isArray(payload?.choices)) {
        const fromChoice = extractTextFromChoice(payload.choices[0]);
        if (fromChoice) return fromChoice;
    }
    return '';
}

export function parseFieldMapping(raw) {
    if (!raw || !raw.trim()) {
        return {
            endpoint: '/chat/completions',
            responseTextPath: 'choices[0].message.content',
            usagePath: 'usage'
        };
    }
    try {
        const parsed = JSON.parse(raw);
        return {
            endpoint: parsed.endpoint || '/chat/completions',
            responseTextPath: parsed.responseTextPath || 'choices[0].message.content',
            usagePath: parsed.usagePath || 'usage',
            requestOverrides: parsed.requestOverrides || null
        };
    } catch (err) {
        throw new Error(`字段映射 JSON 解析失败: ${err.message}`);
    }
}

export async function translateImageWithOpenAICompatible({
    baseUrl,
    apiKey,
    model,
    systemPrompt,
    userPrompt,
    imageDataUrl,
    fieldMapping,
    temperature = 1,
    maxTokens = 1800,
    timeoutMs = 90000
}) {
    const normalizedBase = normalizeBaseUrl(baseUrl);
    if (!normalizedBase) {
        throw new Error('请先配置 Base URL');
    }
    if (!apiKey) {
        throw new Error('请先配置 API Key');
    }
    if (!model) {
        throw new Error('请先配置模型名称');
    }

    const endpoint = fieldMapping?.endpoint || '/chat/completions';
    const url = `${normalizedBase}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

    const body = {
        model,
        messages: buildMessages({
            systemPrompt,
            userText: userPrompt,
            imageDataUrl
        }),
        max_tokens: maxTokens
    };
    if (typeof temperature === 'number' && Number.isFinite(temperature)) {
        body.temperature = temperature;
    }

    if (fieldMapping?.requestOverrides && typeof fieldMapping.requestOverrides === 'object') {
        for (const [path, val] of Object.entries(fieldMapping.requestOverrides)) {
            setByPath(body, path, val);
        }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });

        const text = await resp.text();
        let payload = null;
        try {
            payload = text ? JSON.parse(text) : null;
        } catch (err) {
            if (!resp.ok) {
                throw new Error(`模型请求失败 (${resp.status})，响应不是 JSON`);
            }
            throw new Error(`模型响应解析失败: ${err.message}`);
        }

        if (!resp.ok) {
            const message = payload?.error?.message || payload?.message || `HTTP ${resp.status}`;
            const lower = String(message).toLowerCase();
            if (lower.includes('invalid temperature') && body.temperature !== 1) {
                body.temperature = 1;
                const retryResp = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${apiKey}`
                    },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
                const retryText = await retryResp.text();
                let retryPayload = null;
                try {
                    retryPayload = retryText ? JSON.parse(retryText) : null;
                } catch (err) {
                    throw new Error(`模型响应解析失败: ${err.message}`);
                }
                if (!retryResp.ok) {
                    const retryMsg = retryPayload?.error?.message || retryPayload?.message || `HTTP ${retryResp.status}`;
                    throw new Error(`模型请求失败: ${retryMsg}`);
                }
                payload = retryPayload;
            } else {
                throw new Error(`模型请求失败: ${message}`);
            }
        }

        const preferredPath = fieldMapping?.responseTextPath || 'choices[0].message.content';
        const content = extractTextFromPayload(payload, preferredPath);
        if (!content.trim()) {
            const snippet = JSON.stringify(payload).slice(0, 420);
            throw new Error(`模型返回内容为空（路径 ${preferredPath} 未取到文本）。响应片段: ${snippet}`);
        }

        const usage = getByPath(payload, fieldMapping?.usagePath || 'usage', null);
        return {
            text: content.trim(),
            usage: usage && typeof usage === 'object' ? usage : null,
            raw: payload
        };
    } catch (err) {
        if (err?.name === 'AbortError') {
            throw new Error('模型请求超时，请稍后重试');
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}
