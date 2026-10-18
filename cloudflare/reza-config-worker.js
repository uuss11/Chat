/**
 * REZA CHAT · Cloudflare Worker (reza-chat-config)
 * ------------------------------------------------------------
 * المسارات:
 *   GET /health                     فحص سريع
 *   GET /config                     معلومات فايربيس (من أسرار الـ Worker) + حالة الميزات
 *   GET /search?q=&type=&page=      بحث ويب/صور (Serper ثم Brave ثم Google JSON)
 *   GET /tiktok?user=               معلومات حساب تيك توك (صفحة التضمين)
 *   GET /instagram?user=            معلومات حساب انستغرام
 *   GET /image?prompt=&count=       توليد صورة (Workers AI) وتخزينها في KV
 *   POST /upload                    رفع صورة/فيديو إلى KV (20 MiB، صلاحية 180 يوم)
 *   GET /media/<id>                 إرجاع صورة/فيديو المستخدم من KV
 *   GET /img/<key>                  إرجاع الصورة المولدة المخزنة
 *
 * Bindings: AI (Workers AI) + IMAGES (KV: reza-chat-images)
 * الأسرار: FIREBASE_* (المطلوبة)، GOOGLE_*، SERPER_API_KEY، BRAVE_API_KEY، IG_SESSIONID (اختيارية)
 */

const ALLOW = ['https://uuss11.github.io', 'http://127.0.0.1:8123', 'http://localhost:8123'];
const allow = origin => (ALLOW.includes(origin) ? origin : ALLOW[0]);
const head = origin => ({
    'Access-Control-Allow-Origin': allow(origin),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Chat-User,X-Chat-Proof',
    'Vary': 'Origin',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
});
const json = (data, status, origin) => new Response(JSON.stringify(data), { status: status || 200, headers: head(origin) });
const clean = s => String(s || '').split(' ').filter(Boolean).join(' ').slice(0, 200);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const APPA = 'Instagram 219.0.0.12.117 Android (30/11; 320dpi; 720x1440; mt6765; ar_IQ)';
const safeUser = u => String(u || '').replace(/[^A-Za-z0-9._]/g, '').slice(0, 30);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- تيك توك ---------- */
function field(win, key) {
    const s = win.indexOf('"' + key + '"');
    if (s < 0) return '';
    let p = s + key.length + 2;
    while (p < win.length && (win[p] === ':' || win[p] === ' ')) p++;
    if (win[p] === '"') {
        const e = win.indexOf('"', p + 1);
        return e < 0 ? '' : win.slice(p + 1, e);
    }
    let e = p;
    while (e < win.length && ',}]'.indexOf(win[e]) < 0) e++;
    return win.slice(p, e);
}
const num = v => {
    const n = parseInt(String(v || '').replace(/[^0-9]/g, ''), 10);
    return isNaN(n) ? null : n;
};
function tiktokFrom(html, user) {
    const at = html.indexOf('"uniqueId":"' + user + '"');
    if (at < 0) return null;
    const win = html.slice(Math.max(0, at - 4000), at + 1500);
    const uname = field(win, 'uniqueId');
    if (!uname) return null;
    const prof = {
        platform: 'tiktok',
        username: uname,
        nickname: field(win, 'nickname'),
        id: field(win, 'id'),
        bio: field(win, 'signature'),
        avatar: field(win, 'avatarThumbUrl') || field(win, 'avatarLarger') || field(win, 'avatarMedium') || field(win, 'avatarThumb'),
        verified: field(win, 'verified') === 'true',
        private: field(win, 'privateAccount') === 'true',
        region: field(win, 'region'),
        followers: num(field(win, 'followerCount')),
        following: num(field(win, 'followingCount')),
        likes: num(field(win, 'heartCount')),
        videos: num(field(win, 'videoCount')),
        link: 'https://www.tiktok.com/@' + uname
    };
    if (!prof.nickname && !prof.id && prof.followers === null) return null;
    return prof;
}
async function tiktok(user) {
    const urls = ['https://www.tiktok.com/embed/@' + user, 'https://www.tiktok.com/@' + user];
    const tried = [];
    let loaded = false;
    for (const url of urls) {
        try {
            const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' } });
            const html = await r.text();
            if (r.ok && html.length > 20000) loaded = true;
            const prof = tiktokFrom(html, user);
            if (prof) return { profile: prof };
            tried.push(url.indexOf('embed') > 0 ? 'embed' : 'page:' + r.status);
        } catch (e) {
            tried.push('err:' + String(e).slice(0, 25));
        }
    }
    return { error: loaded ? 'tiktok_not_found' : 'tiktok_blocked', tried };
}

