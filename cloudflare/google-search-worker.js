/**
 * وسيط بحث جوجل لموقع Chat — Cloudflare Worker
 * ------------------------------------------------
 * الهدف: يخلي المتصفح يستدعي رابط واحد بدون أي مفتاح ظاهر، والوسيط هو اللي يتكلم مع Google.
 *
 * طريقة التركيب (دقيقتان):
 * 1) افتح dash.cloudflare.com ثم Workers & Pages ثم Create Worker.
 * 2) الصق هذا الملف كامل داخل المحرر ثم Deploy.
 * 3) أضف متغيرات البيئة (Settings ثم Variables):
 *      GOOGLE_API_KEY = مفتاح Google Custom Search
 *      GOOGLE_CX      = معرّف محرك البحث (Programmable Search Engine ID)
 *    اختَر نوع Secret للمفتاح حتى لا يظهر في اللوحة.
 * 4) انسخ رابط الـ Worker (مثل https://naz-search.xxxx.workers.dev) والصقه في إعدادات ناز
 *    بحقل «رابط وسيط Cloudflare Worker».
 *
 * ملاحظات:
 * - إذا ما ضبطت متغيرات البيئة، يقبل الوسيط المفتاح من الطلب (?key=&cx=) بدل ذلك.
 * - المفتاح المجاني في Google يعطي 100 عملية بحث يومياً.
 * - الرد يخرج بصيغة موحّدة: { engine, items: [{ title, link, snippet, thumb }] }
 */

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400'
};

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60', ...CORS }
    });
}

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
        if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

        const url = new URL(request.url);
        const query = (url.searchParams.get('q') || '').trim().slice(0, 120);
        const type = url.searchParams.get('type') === 'images' ? 'images' : 'web';
        const page = Math.min(5, Math.max(1, Number(url.searchParams.get('page')) || 1));
        const key = env.GOOGLE_API_KEY || url.searchParams.get('key') || '';
        const cx = env.GOOGLE_CX || url.searchParams.get('cx') || '';

        if (query.length < 2) return json({ error: 'query_too_short' }, 400);
        if (!key || !cx) return json({ error: 'missing_credentials', hint: 'اضبط GOOGLE_API_KEY و GOOGLE_CX في متغيرات الـ Worker' }, 400);

        const params = new URLSearchParams({ key, cx, q: query, num: '10' });
        if (type === 'images') params.set('searchType', 'image');
        if (page > 1) params.set('start', String((page - 1) * 10 + 1));

        let payload;
        try {
            const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params.toString()}`, {
                headers: { Accept: 'application/json' },
                cf: { cacheTtl: 60, cacheEverything: true }
            });
            payload = await response.json();
            if (!response.ok) {
                return json({ error: 'google_error', status: response.status, detail: payload?.error?.message || null }, response.status);
            }
        } catch (error) {
            return json({ error: 'upstream_failed', detail: String(error && error.message || error) }, 502);
        }

        const items = (payload.items || []).map(item => ({
            title: item.title || '',
            link: item.link || '',
            snippet: item.snippet || '',
            thumb: item.thumbnail?.url || item.image?.src || item.pagemap?.cse_thumbnail?.[0]?.src || ''
        })).filter(item => item.link);

        return json({ engine: 'google', query, type, page, items });
    }
};
