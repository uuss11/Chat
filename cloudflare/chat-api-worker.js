/**
 * REZA CHAT · Cloudflare Worker API
 * ------------------------------------------------------------
 * كل المعلومات السرية تبقى هنا داخل أسرار الـ Worker، والموقع
 * يستدعيها من رابط سحابي واحد. ما يحتاج أي مفتاح داخل المستودع.
 *
 * المسارات:
 *   GET  /health                  -> فحص سريع
 *   GET  /config                  -> إعدادات فايربيس + قدرات الموقع (بدون مفاتيح سرية)
 *   POST /search {query,mode,page}-> بحث جوجل (ويب/صور)
 *   POST /ai    {model,messages}  -> وسيط OpenRouter مع تدوير المفاتيح تلقائياً
 *
 * الأسرار المطلوبة (Settings > Variables and Secrets > Secrets):
 *   FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_DB_URL,
 *   FIREBASE_PROJECT_ID, FIREBASE_STORAGE_BUCKET, FIREBASE_SENDER_ID, FIREBASE_APP_ID
 *   GOOGLE_API_KEY, GOOGLE_CX            (اختياري: لبحث جوجل)
 *   OPENROUTER_KEYS                      (مفاتيح مفصولة بفاصلة، اختياري)
 *
 * المتغيّرات العادية (Variables):
 *   ALLOWED_ORIGINS = https://uuss11.github.io
 */

const DEFAULT_ALLOWED = ['https://uuss11.github.io'];

function allowedOrigins(env) {
    const raw = String(env?.ALLOWED_ORIGINS || '').trim();
    const list = raw ? raw.split(',').map(item => item.trim()).filter(Boolean) : DEFAULT_ALLOWED;
    return list;
}

function corsHeaders(request, env) {
    const origin = request.headers.get('Origin') || '';
    const list = allowedOrigins(env);
    const allow = list.includes(origin) || list.includes('*') ? (origin || list[0]) : list[0];
    return {
        'Access-Control-Allow-Origin': allow,
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin'
    };
}

function json(data, status, request, env) {
    return new Response(JSON.stringify(data), {
        status: status || 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(request, env) }
    });
}

async function readJson(request) {
    try { return await request.json(); } catch (error) { return null; }
}

async function fetchJson(url, init, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...(init || {}), signal: controller.signal });
        if (!response.ok) return { ok: false, status: response.status, data: null };
        return { ok: true, status: response.status, data: await response.json() };
    } catch (error) {
        return { ok: false, status: 0, data: null, error: String(error && error.name || error) };
    } finally {
        clearTimeout(timer);
    }
}

function openRouterKeys(env) {
    return String(env?.OPENROUTER_KEYS || '').split(/[\s,;]+/).map(key => key.trim()).filter(Boolean);
}

/* ---------------- Google Custom Search ---------------- */
async function handleSearch(request, env) {
    const body = await readJson(request);
    const query = String(body?.query || '').trim();
    const mode = String(body?.mode || 'web').toLowerCase() === 'images' ? 'image' : 'web';
    const page = Math.min(5, Math.max(1, Number(body?.page) || 1));
    if (query.length < 2) return json({ ok: false, error: 'short_query' }, 400, request, env);

    const key = String(env?.GOOGLE_API_KEY || '').trim();
    const cx = String(env?.GOOGLE_CX || '').trim();
    if (!key || !cx) return json({ ok: false, error: 'google_not_configured' }, 501, request, env);

    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', key);
    url.searchParams.set('cx', cx);
    url.searchParams.set('q', query);
    url.searchParams.set('num', '10');
    url.searchParams.set('start', String((page - 1) * 10 + 1));
    url.searchParams.set('safe', 'off');
    if (mode === 'image') url.searchParams.set('searchType', 'image');

    const result = await fetchJson(url.toString());
    if (!result.ok) return json({ ok: false, error: 'google_failed', status: result.status }, 502, request, env);

    const items = (result.data?.items || []).map(item => ({
        title: item.title || '',
        link: mode === 'image' ? (item.link || item.image?.thumbnailLink || '') : item.link,
        thumb: item.image?.thumbnailLink || '',
        snippet: item.snippet || '',
        source: item.displayLink || ''
    })).filter(item => /^https?:\/\//i.test(item.link));

    return json({ ok: true, engine: 'google', mode, page, query, items }, 200, request, env);
}

/* ---------------- OpenRouter proxy with key rotation ---------------- */
async function handleAi(request, env) {
    const body = await readJson(request);
    const model = String(body?.model || '').trim();
    const messages = Array.isArray(body?.messages) ? body.messages : null;
    if (!model || !messages || !messages.length) return json({ ok: false, error: 'bad_request' }, 400, request, env);

    const keys = openRouterKeys(env);
    if (!keys.length) return json({ ok: false, error: 'openrouter_not_configured' }, 501, request, env);

    const payload = JSON.stringify({
        model,
        messages,
        max_tokens: Math.min(2048, Math.max(64, Number(body?.maxTokens) || 700)),
        temperature: Math.max(0, Math.min(2, Number(body?.temperature) ?? 0.8)),
        ...(body?.json ? { response_format: { type: 'json_object' } } : {})
    });

    const tried = [];
    for (const key of keys) {
        const result = await fetchJson('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': allowedOrigins(env)[0],
                'X-Title': 'REZA Chat'
            },
            body: payload
        }, 45000);
        if (result.ok) return json({ ok: true, completion: result.data, keyIndex: tried.length }, 200, request, env);
        tried.push(result.status);
        if (result.status === 400 || result.status === 404) break; // خطأ في الطلب نفسه، ما يفيد تبديل المفتاح
    }
    return json({ ok: false, error: 'openrouter_failed', tried }, 502, request, env);
}

/* ---------------- Firebase config from secrets ---------------- */
function handleConfig(request, env) {
    const firebase = {
        apiKey: env.FIREBASE_API_KEY || '',
        authDomain: env.FIREBASE_AUTH_DOMAIN || '',
        databaseURL: env.FIREBASE_DB_URL || '',
        projectId: env.FIREBASE_PROJECT_ID || '',
        storageBucket: env.FIREBASE_STORAGE_BUCKET || '',
        messagingSenderId: env.FIREBASE_SENDER_ID || '',
        appId: env.FIREBASE_APP_ID || ''
    };
    const ready = Boolean(firebase.apiKey && firebase.databaseURL && firebase.projectId);
    return json({
        ok: true,
        firebase: ready ? firebase : null,
        features: {
            googleSearch: Boolean(env.GOOGLE_API_KEY && env.GOOGLE_CX),
            openRouter: openRouterKeys(env).length > 0,
            openRouterKeys: openRouterKeys(env).length
        }
    }, 200, request, env);
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });

        switch (url.pathname.replace(/\/+$/, '') || '/') {
            case '/':
            case '/health':
                return json({ ok: true, service: 'reza-chat-api', time: new Date().toISOString() }, 200, request, env);
            case '/config':
                return handleConfig(request, env);
            case '/search':
                if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, request, env);
                return handleSearch(request, env);
            case '/ai':
                if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, request, env);
                return handleAi(request, env);
            default:
                return json({ ok: false, error: 'not_found' }, 404, request, env);
        }
    }
};
