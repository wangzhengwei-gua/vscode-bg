import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as path from 'path';

/**
 * 在线图片爬取器
 * - picsum: https://picsum.photos/1920/1080 随机风景图
 * - wallhaven: wallhaven.cc 搜索（支持动漫分类）
 * - konachan: konachan.com 动漫壁纸专门站（API posts.json，tags 搜索）
 * - yandere: yande.re 动漫图片站（API post.json，tags 搜索）
 *
 * 图片类型预设（ImageType）：
 * - anime: 动漫可爱女性角色（wallhaven+konachan+yandere 综合）
 * - scenery: 风景/自然
 * - abstract: 抽象/渐变
 * - dark: 深色系（适合代码背景）
 * - random: 随机
 */

export type ImageSource = 'picsum' | 'wallhaven' | 'konachan' | 'yandere' | 'wallpaper' | 'dmoe' | 'mtyqx';
export type ImageType = 'anime' | 'scenery' | 'abstract' | 'dark' | 'random';

export interface CrawlResult {
    localPath: string;
    sourceUrl: string;
    sourceLabel: string;
}

const MAX_REDIRECT = 5;
const DEFAULT_W = 1920;
const DEFAULT_H = 1080;

/**
 * Wallpaper Engine 动漫少女壁纸 ID 池（已验证全部可查到预览图）
 * 来源：B站 Wallpaper Engine 推荐文章里的热门动漫少女壁纸
 * Steam API: GetPublishedFileDetails（无需 Key）→ preview_url → 下载预览图
 */
const WALLPAPER_ANIME_IDS: string[] = [
    '1821835302',  // Falling girl 落ちる少女
    '2800590196',  // [4K]太空的少女
    '2974383923',  // 雪中少女
    '2097195057',  // 机车少女
    '3391355116',  // Asuka Langley Soryu 明日香
    '3389395431',  // 薇尔莉特-傍晚时分
    '2544905501',  // Geoxor - Ephemeral
    '2292710588',  // Klee - Trip（原神可莉）
    '2014441611',  // Connector Yumi
    '2821690854',  // Anime Girl
    '3010228474',  // 蒙面少女
    '1762712871',  // Dark Souls 3 防火女
    '3004222851',  // 银凇止境——萨卡兹少女（明日方舟）
];

/** 类型预设关键词（用于 wallhaven / konachan / yandere 搜索） */
const TYPE_KEYWORDS: Record<ImageType, { wallhaven: string; danbooru: string }> = {
    anime:    { wallhaven: 'anime girl cute',          danbooru: '1girl solo cute' },
    scenery:  { wallhaven: 'landscape nature',        danbooru: 'scenery no_humans' },
    abstract: { wallhaven: 'abstract minimal',        danbooru: 'abstract' },
    dark:     { wallhaven: 'dark minimal abstract',   danbooru: 'dark' },
    random:   { wallhaven: '',                         danbooru: '' },
};

/** 通用下载：处理 302/301 重定向，写入文件 */
function download(url: string, dest: string, redirects = 0): Promise<void> {
    return new Promise((resolve, reject) => {
        if (redirects > MAX_REDIRECT) { reject(new Error('重定向次数过多')); return; }
        const lib = url.startsWith('https') ? https : http;
        const req = lib.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 vscode-bg-editor' },
            timeout: 30000,
        }, (res) => {
            if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode)) {
                const loc = res.headers.location;
                if (loc) {
                    const nextUrl = loc.startsWith('http') ? loc : new URL(loc, url).toString();
                    res.resume();
                    download(nextUrl, dest, redirects + 1).then(resolve, reject);
                    return;
                }
            }
            if (res.statusCode !== 200) { res.resume(); reject(new Error(`下载失败 HTTP ${res.statusCode}`)); return; }
            const ws = fs.createWriteStream(dest);
            res.pipe(ws);
            ws.on('finish', () => { ws.close(); resolve(); });
            ws.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(new Error('下载超时')); });
    });
}

