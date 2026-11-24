import * as vscode from 'vscode';
import { BackgroundManager } from './background-manager';
import { ConfigPanel } from './config-panel';
import { ImageType, ImageSource } from './image-crawler';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    const manager = new BackgroundManager(context);

    // ===== 左侧活动栏 TreeView（像彩票插件那样的命令列表）=====
    class BgTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
        private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
        readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
        refresh() { this._onDidChangeTreeData.fire(undefined); }

        getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }
        getChildren(): vscode.TreeItem[] {
            const cur = manager.getCurrent();
            const enabled = vscode.workspace.getConfiguration('bgEditor').get('enabled', false);
            const mk = (label: string, cmd?: string, desc?: string): vscode.TreeItem => {
                const t = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
                if (cmd) { t.command = { command: cmd, title: label }; }
                t.description = desc;
                return t;
            };
            return [
                mk(enabled ? '🟢 已启用' : '⚪ 未启用', undefined, cur ? cur.sourceLabel : '无背景图'),
                mk('🌐 换一张图（在线爬取）', 'bgEditor.crawlNext'),
                mk('🎴 选择图片类型', 'bgEditor.setType'),
                mk('🔗 选择图片来源', 'bgEditor.setSource'),
                mk('📷 选择本地图片', 'bgEditor.setLocalImage'),
                mk('⚙ 打开配置面板', 'bgEditor.openPanel'),
                mk('🎚 调节透明度', 'bgEditor.setOpacity'),
                mk('🖥 切换全窗口/仅编辑区', 'bgEditor.toggleFullscreen'),
                mk('⚡ 开关背景', 'bgEditor.toggle'),
                mk('🗑 清除并恢复', 'bgEditor.clear'),
            ];
        }
    }
    const treeProvider = new BgTreeProvider();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('bgEditorTree', treeProvider)
    );

    // 打开配置面板
    context.subscriptions.push(
        vscode.commands.registerCommand('bgEditor.openPanel', () => {
            ConfigPanel.show(context, manager);
        })
    );

    // 换一张图（在线爬取）
    context.subscriptions.push(
        vscode.commands.registerCommand('bgEditor.crawlNext', async () => {
            const r = await manager.crawlAndApply();
            if (r.ok) {
                vscode.window.showInformationMessage(r.msg + '（点此重载窗口）', '重载窗口').then(act => {
                    if (act === '重载窗口') { vscode.commands.executeCommand('workbench.action.reloadWindow'); }
                });
            } else {
                vscode.window.showErrorMessage(r.msg);
            }
        })
    );

    // 开关背景
    context.subscriptions.push(
        vscode.commands.registerCommand('bgEditor.toggle', async () => {
            const r = await manager.toggle();
            if (r.ok) {
                vscode.window.showInformationMessage(r.msg + '（点此重载窗口）', '重载窗口').then(act => {
                    if (act === '重载窗口') { vscode.commands.executeCommand('workbench.action.reloadWindow'); }
                });
            } else {
                vscode.window.showErrorMessage(r.msg);
            }
        })
    );

    // 清除并恢复
    context.subscriptions.push(
        vscode.commands.registerCommand('bgEditor.clear', async () => {
            const r = await manager.clear();
            if (r.ok) {
                vscode.window.showInformationMessage(r.msg, '重载窗口').then(act => {
                    if (act === '重载窗口') { vscode.commands.executeCommand('workbench.action.reloadWindow'); }
                });
            } else {
                vscode.window.showErrorMessage(r.msg);
            }
        })
    );

    // 选择本地图片
    context.subscriptions.push(
        vscode.commands.registerCommand('bgEditor.setLocalImage', async () => {
            const uri = await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: { '图片': ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] },
                title: '选择背景图片',
            });
            if (!uri || !uri[0]) { return; }
            const r = await manager.applyLocal(uri[0].fsPath);
            if (r.ok) {
                vscode.window.showInformationMessage(r.msg + '（点此重载窗口）', '重载窗口').then(act => {
                    if (act === '重载窗口') { vscode.commands.executeCommand('workbench.action.reloadWindow'); }
                });
            } else {
                vscode.window.showErrorMessage(r.msg);
            }
        })
    );

    // 调节透明度（QuickPick 快捷选择）
    context.subscriptions.push(
        vscode.commands.registerCommand('bgEditor.setOpacity', async () => {
            const items: Array<{ label: string; value: number }> = [
                { label: '极淡 0.08', value: 0.08 },
                { label: '淡 0.15（推荐）', value: 0.15 },
                { label: '适中 0.25', value: 0.25 },
                { label: '较浓 0.35', value: 0.35 },
                { label: '浓 0.5', value: 0.5 },
                { label: '完全显示 1.0', value: 1.0 },
            ];
            const pick = await vscode.window.showQuickPick(items, { placeHolder: '选择背景图不透明度（值越大背景越清晰）' });
            if (!pick) { return; }
            const cfg = vscode.workspace.getConfiguration('bgEditor');
            await cfg.update('opacity', pick.value, vscode.ConfigurationTarget.Global);
            const r = await manager.reapplyFromCurrent();
            if (r.ok) {
                vscode.window.showInformationMessage(`透明度已设为 ${pick.value}，请重载窗口`, '重载窗口').then(act => {
                    if (act === '重载窗口') { vscode.commands.executeCommand('workbench.action.reloadWindow'); }
                });
            } else {
                vscode.window.showWarningMessage(r.msg);
            }
        })
    );

    // 切换全窗口/仅编辑区
    context.subscriptions.push(
        vscode.commands.registerCommand('bgEditor.toggleFullscreen', async () => {
            const cfg = vscode.workspace.getConfiguration('bgEditor');
            const cur = cfg.get('fullscreen', true);
            await cfg.update('fullscreen', !cur, vscode.ConfigurationTarget.Global);
            const r = await manager.reapplyFromCurrent();
            vscode.window.showInformationMessage(
                (!cur ? '已切换：全窗口背景' : '已切换：仅编辑区背景') + '，请重载窗口',
                '重载窗口'
            ).then(act => {
                if (act === '重载窗口') { vscode.commands.executeCommand('workbench.action.reloadWindow'); }
            });
        })
    );

    // 选择图片类型
    context.subscriptions.push(
        vscode.commands.registerCommand('bgEditor.setType', async () => {
            const items: Array<{ label: string; value: ImageType; desc: string }> = [
                { label: '动漫可爱女性角色', value: 'anime', desc: '默认，Konachan/Yandere 动漫图' },
                { label: '风景自然', value: 'scenery', desc: 'Wallhaven 风景搜索' },
                { label: '抽象渐变', value: 'abstract', desc: 'Wallhaven 抽象搜索' },
                { label: '深色系', value: 'dark', desc: '适合代码背景的深色图' },
                { label: '随机', value: 'random', desc: '不限定关键词' },
            ];
            const pick = await vscode.window.showQuickPick(items, { placeHolder: '选择图片类型' });
            if (!pick) return;
            const cfg = vscode.workspace.getConfiguration('bgEditor');
            await cfg.update('type', pick.value, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`类型已设为：${pick.label}。点「换一张图」生效`, '换一张图').then(act => {
                if (act === '换一张图') { vscode.commands.executeCommand('bgEditor.crawlNext'); }
            });
        })
    );

    // 选择图片来源
    context.subscriptions.push(
        vscode.commands.registerCommand('bgEditor.setSource', async () => {
            const items: Array<{ label: string; value: ImageSource; desc: string }> = [
                { label: 'Wallpaper Engine', value: 'wallpaper', desc: '默认，动漫少女壁纸（Steam 预览图）' },
                { label: 'Konachan 动漫站', value: 'konachan', desc: '动漫壁纸专门站' },
                { label: 'Yandere 动漫站', value: 'yandere', desc: '动漫图片站' },
                { label: 'Wallhaven 综合站', value: 'wallhaven', desc: '综合壁纸站，支持动漫分类' },
                { label: 'Picsum 随机风景', value: 'picsum', desc: '随机风景图' },
            ];
            const pick = await vscode.window.showQuickPick(items, { placeHolder: '选择图片来源' });
            if (!pick) return;
            const cfg = vscode.workspace.getConfiguration('bgEditor');
            await cfg.update('source', pick.value, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`来源已设为：${pick.label}。点「换一张图」生效`, '换一张图').then(act => {
                if (act === '换一张图') { vscode.commands.executeCommand('bgEditor.crawlNext'); }
            });
        })
    );

    // 监听配置变更：当 opacity/blur/size/dimOverlay/fullscreen 改变时自动重应用（不爬取）
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('bgEditor')) {
                const cfg = vscode.workspace.getConfiguration('bgEditor');
                const keys = ['opacity', 'blur', 'size', 'dimOverlay', 'fullscreen'];
                const touched = keys.some(k => e.affectsConfiguration('bgEditor.' + k));
                if (touched && cfg.get('enabled', false)) {
                    await manager.reapplyFromCurrent();
                }
            }
        })
    );

    // 确保全局存储目录存在（cache 子目录用）
    try {
        if (!fs.existsSync(context.globalStorageUri.fsPath)) {
            fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
        }
    } catch { /* 忽略 */ }
}

export function deactivate() {}
