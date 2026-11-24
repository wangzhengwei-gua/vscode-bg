import * as vscode from 'vscode';
import { BackgroundManager } from './background-manager';

/**
 * 配置面板 Webview
 */
export class ConfigPanel {
    public static currentPanel: ConfigPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    public static show(context: vscode.ExtensionContext, manager: BackgroundManager): ConfigPanel {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
        if (ConfigPanel.currentPanel) {
            ConfigPanel.currentPanel.panel.reveal(column);
            return ConfigPanel.currentPanel;
        }
        const p = vscode.window.createWebviewPanel(
            'bgEditorPanel',
            'Background Editor',
            column || vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        ConfigPanel.currentPanel = new ConfigPanel(p, context, manager);
        return ConfigPanel.currentPanel;
    }

    private constructor(
        panel: vscode.WebviewPanel,
        private context: vscode.ExtensionContext,
        private manager: BackgroundManager
    ) {
        this.panel = panel;
        this.panel.webview.html = this.getHtml();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(async (msg) => {
            const type = msg?.type;
            if (type === 'crawl') {
                const r = await manager.crawlAndApply();
                this.panel.webview.postMessage({ type: 'result', ok: r.ok, msg: r.msg });
                this.refreshStatus();
            } else if (type === 'local') {
                const r = await manager.applyLocal(msg.path);
                this.panel.webview.postMessage({ type: 'result', ok: r.ok, msg: r.msg });
                this.refreshStatus();
            } else if (type === 'toggle') {
                const r = await manager.toggle();
                this.panel.webview.postMessage({ type: 'result', ok: r.ok, msg: r.msg });
                this.refreshStatus();
            } else if (type === 'clear') {
                const r = await manager.clear();
                this.panel.webview.postMessage({ type: 'result', ok: r.ok, msg: r.msg });
                this.refreshStatus();
            } else if (type === 'updateConfig') {
                const cfg = vscode.workspace.getConfiguration('bgEditor');
                await cfg.update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
                if (msg.reapply) {
                    const r = await manager.reapplyFromCurrent();
                    this.panel.webview.postMessage({ type: 'result', ok: r.ok, msg: r.msg });
                }
            } else if (type === 'pickLocal') {
                const uri = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    filters: { '图片': ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] },
                    title: '选择背景图片'
                });
                if (uri && uri[0]) {
                    const p = uri[0].fsPath;
                    this.panel.webview.postMessage({ type: 'localPicked', path: p });
                }
            }
        }, null, this.disposables);
    }

    private async refreshStatus() {
        const cur = this.manager.getCurrent();
        const cfg = vscode.workspace.getConfiguration('bgEditor');
        this.panel.webview.postMessage({
            type: 'status',
            enabled: cfg.get('enabled', false),
            current: cur ? { label: cur.sourceLabel, path: cur.localPath, url: cur.sourceUrl } : null,
        });
    }

    private getHtml(): string {
        const cfg = vscode.workspace.getConfiguration('bgEditor');
        const state = {
            enabled: cfg.get('enabled', false),
            source: cfg.get('source', 'picsum'),
            keyword: cfg.get('keyword', ''),
            opacity: cfg.get('opacity', 0.15),
            blur: cfg.get('blur', 0),
            size: cfg.get('size', 'cover'),
            dimOverlay: cfg.get('dimOverlay', true),
            localImage: cfg.get('localImage', ''),
        };
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Background Editor</title>
<style>
:root { color-scheme: dark; }
body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 20px 24px;
    margin: 0;
}
h2 { margin: 0 0 16px; font-size: 18px; }
.section { margin-bottom: 22px; }
.section h3 { font-size: 13px; margin: 0 0 8px; opacity: 0.85; font-weight: 600; }
.row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
label { min-width: 90px; font-size: 13px; }
select, input[type="text"] {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 5px 8px;
    border-radius: 3px;
    font-size: 13px;
    flex: 1;
    min-width: 160px;
}
input[type="range"] { flex: 1; min-width: 200px; }
.range-val { min-width: 48px; text-align: right; font-variant-numeric: tabular-nums; opacity: 0.8; font-size: 12px; }
button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 7px 14px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 13px;
}
button:hover { background: var(--vscode-button-hoverBackground); }
button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
}
button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
.btn-row { display: flex; gap: 8px; flex-wrap: wrap; }
.status {
    margin-top: 16px;
    padding: 12px 14px;
    border-radius: 4px;
    background: var(--vscode-editor-inactive-selection-background);
    font-size: 12px;
    line-height: 1.6;
}
.status .pill {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 11px;
    margin-right: 6px;
}
.pill.on { background: #4ec9b0; color: #0f0f23; }
.pill.off { background: #555; color: #fff; }
.toast {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
    padding: 8px 16px; border-radius: 4px; font-size: 13px;
    background: var(--vscode-notification-toast-background, #2d2d30);
    color: var(--vscode-notification-toast-foreground, #fff);
    box-shadow: 0 2px 8px rgba(0,0,0,.4);
    opacity: 0; transition: opacity .2s; pointer-events: none;
    max-width: 80%;
}
.toast.show { opacity: 1; }
.toast.err { border-left: 3px solid #f14c4c; }
.toast.ok { border-left: 3px solid #4ec9b0; }
.hint { font-size: 11px; opacity: 0.6; margin-top: 4px; }
</style>
</head>
<body>
<h2>🖼 Background Editor — 代码区背景图</h2>

<div class="section">
    <h3>来源</h3>
    <div class="row">
        <label>图片来源</label>
        <select id="source">
            <option value="picsum">Picsum（随机图，稳定）</option>
            <option value="unsplash">Unsplash 随机（Picsum 代替）</option>
            <option value="wallhaven">Wallhaven（关键词搜索）</option>
            <option value="local">本地图片</option>
        </select>
    </div>
    <div class="row" id="kwRow">
        <label>关键词</label>
        <input type="text" id="keyword" placeholder="如 dark,abstract,galaxy（仅 Wallhaven 生效）">
    </div>
    <div class="row" id="localRow" style="display:none">
        <label>本地图片</label>
        <input type="text" id="localImage" placeholder="选择或输入图片绝对路径" readonly>
        <button class="secondary" id="pickBtn">选择...</button>
    </div>
</div>

<div class="section">
    <h3>显示效果</h3>
    <div class="row">
        <label>透明度</label>
        <input type="range" id="opacity" min="0" max="1" step="0.01">
        <span class="range-val" id="opacityVal"></span>
    </div>
    <div class="hint">建议 0.10~0.30，代码可读性最佳。值越大背景越清晰。</div>
    <div class="row">
        <label>模糊度</label>
        <input type="range" id="blur" min="0" max="30" step="1">
        <span class="range-val" id="blurVal">px</span>
    </div>
    <div class="row">
        <label>填充方式</label>
        <select id="size">
            <option value="cover">cover（铺满裁切）</option>
            <option value="contain">contain（完整显示）</option>
            <option value="auto 100%">auto 100%</option>
            <option value="100% 100%">100% 100%（拉伸）</option>
        </select>
    </div>
    <div class="row">
        <label><input type="checkbox" id="dimOverlay" style="flex:0;min-width:auto"> 叠加暗色遮罩</label>
    </div>
    <div class="hint">开启暗色遮罩可提升代码对比度，推荐。</div>
</div>

<div class="section">
    <h3>操作</h3>
    <div class="btn-row">
        <button id="crawlBtn">🌐 在线爬取并应用</button>
        <button id="applyLocalBtn" class="secondary">📷 应用本地图片</button>
        <button id="toggleBtn" class="secondary">⚡ 开关背景</button>
        <button id="clearBtn" class="secondary">🗑 清除并恢复</button>
    </div>
    <div class="hint">应用后需重载窗口生效：Ctrl+Shift+P → Reload Window</div>
</div>

<div class="status" id="status">加载中...</div>

<div class="toast" id="toast"></div>

<script>
const vscode = acquireVsCodeApi();
const INIT = ${JSON.stringify(state)};

function $(id) { return document.getElementById(id); }

function setRange(id, val, suffix) {
    $(id).value = val;
    $(id + 'Val').textContent = (typeof val === 'number' ? val.toFixed(2) : val) + (suffix || '');
}

$('source').value = INIT.source;
$('keyword').value = INIT.keyword;
$('localImage').value = INIT.localImage;
setRange('opacity', INIT.opacity);
setRange('blur', INIT.blur, 'px');
$('size').value = INIT.size;
$('dimOverlay').checked = INIT.dimOverlay;

function updateLocalRow() {
    const s = $('source').value;
    $('localRow').style.display = (s === 'local') ? 'flex' : 'none';
    $('kwRow').style.display = (s === 'wallhaven') ? 'flex' : 'none';
}
updateLocalRow();

function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
const updateConfig = (key, value, reapply) => {
    vscode.postMessage({ type: 'updateConfig', key, value, reapply });
};

$('source').addEventListener('change', e => updateConfig('source', e.target.value, false));
$('keyword').addEventListener('input', debounce(e => updateConfig('keyword', e.target.value, false), 400));
$('size').addEventListener('change', e => updateConfig('size', e.target.value, true));
$('dimOverlay').addEventListener('change', e => updateConfig('dimOverlay', e.target.checked, true));
$('opacity').addEventListener('input', debounce(e => {
    setRange('opacity', parseFloat(e.target.value));
    updateConfig('opacity', parseFloat(e.target.value), true);
}, 300));
$('blur').addEventListener('input', debounce(e => {
    $('blurVal').textContent = e.target.value + 'px';
    updateConfig('blur', parseInt(e.target.value), true);
}, 300));

$('pickBtn').addEventListener('click', () => vscode.postMessage({ type: 'pickLocal' }));

$('crawlBtn').addEventListener('click', () => {
    toast('正在爬取...', '');
    vscode.postMessage({ type: 'crawl' });
});
$('applyLocalBtn').addEventListener('click', () => {
    const p = $('localImage').value;
    if (!p) { toast('请先选择本地图片', 'err'); return; }
    vscode.postMessage({ type: 'local', path: p });
});
$('toggleBtn').addEventListener('click', () => vscode.postMessage({ type: 'toggle' }));
$('clearBtn').addEventListener('click', () => vscode.postMessage({ type: 'clear' }));

function toast(msg, cls) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + (cls || '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = 'toast ' + (cls || ''); }, 3000);
}

window.addEventListener('message', e => {
    const m = e.data;
    if (m.type === 'result') {
        toast(m.msg, m.ok ? 'ok' : 'err');
    } else if (m.type === 'status') {
        renderStatus(m);
    } else if (m.type === 'localPicked') {
        $('localImage').value = m.path;
        updateConfig('localImage', m.path, false);
    }
});

function renderStatus(s) {
    const pill = s.enabled
        ? '<span class="pill on">已启用</span>'
        : '<span class="pill off">已关闭</span>';
    let cur = '当前无背景图';
    if (s.current) {
        cur = '当前：' + s.current.label + '<br>路径：' + s.current.path;
    }
    $('status').innerHTML = pill + ' ' + cur;
}

toast('提示：改完参数后请点"在线爬取"或"应用本地图片"，再重载窗口', '');
</script>
</body>
</html>`;
    }

    public dispose() {
        ConfigPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) { d.dispose(); }
        }
    }
}
