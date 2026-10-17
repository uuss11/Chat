/**
 * REZA CHAT · Cloudflare Worker (النسخة المنشورة)
 * ------------------------------------------------------------
 * الاسم على Cloudflare: reza-chat-config
 * الرابط: https://reza-chat-config.aliali1717ikik.workers.dev
 *
 * المسارات:
 *   GET /health  -> فحص سريع
 *   GET /config  -> معلومات فايربيس (تجي من أسرار الـ Worker، مو من الكود)
 *
 * الأسرار المضبوطة على الـ Worker: FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN,
 * FIREBASE_DB_URL, FIREBASE_PROJECT_ID, FIREBASE_STORAGE_BUCKET,
 * FIREBASE_SENDER_ID, FIREBASE_APP_ID, FIREBASE_MEASUREMENT_ID
 *
 * CORS محصور بـ https://uuss11.github.io — أي أصل ثاني يستلم نفس الترويسة
 * لكن المتصفح يرفض قراءة الرد.
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

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: head(origin) });

        const raw = new URL(request.url).pathname;
        const path = raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;

        if (path === '/health') return json({ ok: true, service: 'reza-chat-config' }, 200, origin);
        if (path !== '/' && path !== '/config') return json({ ok: false, error: 'not_found' }, 404, origin);

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
        return json({ ok: true, firebase: ready ? firebase : null, time: new Date().toISOString() }, 200, origin);
    }
};
