import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * CSS 注入器：修改 VSCode 的 workbench.desktop.main.css，
 * 注入带标记的自定义背景图样式。
 *
 * 原理：用 .monaco-editor::before 伪元素做背景层，
 * 编辑器背景设透明，内容层 z-index 提升，保证代码可读。
 */

const START_MARKER = '/* >>> BG-EDITOR START <<< */';
const END_MARKER = '/* >>> BG-EDITOR END <<< */';

/** 获取 workbench.desktop.main.css 绝对路径 */
export function getWorkbenchCssPath(): string {
    const appRoot = vscode.env.appRoot;
    // 标准 VSCode: <appRoot>/out/vs/workbench/workbench.desktop.main.css
    return path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.css');
}

/** 备份原 CSS（仅首次） */
export function backupCssOnce(): { backed: boolean; bakPath: string | null } {
    const cssPath = getWorkbenchCssPath();
    const bakPath = cssPath + '.bak';
    if (!fs.existsSync(bakPath) && fs.existsSync(cssPath)) {
        fs.copyFileSync(cssPath, bakPath);
        return { backed: true, bakPath };
    }
    return { backed: false, bakPath: fs.existsSync(bakPath) ? bakPath : null };
}

/** 从原文件读取纯净 CSS（去除已注入块），基于备份或当前文件 */
function readCleanCss(): string {
    const cssPath = getWorkbenchCssPath();
    const bakPath = cssPath + '.bak';
    const base = fs.existsSync(bakPath) ? fs.readFileSync(bakPath, 'utf8') : fs.readFileSync(cssPath, 'utf8');
    return stripInjected(base);
}

/** 移除已注入的自定义块 */
function stripInjected(content: string): string {
    const startIdx = content.indexOf(START_MARKER);
    if (startIdx < 0) { return content; }
    const endIdx = content.indexOf(END_MARKER);
    if (endIdx < 0) { return content; }
    // 包含尾随换行
    const endPos = endIdx + END_MARKER.length;
    const nextLineBreak = content.indexOf('\n', endPos);
    const removeEnd = nextLineBreak > endPos ? nextLineBreak + 1 : endPos;
    return content.slice(0, startIdx) + content.slice(removeEnd);
}

/** 生成注入的 CSS 文本 */
function buildInjectedCss(opts: {
    imageUrl: string;
    opacity: number;
    blur: number;
    size: string;
    dimOverlay: boolean;
}): string {
    const { imageUrl, opacity, blur, size, dimOverlay } = opts;
    // ★ 关键：VSCode workbench CSS 加载本地图片必须用 vscode-file://vscode-app/ 协议，
    //   file:/// 协议不生效（图片不会加载）。http(s)/data: 原样保留。
    let url: string;
    if (imageUrl.startsWith('vscode-file://') || imageUrl.startsWith('http://') || imageUrl.startsWith('https://') || imageUrl.startsWith('data:')) {
        url = imageUrl;
    } else {
        // 本地路径 → vscode-file://vscode-app/<盘符:/路径>
        const norm = imageUrl.replace(/\\/g, '/').replace(/^\//, '');
        url = 'vscode-file://vscode-app/' + norm;
    }

    const lines: string[] = [];
    lines.push(START_MARKER);
    lines.push('/* 由 Background Editor 插件自动注入，请勿手动编辑 */');
    // 行号边栏背景透明，露出背景图
    lines.push('.monaco-editor .margin { background-color: transparent !important; }');
    // 暗色遮罩浓度：透明度越大遮罩越浅（overlay = 1 - opacity）。
    // 不用 CSS opacity（会让代码文字也变透明），改用 linear-gradient 黑色遮罩压暗图片。
    const overlay = Math.max(0, Math.min(1, 1 - opacity));
    const bgLayer = dimOverlay
        ? `linear-gradient(rgba(0,0,0,${overlay.toFixed(3)}), rgba(0,0,0,${overlay.toFixed(3)})), url("${url}")`
        : `url("${url}")`;
    if (blur > 0) {
        // 模糊模式：用伪元素承载模糊背景层（filter 不影响代码）
        lines.push('.monaco-editor { position: relative; background-color: transparent !important; }');
        lines.push(`.monaco-editor::before { content: ""; position: absolute; inset: 0; background-image: ${bgLayer} !important; background-size: ${size} !important; background-position: center !important; background-repeat: no-repeat !important; filter: blur(${blur}px) !important; pointer-events: none !important; }`);
    } else {
        // 默认模式：背景图挂 .monaco-editor + .monaco-editor-background（组合选择器，两者都设才能完整覆盖代码区）
        lines.push(`.monaco-editor, .monaco-editor-background { background-color: transparent !important; background-image: ${bgLayer} !important; background-size: ${size} !important; background-position: center !important; background-repeat: no-repeat !important; }`);
    }
    lines.push(END_MARKER);
    return lines.join('\n');
}

/** 注入/更新背景样式。imageUrl 为空则清除 */
export function applyBackground(opts: {
    imageUrl: string;
    opacity: number;
    blur: number;
    size: string;
    dimOverlay: boolean;
}): { ok: boolean; msg: string } {
    try {
        const cssPath = getWorkbenchCssPath();
        if (!fs.existsSync(cssPath)) {
            return { ok: false, msg: `未找到 workbench CSS：${cssPath}` };
        }
        backupCssOnce();
        const clean = readCleanCss();
        let next: string;
        if (opts.imageUrl) {
            next = clean + '\n' + buildInjectedCss(opts) + '\n';
        } else {
            next = clean;
        }
        // 写入（保持 UTF-8）
        fs.writeFileSync(cssPath, next, 'utf8');
        return { ok: true, msg: opts.imageUrl ? '背景已应用，请重启 VSCode 或重载窗口（Ctrl+Shift+P → Reload Window）' : '背景已清除，请重载窗口' };
    } catch (e: any) {
        // 权限不足时提示用管理员重启
        if (e && (e.code === 'EACCES' || e.code === 'EPERM')) {
            return { ok: false, msg: '写入 CSS 失败：权限不足。请用管理员权限重启 VSCode 后重试。' };
        }
        return { ok: false, msg: '写入 CSS 失败：' + (e?.message || String(e)) };
    }
}

/** 清除注入并尝试从备份恢复 */
export function clearBackground(): { ok: boolean; msg: string } {
    try {
        const cssPath = getWorkbenchCssPath();
        const bakPath = cssPath + '.bak';
        if (fs.existsSync(bakPath)) {
            fs.copyFileSync(bakPath, cssPath);
            return { ok: true, msg: '已从备份恢复 CSS，请重载窗口' };
        }
        // 无备份则仅移除注入块
        const cur = fs.readFileSync(cssPath, 'utf8');
        fs.writeFileSync(cssPath, stripInjected(cur), 'utf8');
        return { ok: true, msg: '已移除注入样式，请重载窗口' };
    } catch (e: any) {
        return { ok: false, msg: '清除失败：' + (e?.message || String(e)) };
    }
}
