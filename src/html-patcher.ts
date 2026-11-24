import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * HTML 注入器：修改 VSCode 的 workbench.html，在 </head> 前注入 <style> 标签。
 *
 * 为什么改 html 而不是 css：
 * 某些 VSCode fork（如 D:\Microsoft VS Code）不加载被修改过的 workbench.desktop.main.css，
 * 但 workbench.html 里注入的 inline <style> 能正常生效（CSP 允许 unsafe-inline）。
 *
 * 方案（已验证）：
 * - body 挂背景图（fixed，铺满窗口）
 * - .monaco-workbench + 编辑区链路全透明（让图透到代码区）
 * - 侧边栏/标题栏/状态栏保持主题色（不设透明）
 */

const START_MARKER = '<!-- BG-EDITOR-INJECT -->';
const END_MARKER = '<!-- BG-EDITOR-INJECT-END -->';

/** 定位 workbench.html（兼容 electron-browser 和 electron-sandbox 两种路径） */
export function getWorkbenchHtmlPath(): string | null {
    const appRoot = vscode.env.appRoot;
    const candidates = [
        path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
        path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

/** 备份 workbench.html（仅首次） */
export function backupHtmlOnce(): { backed: boolean; bakPath: string | null } {
    const htmlPath = getWorkbenchHtmlPath();
    if (!htmlPath) return { backed: false, bakPath: null };
    const bakPath = htmlPath + '.bak';
    if (!fs.existsSync(bakPath)) {
        fs.copyFileSync(htmlPath, bakPath);
        return { backed: true, bakPath };
    }
    return { backed: false, bakPath };
}

/** 读取纯净 html（基于备份或当前文件，去除已注入块） */
function readCleanHtml(): string | null {
    const htmlPath = getWorkbenchHtmlPath();
    if (!htmlPath) return null;
    const bakPath = htmlPath + '.bak';
    const base = fs.existsSync(bakPath) ? fs.readFileSync(bakPath, 'utf8') : fs.readFileSync(htmlPath, 'utf8');
    return stripInjected(base);
}

/** 移除已注入的 style 块 */
function stripInjected(content: string): string {
    const startIdx = content.indexOf(START_MARKER);
    if (startIdx < 0) return content;
    const endIdx = content.indexOf(END_MARKER);
    if (endIdx < 0) return content;
    return content.slice(0, startIdx) + content.slice(endIdx + END_MARKER.length);
}

/** 生成注入的 CSS 文本 */
function buildInjectStyle(opts: {
    imageUrl: string;
    opacity: number;
    blur: number;
    size: string;
    dimOverlay: boolean;
    fullscreen: boolean;
}): string {
    const { imageUrl, opacity, size, dimOverlay, fullscreen } = opts;
    // URL 协议：本地路径转 vscode-file://vscode-app/（VSCode workbench 加载本地资源的正确协议）
    let url: string;
    if (imageUrl.startsWith('vscode-file://') || imageUrl.startsWith('http://') || imageUrl.startsWith('https://') || imageUrl.startsWith('data:')) {
        url = imageUrl;
    } else {
        const norm = imageUrl.replace(/\\/g, '/').replace(/^\//, '');
        url = 'vscode-file://vscode-app/' + norm;
    }
    // 遮罩浓度：opacity 越大背景越清晰，遮罩越浅（overlay = 1 - opacity）
    // 不用 CSS opacity（会让代码也变透明），用 linear-gradient 黑色遮罩压暗图片
    const overlay = Math.max(0, Math.min(1, 1 - opacity));
    const bgLayer = dimOverlay
        ? `linear-gradient(rgba(0,0,0,${overlay.toFixed(3)}),rgba(0,0,0,${overlay.toFixed(3)})), url("${url}")`
        : `url("${url}")`;
    // 透明选择器：fullscreen=true 全部件透明，false 仅编辑区链路透明
    const transparentSelectors = fullscreen
        ? '.monaco-workbench,.monaco-workbench .part,.monaco-workbench .part.titlebar,.monaco-workbench .part.activitybar,.monaco-workbench .part.sidebar,.monaco-workbench .part.editor,.monaco-workbench .part.editor>.content,.monaco-workbench .part.panel,.monaco-workbench .part.statusbar,.monaco-workbench .part.auxiliarybar,.editor-group-container,.tabs-and-actions-container,.tab,.editor-container,.editor-instance,.monaco-editor,.monaco-editor-background,.monaco-editor .margin,.monaco-editor .overflow-guard,.monaco-editor .monaco-scrollable-element,.monaco-editor .view-lines,.monaco-editor .view-overlays,.monaco-editor .view-layer,.explorer-viewlet,.monaco-pane-view,.pane-body,.integrated-terminal,.terminal-wrapper,.terminal-container,.xterm,.xterm-viewport,.xterm-screen'
        : '.monaco-workbench,.monaco-workbench .part.editor,.monaco-workbench .part.editor>.content,.editor-group-container,.editor-container,.editor-instance,.monaco-editor,.monaco-editor-background,.monaco-editor .margin,.monaco-editor .overflow-guard,.monaco-editor .monaco-scrollable-element,.monaco-editor .view-lines,.monaco-editor .view-overlays,.monaco-editor .view-layer';
    return `body{background-image:${bgLayer} !important;background-size:${size} !important;background-position:center !important;background-repeat:no-repeat !important;background-attachment:fixed !important;} ${transparentSelectors}{background-color:transparent !important;}`;
}

/** 注入/更新背景样式。imageUrl 为空则清除 */
export function applyBackground(opts: {
    imageUrl: string;
    opacity: number;
    blur: number;
    size: string;
    dimOverlay: boolean;
    fullscreen: boolean;
}): { ok: boolean; msg: string } {
    try {
        const htmlPath = getWorkbenchHtmlPath();
        if (!htmlPath) {
            return { ok: false, msg: '未找到 workbench.html（尝试了 electron-browser 和 electron-sandbox 路径）' };
        }
        backupHtmlOnce();
        const clean = readCleanHtml();
        if (clean === null) return { ok: false, msg: '读取 workbench.html 失败' };

        let next: string;
        if (opts.imageUrl) {
            const style = buildInjectStyle(opts);
            const inject = `${START_MARKER}<style>${style}</style>${END_MARKER}`;
            const idx = clean.indexOf('</head>');
            next = idx >= 0 ? clean.slice(0, idx) + inject + clean.slice(idx) : clean + inject;
        } else {
            next = clean;
        }
        fs.writeFileSync(htmlPath, next, 'utf8');
        return { ok: true, msg: opts.imageUrl ? '背景已应用，请重载窗口（Ctrl+Shift+P → Reload Window）' : '背景已清除，请重载窗口' };
    } catch (e: any) {
        if (e && (e.code === 'EACCES' || e.code === 'EPERM')) {
            return { ok: false, msg: '写入 workbench.html 失败：权限不足。请用管理员权限重启 VSCode 后重试。' };
        }
        return { ok: false, msg: '写入 workbench.html 失败：' + (e?.message || String(e)) };
    }
}

/** 清除注入并从备份恢复 */
export function clearBackground(): { ok: boolean; msg: string } {
    try {
        const htmlPath = getWorkbenchHtmlPath();
        if (!htmlPath) return { ok: false, msg: '未找到 workbench.html' };
        const bakPath = htmlPath + '.bak';
        if (fs.existsSync(bakPath)) {
            fs.copyFileSync(bakPath, htmlPath);
            return { ok: true, msg: '已从备份恢复 workbench.html，请重载窗口' };
        }
        const cur = fs.readFileSync(htmlPath, 'utf8');
        fs.writeFileSync(htmlPath, stripInjected(cur), 'utf8');
        return { ok: true, msg: '已移除注入样式，请重载窗口' };
    } catch (e: any) {
        return { ok: false, msg: '清除失败：' + (e?.message || String(e)) };
    }
}
