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
        extensions: [mathExtension]
    });

    marked.setOptions({
        highlight: function (code, lang) {
            if (lang && hljs.getLanguage(lang)) {
                return hljs.highlight(code, { language: lang }).value;
            }
            return hljs.highlightAuto(code).value;
        },
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