/* ---------- انستغرام ---------- */
function igProfile(u) {
    return {
        platform: 'instagram',
        username: u.username,
        nickname: u.full_name || '',
        id: u.id || '',
        bio: u.biography || '',
        avatar: u.profile_pic_url_hd || u.profile_pic_url || '',
        verified: Boolean(u.is_verified),
        private: Boolean(u.is_private),
        category: u.category_name || '',
        external: u.external_url || '',
        followers: (u.edge_followed_by || {}).count,
        following: (u.edge_follow || {}).count,
        videos: (u.edge_owner_to_timeline_media || {}).count,
        link: 'https://www.instagram.com/' + u.username
    };
}
async function instagram(user, env) {
    const sid = env.IG_SESSIONID || '';
    const url = 'https://www.instagram.com/api/v1/users/web_profile_info/?username=' + user;
    const tried = [];
    for (let i = 0; i < 3; i++) {
        const heads = {
            'User-Agent': i === 0 ? APPA : UA,
            Accept: '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'X-Requested-With': 'XMLHttpRequest'
        };
        if (i > 0 && sid) heads['Cookie'] = 'sessionid=' + sid;
        try {
            const r = await fetch(url, { headers: heads });
            const txt = await r.text();
            if (r.ok) {
                let data = null;
                try { data = JSON.parse(txt); } catch (e) { data = null; }
                const u = (((data || {}).data) || {}).user || {};
                if (u.username) return { profile: igProfile(u) };
                return { error: 'instagram_not_found', tried };
            }
            tried.push('try' + i + ':' + r.status + (txt.indexOf('few minutes') >= 0 ? '/ratelimited' : ''));
        } catch (e) {
            tried.push('err:' + String(e).slice(0, 25));
        }
        await sleep(1200);
    }
    return { error: 'instagram_blocked', tried, session: Boolean(sid) };
}

/* ---------- محركات البحث ---------- */
async function googleJson(q, type, page, key, cx) {
    const gs = new URLSearchParams();
    gs.set('key', key);
    gs.set('cx', cx);
    gs.set('q', q);
    gs.set('num', '10');
    gs.set('safe', 'off');
    gs.set('start', String((page - 1) * 10 + 1));
    if (type === 'image') gs.set('searchType', 'image');
    const r = await fetch('https://www.googleapis.com/customsearch/v1?' + gs.toString(), { headers: { Accept: 'application/json' } });
    if (!r.ok) return { error: 'google_failed', status: r.status };
    const data = await r.json();
    return {
        items: (Array.isArray(data.items) ? data.items : []).map(it => ({
            title: String(it.title || '').slice(0, 120),
            link: String(it.link || ''),
            snippet: clean(it.snippet),
            thumb: String((it.image && it.image.thumbnailLink) || '')
        })).filter(it => /^https?:/.test(it.link))
    };
}
async function serperSearch(q, type, page, key) {
    const r = await fetch('https://google.serper.dev/' + (type === 'image' ? 'images' : 'search'), {
        method: 'POST',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, num: 10, page, gl: 'iq', hl: 'ar' })
    });
    if (!r.ok) return { error: 'serper_failed', status: r.status };
    const data = await r.json();
    if (type === 'image') {
        return {
            items: (data.images || []).map(it => ({
                title: String(it.title || '').slice(0, 120),
                link: String(it.imageUrl || it.link || ''),
                snippet: '',
                thumb: String(it.thumbnailUrl || '')
            })).filter(it => /^https?:/.test(it.link))
        };
    }
    return {
        items: (data.organic || []).map(it => ({
            title: String(it.title || '').slice(0, 120),
            link: String(it.link || ''),
            snippet: clean(it.snippet),
            thumb: ''
        })).filter(it => /^https?:/.test(it.link))
    };
}
async function braveSearch(q, type, page, key) {
    const url = 'https://api.search.brave.com/res/v1/' + (type === 'image' ? 'images' : 'web') + '/search?q=' + encodeURIComponent(q) + '&count=10&offset=' + ((page - 1) * 10);
    const r = await fetch(url, { headers: { 'X-Subscription-Token': key, Accept: 'application/json' } });
    if (!r.ok) return { error: 'brave_failed', status: r.status };
    const data = await r.json();
    if (type === 'image') {
        return {
            items: (data.results || []).map(it => ({
                title: String(it.title || '').slice(0, 120),
                link: String((it.properties && it.properties.url) || it.url || ''),
                snippet: '',
                thumb: String((it.thumbnail && it.thumbnail.src) || '')
            })).filter(it => /^https?:/.test(it.link))
        };
    }
    return {
        items: (((data.web || {}).results) || []).map(it => ({
            title: String(it.title || '').slice(0, 120),
            link: String(it.url || ''),
            snippet: clean(it.description),
            thumb: ''
        })).filter(it => /^https?:/.test(it.link))
    };
}

