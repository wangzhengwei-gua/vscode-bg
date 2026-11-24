import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { applyBackground, clearBackground } from './html-patcher';
import { crawlImage, cleanCache, ImageSource, ImageType } from './image-crawler';

/**
 * 背景管理器：串联配置、爬取、CSS 注入
 * 当前应用的图片信息存于 globalState: bgEditor.current
 */
interface CurrentBg {
    localPath: string;
    sourceLabel: string;
    sourceUrl: string;
    appliedAt: number;
}

export class BackgroundManager {
    constructor(private context: vscode.ExtensionContext) {}

    private cfg(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration('bgEditor');
    }

    private cacheDir(): string {
        // 默认存 D:\VS壁纸，可通过 bgEditor.saveDir 配置项修改
        const configured = this.cfg().get('saveDir', 'D:\\VS壁纸');
        return configured;
    }

    getCurrent(): CurrentBg | undefined {
        return this.context.globalState.get<CurrentBg>('current');
    }

    private setCurrent(c: CurrentBg | undefined): Thenable<void> {
        return this.context.globalState.update('current', c);
    }

    /** 应用指定本地图片 */
    async applyLocal(localPath: string): Promise<{ ok: boolean; msg: string }> {
        if (!fs.existsSync(localPath)) {
            return { ok: false, msg: `文件不存在：${localPath}` };
        }
        const r = applyBackground({
            imageUrl: localPath,
            opacity: this.cfg().get('opacity', 0.15),
            blur: this.cfg().get('blur', 0),
            size: this.cfg().get('size', 'cover'),
            dimOverlay: this.cfg().get('dimOverlay', true),
            fullscreen: this.cfg().get('fullscreen', true),
        });
        if (r.ok) {
            await this.setCurrent({
                localPath,
                sourceLabel: '本地图片',
                sourceUrl: localPath,
                appliedAt: Date.now(),
            });
            await this.cfg().update('enabled', true, vscode.ConfigurationTarget.Global);
            await this.cfg().update('localImage', localPath, vscode.ConfigurationTarget.Global);
        }
        return r;
    }

    /** 在线爬取并应用 */
    async crawlAndApply(): Promise<{ ok: boolean; msg: string }> {
        const source = this.cfg().get<ImageSource>('source', 'konachan');
        const keyword = this.cfg().get('keyword', '');
        const type = this.cfg().get<ImageType>('type', 'anime');
        try {
            const res = await crawlImage(source, keyword, this.cacheDir(), type);
            cleanCache(this.cacheDir(), 5);
            const r = applyBackground({
                imageUrl: res.localPath,
                opacity: this.cfg().get('opacity', 0.15),
                blur: this.cfg().get('blur', 0),
                size: this.cfg().get('size', 'cover'),
                dimOverlay: this.cfg().get('dimOverlay', true),
                fullscreen: this.cfg().get('fullscreen', true),
            });
            if (r.ok) {
                await this.setCurrent({
                    localPath: res.localPath,
                    sourceLabel: res.sourceLabel,
                    sourceUrl: res.sourceUrl,
                    appliedAt: Date.now(),
                });
                await this.cfg().update('enabled', true, vscode.ConfigurationTarget.Global);
                return { ok: true, msg: `${res.sourceLabel} 已应用，请重载窗口查看` };
            }
            return r;
        } catch (e: any) {
            const msg = e?.message || String(e);
            const sourceHint = /Konachan|Yandere|Wallhaven|超时|ECONNREFUSED|ENETUNREACH/i.test(msg)
                ? '（该源国内可能连不上，建议切换到 Wallpaper Engine 或 Picsum）'
                : '';
            return { ok: false, msg: '爬取失败：' + msg + sourceHint };
        }
    }

    /** 开关背景 */
    async toggle(): Promise<{ ok: boolean; msg: string }> {
        const enabled = this.cfg().get('enabled', false);
        if (enabled) {
            // 关闭：清除
            const r = clearBackground();
            if (r.ok) {
                await this.cfg().update('enabled', false, vscode.ConfigurationTarget.Global);
            }
            return r;
        } else {
            // 开启：用当前图片或爬取
            const cur = this.getCurrent();
            if (cur) {
                return this.applyLocal(cur.localPath);
            }
            return this.crawlAndApply();
        }
    }

    /** 清除并恢复 */
    async clear(): Promise<{ ok: boolean; msg: string }> {
        const r = clearBackground();
        if (r.ok) {
            await this.setCurrent(undefined);
            await this.cfg().update('enabled', false, vscode.ConfigurationTarget.Global);
        }
        return r;
    }

    /** 配置变更时重新应用（不爬取） */
    async reapplyFromCurrent(): Promise<{ ok: boolean; msg: string }> {
        const cur = this.getCurrent();
        const local = this.cfg().get('localImage', '');
        const imgPath = cur?.localPath || local;
        if (!imgPath) {
            return { ok: false, msg: '当前无图片，请先爬取或选择本地图片' };
        }
        if (!fs.existsSync(imgPath)) {
            return { ok: false, msg: `图片文件已丢失：${imgPath}` };
        }
        return this.applyLocal(imgPath);
    }
}
