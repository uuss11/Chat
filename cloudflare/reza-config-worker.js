/**
 * REZA CHAT · Cloudflare Worker (نسخة كاملة قابلة للنشر)
 * ------------------------------------------------------------
 * الاسم: reza-chat-config
 * الرابط: https://reza-chat-config.aliali1717ikik.workers.dev
 *
 * المسارات:
 *   GET /health                     فحص سريع
 *   GET /config                     معلومات فايربيس (من أسرار الـ Worker) + الميزات المفعّلة
 *   GET /search?q=&type=&page=      بحث ويب/صور (Serper ثم Brave ثم Google JSON حسب المفاتيح المتوفرة)
 *   GET /tiktok?user=               معلومات حساب تيك توك (من صفحة التضمين)
 *   GET /instagram?user=            معلومات حساب انستغرام (i.instagram web_profile_info)
 *
 * الأسرار المطلوبة: FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_DB_URL, FIREBASE_PROJECT_ID,
 *                   FIREBASE_STORAGE_BUCKET, FIREBASE_SENDER_ID, FIREBASE_APP_ID, FIREBASE_MEASUREMENT_ID
 * الاختيارية: GOOGLE_API_KEY, GOOGLE_CX, SERPER_API_KEY, BRAVE_API_KEY
 * CORS محصور بـ https://uuss11.github.io
 */

const ALLOW = ['https://uuss11.github.io'];
const allow = origin => (ALLOW.includes(origin) ? origin : ALLOW[0]);
const head = origin => ({
    'Access-Control-Allow-Origin': allow(origin),
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
});
const json = (data, status, origin) => new Response(JSON.stringify(data), { status: status || 200, headers: head(origin) });
const clean = s => String(s || '').split(' ').filter(Boolean).join(' ').slice(0, 200);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const safeUser = u => String(u || '').replace(/[^A-Za-z0-9._]/g, '').slice(0, 30);

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
    return {
        platform: 'tiktok',
        username: uname,
        nickname: field(win, 'nickname'),
        id: field(win, 'id'),
        bio: field(win, 'signature'),
        avatar: field(win, 'avatarLarger') || field(win, 'avatarMedium') || field(win, 'avatarThumb'),
        verified: field(win, 'verified') === 'true',
        private: field(win, 'privateAccount') === 'true',
        region: field(win, 'region'),
        followers: num(field(win, 'followerCount')),
        following: num(field(win, 'followingCount')),
        likes: num(field(win, 'heartCount')),
        videos: num(field(win, 'videoCount')),
        link: 'https://www.tiktok.com/@' + uname
    };
}
async function tiktok(user) {
    const urls = ['https://www.tiktok.com/embed/@' + user, 'https://www.tiktok.com/@' + user];
    const tried = [];
    for (const url of urls) {
        try {
            const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' } });
            const html = await r.text();
            const prof = tiktokFrom(html, user);
            if (prof) return { profile: prof };
            tried.push(url + '(' + r.status + ',' + html.length + ')');
        } catch (e) {
            tried.push(url + '(' + String(e).slice(0, 30) + ')');
        }
    }
    return { error: 'tiktok_blocked', tried };
}

/* ---------- انستغرام ---------- */
async function instagram(user) {
    const heads = {
        'User-Agent': UA,
        'x-ig-app-id': '936619743392459',
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.instagram.com/'
    };
    const urls = [
        'https://i.instagram.com/api/v1/users/web_profile_info/?username=' + user,
        'https://www.instagram.com/api/v1/users/web_profile_info/?username=' + user
    ];
    const tried = [];
    for (const url of urls) {
        try {
            const r = await fetch(url, { headers: heads });
            const txt = await r.text();
            if (r.ok) {
                let data = null;
                try { data = JSON.parse(txt); } catch (e) { data = null; }
                const u = (((data || {}).data) || {}).user || {};
                if (u.username) {
                    return {
                        profile: {
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
                        }
                    };
                }
            }
            tried.push(url.slice(0, 40) + '(' + r.status + ',' + txt.length + ')');
        } catch (e) {
            tried.push('err:' + String(e).slice(0, 30));
        }
    }
    return { error: 'instagram_blocked', tried };
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

export default {
    async fetch(request, env) {
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
                    qr: true
                },
                time: new Date().toISOString()
            }, 200, origin);
        }

        if (path === '/tiktok' || path === '/instagram') {
            const user = safeUser(u.searchParams.get('user'));
            if (user.length < 2) return json({ ok: false, error: 'bad_user' }, 400, origin);
            const out = path === '/tiktok' ? await tiktok(user) : await instagram(user);
            if (out.error) return json({ ok: false, error: out.error, tried: out.tried, user }, 502, origin);
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

        return json({ ok: false, error: 'not_found' }, 404, origin);
    }
};