/* ---------- توليد الصور ---------- */
function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
const IMG_MODELS = ['@cf/black-forest-labs/flux-1-schnell', '@cf/stabilityai/stable-diffusion-xl-base-1.0'];
async function generateImage(prompt, env) {
    if (!env.AI || !env.IMAGES) return { error: 'bindings_missing' };
    let detail = '';
    for (const model of IMG_MODELS) {
        try {
            const out = await env.AI.run(model, { prompt, steps: 4 });
            let b64 = '';
            if (out && typeof out.image === 'string') b64 = out.image;
            else if (out && out.image instanceof Uint8Array) {
                let s = '';
                for (let i = 0; i < out.image.length; i++) s += String.fromCharCode(out.image[i]);
                b64 = btoa(s);
            }
            if (!b64) { detail = 'empty'; continue; }
            const key = 'i/' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
            await env.IMAGES.put(key, b64ToBytes(b64), { metadata: { contentType: 'image/jpeg' } });
            return { key, model };
        } catch (e) {
            detail = String(e).slice(0, 140);
        }
    }
    return { error: 'ai_failed', detail };
}

export default {
    async fetch(request, env, ctx) {
        const origin = request.headers.get('Origin') || '';
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: head(origin) });

        const u = new URL(request.url);
        const raw = u.pathname;
        const path = raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;

        if (path === '/health') return json({ ok: true, service: 'reza-chat-config' }, 200, origin);

        if (path === '/config') {
            const firebase = {
                apiKey: env.FIREBASE_API_KEY || '',
                authDomain: env.FIREBASE_AUTH_DOMAIN || '',
                databaseURL: env.FIREBASE_DB_URL || '',
                projectId: env.FIREBASE_PROJECT_ID || '',
                storageBucket: env.FIREBASE_STORAGE_BUCKET || '',
                messagingSenderId: env.FIREBASE_SENDER_ID || '',
                appId: env.FIREBASE_APP_ID || '',
                measurementId: env.FIREBASE_MEASUREMENT_ID || ''
            };
            const ready = Boolean(firebase.apiKey && firebase.databaseURL && firebase.projectId);
            return json({
                ok: true,
                firebase: ready ? firebase : null,
                features: {
                    googleCx: env.GOOGLE_CX || '',
                    googleJsonApi: Boolean(env.GOOGLE_API_KEY && env.GOOGLE_CX),
                    serper: Boolean(env.SERPER_API_KEY),
                    brave: Boolean(env.BRAVE_API_KEY),
                    tiktok: true,
                    instagram: true,
                    instagramSession: Boolean(env.IG_SESSIONID),
                    qr: true,
                    imageGen: Boolean(env.AI),
                    imageStore: Boolean(env.IMAGES)
                },
                time: new Date().toISOString()
            }, 200, origin);
        }

        if (path === '/tiktok' || path === '/instagram') {
            const user = safeUser(u.searchParams.get('user'));
            if (user.length < 2) return json({ ok: false, error: 'bad_user' }, 400, origin);
            const kind = path === '/tiktok' ? 'tt' : 'ig';
            const ck = new Request('https://reza-chat-internal-cache.local/' + kind + '/' + user);
            const cache = caches.default;
            try {
                const hit = await cache.match(ck);
                if (hit) {
                    const data = await hit.json();
                    return json({ ok: true, profile: data.profile, cached: true }, 200, origin);
                }
            } catch (e) { /* ignore */ }
            const out = path === '/tiktok' ? await tiktok(user) : await instagram(user, env);
            if (out.error) return json({ ok: false, error: out.error, tried: out.tried, user }, out.error.indexOf('not_found') >= 0 ? 404 : 502, origin);
            try {
                ctx.waitUntil(cache.put(ck, new Response(JSON.stringify({ profile: out.profile }), { headers: { 'Cache-Control': 'max-age=3600' } })));
            } catch (e) { /* ignore */ }
            return json({ ok: true, profile: out.profile }, 200, origin);
        }

        if (path === '/search') {
            const q = (u.searchParams.get('q') || '').trim().slice(0, 120);
            const type = (u.searchParams.get('type') || 'web').toLowerCase() === 'images' ? 'image' : 'web';
            const page = Math.min(5, Math.max(1, parseInt(u.searchParams.get('page') || '1', 10) || 1));
            if (q.length < 2) return json({ ok: false, error: 'short_query' }, 400, origin);

            const engines = [];
            if (env.SERPER_API_KEY) engines.push(['serper', () => serperSearch(q, type, page, env.SERPER_API_KEY)]);
            if (env.BRAVE_API_KEY) engines.push(['brave', () => braveSearch(q, type, page, env.BRAVE_API_KEY)]);
            if (env.GOOGLE_API_KEY && env.GOOGLE_CX) engines.push(['google', () => googleJson(q, type, page, env.GOOGLE_API_KEY, env.GOOGLE_CX)]);
            if (!engines.length) return json({ ok: false, error: 'search_not_configured' }, 501, origin);

            const tried = [];
            for (const pair of engines) {
                const res = await pair[1]();
                if (res.items && res.items.length) {
                    return json({ ok: true, engine: pair[0], type, page, q, items: res.items }, 200, origin);
                }
                tried.push(pair[0] + ':' + (res.error || 'empty') + (res.status ? ('(' + res.status + ')') : ''));
            }
            return json({ ok: false, error: 'search_failed', tried }, 502, origin);
        }

        if (path === '/image') {
            const prompt = (u.searchParams.get('prompt') || '').trim().slice(0, 400);
            const count = Math.min(4, Math.max(1, parseInt(u.searchParams.get('count') || '1', 10) || 1));
            if (prompt.length < 3) return json({ ok: false, error: 'short_prompt' }, 400, origin);
            const started = Date.now();
            const urls = [];
            let model = '';
            for (let i = 0; i < count; i++) {
                const res = await generateImage(prompt, env);
                if (res.error) {
                    if (!urls.length) return json({ ok: false, error: res.error, detail: res.detail || '' }, 502, origin);
                    break;
                }
                urls.push(u.origin + '/img/' + res.key);
                model = res.model;
            }
            return json({ ok: true, urls, model, ms: Date.now() - started }, 200, origin);
        }

        if (path === '/upload' && request.method === 'POST') {
            if (!env.IMAGES) return json({ ok: false, error: 'storage_unavailable' }, 503, origin);
            const user = String(request.headers.get('X-Chat-User') || '').toLowerCase();
            const proof = String(request.headers.get('X-Chat-Proof') || '').toLowerCase();
            if (!/^[a-z0-9_-]{1,32}$/.test(user) || !/^[a-f0-9]{64}$/.test(proof)) {
                return json({ ok: false, error: 'auth_required' }, 401, origin);
            }
            try {
                const dbUrl = String(env.FIREBASE_DB_URL || '').replace(/\/+$/, '');
                if (!dbUrl) return json({ ok: false, error: 'upload_auth_unavailable' }, 503, origin);
                const authResponse = await fetch(dbUrl + '/users/' + encodeURIComponent(user) + '.json', { headers: { Accept: 'application/json' } });
                if (!authResponse.ok) return json({ ok: false, error: 'upload_auth_unavailable' }, 503, origin);
                const account = await authResponse.json();
                if (!account || account.isBanned || account.passwordHashed !== true || account.password !== proof) {
                    return json({ ok: false, error: 'auth_required' }, 401, origin);
                }
            } catch (error) {
                console.error('Media upload identity check failed:', String(error).slice(0, 100));
                return json({ ok: false, error: 'upload_auth_unavailable' }, 503, origin);
            }
            const contentType = String(request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
            const allowedTypes = new Set([
                'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/heic', 'image/heif',
                'video/mp4', 'video/webm', 'video/quicktime', 'video/3gpp', 'video/ogg'
            ]);
            if (!allowedTypes.has(contentType)) return json({ ok: false, error: 'unsupported_media_type' }, 415, origin);
            const maxBytes = 20 * 1024 * 1024;
            const contentLength = Number(request.headers.get('Content-Length') || 0);
            if (contentLength > maxBytes) return json({ ok: false, error: 'file_too_large' }, 413, origin);
            const quotaKey = 'q/' + user + '/' + new Date().toISOString().slice(0, 10);
            let usedToday = 0;
            try { usedToday = Number(await env.IMAGES.get(quotaKey) || 0) || 0; }
            catch (error) { return json({ ok: false, error: 'kv_write_failed' }, 503, origin); }
            if (contentLength && usedToday + contentLength > 100 * 1024 * 1024) return json({ ok: false, error: 'daily_upload_limit' }, 429, origin);
            let bytes;
            try { bytes = await request.arrayBuffer(); }
            catch (error) { return json({ ok: false, error: 'invalid_upload' }, 400, origin); }
            if (!bytes.byteLength || bytes.byteLength > maxBytes) return json({ ok: false, error: bytes.byteLength ? 'file_too_large' : 'empty_file' }, bytes.byteLength ? 413 : 400, origin);
            if (usedToday + bytes.byteLength > 100 * 1024 * 1024) return json({ ok: false, error: 'daily_upload_limit' }, 429, origin);
            const id = crypto.randomUUID();
            try {
                await env.IMAGES.put('u/' + id, bytes, {
                    expirationTtl: 15552000,
                    metadata: { contentType }
                });
                await env.IMAGES.put(quotaKey, String(usedToday + bytes.byteLength), { expirationTtl: 172800 });
            } catch (error) {
                console.error('KV media upload failed:', String(error).slice(0, 120));
                return json({ ok: false, error: 'kv_write_failed' }, 507, origin);
            }
            return json({ ok: true, url: u.origin + '/media/' + id, size: bytes.byteLength, contentType }, 201, origin);
        }

        if (path.indexOf('/media/') === 0 && request.method === 'GET') {
            const id = path.slice(7);
            if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('bad media id', { status: 400 });
            const cache = caches.default;
            const ck = new Request('https://reza-chat-internal-cache.local/media/' + id);
            const range = request.headers.get('Range') || '';
            if (!range) {
                try {
                    const hit = await cache.match(ck);
                    if (hit) return hit;
                } catch (error) { /* ignore cache errors */ }
            }
            const got = await env.IMAGES.getWithMetadata('u/' + id, 'arrayBuffer');
            if (!got || !got.value) return new Response('not found', { status: 404 });
            const total = got.value.byteLength;
            let body = got.value;
            let status = 200;
            const headers = {
                'Content-Type': (got.metadata && got.metadata.contentType) || 'application/octet-stream',
                'Content-Length': String(total),
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'public, max-age=86400',
                'X-Content-Type-Options': 'nosniff',
                'Access-Control-Allow-Origin': '*'
            };
            if (range) {
                const match = /^bytes=(\d*)-(\d*)$/.exec(range);
                if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + total } });
                let start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2]));
                let end = match[2] && match[1] ? Number(match[2]) : total - 1;
                if (start > end || start >= total || end < 0) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + total } });
                end = Math.min(end, total - 1);
                body = got.value.slice(start, end + 1);
                status = 206;
                headers['Content-Length'] = String(end - start + 1);
                headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
            }
            const res = new Response(body, { status, headers });
            if (!range) {
                try { ctx.waitUntil(cache.put(ck, res.clone())); } catch (error) { /* ignore cache errors */ }
            }
            return res;
        }

        if (path.indexOf('/img/') === 0) {
            const key = path.slice(5);
            if (!key || key.length > 200) return new Response('bad key', { status: 400 });
            const cache = caches.default;
            const ck = new Request('https://reza-chat-internal-cache.local/img/' + key);
            try {
                const hit = await cache.match(ck);
                if (hit) return hit;
            } catch (e) { /* ignore */ }
            const got = await env.IMAGES.getWithMetadata(key, 'arrayBuffer');
            if (!got || !got.value) return new Response('not found', { status: 404 });
            const res = new Response(got.value, {
                headers: {
                    'Content-Type': (got.metadata && got.metadata.contentType) || 'image/jpeg',
                    'Cache-Control': 'public, max-age=31536000, immutable',
                    'Access-Control-Allow-Origin': '*'
                }
            });
            try { ctx.waitUntil(cache.put(ck, res.clone())); } catch (e) { /* ignore */ }
            return res;
        }

        return json({ ok: false, error: 'not_found' }, 404, origin);
    }
};