/** JSON GET */
function getJson<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 vscode-bg-editor' }, timeout: 20000 }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
                try { resolve(JSON.parse(body) as T); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

/** JSON POST（用于 Steam API，表单格式 body） */
function postJson<T>(url: string, body: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const lib = url.startsWith('https') ? https : http;
        const req = lib.request({
            hostname: u.hostname,
            port: u.port || (url.startsWith('https') ? 443 : 80),
            path: u.pathname + u.search,
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0 vscode-bg-editor',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body),
            },
            timeout: 20000,
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                try { resolve(JSON.parse(data) as T); }
                catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(new Error('Steam API 超时')); });
        req.write(body);
        req.end();
    });
}

function randSeed(): string { return Math.random().toString(36).slice(2, 10); }

/**
 * 爬取一张图片到 destDir
 * - source: 来源
 * - type: 类型预设（覆盖 keyword，若 keyword 非空则优先 keyword）
 */
export async function crawlImage(
    source: ImageSource,
    keyword: string,
    destDir: string,
    type: ImageType = 'anime',
    w = DEFAULT_W,
    h = DEFAULT_H
): Promise<CrawlResult> {
    if (!fs.existsSync(destDir)) { fs.mkdirSync(destDir, { recursive: true }); }
    // 命名格式：wallpaper-yyyymmdd-hhmmss.jpg
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const dest = path.join(destDir, `wallpaper-${ts}.jpg`);
    const rand = Math.floor(Math.random() * 1000);

    // 关键词：用户指定 > 类型预设
    const preset = TYPE_KEYWORDS[type] || TYPE_KEYWORDS.anime;
    const kwWallhaven = keyword || preset.wallhaven;
    const kwDanbooru = keyword || preset.danbooru;

    if (source === 'picsum') {
        const seed = randSeed();
        const url = `https://picsum.photos/seed/${seed}/${w}/${h}`;
        await download(url, dest);
        return { localPath: dest, sourceUrl: url, sourceLabel: 'Picsum 随机风景图' };
    }

    if (source === 'wallhaven') {
        // categories: 1=General 1=Anime 1=People → 111；purity: 1=SFW 0 0 → 100
        // anime 类型用 011（仅 Anime），其他用 111
        const categories = type === 'anime' ? '011' : '111';
        const q = kwWallhaven || 'anime';
        const apiUrl = `https://wallhaven.cc/api/v1/search?q=${encodeURIComponent(q)}&categories=${categories}&purity=100&sorting=relevance&atleast=${w}x${h}`;
        const json = await getJson<any>(apiUrl);
        const data = json?.data;
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error(`Wallhaven 搜索无结果（关键词：${q}）`);
        }
        const pick = data[rand % Math.min(data.length, 20)];
        const imgUrl = pick?.path;
        if (!imgUrl) { throw new Error('Wallhaven 返回数据格式异常'); }
        await download(imgUrl, dest);
        return { localPath: dest, sourceUrl: imgUrl, sourceLabel: `Wallhaven"${q}"` };
    }

    if (source === 'konachan') {
        // https://konachan.com/post.json?limit=20&tags=1girl+solo+cute&order=random
        // Konachan 是动漫壁纸专门站（1280x720+ 高清），tags 用 + 连接
        const tags = kwDanbooru || '1girl solo cute';
        const apiUrl = `https://konachan.com/post.json?limit=30&tags=${encodeURIComponent(tags)}&order=random`;
        const json = await getJson<any>(apiUrl);
        const arr = Array.isArray(json) ? json : json?.posts;
        if (!Array.isArray(arr) || arr.length === 0) {
            throw new Error(`Konachan 搜索无结果（tags：${tags}）`);
        }
        // 过滤掉没有 jpeg_url 或 file_url 的，随机选
        const valid = arr.filter((p: any) => p?.jpeg_url || p?.file_url);
        if (valid.length === 0) { throw new Error('Konachan 无可下载图片'); }
        const pick = valid[rand % valid.length];
        const imgUrl = pick.jpeg_url || pick.file_url;
        await download(imgUrl, dest);
        return { localPath: dest, sourceUrl: imgUrl, sourceLabel: `Konachan动漫"${tags}"` };
    }

    if (source === 'yandere') {
        // https://yande.re/post.json?limit=20&tags=1girl+solo+cute&order=random
        // Yandere 同样是动漫图片站，质量高
        const tags = kwDanbooru || '1girl solo cute';
        const apiUrl = `https://yande.re/post.json?limit=30&tags=${encodeURIComponent(tags)}&order=random`;
        const json = await getJson<any>(apiUrl);
        const arr = Array.isArray(json) ? json : json?.posts;
        if (!Array.isArray(arr) || arr.length === 0) {
            throw new Error(`Yandere 搜索无结果（tags：${tags}）`);
        }
        const valid = arr.filter((p: any) => p?.jpeg_url || p?.file_url);
        if (valid.length === 0) { throw new Error('Yandere 无可下载图片'); }
        const pick = valid[rand % valid.length];
        const imgUrl = pick.jpeg_url || pick.file_url;
        await download(imgUrl, dest);
        return { localPath: dest, sourceUrl: imgUrl, sourceLabel: `Yandere动漫"${tags}"` };
    }

    if (source === 'dmoe') {
        // Dmoe 樱花二次元 API（国内可用，5200+ 动漫图，百度缓存+新浪图床）
        // https://www.dmoe.cc/random.php?return=json → { imgurl }
        const apiUrl = 'https://www.dmoe.cc/random.php?return=json';
        const json = await getJson<any>(apiUrl);
        const imgUrl = json?.imgurl;
        if (!imgUrl) { throw new Error('Dmoe 返回无图片URL'); }
        await download(imgUrl, dest);
        return { localPath: dest, sourceUrl: imgUrl, sourceLabel: 'Dmoe樱花动漫' };
    }

    if (source === 'mtyqx') {
        // 墨天逸随机动漫 API（国内可用，3000+ 图）
        // https://api.mtyqx.cn/api/random.php?return=json → { imgurl }
        const apiUrl = 'https://api.mtyqx.cn/api/random.php?return=json';
        const json = await getJson<any>(apiUrl);
        const imgUrl = json?.imgurl;
        if (!imgUrl) { throw new Error('墨天逸返回无图片URL'); }
        await download(imgUrl, dest);
        return { localPath: dest, sourceUrl: imgUrl, sourceLabel: '墨天逸动漫' };
    }

    if (source === 'wallpaper') {
        // Wallpaper Engine 动漫少女壁纸预览图
        // Steam API: GetPublishedFileDetails（无需 Key）→ preview_url → 下载
        const ids = WALLPAPER_ANIME_IDS;
        const shuffled = [...ids].sort(() => Math.random() - 0.5);
        let lastErr: string = '';
        for (const id of shuffled) {
            try {
                const apiUrl = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/';
                const postBody = `itemcount=1&publishedfileids[0]=${id}`;
                const json = await postJson<any>(apiUrl, postBody);
                const pf = json?.response?.publishedfiledetails?.[0];
                if (!pf || pf.result !== 1) { lastErr = `ID ${id} 查询失败`; continue; }
                const previewUrl = pf.preview_url;
                const title = pf.title || '未命名';
                if (!previewUrl) { lastErr = `ID ${id} 无预览图`; continue; }
                await download(previewUrl, dest);
                return { localPath: dest, sourceUrl: previewUrl, sourceLabel: `Wallpaper Engine: ${title}` };
            } catch (e: any) {
                lastErr = e?.message || String(e);
                continue;
            }
        }
        throw new Error(`Wallpaper Engine 壁纸池全部失败：${lastErr}`);
    }

    throw new Error(`未知来源：${source}`);
}

/** 清理缓存目录（保留最近 N 张） */
export function cleanCache(cacheDir: string, keep = 5): void {
    if (!fs.existsSync(cacheDir)) { return; }
    const files = fs.readdirSync(cacheDir)
        .filter(f => /^wallpaper-\d{8}-\d{6}\.(jpg|png)$/.test(f))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(cacheDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
    for (const f of files.slice(keep)) {
        try { fs.unlinkSync(path.join(cacheDir, f.name)); } catch { /* 忽略 */ }
    }
}
