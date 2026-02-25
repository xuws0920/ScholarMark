import { marked } from 'marked';
import hljs from 'highlight.js';
import katex from 'katex';
import 'katex/dist/katex.min.css';

let configured = false;

function configureMarkdown() {
    if (configured) return;

    const mathExtension = {
        name: 'math',
        level: 'inline',
        start(src) {
            return src.indexOf('$');
        },
        tokenizer(src) {
            const blockMatch = src.match(/^\$\$([\s\S]+?)\$\$/);
            if (blockMatch) {
                return {
                    type: 'math',
                    raw: blockMatch[0],
                    text: blockMatch[1].trim(),
                    displayMode: true
                };
            }
            const inlineMatch = src.match(/^\$(?!\$)((?:[^$\\]|\\.)+?)\$/);
            if (inlineMatch) {
                return {
                    type: 'math',
                    raw: inlineMatch[0],
                    text: inlineMatch[1].trim(),
                    displayMode: false
                };
            }
            return undefined;
        },
        renderer(token) {
            try {
                const rendered = katex.renderToString(token.text, {
                    displayMode: token.displayMode,
                    throwOnError: false,
                    output: 'html'
                });
                const raw = token.displayMode ? `$$${token.text}$$` : `$${token.text}$`;
                return `<span class="math-token" data-raw="${escapeHtmlAttr(raw)}">${rendered}</span>`;
            } catch (e) {
                console.warn('KaTeX render failed:', e);
                return `<code class="katex-error">${token.raw}</code>`;
            }
        }
    };

    marked.use({
        extensions: [mathExtension],
        renderer: {
            code({ text, lang }) {
                const language = (lang || '').trim().toLowerCase();
                if (shouldRenderMathInsideCode(text, language)) {
                    const langClass = language ? ` language-${escapeHtmlAttr(language)}` : '';
                    return `<pre><code class="hljs${langClass}">${renderCodeWithMath(text || '')}</code></pre>`;
                }

                if (language && hljs.getLanguage(language)) {
                    const highlighted = hljs.highlight(text, { language }).value;
                    return `<pre><code class="hljs language-${escapeHtmlAttr(language)}">${highlighted}</code></pre>`;
                }

                const highlighted = hljs.highlightAuto(text).value;
                return `<pre><code class="hljs">${highlighted}</code></pre>`;
            }
        }
    });

    marked.setOptions({
        breaks: true,
        gfm: true
    });

    configured = true;
}

export function renderMarkdown(content = '') {
    configureMarkdown();
    return marked.parse(content || '');
}

function escapeHtmlAttr(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeHtmlText(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function shouldRenderMathInsideCode(code, language) {
    if (!code || !code.includes('$')) return false;
    const plainLang = language === '' || language === 'text' || language === 'plain' || language === 'plaintext';
    if (!plainLang) return false;
    const hasMathPair = /\$\$[\s\S]+?\$\$|\$(?!\$)[\s\S]+?\$/.test(code);
    if (!hasMathPair) return false;
    return /\\[a-zA-Z]+|\\[{}[\]]/.test(code);
}

function renderCodeWithMath(code) {
    let out = '';
    let i = 0;

    while (i < code.length) {
        if (code[i] !== '$' || (i > 0 && code[i - 1] === '\\')) {
            out += escapeHtmlText(code[i]);
            i += 1;
            continue;
        }

        const isDisplay = code[i + 1] === '$';
        const openLen = isDisplay ? 2 : 1;
        const closeToken = isDisplay ? '$$' : '$';
        const bodyStart = i + openLen;
        let j = bodyStart;
        let found = false;

        while (j < code.length) {
            if (isDisplay) {
                if (code[j] === '$' && code[j + 1] === '$' && (j === bodyStart || code[j - 1] !== '\\')) {
                    found = true;
                    break;
                }
                j += 1;
                continue;
            }

            if (code[j] === '$' && (j === bodyStart || code[j - 1] !== '\\')) {
                found = true;
                break;
            }
            j += 1;
        }

        if (!found) {
            out += escapeHtmlText(code[i]);
            i += 1;
            continue;
        }

        const tex = code.slice(bodyStart, j).trim();
        if (!tex) {
            out += escapeHtmlText(code.slice(i, j + closeToken.length));
            i = j + closeToken.length;
            continue;
        }

        try {
            const rendered = katex.renderToString(tex, {
                displayMode: isDisplay,
                throwOnError: false,
                output: 'html'
            });
            const raw = `${isDisplay ? '$$' : '$'}${tex}${isDisplay ? '$$' : '$'}`;
            out += `<span class="math-token" data-raw="${escapeHtmlAttr(raw)}">${rendered}</span>`;
        } catch (e) {
            out += `<code class="katex-error">${escapeHtmlText(code.slice(i, j + closeToken.length))}</code>`;
        }

        i = j + closeToken.length;
    }

    return out;
}
