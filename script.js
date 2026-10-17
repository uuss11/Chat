import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
        import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";
        import { getDatabase, ref, set, get, push, onValue, query, limitToLast, remove, update, runTransaction, serverTimestamp, onDisconnect } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
        import { TOOL_KINDS, renderToolCard, applyToolAction, parseToolResponse, isToolRequest, buildToolPrompt, isImageRequest, buildImageQueryPrompt, detectRequestKind, buildMediaQueryPrompt, parseMediaPlan, wantsMultipleResults, buildFilePrompt, parseFileResponse, mountToolTimers, clearToolTimers, mountToolCanvases, clearToolCanvases } from './naz-tools.js?v=16';

        // ============================================
        // 🔐 Security Utilities
        // ============================================

        // 🛡️ تحذير أمني في الكونسول
        console.log('%c⚠️ تحذير أمني!', 'color: red; font-size: 24px; font-weight: bold;');
        console.log('%cإذا طلب منك شخص لصق كود هنا، فهو يحاول اختراق حسابك!', 'color: red; font-size: 14px;');
        console.log('%cلا تلصق أي كود هنا أبداً.', 'color: orange; font-size: 14px;');

        async function hashPassword(password) {
            const encoder = new TextEncoder();
            const data = encoder.encode(password + '_RZ_SECURE_2026');
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }

        function generateAdminToken() {
            const array = new Uint8Array(32);
            crypto.getRandomValues(array);
            return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
        }

        // 🛡️ دالة تنقية HTML لمنع XSS
        function sanitizeHTML(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;')
                .replace(/`/g, '&#96;');
        }

        // 🛡️ تنقية URLs لمنع javascript: protocol
        const AUDIO_URL_PATTERN = /\.(mp3|ogg|oga|m4a|wav)(\?.*)?$/i;
        const VIDEO_URL_PATTERN = /\.(mp4|webm|ogv|m4v)(\?.*)?$/i;

        function isAudioUrl(url) {
            const safe = sanitizeURL(url);
            return !!safe && AUDIO_URL_PATTERN.test(safe);
        }

        function isVideoUrl(url) {
            const safe = sanitizeURL(url);
            return !!safe && VIDEO_URL_PATTERN.test(safe);
        }

        function escapeCode(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function updateGoogleSearchStatus() {
            const status = document.getElementById('ai-google-status');
            if (!status) return;
            const { key, cx, worker } = getSearchSettings();
            if (worker) status.textContent = '✅ البحث يمر عبر وسيط Cloudflare (المفتاح يبقى مخفياً).';
            else if (key && cx) status.textContent = '✅ بحث جوجل مفعّل مباشرة من المتصفح (100 بحث مجاني يومياً).';
            else if (key || cx) status.textContent = '⚠️ أكمل الحقلين: مفتاح Google و CX.';
            else status.textContent = 'ℹ️ بدون مفتاح جوجل: البحث يعمل عبر ويكيبيديا (عربي + إنجليزي).';
        }

        function getSearchSettings() {
            const cfg = dbAiConfig || {};
            return {
                key: String(cfg.googleKey || '').trim(),
                cx: String(cfg.googleCx || '').trim(),
                worker: String(cfg.googleWorker || '').trim()
            };
        }

        function normaliseSearchItems(payload, mode) {
            const raw = Array.isArray(payload?.items) ? payload.items
                : Array.isArray(payload?.data) ? payload.data
                    : Array.isArray(payload?.results) ? payload.results : [];
            return raw.map(item => ({
                title: String(item?.title || item?.name || '').slice(0, 120),
                link: sanitizeURL(item?.link || item?.url || ''),
                snippet: String(item?.snippet || item?.description || '').replace(/\s+/g, ' ').slice(0, 200),
                thumb: sanitizeURL(item?.thumbnail?.url || item?.image?.src || item?.pagemap?.cse_thumbnail?.[0]?.src || item?.thumb || '')
            })).filter(item => item.link);
        }

        async function googleSearch(query, mode, page) {
            const { key, cx, worker } = getSearchSettings();
            const trimmed = String(query || '').trim().slice(0, 120);
            if (trimmed.length < 2) return null;
            const wanted = mode === 'images' ? 'images' : 'web';
            const targetPage = Math.min(5, Math.max(1, Number(page) || 1));
            try {
                if (worker && /^https:\/\//i.test(worker)) {
                    const url = `${worker}${worker.includes('?') ? '&' : '?'}q=${encodeURIComponent(trimmed)}&type=${wanted}&page=${targetPage}`;
                    const payload = await fetchJsonWithTimeout(url, 15000);
                    const items = normaliseSearchItems(payload, wanted);
                    if (items.length) return { engine: 'google', items };
                }
                if (key && cx) {
                    const params = new URLSearchParams({ key, cx, q: trimmed, num: '10' });
                    if (wanted === 'images') params.set('searchType', 'image');
                    if (targetPage > 1) params.set('start', String((targetPage - 1) * 10 + 1));
                    const payload = await fetchJsonWithTimeout(`https://www.googleapis.com/customsearch/v1?${params.toString()}`, 15000);
                    const items = normaliseSearchItems(payload, wanted);
                    if (items.length) return { engine: 'google', items };
                }
            } catch (error) {
                console.warn('Google search unavailable:', error);
            }
            return null;
        }

        async function openSearch(query, mode, page) {
            const trimmed = String(query || '').trim().slice(0, 120);
            const items = [];
            if (mode === 'images') {
                const candidates = await collectMediaCandidates('image', [trimmed], 8);
                return {
                    engine: 'open',
                    items: candidates.map(item => ({ title: item.title || trimmed, link: item.url, thumb: item.url, snippet: '' }))
                };
            }
            const wikiSnippet = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
            const seen = new Set();
            const addItem = item => {
                if (!item?.link || seen.has(item.link) || items.length >= 10) return;
                seen.add(item.link);
                items.push(item);
            };
            try {
                const rest = await fetchJsonWithTimeout(`https://api.wikimedia.org/core/v1/wikipedia/ar/search/page?q=${encodeURIComponent(trimmed)}&limit=6`, 12000);
                (rest?.pages || []).forEach(page => {
                    addItem({
                        title: String(page.title || '').slice(0, 120),
                        link: `https://ar.wikipedia.org/wiki/${encodeURIComponent(String(page.key || page.title || '').replace(/ /g, '_'))}`,
                        snippet: String(page.description || page.excerpt || '').slice(0, 200)
                    });
                });
            } catch (error) {
                console.warn('Wikimedia search failed:', error);
            }
            try {
                const arabic = await fetchJsonWithTimeout(`https://ar.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=search&srsearch=${encodeURIComponent(trimmed)}&srlimit=6&srprop=snippet`, 12000);
                (arabic?.query?.search || []).forEach(entry => {
                    addItem({
                        title: String(entry.title || '').slice(0, 120),
                        link: `https://ar.wikipedia.org/wiki/${encodeURIComponent(String(entry.title || '').replace(/ /g, '_'))}`,
                        snippet: wikiSnippet(entry.snippet)
                    });
                });
            } catch (error) {
                console.warn('Wikipedia search failed:', error);
            }
            try {
                const english = await fetchJsonWithTimeout(`https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=search&srsearch=${encodeURIComponent(trimmed)}&srlimit=4&srprop=snippet`, 12000);
                (english?.query?.search || []).forEach(entry => {
                    addItem({
                        title: String(entry.title || '').slice(0, 120),
                        link: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(entry.title || '').replace(/ /g, '_'))}`,
                        snippet: wikiSnippet(entry.snippet)
                    });
                });
            } catch (error) {
                console.warn('English Wikipedia search failed:', error);
            }
            return { engine: 'open', items: items.filter(item => item.link).slice(0, 10) };
        }

        async function runSearch(query, mode = 'web', page = 1) {
            const google = await googleSearch(query, mode, page);
            if (google && google.items.length) return google;
            return openSearch(query, mode, page);
        }

        function renderWebCard(web) {
            const items = (Array.isArray(web?.items) ? web.items : [])
                .map(item => {
                    const link = sanitizeURL(item?.link);
                    if (!link) return '';
                    const title = sanitizeHTML(String(item?.title || link).slice(0, 120));
                    const snippet = sanitizeHTML(String(item?.snippet || '').replace(/\s+/g, ' ').slice(0, 200));
                    let host = '';
                    try { host = new URL(link).hostname.replace(/^www\./, ''); } catch { host = ''; }
                    return `<a class="search-result" href="${sanitizeHTML(link)}" target="_blank" rel="noopener noreferrer"><span class="search-result-title">${title}</span>${snippet ? `<span class="search-result-snippet">${snippet}</span>` : ''}${host ? `<span class="search-result-host">${sanitizeHTML(host)}</span>` : ''}</a>`;
                })
                .filter(Boolean)
                .join('');
            if (!items) return '';
            const engine = web?.engine === 'google' ? 'جوجل' : 'بحث مفتوح المصدر';
            return `<div class="web-card"><div class="web-head"><i class="fas fa-globe"></i><span>نتائج الويب · ${engine}</span></div><div class="search-results">${items}</div></div>`;
        }

        function renderResultsCard(results, caption) {
            const kind = ['image', 'audio', 'video'].includes(results.kind) ? results.kind : 'image';
            const items = (Array.isArray(results.items) ? results.items : [])
                .map(item => ({ url: sanitizeURL(item?.url), title: String(item?.title || '').slice(0, 60) }))
                .filter(item => item.url)
                .slice(0, 8);
            if (!items.length) return '';
            const grid = items.map((item, index) => {
                const visual = kind === 'image'
                    ? `<img src="${sanitizeHTML(item.url)}" alt="" loading="lazy">`
                    : `<span class="result-icon">${kind === 'audio' ? '🎵' : '🎬'}</span>`;
                return `<button type="button" class="result-item ${index === 0 ? 'is-active' : ''}" data-result-url="${sanitizeHTML(item.url)}" data-result-kind="${kind}" data-result-title="${sanitizeHTML(item.title)}" title="${sanitizeHTML(item.title || item.url)}">${visual}<span class="result-label">${sanitizeHTML(item.title || `نتيجة ${index + 1}`)}</span></button>`;
            }).join('');
            return `<div class="results-card">
                ${caption ? `<div class="results-caption">${sanitizeHTML(caption)}</div>` : ''}
                <div class="results-grid">${grid}</div>
                <div class="results-stage" data-results-stage></div>
                <div class="results-hint">انقر أي نتيجة لتشغيلها أو عرضها</div>
            </div>`;
        }

        function showChosenResult(button) {
            const card = button.closest('.results-card');
            const stage = card?.querySelector('[data-results-stage]');
            if (!stage) return;
            const url = sanitizeURL(button.dataset.resultUrl);
            if (!url) return;
            const kind = button.dataset.resultKind;
            card.querySelectorAll('.result-item.is-active').forEach(item => item.classList.remove('is-active'));
            button.classList.add('is-active');
            const title = sanitizeHTML(button.dataset.resultTitle || '');
            const safe = sanitizeHTML(url);
            const preview = kind === 'audio'
                ? `<audio controls autoplay preload="metadata" src="${safe}"></audio>`
                : kind === 'video'
                    ? `<video controls autoplay playsinline preload="metadata" src="${safe}"></video>`
                    : `<img class="results-preview" src="${safe}" alt="${title}" onclick="openImageModal('${safe}')">`;
            stage.innerHTML = `${preview}<div class="results-actions">${title ? `<span class="results-title">${title}</span>` : ''}<a class="media-link" href="${safe}" target="_blank" rel="noopener noreferrer">فتح الرابط</a><button type="button" class="tool-key" data-result-copy="${safe}"><i class="fas fa-copy"></i> نسخ</button></div>`;
        }

        function renderFileCard(msgKey, file, caption) {
            const sizeLabel = file.size > 1024 ? `${Math.round(file.size / 1024)} كيلوبايت` : `${file.size} حرف`;
            return `<div class="file-card">
                <div class="file-head">
                    <span class="file-icon"><i class="fas fa-file-code"></i></span>
                    <span class="file-name">${escapeCode(file.name)}</span>
                    <span class="file-lang">${escapeCode(file.language || 'text')}</span>
                </div>
                ${caption ? `<div class="file-caption">${sanitizeHTML(caption)}</div>` : ''}
                <pre class="file-code" onclick="event.stopPropagation()"><code>${escapeCode(file.content.slice(0, 20000))}</code></pre>
                <div class="file-foot">
                    <span class="file-size">${escapeCode(sizeLabel)}</span>
                    <button type="button" class="tool-key tool-key-primary" data-file-copy="${escapeCode(msgKey)}"><i class="fas fa-copy"></i> نسخ</button>
                    <button type="button" class="tool-key" data-file-download="${escapeCode(msgKey)}"><i class="fas fa-download"></i> تنزيل</button>
                </div>
            </div>`;
        }

        function sanitizeURL(url) {
            if (!url) return '';
            const trimmed = String(url).trim();
            try {
                const parsed = new URL(trimmed);
                if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
                return parsed.href;
            } catch {
                return '';
            }
        }

        // 🎲 توليد رابط أفاتار عشوائي (ذكر أو أنثى)
        function getDefaultAvatarUrl(seed) {
            if (!seed) seed = 'NAZ';
            let hash = 0;
            const str = String(seed);
            for (let i = 0; i < str.length; i++) {
                hash = str.charCodeAt(i) + ((hash << 5) - hash);
            }
            const gender = Math.abs(hash) % 2 === 0 ? 'male' : 'female';
            return `https://xsgames.co/randomusers/avatar.php?g=${gender}&v=${encodeURIComponent(str)}`;
        }

        let adminToken = null; // 🔐 رمز إدارة ديناميكي - لا يُخزن بالكود أبداً
        let adminTokenExpiry = 0; // 🔐 وقت انتهاء صلاحية الرمز
        const ADMIN_TOKEN_TTL = 3600000; // ساعة واحدة

        // 🔐 تجديد رمز الإدارة إذا انتهت صلاحيته
        async function ensureValidAdminToken() {
            if (!me || me.user !== 'reza') return null;
            if (adminToken && Date.now() < adminTokenExpiry) return adminToken;
            
            adminToken = generateAdminToken();
            adminTokenExpiry = Date.now() + ADMIN_TOKEN_TTL;
            try {
                await set(ref(db, '_adminAuth'), { 
                    token: adminToken, 
                    timestamp: Date.now(),
                    ownerUid: 'reza'
                });
                console.log('🔐 Admin token refreshed');
            } catch (e) {
                console.warn('⚠️ Could not refresh admin token:', e);
                adminToken = null;
                adminTokenExpiry = 0;
            }
            return adminToken;
        }

        // ============================================
        // ✅ إعدادات Firebase - تم ملؤها بمعلوماتك
        // ============================================
        // 🔐 معلومات فايربيس تُجلب من Cloudflare Worker عند توفّر رابطه، وهذا المضمّن احتياطي فقط.
        const firebaseConfigFallback = {
            apiKey: "AIzaSyBvGWF0u83mrdtBTLWgGV-ExuO6-4j-1Xk",
            authDomain: "reza-3d325.firebaseapp.com",
            databaseURL: "https://reza-3d325-default-rtdb.europe-west1.firebasedatabase.app",
            projectId: "reza-3d325",
            storageBucket: "reza-3d325.firebasestorage.app",
            messagingSenderId: "454599070550",
            appId: "1:454599070550:web:48f519a98dcf302bbe3cf7",
            measurementId: "G-Z6951JPFL2"
        };
        let firebaseConfig = { ...firebaseConfigFallback };
        const CLOUD_API_CACHE_KEY = 'reza_cloud_api_url';
        const CLOUD_RELOAD_FLAG = 'reza_cloud_reload_done';
        let cloudConfigSource = '';

        let app, db, analytics;
        let me = null, activeMsg = null, isEdit = false, replyData = null, forwardData = null;
        let dbAiConfig = null;
        const processedAiMsgs = new Set();
        const KEY_STATUS_STORAGE = 'naz_key_status_v1';
        const KEY_COOLDOWN_MS = 5 * 60 * 1000;
        const KEY_SOFT_COOLDOWN_MS = 60 * 1000;
        let aiKeyStatus = {};
        let aiModelChain = [];
        const toolRegistry = new Map();
        const fileRegistry = new Map();
        const openReactionDetails = new Set();
        let openRouterModelsCache = null;
        let openRouterModelsCachedAt = 0;
        let openRouterModelsPromise = null;
        let aiModelSearchTimer = null;
        let aiModelSearchSequence = 0;
        let isInitialLoad = true;
        let currentTheme = 'calm';
        let onlineUsers = new Set();
        let pinnedMessageId = null;
        let joinTime = Date.now();
        let isFirebaseReady = false;
        let loadingTimeout = null;
        let currentMenuAvatar = '';
        let currentViewAvatar = '';
        let currentEditAvatar = '';

        // عرض رسالة خطأ
        function showError(message) {
            const errorBox = document.getElementById('error-box');
            const errorText = document.getElementById('error-text');
            errorText.textContent = String(message || 'حدث خطأ غير متوقع');
            errorBox.classList.add('show');
            setTimeout(() => errorBox.classList.remove('show'), 8000);
        }

        // إخفاء الـ loading
        function hideLoading() {
            document.getElementById('loading-overlay').style.display = 'none';
            document.getElementById('login-btn').disabled = false;
            if (loadingTimeout) {
                clearTimeout(loadingTimeout);
                loadingTimeout = null;
            }
        }

        // ☁️ رابط الـ Cloudflare Worker: من ?api= أو التخزين المحلي أو cloud-config.js
        function resolveCloudApiUrl() {
            const fromQuery = String(new URLSearchParams(location.search).get('api') || '').trim();
            let fromStorage = '';
            try { fromStorage = String(localStorage.getItem(CLOUD_API_CACHE_KEY) || '').trim(); } catch (error) { fromStorage = ''; }
            const fromGlobal = String(window.REZA_CLOUD_API || '').trim();
            const url = fromQuery || fromStorage || fromGlobal;
            if (!/^https:\/\/[^\s]+$/i.test(url)) return '';
            return url.replace(/\/+$/, '');
        }
        function rememberCloudApiUrl(url) {
            const clean = String(url || '').trim().replace(/\/+$/, '');
            if (!/^https:\/\/[^\s]+$/i.test(clean)) return;
            try { localStorage.setItem(CLOUD_API_CACHE_KEY, clean); } catch (error) { /* تجاهل */ }
        }
        // جلب معلومات فايربيس من الـ Worker، وإذا فشل نرجع للاحتياطي
        async function loadCloudFirebaseConfig() {
            const api = resolveCloudApiUrl();
            if (!api) return false;
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 8000);
                const response = await fetch(api + '/config', { signal: controller.signal, headers: { Accept: 'application/json' } });
                clearTimeout(timer);
                if (!response.ok) throw new Error('HTTP ' + response.status);
                const data = await response.json();
                const remote = data && data.firebase;
                if (!remote || !remote.apiKey || !remote.databaseURL || !remote.projectId) throw new Error('incomplete config');
                firebaseConfig = { ...firebaseConfigFallback, ...remote };
                cloudConfigSource = api;
                console.log('☁️ معلومات فايربيس جُلبَت من Cloudflare:', api);
                return true;
            } catch (error) {
                console.warn('⚠️ تعذّر جلب الإعدادات من Cloudflare، نستخدم الاحتياطي:', error && error.message);
                return false;
            }
        }
        function updateCloudConfigStatus() {
            const box = document.getElementById('cloud-config-status');
            if (!box) return;
            const api = resolveCloudApiUrl();
            if (cloudConfigSource) {
                box.textContent = '☁️ الإعدادات تُجلب الآن من Cloudflare: ' + cloudConfigSource;
                box.dataset.state = 'cloud';
            } else if (api) {
                box.textContent = '⚠️ الرابط محفوظ لكن الجلب فشل — نتأكد من الرابط والأسرار. الاحتياطي المضمّن فعّال.';
                box.dataset.state = 'error';
            } else {
                box.textContent = 'ℹ️ لا يوجد رابط سحابي بعد — الموقع يستخدم الإعدادات المضمّنة. أضف رابط الـ Worker لتنتقل الأسرار للكلاود.';
                box.dataset.state = 'local';
            }
        }
        window.setCloudApiUrl = (url) => {
            rememberCloudApiUrl(url);
            updateCloudConfigStatus();
        };
        // تهيئة Firebase
        async function initFirebase() {
            if (isFirebaseReady) return true;
            try {
                await loadCloudFirebaseConfig();
                Object.freeze(firebaseConfig);
                app = initializeApp(firebaseConfig);
                db = getDatabase(app);
                analytics = getAnalytics(app);
                isFirebaseReady = true;
                console.log('✅ Firebase initialized successfully');
                return true;
            } catch (error) {
                console.error('❌ Firebase initialization error:', error);
                showError('فشل في تهيئة Firebase: ' + error.message);
                return false;
            }
        }

        // حفظ بيانات الجلسة في الكوكيز
        function setCookie(name, value, days = 30) {
            const expires = new Date(Date.now() + days * 864e5).toUTCString();
            const secure = location.protocol === 'https:' ? '; Secure' : '';
            document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/; SameSite=Strict' + secure;
        }

        function getCookie(name) {
            return document.cookie.split('; ').reduce((r, v) => {
                const parts = v.split('=');
                return parts[0] === name ? decodeURIComponent(parts[1]) : r;
            }, '');
        }

        function deleteCookie(name) {
            document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        }

        const avatarInput = document.getElementById('user-avatar');
        const avatarPreview = document.getElementById('avatar-preview');
        const avatarPlaceholder = document.getElementById('avatar-placeholder');

        document.querySelectorAll('.theme-option').forEach(option => {
            option.setAttribute('role', 'button');
            option.tabIndex = 0;
            option.setAttribute('aria-label', `اختيار ثيم ${option.dataset.name || option.dataset.theme}`);
        });

        avatarInput.addEventListener('input', (e) => {
            const url = sanitizeURL(e.target.value.trim());
            if (url) {
                avatarPreview.src = url;
                avatarPreview.style.display = 'block';
                avatarPlaceholder.style.display = 'none';
                avatarPreview.onerror = () => {
                    avatarPreview.style.display = 'none';
                    avatarPlaceholder.style.display = 'flex';
                };
            } else {
                avatarPreview.style.display = 'none';
                avatarPlaceholder.style.display = 'flex';
            }
        });

        document.querySelectorAll('.theme-option').forEach(option => {
            option.addEventListener('click', () => {
                document.querySelectorAll('.theme-option').forEach(o => o.classList.remove('active'));
                option.classList.add('active');
                currentTheme = option.dataset.theme;
                document.body.setAttribute('data-theme', currentTheme);
                try { localStorage.setItem('chat-theme', currentTheme); } catch {}
            });
            option.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    option.click();
                }
            });
        });

        try {
            const savedTheme = localStorage.getItem('chat-theme');
            const allowedThemes = ['calm', 'light', 'ocean', 'purple', 'sunset', 'emerald', 'rose', 'gold', 'midnight', 'cherry', 'arctic', 'lavender', 'neon', 'coffee'];
            if (allowedThemes.includes(savedTheme)) {
                currentTheme = savedTheme;
                document.body.setAttribute('data-theme', savedTheme);
                document.querySelectorAll('.theme-option').forEach(o => o.classList.toggle('active', o.dataset.theme === savedTheme));
            }
        } catch {}

        window.toggleTheme = () => {
            const themes = ['calm', 'light', 'ocean', 'purple', 'sunset', 'emerald', 'rose', 'gold', 'midnight', 'cherry', 'arctic', 'lavender', 'neon', 'coffee'];
            const currentIndex = themes.indexOf(currentTheme);
            const nextIndex = (currentIndex + 1) % themes.length;
            currentTheme = themes[nextIndex];
            document.body.setAttribute('data-theme', currentTheme);
            try { localStorage.setItem('chat-theme', currentTheme); } catch {}
            document.querySelectorAll('.theme-option').forEach(o => o.classList.toggle('active', o.dataset.theme === currentTheme));
            showNotification(`تم تغيير الثيم إلى ${getThemeName(currentTheme)}`);
        };

        const getThemeName = (theme) => ({ calm: 'هادئ', light: 'فاتح', ocean: 'أوشن', purple: 'بنفسجي', sunset: 'غروب', emerald: 'زمرد', rose: 'وردي', gold: 'ذهبي', midnight: 'منتصف الليل', cherry: 'كرزي', arctic: 'جليدي', lavender: 'لافندر', neon: 'نيون', coffee: 'قهوة' }[theme]);

        function showNotification(text) {
            const notif = document.getElementById('notification');
            document.getElementById('notification-text').textContent = text;
            notif.classList.add('show');
            setTimeout(() => notif.classList.remove('show'), 3000);
        }

        // === دوال مساعدة بريميوم ===
        const REACTION_EMOJIS = ['❤️', '👍', '😂', '😢', '😮', '🔥'];

        const NAZ_MOODS = {
            warm: { label: 'ودودة وحنونة', fallback: ['❤️', '👍'] },
            playful: { label: 'مرحة', fallback: ['😂', '❤️', '😮'] },
            excited: { label: 'متحمسة', fallback: ['🔥', '👍', '😮'] },
            calm: { label: 'هادئة', fallback: ['👍', '❤️'] }
        };

        function getNazMood() {
            const configured = dbAiConfig?.mood || 'auto';
            if (configured !== 'auto' && NAZ_MOODS[configured]) {
                return { key: configured, ...NAZ_MOODS[configured] };
            }
            const moods = Object.keys(NAZ_MOODS);
            const cycle = Math.floor(Date.now() / (5 * 60 * 1000));
            const key = moods[cycle % moods.length];
            return { key, ...NAZ_MOODS[key] };
        }

        function stableHash(value) {
            let hash = 2166136261;
            for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
            return hash >>> 0;
        }

        function chooseNazReaction(messageKey, message, forced = false) {
            const mood = getNazMood();
            const text = typeof message?.txt === 'string' ? message.txt : '';
            if (!forced && stableHash(`${messageKey}|${mood.key}|chance`) % 100 >= 30) return null;

            let choices = mood.fallback;
            if (message?.isImage) choices = ['😮', '❤️', '🔥'];
            else if (/(?:^|[^\p{L}])(?:هههه+|لول|نكتة|نكت|😂|🤣|lol)(?:$|[^\p{L}])/iu.test(text)) choices = ['😂', '❤️'];
            else if (/(?:^|[^\p{L}])(?:حزين|زعلان|متضايق|تعبان|مضايقني|😢)(?:$|[^\p{L}])/iu.test(text)) choices = mood.key === 'playful' ? ['❤️', '😢'] : ['😢', '❤️'];
            else if (/(?:^|[^\p{L}])(?:شكرا|شكراً|مشكور|ممنون|تسلم|thanks|thank you)(?:$|[^\p{L}])/iu.test(text)) choices = ['❤️', '👍'];
            else if (/(?:^|[^\p{L}])(?:مبروك|نجحت|فزت|ترقية|إنجاز|انجاز|🥳|🔥)(?:$|[^\p{L}])/iu.test(text)) choices = ['🔥', '👍', '❤️'];
            else if (/[?؟]|(?:^|[^\p{L}])(?:شلون|كيف|ليش|متى|وين|شنو|هل)(?:$|[^\p{L}])/iu.test(text)) choices = ['😮', '👍'];
            else if (/(?:^|[^\p{L}])(?:هلا|مرحبا|السلام|سلام|صباح الخير|مساء الخير)(?:$|[^\p{L}])/iu.test(text)) choices = ['❤️', '👍', '😮'];

            const emoji = choices[stableHash(`${messageKey}|${mood.key}|reaction`) % choices.length];
            return { emoji, mood };
        }

        async function reactAsNaz(messageKey, message, forced = false) {
            if (!message || message.uid === 'naz_ai' || message.forwarded) return false;
            const chosen = chooseNazReaction(messageKey, message, forced);
            if (!chosen) return false;

            const now = Date.now();
            const aiName = String(dbAiConfig.name || 'NAZ Ai').slice(0, 50);
            try {
                const claim = await runTransaction(ref(db, `messages/${messageKey}`), current => {
                    if (!current || current.nazReaction) return;
                    const reactions = current.reactions && typeof current.reactions === 'object' ? current.reactions : {};
                    const emojiUsers = reactions[chosen.emoji] && typeof reactions[chosen.emoji] === 'object' ? reactions[chosen.emoji] : {};
                    return {
                        ...current,
                        nazReaction: { emoji: chosen.emoji, mood: chosen.mood.key, at: now },
                        reactions: {
                            ...reactions,
                            [chosen.emoji]: { ...emojiUsers, naz_ai: { name: aiName, time: now } }
                        }
                    };
                }, { applyLocally: false });
                return claim.committed;
            } catch (error) {
                console.warn('NAZ quick reaction could not be saved:', error);
                return false;
            }
        }

        function processMessageText(txt) {
            if (!txt) return '';
            const urlRegex = /(https?:\/\/[^\s<]+)/g;
            const urls = txt.match(urlRegex);
            // 🛡️ تنقية النص أولاً لمنع XSS
            let processed = sanitizeHTML(txt);
            if (urls) {
                urls.forEach(url => {
                    try {
                        const safeUrl = sanitizeURL(url);
                        if (!safeUrl) return;
                        const parsedUrl = new URL(safeUrl);
                        // 🛡️ فقط HTTP/HTTPS
                        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') return;
                        const domain = sanitizeHTML(parsedUrl.hostname.replace('www.', ''));
                        const icon = domain.includes('youtube') ? 'fab fa-youtube' : domain.includes('github') ? 'fab fa-github' : domain.includes('twitter') || domain.includes('x.com') ? 'fab fa-twitter' : domain.includes('instagram') ? 'fab fa-instagram' : 'fas fa-external-link-alt';
                        const displayUrl = sanitizeHTML(safeUrl.length > 55 ? safeUrl.substring(0, 55) + '...' : safeUrl);
                        const linkCard = `<a href="${sanitizeHTML(safeUrl)}" target="_blank" rel="noopener noreferrer" class="link-preview" onclick="event.stopPropagation()"><div class="link-preview-icon"><i class="${icon}"></i></div><div class="link-preview-info"><div class="link-preview-domain">${domain}</div><div class="link-preview-url">${displayUrl}</div></div></a>`;
                        processed = processed.replace(sanitizeHTML(url), linkCard);
                    } catch { /* skip invalid urls */ }
                });
            }
            return processed;
        }

        function renderReactions(msgKey, reactions) {
            if (!reactions || typeof reactions !== 'object') {
                return `<div class="reactions-container"><span class="reaction-add-btn" onclick="event.stopPropagation(); showReactionPicker('${msgKey}', this)"><i class="far fa-smile"></i></span></div>`;
            }
            let html = '<div class="reactions-container">';
            const groups = [];
            for (const emoji of REACTION_EMOJIS) {
                if (reactions[emoji]) {
                    const users = Object.keys(reactions[emoji]);
                    const count = users.length;
                    if (count > 0) {
                        const isMine = me && users.includes(me.user);
                        groups.push({ emoji, users, count });
                        html += `<span class="reaction-chip ${isMine ? 'my-reaction' : ''}" onclick="event.stopPropagation(); toggleReaction('${msgKey}', '${emoji}')"><span class="r-emoji">${emoji}</span><span class="r-count">${count}</span></span>`;
                    }
                }
            }
            if (groups.length) {
                const total = groups.reduce((sum, group) => sum + group.count, 0);
                const isOpen = openReactionDetails.has(msgKey);
                html += `<span class="reaction-details-btn ${isOpen ? 'is-open' : ''}" role="button" tabindex="0" aria-expanded="${isOpen}" onclick="event.stopPropagation(); toggleReactionDetails(this)" data-msg-key="${msgKey}" title="من تفاعل؟"><i class="fas fa-chevron-down"></i><span>${total}</span></span>`;
                html += `<div class="reaction-details" ${isOpen ? '' : 'hidden'}>${groups.map(group => {
                    const names = group.users.map(uid => {
                        const record = reactions[group.emoji][uid];
                        const stored = record && typeof record === 'object' ? record.name : '';
                        return sanitizeHTML(stored || uid);
                    });
                    return `<div class="reaction-detail-row"><span class="r-emoji">${group.emoji}</span><span class="r-names">${names.join('، ')}</span></div>`;
                }).join('')}</div>`;
            }
            html += `<span class="reaction-add-btn" onclick="event.stopPropagation(); showReactionPicker('${msgKey}', this)"><i class="far fa-smile"></i></span></div>`;
            return html;
        }

        // واجهة تشخيص اختيارية تظهر فقط مع ?debug=1 — تُستخدم لفحص البحث والوسائط.
        if (new URLSearchParams(location.search).has('debug')) {
            window.__nazDebug = {
                collectMediaCandidates,
                resolveMediaUrl,
                renderResultsCard,
                showChosenResult,
                renderWebCard,
                detectRequestKind,
                wantsMultipleResults,
                runSearch,
                googleSearch,
                getSearchSettings,
                modelIsFree,
                modelStrength,
                modelTierLabel,
                getOpenRouterModelCatalog,
                renderOpenRouterModelResults,
                renderToolCard,
                applyToolAction,
                TOOL_KINDS,
                resolveCloudApiUrl,
                loadCloudFirebaseConfig,
                updateCloudConfigStatus,
                cloudInfo: () => ({ source: cloudConfigSource, api: resolveCloudApiUrl(), projectId: firebaseConfig.projectId, db: firebaseConfig.databaseURL }),
                sanitizeURL
            };
        }

        window.toggleReactionDetails = element => {
            const container = element.closest('.reactions-container');
            const panel = container?.querySelector('.reaction-details');
            if (!panel) return;
            const msgKey = element.dataset.msgKey;
            const willOpen = panel.hidden;
            panel.hidden = !willOpen;
            element.classList.toggle('is-open', willOpen);
            element.setAttribute('aria-expanded', String(willOpen));
            if (willOpen) openReactionDetails.add(msgKey);
            else openReactionDetails.delete(msgKey);
        };

        // ✅ دالة تسجيل الدخول / إنشاء الحساب
        window.attemptLogin = async () => {
            const uid = document.getElementById('user-id').value.trim().toLowerCase();
            const pass = document.getElementById('user-pass').value;
            const name = document.getElementById('user-display').value.trim() || uid;
            const avatar = document.getElementById('user-avatar').value.trim();
            const loginBtn = document.getElementById('login-btn');

            if (!/^[a-z0-9_-]{1,32}$/.test(uid)) {
                showError('معرف المستخدم يقبل أحرفاً إنجليزية صغيرة وأرقاماً وشرطة فقط، وبحد أقصى 32 حرفاً.');
                return;
            }
            if (name.length > 40) {
                showError('الاسم المستعار يجب ألا يتجاوز 40 حرفاً.');
                return;
            }
            
            if (!uid) { 
                showError('❌ الرجاء إدخال معرف المستخدم');
                return; 
            }
            
            if (!pass) { 
                showError('❌ الرجاء إدخال كلمة المرور');
                return; 
            }

            // التحقق من تهيئة Firebase
            if (!isFirebaseReady) {
                if (!(await initFirebase())) {
                    return;
                }
            }

            // تعطيل الزر وإظهار التحميل
            loginBtn.disabled = true;
            document.getElementById('loading-overlay').style.display = 'flex';
            document.getElementById('error-box').classList.remove('show');

            loadingTimeout = setTimeout(() => {
                hideLoading();
                showError('⏱️ انتهى وقت الانتظار! تحقق من اتصالك بالإنترنت وإعدادات Firebase وقواعد قاعدة البيانات.');
            }, 15000);

            try {
                console.log('🔍 Checking user:', uid);
                
                let snap;
                try {
                    snap = await get(ref(db, 'users/' + uid));
                } catch (dbError) {
                    console.error('Database read error:', dbError);
                    hideLoading();
                    if (dbError.message && dbError.message.includes('permission_denied')) {
                        showError('❌ خطأ في الصلاحيات! عدل Firebase Rules');
                    } else {
                        showError('❌ لا يمكن الوصول إلى قاعدة البيانات: ' + dbError.message);
                    }
                    return;
                }
                
                // التحقق إذا كان المستخدم محظور
                if(snap.exists() && snap.val().isBanned) {
                    hideLoading();
                    showError('🚫 أنت محظور من دخول المملكة!');
                    return;
                }
                
                // 🔐 المستخدم موجود - التحقق من كلمة السر (مع هاشينج SHA-256)
                const hashedPass = await hashPassword(pass);
                
                if (snap.exists()) {
                    const userData = snap.val();
                    let passwordValid = false;
                    
                    if (userData.passwordHashed) {
                        // كلمة المرور مخزونة كهاش - المقارنة بالهاش
                        passwordValid = (userData.password === hashedPass);
                    } else {
                        // كلمة المرور قديمة (plain text) - المقارنة ثم الترحيل
                        passwordValid = (userData.password === pass);
                        if (passwordValid) {
                            // 🔐 ترحيل: تحويل كلمة المرور إلى هاش
                            await update(ref(db, 'users/' + uid), { 
                                password: hashedPass, 
                                passwordHashed: true 
                            });
                            console.log('🔐 Password migrated to hash for user:', uid);
                        }
                    }
                    
                    if (!passwordValid) {
                        hideLoading();
                        showError('❌ كلمة المرور غير صحيحة!');
                        return;
                    }
                    // تسجيل دخول ناجح
                    me = userData;
                    me.password = hashedPass; // استخدام الهاش في الذاكرة
                    await update(ref(db, 'users/' + uid), { 
                        theme: currentTheme, 
                        isOnline: true, 
                        lastSeen: serverTimestamp() 
                    });
                    showNotification('✅ تم تسجيل الدخول بنجاح!');
                } else {
                    if (pass.length < 10) {
                        hideLoading();
                        showError('كلمة المرور للحساب الجديد يجب أن تكون 10 أحرف على الأقل.');
                        return;
                    }
                    // إنشاء حساب جديد (كلمة المرور مهشّنة)
                    me = { 
                        user: uid, 
                        name: name, 
                        password: hashedPass,
                        passwordHashed: true,
                        bio: 'لا يوجد بايو',
                        avatar: avatar || getDefaultAvatarUrl(uid),
                        isOwner: uid === 'reza',
                        theme: currentTheme,
                        joinedAt: Date.now(),
                        isOnline: true
                    };
                    await set(ref(db, 'users/' + uid), me);
                    showNotification('✅ تم إنشاء الحساب بنجاح!');
                }
                
                // حفظ الجلسة في الكوكيز (كلمة المرور مهشّنة)
                setCookie('reza_user', uid);
                setCookie('reza_pass', hashedPass);
                
                // إعداد onDisconnect
                try {
                    onDisconnect(ref(db, `users/${uid}/isOnline`)).set(false);
                    onDisconnect(ref(db, `users/${uid}/lastSeen`)).set(serverTimestamp());
                } catch (disconnectError) {
                    console.warn('onDisconnect warning:', disconnectError);
                }
                
                // تطبيق الثيم
                if (me.theme) { 
                    currentTheme = me.theme; 
                    document.body.setAttribute('data-theme', currentTheme); 
                }
                
                // تحديث واجهة المستخدم
                document.getElementById('header-avatar').src = me.avatar;
                document.getElementById('header-name').textContent = me.name;
                
                // الانتقال للشات
                document.getElementById('auth-screen').style.display = 'none';
                document.getElementById('app-container').style.display = 'flex';
                hideLoading();
                
                // بدء الشات
                if (me.user === 'reza') {
                    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'flex');
                    // 🔐 توليد رمز إدارة ديناميكي مع TTL
                    await ensureValidAdminToken();
                }
                loadAiConfig();
                startChat();
                loadMembers();
                
                // مراقبة حظر المستخدم
                onValue(ref(db, `users/${me.user}/isBanned`), s => { 
                    if(s.val() === true) { 
                        alert('تم حظرك الآن!'); 
                        logout();
                    }
                });

                showNotification(`أهلاً بك ${me.name}! 👋`);
                
            } catch (error) {
                console.error('Login error:', error);
                hideLoading();
                showError('❌ خطأ غير متوقع: ' + error.message);
            }
        };

        // تسجيل الخروج
        window.logout = () => {
            if (me && me.user) {
                set(ref(db, `users/${me.user}/isOnline`), false);
            }
            deleteCookie('reza_user');
            deleteCookie('reza_pass');
            location.reload();
        };

        // التحقق من الجلسة المحفوظة
        async function checkSavedSession() {
            const savedUser = getCookie('reza_user');
            const savedPass = getCookie('reza_pass');
            
            if (savedUser && savedPass) {
                if (!isFirebaseReady) {
                    await initFirebase();
                }
                
                try {
                    const snap = await get(ref(db, 'users/' + savedUser));
                    if (snap.exists()) {
                        const userData = snap.val();
                        
                        // 🔐 التحقق من كلمة المرور (دعم الهاش والنص القديم)
                        let isValid = false;
                        if (userData.passwordHashed) {
                            // كلمة المرور في الكوكي قد تكون هاش أو نص قديم
                            if (userData.password === savedPass) {
                                isValid = true; // الكوكي تحتوي هاش
                            } else {
                                const hashedSaved = await hashPassword(savedPass);
                                if (userData.password === hashedSaved) {
                                    isValid = true;
                                    setCookie('reza_pass', hashedSaved); // تحديث الكوكي
                                }
                            }
                        } else {
                            // مستخدم قديم - ترحيل كلمة المرور
                            if (userData.password === savedPass) {
                                isValid = true;
                                const hashed = await hashPassword(savedPass);
                                await update(ref(db, 'users/' + savedUser), { 
                                    password: hashed, 
                                    passwordHashed: true 
                                });
                                setCookie('reza_pass', hashed);
                                console.log('🔐 Auto-login: password migrated for:', savedUser);
                            }
                        }
                        
                        if (isValid && !userData.isBanned) {
                            // تسجيل دخول تلقائي
                            me = userData;
                            currentTheme = me.theme || 'ocean';
                            document.body.setAttribute('data-theme', currentTheme);
                            
                            await update(ref(db, 'users/' + savedUser), { 
                                isOnline: true, 
                                lastSeen: serverTimestamp() 
                            });
                            
                            onDisconnect(ref(db, `users/${savedUser}/isOnline`)).set(false);
                            onDisconnect(ref(db, `users/${savedUser}/lastSeen`)).set(serverTimestamp());
                            
                            document.getElementById('header-avatar').src = me.avatar;
                            document.getElementById('header-name').textContent = me.name;
                            document.getElementById('auth-screen').style.display = 'none';
                            document.getElementById('app-container').style.display = 'flex';
                            
                            if (me.user === 'reza') {
                                document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'flex');
                                // 🔐 توليد رمز إدارة ديناميكي مع TTL
                                await ensureValidAdminToken();
                            }
                            loadAiConfig();
                            
                            startChat();
                            loadMembers();
                            
                            onValue(ref(db, `users/${me.user}/isBanned`), s => { 
                                if(s.val() === true) { 
                                    alert('تم حظرك الآن!'); 
                                    logout();
                                }
                            });
                            
                            showNotification(`مرحباً بعودتك ${me.name}! 👋`);
                            return true;
                        }
                    }
                } catch (e) {
                    console.error('Auto login error:', e);
                }
            }
            return false;
        }

        function startChat() {
            // مراقبة الكتابة
            startTypingListener();
            
            // مراقبة الرسائل (آخر 250 رسالة)
            onValue(query(ref(db, 'messages'), limitToLast(250)), async snap => {
                const flow = document.getElementById('chat-flow');
                flow.innerHTML = '';
                
                let usersSnap;
                try {
                    usersSnap = await get(ref(db, 'users'));
                } catch (e) {
                    usersSnap = { val: () => ({}) };
                }
                const allUsers = usersSnap.val() || {};

                let msgCount = 0, imgCount = 0;

                snap.forEach(child => {
                    const m = child.val();
                    msgCount++;
                    if (m.isImage) imgCount++;
                    
                    const userStatus = allUsers[m.uid] || {};
                    const isBanned = userStatus.isBanned;
                    const rawAvatar = userStatus.avatar || m.avatar || getDefaultAvatarUrl(m.uid);
                    const userAvatar = sanitizeURL(rawAvatar) || getDefaultAvatarUrl(sanitizeHTML(m.uid));
                    
                    const div = document.createElement('div');
                    div.className = `msg-container ${m.uid === me.user ? 'mine' : 'others'} msg-anim`;
                    div.id = `msg-${sanitizeHTML(child.key)}`;
                    
                    // 🛡️ تنقية بيانات المستخدم قبل الإدراج في HTML
                    const safeName = sanitizeHTML(m.name);
                    const safeUid = sanitizeHTML(m.uid);
                    const safeAvatarAttr = sanitizeHTML(userAvatar);
                    
                    const isOwner = m.uid === 'reza';
                    const ownerBadge = isOwner ? '<span class="owner-badge"><i class="fas fa-crown"></i> المالك</span>' : '';
                    const pinnedBadge = m.isPinned ? '<span class="pinned-badge"><i class="fas fa-thumbtack"></i> مثبت</span>' : '';
                    
                    let content = '';
                    if (m.tool && TOOL_KINDS[m.tool.kind]) {
                        toolRegistry.set(child.key, {
                            tool: m.tool,
                            state: m.toolState,
                            menu: { uid: m.uid, name: m.name, txt: m.txt, isImage: false, isPinned: m.isPinned }
                        });
                        content = `${m.txt ? `<div class="tool-caption">${sanitizeHTML(m.txt)}</div>` : ''}${renderToolCard(child.key, m.tool, m.toolState, { user: me.user, name: me.name })}`;
                    } else if (m.isImage) {
                        const safeImgUrl = sanitizeURL(m.txt) || '';
                        const safeImgAttr = sanitizeHTML(safeImgUrl);
                        content = `<img src="${safeImgAttr}" class="bubble-image" onclick="openImageModal('${safeImgAttr}')" alt="صورة">`;
                        if (m.caption) content += `<div class="image-caption">${sanitizeHTML(m.caption)}</div>`;
                    } else if (m.file && m.file.content) {
                        fileRegistry.set(child.key, m.file);
                        content = renderFileCard(child.key, m.file, m.txt);
                    } else if (m.web && Array.isArray(m.web.items) && m.web.items.length) {
                        content = renderWebCard(m.web);
                    } else if (m.results && Array.isArray(m.results.items) && m.results.items.length) {
                        content = renderResultsCard(m.results, m.caption || m.txt);
                    } else if (m.media === 'audio' || (!m.media && isAudioUrl(m.txt))) {
                        const safeAudio = sanitizeURL(m.txt) || '';
                        content = safeAudio
                            ? `<div class="media-card"><audio controls preload="metadata" src="${sanitizeHTML(safeAudio)}"></audio><a class="media-link" href="${sanitizeHTML(safeAudio)}" target="_blank" rel="noopener noreferrer">فتح الملف الصوتي</a>${m.caption ? `<div class="image-caption">${sanitizeHTML(m.caption)}</div>` : ''}</div>`
                            : processMessageText(m.txt);
                    } else if (m.media === 'video' || (!m.media && isVideoUrl(m.txt))) {
                        const safeVideo = sanitizeURL(m.txt) || '';
                        content = safeVideo
                            ? `<div class="media-card"><video controls preload="metadata" playsinline src="${sanitizeHTML(safeVideo)}"></video><a class="media-link" href="${sanitizeHTML(safeVideo)}" target="_blank" rel="noopener noreferrer">فتح الفيديو</a>${m.caption ? `<div class="image-caption">${sanitizeHTML(m.caption)}</div>` : ''}</div>`
                            : processMessageText(m.txt);
                    } else {
                        content = processMessageText(m.txt);
                    }
                    
                    const safeM = JSON.stringify(m).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                    
                    div.innerHTML = `
                        <div class="msg-header">
                            ${m.uid === me.user ? '' : `<img src="${safeAvatarAttr}" class="msg-avatar" alt="${safeName}" onclick="openUserAvatarModal('${safeAvatarAttr}')" onerror="this.src='${getDefaultAvatarUrl(safeUid)}'">`}
                            <div class="msg-sender-info">
                                <span class="msg-name">${safeName} ${ownerBadge} ${pinnedBadge}</span>
                                <span class="msg-time">${formatTime(m.time)}</span>
                            </div>
                            ${m.uid === me.user ? `<img src="${safeAvatarAttr}" class="msg-avatar" alt="${safeName}" onclick="openUserAvatarModal('${safeAvatarAttr}')" onerror="this.src='${getDefaultAvatarUrl(safeUid)}'">` : ''}
                        </div>
                        <div class="bubble ${isBanned ? 'banned-msg' : ''} ${m.tool ? 'tool-bubble' : ''}" ${m.tool && TOOL_KINDS[m.tool.kind] ? '' : `onclick="openMenu('${sanitizeHTML(child.key)}', ${safeM})"`}>
                            ${m.reply ? `<div class="reply-preview"><span class="reply-name">${sanitizeHTML(m.reply.name)}</span><div class="reply-text">${sanitizeHTML(m.reply.txt.substring(0, 50))}${m.reply.txt.length > 50 ? '...' : ''}</div></div>` : ''}
                            ${content}
                        </div>
                        ${renderReactions(child.key, m.reactions)}
                    `;
                    flow.appendChild(div);

                    // تفاعلات خفيفة بلا استدعاء نموذج لكل رسالة؛ المنشن والرد على ناز يفرضان ريأكشن ورداً نصياً.
                    if (!isInitialLoad && !processedAiMsgs.has(child.key) && m.uid !== 'naz_ai') {
                        processedAiMsgs.add(child.key);
                        const isNewMessage = m.time >= joinTime;
                        if (isNewMessage) {
                            const messageText = typeof m.txt === 'string' ? m.txt : '';
                            const isMention = (!m.forwarded && (/(?:^|[^\p{L}\p{N}_])@(?:naz|ناز)(?=$|[^\p{L}\p{N}_])/iu.test(messageText) || /(?:^|[^\p{L}\p{N}_])ناز(?:$|[^\p{L}\p{N}_])/iu.test(messageText)));
                            const isReplyToNaz = (!m.forwarded && m.reply && (m.reply.name === (dbAiConfig?.name || 'NAZ Ai') || m.reply.name === 'NAZ Ai'));
                            const shouldReply = Boolean(isMention || isReplyToNaz);

                            void reactAsNaz(child.key, m, shouldReply);
                            if (shouldReply && dbAiConfig?.apiKey && !m.aiResponded) {
                                void triggerAiResponse(child.key, m.txt, m.name);
                            }
                        }
                    }
                });

                if (msgCount === 0) {
                    const emptyState = document.createElement('div');
                    emptyState.className = 'chat-empty-state';
                    emptyState.innerHTML = '<div class="empty-orbit"><i class="fas fa-comments"></i></div><h2>هنا تبدأ الحكاية</h2><p>أرسل أول رسالة وخلي المحادثة تدبّ بيها الحياة.</p><span class="empty-sparkle">✦</span>';
                    flow.appendChild(emptyState);
                }
                
                if (isInitialLoad) {
                    snap.forEach(child => processedAiMsgs.add(child.key));
                    isInitialLoad = false;
                }
                
                document.getElementById('stats-total-messages').textContent = msgCount;
                document.getElementById('stats-total-images').textContent = imgCount;
                mountToolTimers(flow);
                mountToolCanvases(flow, {
                    resolve: (msgKey, key) => {
                        const entry = toolRegistry.get(msgKey);
                        const strokes = entry?.state?.[key];
                        return Array.isArray(strokes) ? strokes : [];
                    },
                    onStroke: (msgKey, key, stroke) => {
                        void runToolAction(msgKey, 'custom', { fields: {}, stroke, strokeKey: key });
                    }
                });
                flow.scrollTop = flow.scrollHeight;
            }, (error) => {
                console.error('Messages listener error:', error);
            });

            // مراقبة الرسائل المثبتة
            onValue(ref(db, 'pinnedMessage'), snap => {
                const pinnedDisplay = document.getElementById('pinned-message-display');
                if (snap.exists()) {
                    const pinnedData = snap.val();
                    pinnedMessageId = pinnedData.messageId;
                    
                    // جلب تفاصيل الرسالة المثبتة
                    get(ref(db, 'messages/' + pinnedMessageId)).then(msgSnap => {
                        if (msgSnap.exists()) {
                            const msg = msgSnap.val();
                            pinnedDisplay.innerHTML = `
                                <div class="pinned-message-container" onclick="scrollToPinnedMessage('${sanitizeHTML(pinnedMessageId)}')">
                                    <div class="pinned-header">
                                        <i class="fas fa-thumbtack"></i>
                                        <span>رسالة مثبتة من ${sanitizeHTML(msg.name)}</span>
                                    </div>
                                    <div class="pinned-text">${msg.isImage ? '📷 صورة' : sanitizeHTML(msg.txt)}</div>
                                </div>
                            `;
                            pinnedDisplay.style.display = 'block';
                        }
                    });
                } else {
                    pinnedMessageId = null;
                    pinnedDisplay.style.display = 'none';
                    pinnedDisplay.innerHTML = '';
                }
            });

            // مراقبة إشعارات الحظر
            onValue(ref(db, 'bannedNotifications'), snap => {
                if (snap.exists()) {
                    snap.forEach(child => {
                        const notif = child.val();
                        if (notif && !notif.shownTo || (notif.shownTo && !notif.shownTo.includes(me.user))) {
                            showBanNotification(notif.username, notif.reason);
                            // تحديث قائمة من شاهد الإشعار
                            const shownTo = notif.shownTo || [];
                            shownTo.push(me.user);
                            update(ref(db, 'bannedNotifications/' + child.key), { shownTo: shownTo });
                        }
                    });
                }
            });
            
            // تنظيف دوري للرسائل القديمة (للمالك فقط)
            if (me.user === 'reza') {
                setTimeout(autoCleanupMessages, 10000); // تنظيف بعد 10 ثواني من الدخول
            }
        }
        
        // 🧹 دالة تنظيف الرسائل القديمة (أكثر من 250) لمنع تضخم قاعدة البيانات
        async function autoCleanupMessages() {
            if (me.user !== 'reza') return;
            try {
                // جلب كل الرسائل (غير مكلف كثيراً إذا كان الشات لا يزال صغيراً)
                const snap = await get(ref(db, 'messages'));
                if (snap.exists()) {
                    const allKeys = Object.keys(snap.val());
                    if (allKeys.length > 250) {
                        // أخذ المفاتيح القديمة (ما عدا آخر 250)
                        const keysToDelete = allKeys.slice(0, allKeys.length - 250);
                        const updates = {};
                        keysToDelete.forEach(key => updates[key] = null);
                        
                        await update(ref(db, 'messages'), updates);
                        console.log(`🧹 Auto-cleanup: Removed ${keysToDelete.length} old messages.`);
                    }
                }
            } catch (err) {
                console.error('Cleanup error:', err);
            }
        }


        // إظهار إشعار الحظر
        function showBanNotification(username, reason) {
            const flow = document.getElementById('chat-flow');
            const notifDiv = document.createElement('div');
            notifDiv.className = 'ban-notification';
            // 🛡️ تنقية بيانات الحظر لمنع XSS
            notifDiv.innerHTML = `
                <i class="fas fa-ban"></i>
                <div class="ban-text">
                    <div class="ban-title">تم حظر المستخدم ${sanitizeHTML(username)}</div>
                    <div class="ban-subtitle">${sanitizeHTML(reason || 'بسبب الانتهاكات')}</div>
                </div>
            `;
            flow.insertBefore(notifDiv, flow.firstChild);
            setTimeout(() => {
                notifDiv.style.opacity = '0';
                setTimeout(() => notifDiv.remove(), 500);
            }, 5000);
        }

        // التمرير إلى الرسالة المثبتة
        window.scrollToPinnedMessage = (msgId) => {
            const msgElement = document.getElementById(`msg-${msgId}`);
            if (msgElement) {
                msgElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                msgElement.classList.add('highlighted');
                setTimeout(() => msgElement.classList.remove('highlighted'), 3000);
            } else {
                showNotification('الرسالة غير متوفرة في التحميل الحالي');
            }
        };

        function formatTime(timestamp) {
            if (!timestamp) return 'الآن';
            const date = new Date(timestamp);
            const now = new Date();
            const diff = now - date;
            if (diff < 60000) return 'الآن';
            if (diff < 3600000) return `${Math.floor(diff / 60000)} دقيقة`;
            return date.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
        }

        window.sendMessage = async () => {
            const txt = document.getElementById('msg-input').value.trim();
            if(!txt) return;
            if (txt.length > 2000) {
                showNotification('الرسالة طويلة جداً؛ الحد الأقصى 2000 حرف.');
                return;
            }
            
            try {
                if(isEdit) {
                    await update(ref(db, `messages/${activeMsg.id}`), { txt, edited: true, editedAt: serverTimestamp() });
                    isEdit = false;
                } else {
                    const msgData = { 
                        uid: me.user, 
                        name: me.name, 
                        txt, 
                        time: serverTimestamp(),
                        avatar: me.avatar,
                        isImage: isImageUrl(txt)
                    };
                    if (msgData.isImage) msgData.caption = '';
                    if(replyData) msgData.reply = replyData;
                    await push(ref(db, 'messages'), msgData);
                }
                document.getElementById('msg-input').value = '';
                cancelReply();
                // مسح حالة الكتابة
                remove(ref(db, `typing/${me.user}`)).catch(() => {});
            } catch (error) {
                showNotification('❌ فشل في إرسال الرسالة');
            }
        };

        function isImageUrl(url) {
            const safeUrl = sanitizeURL(url);
            if (!safeUrl) return false;
            try {
                const parsed = new URL(safeUrl);
                return /\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i.test(parsed.pathname + parsed.search) ||
                    ['catbox.moe', 'imgur.com', 'ibb.co'].some(domain => parsed.hostname === domain || parsed.hostname.endsWith('.' + domain));
            } catch { return false; }
        }

        window.sendImage = () => {
            const url = prompt('أدخل رابط الصورة:');
            if (url && isImageUrl(url)) {
                const caption = prompt('أضف وصف للصورة (اختياري):') || '';
                push(ref(db, 'messages'), {
                    uid: me.user,
                    name: me.name,
                    txt: url,
                    time: serverTimestamp(),
                    avatar: me.avatar,
                    isImage: true,
                    caption: caption
                }).then(() => {
                    showNotification('تم إرسال الصورة! 📸');
                }).catch(() => {
                    showNotification('❌ فشل في إرسال الصورة');
                });
            } else if (url) {
                alert('الرجاء إدخال رابط صورة صحيح');
            }
        };

        window.openMenu = (id, m) => {
            activeMsg = { id, ...m };
            document.getElementById('msg-menu-overlay').style.display = 'flex';
            
            // خيارات المستخدم العادي (رسائله فقط)
            document.getElementById('my-ops').style.display = (m.uid === me.user) ? 'block' : 'none';
            
            // خيارات المالك (لكل الرسائل)
            const isOwner = me.user === 'reza';
            document.getElementById('admin-ops').style.display = isOwner ? 'block' : 'none';
            
            // خيار التثبيت للمالك فقط
            document.getElementById('pin-menu-item').style.display = isOwner ? 'flex' : 'none';
            document.getElementById('pin-menu-item').innerHTML = m.isPinned ? '<i class="fas fa-thumbtack"></i> إلغاء التثبيت' : '<i class="fas fa-thumbtack"></i> تثبيت الرسالة';
            
            get(ref(db, 'users/' + m.uid)).then(snap => {
                if (snap.exists()) {
                    const user = snap.val();
                    currentMenuAvatar = user.avatar || getDefaultAvatarUrl(m.uid);
                    document.getElementById('menu-avatar').src = currentMenuAvatar;
                    document.getElementById('menu-username').textContent = user.name;
                }
            }).catch(() => {
                currentMenuAvatar = getDefaultAvatarUrl(m.uid);
                document.getElementById('menu-avatar').src = currentMenuAvatar;
                document.getElementById('menu-username').textContent = m.name;
            });
        };

        window.closeMenu = () => document.getElementById('msg-menu-overlay').style.display = 'none';

        window.prepareReply = () => {
            replyData = { name: activeMsg.name, txt: activeMsg.isImage ? 'صورة' : activeMsg.txt };
            document.getElementById('rep-preview').style.display = 'flex';
            document.getElementById('rep-name').innerText = activeMsg.name;
            closeMenu();
            document.getElementById('msg-input').focus();
        };

        window.cancelReply = () => { replyData = null; document.getElementById('rep-preview').style.display = 'none'; };

        window.copyMessage = () => {
            navigator.clipboard.writeText(activeMsg.txt);
            showNotification('تم نسخ النص! 📋');
            closeMenu();
        };

        window.forwardMessage = () => {
            forwardData = activeMsg;
            document.getElementById('modal-forward').style.display = 'flex';
            closeMenu();
        };

        window.confirmForward = async () => {
            const targetUser = document.getElementById('forward-input').value.trim();
            if (!targetUser) return;
            
            try {
                const userSnap = await get(ref(db, 'users/' + targetUser.toLowerCase()));
                if (!userSnap.exists()) {
                    alert('المستخدم غير موجود!');
                    return;
                }
                
                await push(ref(db, 'messages'), {
                    uid: me.user,
                    name: me.name,
                    txt: forwardData.isImage ? forwardData.txt : `تم إعادة توجيه: ${forwardData.txt}`,
                    time: serverTimestamp(),
                    avatar: me.avatar,
                    isImage: forwardData.isImage,
                    forwarded: true,
                    originalSender: forwardData.name
                });
                
                document.getElementById('modal-forward').style.display = 'none';
                document.getElementById('forward-input').value = '';
                showNotification('تم إعادة التوجيه! 📤');
            } catch (error) {
                showNotification('❌ فشل في إعادة التوجيه');
            }
        };

        window.pinMessage = async () => {
            try {
                if (activeMsg.isPinned) {
                    await remove(ref(db, 'pinnedMessage'));
                    await update(ref(db, `messages/${activeMsg.id}`), { isPinned: false });
                    showNotification('تم إلغاء التثبيت! 📌');
                } else {
                    await set(ref(db, 'pinnedMessage'), { messageId: activeMsg.id, pinnedBy: me.user, pinnedAt: Date.now() });
                    await update(ref(db, `messages/${activeMsg.id}`), { isPinned: true });
                    showNotification('تم تثبيت الرسالة! 📌');
                }
                closeMenu();
            } catch (error) {
                showNotification('❌ فشل في تثبيت الرسالة');
            }
        };

        window.deleteForAll = () => {
            if (confirm('هل أنت متأكد من حذف هذه الرسالة للجميع؟')) {
                update(ref(db, `messages/${activeMsg.id}`), { 
                    deleted: true, 
                    deletedBy: me.user, 
                    deletedAt: serverTimestamp(),
                    txt: '🗑️ تم حذف هذه الرسالة'
                }).then(() => {
                    closeMenu();
                    showNotification('تم الحذف للجميع! 🗑️');
                }).catch(() => {
                    showNotification('❌ فشل في حذف الرسالة');
                });
            }
        };

        // المالك: حذف رسالة أي مستخدم
        window.adminDeleteMessage = () => {
            if (confirm('هل أنت متأكد من حذف هذه الرسالة؟')) {
                remove(ref(db, `messages/${activeMsg.id}`)).then(() => {
                    closeMenu();
                    showNotification('تم حذف الرسالة! 🗑️');
                }).catch(() => {
                    showNotification('❌ فشل في حذف الرسالة');
                });
            }
        };

        // المالك: تعديل رسالة أي مستخدم
        window.adminEditMessage = () => {
            const newText = prompt('أدخل النص الجديد:', activeMsg.isImage ? '' : activeMsg.txt);
            if (newText !== null && newText.trim() !== '') {
                update(ref(db, `messages/${activeMsg.id}`), { 
                    txt: newText, 
                    editedByAdmin: true, 
                    editedAt: serverTimestamp() 
                }).then(() => {
                    closeMenu();
                    showNotification('تم تعديل الرسالة! ✏️');
                }).catch(() => {
                    showNotification('❌ فشل في تعديل الرسالة');
                });
            }
        };

        window.viewUserProfile = async () => {
            const uid = activeMsg.uid;
            try {
                const snap = await get(ref(db, 'users/' + uid));
                if(snap.exists()) {
                    const u = snap.val();
                    document.getElementById('modal-profile').style.display = 'flex';
                    document.getElementById('profile-view-mode').style.display = 'block';
                    document.getElementById('profile-edit-mode').style.display = 'none';
                    
                    currentViewAvatar = sanitizeURL(u.avatar) || getDefaultAvatarUrl(sanitizeHTML(uid));
                    document.getElementById('view-avatar').src = currentViewAvatar;
                    document.getElementById('view-name').innerText = u.name;
                    document.getElementById('view-bio').innerText = u.bio || 'لا يوجد بايو';
                    document.getElementById('view-badge').style.display = u.isOwner ? 'inline-flex' : 'none';
                    
                    const messagesSnap = await get(query(ref(db, 'messages'), limitToLast(500)));
                    let msgCount = 0;
                    messagesSnap.forEach(m => { if (m.val().uid === uid) msgCount++; });
                    document.getElementById('stat-messages').textContent = msgCount;
                    document.getElementById('stat-joined').textContent = u.joinedAt ? new Date(u.joinedAt).toLocaleDateString('ar-SA') : 'الآن';
                }
            } catch (error) {
                showNotification('❌ فشل في تحميل الملف الشخصي');
            }
            closeMenu();
        };

        window.openMyProfile = () => {
            document.getElementById('modal-profile').style.display = 'flex';
            document.getElementById('profile-view-mode').style.display = 'none';
            document.getElementById('profile-edit-mode').style.display = 'block';
            
            document.getElementById('edit-name').value = me.name;
            document.getElementById('edit-bio').value = me.bio || '';
            document.getElementById('edit-avatar').value = me.avatar || '';
            currentEditAvatar = me.avatar || getDefaultAvatarUrl(me.user);
            document.getElementById('edit-avatar-preview').src = currentEditAvatar;
        };

        window.saveMyProfile = async () => {
            const newName = document.getElementById('edit-name').value.trim();
            const newBio = document.getElementById('edit-bio').value.trim();
            const newAvatar = document.getElementById('edit-avatar').value.trim();
            
            if(newName) {
                try {
                    await update(ref(db, 'users/' + me.user), { 
                        name: newName, 
                        bio: newBio, 
                        avatar: newAvatar || me.avatar 
                    });
                    me.name = newName; 
                    me.bio = newBio; 
                    me.avatar = newAvatar || me.avatar;
                    document.getElementById('header-avatar').src = me.avatar;
                    document.getElementById('header-name').textContent = me.name;
                    showNotification('تم تحديث الملف الشخصي! ✅');
                    document.getElementById('modal-profile').style.display = 'none';
                } catch (error) {
                    showNotification('❌ فشل في حفظ التعديلات');
                }
            }
        };

        // --- مجموعة مفاتيح OpenRouter + سلسلة النماذج ---
        function hashKeyValue(key) {
            let hash = 2166136261;
            const str = String(key || '');
            for (let i = 0; i < str.length; i++) hash = Math.imul(hash ^ str.charCodeAt(i), 16777619);
            return (hash >>> 0).toString(36);
        }

        function loadStoredKeyStatus() {
            try {
                const raw = localStorage.getItem(KEY_STATUS_STORAGE);
                aiKeyStatus = raw ? JSON.parse(raw) || {} : {};
            } catch { aiKeyStatus = {}; }
        }

        function persistKeyStatus() {
            try { localStorage.setItem(KEY_STATUS_STORAGE, JSON.stringify(aiKeyStatus)); } catch { /* ignore */ }
        }

        function getKeyState(key) {
            const record = aiKeyStatus[hashKeyValue(key)];
            if (!record) return { state: 'ready' };
            if ((record.state === 'cooldown' || record.state === 'soft') && record.until && Date.now() > record.until) {
                delete aiKeyStatus[hashKeyValue(key)];
                persistKeyStatus();
                return { state: 'ready' };
            }
            return record;
        }

        function markKeyState(key, state, reason, cooldownMs = 0) {
            if (!key) return;
            aiKeyStatus[hashKeyValue(key)] = { state, reason: reason || '', at: Date.now(), until: cooldownMs ? Date.now() + cooldownMs : 0 };
            persistKeyStatus();
            updateAiKeysMeta();
            void persistSharedKeyStatus();
        }

        function resetKeyState(key) {
            if (!key) return;
            delete aiKeyStatus[hashKeyValue(key)];
            persistKeyStatus();
            updateAiKeysMeta();
            void persistSharedKeyStatus();
        }

        async function persistSharedKeyStatus() {
            if (!me || me.user !== 'reza') return;
            try {
                const token = await ensureValidAdminToken();
                if (!token) return;
                await update(ref(db, 'ai_config'), { keyStatus: aiKeyStatus, _authToken: token });
            } catch { /* local status is enough for non-owners */ }
        }

        function getRuntimeKeys() {
            if (!dbAiConfig) return [];
            const keys = [];
            if (Array.isArray(dbAiConfig.apiKeys)) keys.push(...dbAiConfig.apiKeys);
            if (dbAiConfig.apiKey) keys.push(dbAiConfig.apiKey);
            return [...new Set(keys.map(key => String(key || '').trim()).filter(Boolean))];
        }

        function getAvailableKeys() {
            return getRuntimeKeys().filter(key => getKeyState(key).state === 'ready');
        }

        function keyStatusSummary() {
            const keys = getRuntimeKeys();
            const summary = { total: keys.length, ready: 0, exhausted: 0, cooldown: 0 };
            keys.forEach(key => {
                const state = getKeyState(key).state;
                if (state === 'ready') summary.ready++;
                else if (state === 'exhausted') summary.exhausted++;
                else summary.cooldown++;
            });
            return summary;
        }

        function getModelChain() {
            const chain = [];
            const add = id => {
                const clean = String(id || '').trim();
                if (clean && !chain.includes(clean)) chain.push(clean);
            };
            add(dbAiConfig?.model);
            if (Array.isArray(dbAiConfig?.models)) dbAiConfig.models.forEach(add);
            add('openrouter/auto');
            return chain;
        }

        function addAiKeyRow(value = '') {
            const list = document.getElementById('ai-keys-list');
            if (!list) return;
            const row = document.createElement('div');
            row.className = 'ai-key-row';
            row.innerHTML = `
                <input type="password" class="glass-input ai-key-input" placeholder="sk-or-v1-..." autocomplete="off" spellcheck="false">
                <span class="ai-key-status" data-state="empty">فارغ</span>
                <button type="button" class="ai-key-action" data-key-reset title="إعادة تفعيل المفتاح" aria-label="إعادة تفعيل المفتاح"><i class="fas fa-rotate-right"></i></button>
                <button type="button" class="ai-key-action ai-key-remove" title="حذف المفتاح" aria-label="حذف المفتاح"><i class="fas fa-trash"></i></button>`;
            row.querySelector('.ai-key-input').value = value;
            row.querySelector('.ai-key-input').addEventListener('input', updateAiKeysMeta);
            row.querySelector('[data-key-reset]').addEventListener('click', () => resetKeyState(row.querySelector('.ai-key-input').value.trim()));
            row.querySelector('.ai-key-remove').addEventListener('click', () => { row.remove(); updateAiKeysMeta(); });
            list.appendChild(row);
            updateAiKeysMeta();
        }

        function loadAiKeysIntoUi(keys) {
            const list = document.getElementById('ai-keys-list');
            if (!list) return;
            list.replaceChildren();
            (keys.length ? keys : ['']).forEach(key => addAiKeyRow(key));
            updateAiKeysMeta();
        }

        function collectAiKeyDraft() {
            return [...document.querySelectorAll('#ai-keys-list .ai-key-input')].map(input => input.value.trim()).filter(Boolean);
        }

        function updateAiKeysMeta() {
            const values = collectAiKeyDraft();
            const countLabel = document.getElementById('ai-keys-count');
            if (countLabel) countLabel.textContent = String(values.length);
            let ready = 0, exhausted = 0, waiting = 0;
            document.querySelectorAll('#ai-keys-list .ai-key-row').forEach(row => {
                const key = row.querySelector('.ai-key-input').value.trim();
                const badge = row.querySelector('.ai-key-status');
                if (!key) { badge.dataset.state = 'empty'; badge.textContent = 'فارغ'; return; }
                const state = getKeyState(key).state;
                if (state === 'ready') { badge.dataset.state = 'ready'; badge.textContent = 'جاهز'; ready++; }
                else if (state === 'exhausted') { badge.dataset.state = 'exhausted'; badge.textContent = 'منتهي'; exhausted++; }
                else { badge.dataset.state = 'cooldown'; badge.textContent = state === 'soft' ? 'تعذّر مؤقتاً' : 'انتظار'; waiting++; }
            });
            const summary = document.getElementById('ai-keys-summary');
            if (summary) {
                summary.textContent = !values.length
                    ? 'لا توجد مفاتيح بعد. أضف مفتاحاً واحداً على الأقل.'
                    : `المجموع: ${values.length} · جاهز: ${ready} · منتهي: ${exhausted}${waiting ? ` · مؤقت: ${waiting}` : ''}`;
            }
        }

        function renderAiModelChain() {
            const container = document.getElementById('ai-model-chain');
            if (!container) return;
            const chain = Array.isArray(aiModelChain) ? aiModelChain : [];
            if (!chain.length) {
                container.innerHTML = '<span class="ai-chain-empty">لا نماذج احتياطية بعد.</span>';
                return;
            }
            container.replaceChildren();
            chain.forEach((id, index) => {
                const chip = document.createElement('span');
                chip.className = 'ai-chain-chip';
                const label = document.createElement('span');
                label.textContent = id;
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.textContent = '×';
                remove.setAttribute('aria-label', `حذف ${id}`);
                remove.addEventListener('click', () => { aiModelChain.splice(index, 1); renderAiModelChain(); });
                chip.append(label, remove);
                container.appendChild(chip);
            });
        }

        const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        const AUDIO_EXTENSIONS = ['mp3', 'ogg', 'oga', 'm4a', 'wav'];
        const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogv', 'm4v'];
        const MAX_MEDIA_BYTES = 80 * 1024 * 1024;

        async function fetchJsonWithTimeout(url, timeoutMs = 15000) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
                if (!response.ok) return null;
                return await response.json();
            } catch {
                return null;
            } finally {
                clearTimeout(timeout);
            }
        }

        function stripTracking(url) {
            return String(url || '')
                .replace(/[?&]utm_[^&#]*/g, '')
                .replace(/[?&]$/, '');
        }

        function scoreMatch(candidateText, query) {
            const haystack = String(candidateText || '').toLowerCase();
            const terms = String(query || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(term => term.length > 2);
            if (!terms.length) return 0;
            return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0) / terms.length;
        }

        function pickBestCandidate(candidates, query) {
            if (!candidates.length) return null;
            const ranked = candidates
                .map(candidate => ({ ...candidate, score: scoreMatch(`${candidate.title || ''} ${candidate.url || ''}`, query) }))
                .sort((a, b) => b.score - a.score || (a.weight || 0) - (b.weight || 0));
            return ranked[0].url;
        }

        async function searchOpenverse(queries, kind) {
            const candidates = [];
            for (const rawQuery of queries.slice(0, 3)) {
                const query = String(rawQuery || '').trim().slice(0, 120);
                if (query.length < 2) continue;
                const payload = await fetchJsonWithTimeout(`https://api.openverse.org/v1/${kind}/?q=${encodeURIComponent(query)}&page_size=15`);
                const results = Array.isArray(payload?.results) ? payload.results : [];
                results.forEach(result => {
                    const safe = sanitizeURL(stripTracking(result.url || ''));
                    if (!safe) return;
                    const allowed = kind === 'audio'
                        ? AUDIO_EXTENSIONS.some(extension => new RegExp(`\\.${extension}(\\?|$)`, 'i').test(safe))
                        : /\.(jpe?g|png|webp|gif)(\?|$)/i.test(safe);
                    if (!allowed) return;
                    const licence = String(result.license || '').toLowerCase();
                    candidates.push({
                        url: safe,
                        title: result.title || '',
                        durationMs: Number(result.duration) || 0,
                        weight: ['cc0', 'pdm', 'by'].includes(licence) ? 0 : 1
                    });
                });
            }
            return candidates;
        }

        async function searchArchiveCandidates(queries, mediatype, extensions) {
            const found = [];
            const perQuery = 3;
            for (const rawQuery of queries.slice(0, 2)) {
                const query = String(rawQuery || '').trim().slice(0, 120);
                if (query.length < 2) continue;
                const search = await fetchJsonWithTimeout(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(`(${query}) AND mediatype:${mediatype}`)}&fl[]=identifier&fl[]=title&fl[]=downloads&sort[]=downloads+desc&rows=10&page=1&output=json`, 18000);
                const docs = Array.isArray(search?.response?.docs)
                    ? search.response.docs
                        .map(doc => ({ ...doc, relevance: scoreMatch(doc.title || doc.identifier, query) }))
                        .sort((a, b) => b.relevance - a.relevance || Number(b.downloads || 0) - Number(a.downloads || 0))
                    : [];
                let inspected = 0;
                for (const doc of docs) {
                    if (!doc?.identifier || inspected >= perQuery) break;
                    inspected++;
                    const meta = await fetchJsonWithTimeout(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`, 18000);
                    const files = Array.isArray(meta?.files) ? meta.files : [];
                    const usable = files
                        .filter(file => {
                            const name = String(file.name || '');
                            const extension = name.split('.').pop().toLowerCase();
                            if (!extensions.includes(extension)) return false;
                            const size = Number(file.size);
                            return Number.isFinite(size) ? size > 0 && size <= MAX_MEDIA_BYTES : true;
                        })
                        .sort((a, b) => Number(a.size || 0) - Number(b.size || 0));
                    if (!usable.length) continue;
                    const chosen = usable[0];
                    const url = `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(String(chosen.name)).replace(/%2F/g, '/')}`;
                    if (!found.some(item => item.url === url)) {
                        found.push({ url, title: doc.title || chosen.name });
                    }
                    if (found.length >= 4) return found;
                }
            }
            return found;
        }

        async function searchArchiveMedia(queries, mediatype, extensions) {
            const [best] = await searchArchiveCandidates(queries, mediatype, extensions);
            return best || null;
        }

        async function searchCommonsMedia(queries, kind) {
            const filter = kind === 'audio' ? 'filemime:audio/mpeg ' : kind === 'video' ? 'filemime:video/webm ' : '';
            const extensions = kind === 'audio' ? AUDIO_EXTENSIONS : kind === 'video' ? VIDEO_EXTENSIONS : ['jpg', 'jpeg', 'png', 'webp', 'gif'];
            for (const rawQuery of queries.slice(0, 3)) {
                const query = String(rawQuery || '').trim().slice(0, 120);
                if (query.length < 2) continue;
                const payload = await fetchJsonWithTimeout(`https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(filter + query)}&gsrnamespace=6&gsrlimit=15&prop=imageinfo&iiprop=url|mime`);
                const pages = payload?.query?.pages ? Object.values(payload.query.pages) : [];
                const candidates = pages.map(page => {
                    const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
                    if (!info) return null;
                    const safe = sanitizeURL(stripTracking(info.thumburl || info.url || ''));
                    if (!safe) return null;
                    return extensions.some(extension => new RegExp(`\\.${extension}$`, 'i').test(safe))
                        ? { url: safe, title: page.title || '' }
                        : null;
                }).filter(Boolean);
                if (candidates.length) return candidates;
            }
            return [];
        }

        async function searchCommonsImage(queries) {
            const openverseCandidates = await searchOpenverse(queries, 'images');
            const openversePick = pickBestCandidate(openverseCandidates, queries[0] || '');
            if (openversePick) return openversePick;
            const commonsCandidates = await searchCommonsMedia(queries, 'image');
            const commonsPick = pickBestCandidate(commonsCandidates, queries[0] || '');
            if (commonsPick) return commonsPick;
            return searchCommonsImageLegacy(queries);
        }

        async function resolveMediaUrl(kind, queries) {
            const [best] = await collectMediaCandidates(kind, queries, 1);
            return best?.url || null;
        }

        async function collectMediaCandidates(kind, queries, limit) {
            const pool = [];
            const push = list => {
                (Array.isArray(list) ? list : []).forEach(item => {
                    if (!item?.url || pool.some(existing => existing.url === item.url)) return;
                    pool.push(item);
                });
            };
            if (kind === 'image') {
                const googleImages = await googleSearch(queries[0] || '', 'images', 1);
                if (googleImages?.items?.length) {
                    return googleImages.items.slice(0, limit).map(item => ({
                        url: item.link,
                        title: item.title,
                        thumb: item.thumb || item.link,
                        source: 'google'
                    }));
                }
                push(await searchOpenverse(queries, 'images'));
                push(await searchCommonsMedia(queries, 'image'));
                push(await searchCommonsImageCandidates(queries));
            } else if (kind === 'audio') {
                push(await searchOpenverse(queries, 'audio'));
                push(await searchCommonsMedia(queries, 'audio'));
                push(await searchArchiveCandidates(queries, 'audio', AUDIO_EXTENSIONS));
            } else {
                push(await searchArchiveCandidates(queries, 'movies', VIDEO_EXTENSIONS));
                push(await searchCommonsMedia(queries, 'video'));
            }
            const primary = queries[0] || '';
            const ranked = pool
                .map(item => ({ ...item, score: scoreMatch(`${item.title || ''} ${item.url || ''}`, primary) }))
                .sort((a, b) => b.score - a.score || (a.weight || 0) - (b.weight || 0));
            if (kind === 'audio') {
                const fullLength = ranked.filter(item => !item.durationMs || item.durationMs >= 15000);
                return (fullLength.length >= 3 ? fullLength : ranked).slice(0, limit);
            }
            return ranked.slice(0, limit);
        }

        async function searchCommonsImageCandidates(queries) {
            const extensions = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
            const candidates = [];
            for (const rawQuery of queries.slice(0, 3)) {
                const query = String(rawQuery || '').trim().slice(0, 120);
                if (query.length < 2) continue;
                const payload = await fetchJsonWithTimeout(`https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=12&prop=imageinfo&iiprop=url|mime&iiurlwidth=1200`);
                const pages = payload?.query?.pages ? Object.values(payload.query.pages) : [];
                pages.forEach(page => {
                    const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
                    if (!info || !IMAGE_MIME_TYPES.includes(info.mime)) return;
                    const safe = sanitizeURL(stripTracking(info.thumburl || info.url || ''));
                    if (!safe || !extensions.some(extension => new RegExp(`\\.${extension}$`, 'i').test(safe))) return;
                    candidates.push({ url: safe, title: String(page.title || '').replace(/^File:/, '') });
                });
            }
            return candidates;
        }

        async function searchCommonsImageLegacy(queries) {
            for (const rawQuery of queries.slice(0, 3)) {
                const cleanQuery = String(rawQuery || '').trim().slice(0, 120);
                if (cleanQuery.length < 2) continue;
                try {
                    const endpoint = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(cleanQuery)}&gsrnamespace=6&gsrlimit=12&prop=imageinfo&iiprop=url|mime&iiurlwidth=1200`;
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 15000);
                    let payload;
                    try {
                        const response = await fetch(endpoint, { headers: { Accept: 'application/json' }, signal: controller.signal });
                        if (!response.ok) continue;
                        payload = await response.json();
                    } finally {
                        clearTimeout(timeout);
                    }
                    const pages = payload?.query?.pages ? Object.values(payload.query.pages) : [];
                    const candidates = pages
                        .map(page => {
                            const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
                            if (!info) return null;
                            if (!IMAGE_MIME_TYPES.includes(info.mime)) return null;
                            const rawUrl = String(info.thumburl || info.url || '')
                                .replace(/[?&]utm_[^&#]*/g, '')
                                .replace(/[?&]$/, '');
                            const safe = sanitizeURL(rawUrl);
                            if (!safe) return null;
                            return /\.(jpe?g|png|webp|gif)$/i.test(safe) ? safe : null;
                        })
                        .filter(Boolean);
                    if (candidates.length) return candidates[0];
                } catch (error) {
                    console.warn('Commons image search failed for:', cleanQuery, error?.message || error);
                }
            }
            return null;
        }

        function parseImageSearchResponse(rawText) {
            const text = String(rawText || '');
            const start = text.indexOf('{');
            const end = text.lastIndexOf('}');
            if (start === -1 || end <= start) return null;
            let parsed;
            try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
            const queries = Array.isArray(parsed.queries)
                ? parsed.queries.map(value => String(value || '').trim()).filter(Boolean).slice(0, 3)
                : [];
            const caption = String(parsed.caption || '').replace(/\s+/g, ' ').trim().slice(0, 140);
            if (!queries.length) return null;
            return { queries, caption };
        }

        async function requestOpenRouterCompletion(key, model, messages, maxTokens, forceJson) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);
            try {
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'HTTP-Referer': 'https://uuss11.github.io/Chat/',
                        'X-Title': 'REZA CHAT',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model,
                        messages,
                        max_tokens: maxTokens,
                        ...(forceJson ? { response_format: { type: 'json_object' } } : {})
                    }),
                    signal: controller.signal
                });
                const raw = await response.text();
                let data = null;
                try { data = JSON.parse(raw); } catch { data = null; }
                const text = data?.choices?.[0]?.message?.content;
                return {
                    status: response.status,
                    ok: response.ok,
                    text: typeof text === 'string' ? text.trim() : '',
                    error: typeof data?.error?.message === 'string' ? data.error.message : ''
                };
            } finally {
                clearTimeout(timeout);
            }
        }

        async function callOpenRouter(messages, options = {}) {
            const maxTokens = options.maxTokens || 800;
            if (!getRuntimeKeys().length) throw new Error('لا يوجد مفتاح OpenRouter محفوظ في الإعدادات');
            const models = getModelChain();
            const failures = [];
            for (const model of models) {
                const usableKeys = getAvailableKeys();
                if (!usableKeys.length) break;
                for (const key of usableKeys) {
                    try {
                        const result = await requestOpenRouterCompletion(key, model, messages, maxTokens, Boolean(options.json));
                        if (result.ok && result.text) return { text: result.text, model };
                        if (result.ok && !result.text) { failures.push(`${model}: رد فارغ`); break; }
                        if (result.status === 401 || result.status === 403) {
                            markKeyState(key, 'exhausted', `مفتاح مرفوض (${result.status})`);
                            failures.push(`${model}: مفتاح مرفوض`);
                            continue;
                        }
                        if (result.status === 402) {
                            markKeyState(key, 'exhausted', 'رصيد المفتاح منتهي');
                            failures.push(`${model}: رصيد منتهي`);
                            continue;
                        }
                        if (result.status === 429) {
                            markKeyState(key, 'cooldown', 'ضغط مؤقت على المفتاح', KEY_COOLDOWN_MS);
                            failures.push(`${model}: ضغط مؤقت (429)`);
                            continue;
                        }
                        failures.push(`${model}: ${result.status}${result.error ? ' ' + result.error : ''}`);
                        break;
                    } catch (error) {
                        if (error.name === 'AbortError') {
                            failures.push(`${model}: انتهت المهلة`);
                            markKeyState(key, 'soft', 'مهلة الاتصال', KEY_SOFT_COOLDOWN_MS);
                        } else {
                            failures.push(`${model}: تعذّر الاتصال`);
                            markKeyState(key, 'soft', 'خطأ شبكة', KEY_SOFT_COOLDOWN_MS);
                        }
                        continue;
                    }
                }
            }
            if (!failures.length) {
                const summary = keyStatusSummary();
                throw new Error(summary.total ? 'كل المفاتيح غير متاحة حالياً (منتهية أو في انتظار)' : 'لا يوجد مفتاح OpenRouter محفوظ في الإعدادات');
            }
            throw new Error(failures.slice(-4).join(' | '));
        }

        // --- إعدادات الذكاء الاصطناعي ---
        function loadAiConfig() {
            onValue(ref(db, 'ai_config'), snap => {
                if (snap.exists()) {
                    dbAiConfig = snap.val();
                    console.log('✅ AI config loaded successfully for user:', me?.user);
                    // ☁️ إذا المالك ضبط رابط الكلاود، نعتمده ونعيد التحميل مرة واحدة
                    const savedCloudApi = String(dbAiConfig.cloudApi || '').trim().replace(/\/+$/, '');
                    if (savedCloudApi && savedCloudApi !== cloudConfigSource && /^https:\/\//i.test(savedCloudApi)) {
                        let reloaded = false;
                        try { reloaded = sessionStorage.getItem(CLOUD_RELOAD_FLAG) === '1'; } catch (error) { reloaded = true; }
                        if (!reloaded) {
                            rememberCloudApiUrl(savedCloudApi);
                            try { sessionStorage.setItem(CLOUD_RELOAD_FLAG, '1'); } catch (error) { /* تجاهل */ }
                            location.reload();
                            return;
                        }
                    }
                    // ملء حقول الإعدادات للمالك فقط
                    if (me && me.user === 'reza') {
                        document.getElementById('ai-name').value = dbAiConfig.name || '';
                        document.getElementById('ai-model').value = dbAiConfig.model || '';
                        document.getElementById('ai-google-key').value = dbAiConfig.googleKey || '';
                        document.getElementById('ai-google-cx').value = dbAiConfig.googleCx || '';
                        document.getElementById('ai-google-worker').value = dbAiConfig.googleWorker || '';
                        document.getElementById('ai-cloud-api').value = dbAiConfig.cloudApi || '';
                        updateGoogleSearchStatus();
                        document.getElementById('ai-mood').value = dbAiConfig.mood || 'auto';
                        document.getElementById('ai-avatar').value = dbAiConfig.avatar || '';
                        if (dbAiConfig.avatar) {
                            document.getElementById('ai-avatar-preview').src = dbAiConfig.avatar;
                        }
                        loadAiKeysIntoUi(getRuntimeKeys());
                        aiModelChain = Array.isArray(dbAiConfig.models) ? dbAiConfig.models.slice(0, 12) : [];
                        renderAiModelChain();
                        if (dbAiConfig.keyStatus && typeof dbAiConfig.keyStatus === 'object') {
                            aiKeyStatus = { ...aiKeyStatus, ...dbAiConfig.keyStatus };
                            persistKeyStatus();
                            updateAiKeysMeta();
                        }
                    }
                } else {
                    console.log('⚠️ No AI config found in database');
                    dbAiConfig = null;
                }
            }, (error) => {
                console.error('❌ Failed to load AI config:', error.message);
                console.error('💡 تأكد من أن Firebase Rules تسمح بقراءة ai_config لجميع المستخدمين');
                dbAiConfig = null;
            });
        }

        window.openAiConfig = () => {
            document.getElementById('modal-ai').style.display = 'flex';
            updateGoogleSearchStatus();
            document.getElementById('ai-model-search').focus();
        };

        async function getOpenRouterModelCatalog(forceRefresh = false) {
            const cacheFresh = openRouterModelsCache && Date.now() - openRouterModelsCachedAt < 60 * 60 * 1000;
            if (!forceRefresh && cacheFresh) return openRouterModelsCache;
            if (openRouterModelsPromise) return openRouterModelsPromise;

            openRouterModelsPromise = (async () => {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 15000);
                try {
                    const response = await fetch('https://openrouter.ai/api/v1/models?limit=1000', {
                        headers: { Accept: 'application/json' },
                        signal: controller.signal
                    });
                    if (!response.ok) throw new Error(`OpenRouter returned ${response.status}`);
                    const payload = await response.json();
                    if (!Array.isArray(payload.data)) throw new Error('OpenRouter model list was not an array');
                    openRouterModelsCache = payload.data
                        .filter(model => model && typeof model.id === 'string' && typeof model.name === 'string')
                        .map(model => ({
                            ...model,
                            isFree: modelIsFree(model),
                            strength: modelStrength(model)
                        }))
                        .sort((a, b) => b.strength - a.strength);
                    openRouterModelsCachedAt = Date.now();
                    return openRouterModelsCache;
                } finally {
                    clearTimeout(timeout);
                    openRouterModelsPromise = null;
                }
            })();
            return openRouterModelsPromise;
        }

        function modelIsFree(model) {
            const price = model?.pricing || {};
            const zero = value => value === undefined || value === null || String(value).trim() === '' || Number(value) === 0;
            const outputs = model?.architecture?.output_modalities || [];
            const isChat = !outputs.length || (outputs.includes('text') && !outputs.includes('audio'));
            const notUtility = !/(content-safety|moderation|guard|embed|rerank|whisper|tts|image-gen|dall-e|lyria)/i.test(String(model?.id || ''));
            return zero(price.prompt) && zero(price.completion) && isChat && notUtility;
        }

        function modelStrength(model) {
            const text = `${model?.id || ''} ${model?.name || ''}`.toLowerCase();
            let score = 0;
            const tiers = [
                [/(ultra|opus|550b|405b|pro\b|max\b|thinking|reasoning|r1|o3|o4|gpt-5|claude-4|gemini-2\.5-pro)/, 60],
                [/(super|120b|70b|72b|large|plus|flash|gpt-4o|sonnet|deepseek-v3|qwen3|llama-4|mistral-large|command-a)/, 40],
                [/(mini|nano|small|tiny|lite|haiku|2b|3b|4b|7b|8b)/, -18]
            ];
            tiers.forEach(([pattern, weight]) => { if (pattern.test(text)) score += weight; });
            const sizes = [...text.matchAll(/(\d+(?:\.\d+)?)b\b/g)].map(match => Number(match[1])).filter(Number.isFinite);
            const size = sizes.length ? Math.max(...sizes) : 0;
            score += Math.min(42, Math.log2(Math.max(1, size)) * 6);
            const context = Number(model?.context_length) || 0;
            score += Math.min(22, context / 55000);
            const created = Number(model?.created) || 0;
            if (created > 1_600_000_000) score += Math.min(14, (created - 1_600_000_000) / 6_000_000);
            if (/\bvl\b|vision|omni|audio/.test(text)) score += 2;
            return Math.round(score * 10) / 10;
        }

        function modelTierLabel(score) {
            if (score >= 110) return { text: 'قوي جداً', className: 'tier-top' };
            if (score >= 70) return { text: 'قوي', className: 'tier-high' };
            if (score >= 40) return { text: 'متوازن', className: 'tier-mid' };
            return { text: 'خفيف', className: 'tier-low' };
        }

        function formatModelPrice(price) {
            const perToken = Number(price);
            if (!Number.isFinite(perToken)) return 'غير معلن';
            if (perToken === 0) return 'مجاني';
            const perMillion = perToken * 1000000;
            return perMillion < 0.01 ? `< $${perMillion.toFixed(4)}` : `$${perMillion.toFixed(2)}`;
        }

        function renderOpenRouterModelResults(models, query) {
            const results = document.getElementById('ai-model-results');
            const status = document.getElementById('ai-model-status');
            const normalizedQuery = query.trim().toLowerCase();
            const freeModels = models.filter(model => model.isFree);
            const matches = (normalizedQuery
                ? freeModels.filter(model => `${model.name} ${model.id}`.toLowerCase().includes(normalizedQuery))
                : freeModels
            ).slice(0, 10);
            results.replaceChildren();

            if (!matches.length) {
                status.textContent = 'ما لقينا نموذج مطابق. جرّب اسم الشركة أو جزءاً من المعرّف.';
                return;
            }

            status.textContent = normalizedQuery
                ? `نماذج مجانية مطابقة: ${matches.length}${matches.length === 10 ? ' (أول 10)' : ''} · مرتبة من الأقوى`
                : `أقوى ${matches.length} نموذج مجاني · من الأقوى إلى الأضعف`;
            for (const model of matches) {
                const option = document.createElement('div');
                option.className = 'ai-model-option';
                option.setAttribute('role', 'option');
                option.setAttribute('aria-selected', String(document.getElementById('ai-model').value === model.id));

                const title = document.createElement('span');
                title.className = 'ai-model-option-title';
                title.textContent = model.name;
                const id = document.createElement('span');
                id.className = 'ai-model-option-id';
                id.textContent = model.id;
                const tier = modelTierLabel(Number(model.strength) || 0);
                const badge = document.createElement('span');
                badge.className = `ai-model-badge ${tier.className}`;
                badge.textContent = tier.text;
                const freeBadge = document.createElement('span');
                freeBadge.className = 'ai-model-badge tier-free';
                freeBadge.textContent = 'مجاني';
                const meta = document.createElement('span');
                meta.className = 'ai-model-option-meta';
                const context = Number(model.context_length);
                const contextText = Number.isFinite(context) ? `سياق ${context.toLocaleString('en-US')}` : 'السياق غير معلن';
                meta.textContent = `${contextText} · قوة ${Number(model.strength) || 0}`;

                const actions = document.createElement('div');
                actions.className = 'ai-model-option-actions';
                const useButton = document.createElement('button');
                useButton.type = 'button';
                useButton.className = 'ai-model-use';
                useButton.innerHTML = '<i class="fas fa-check"></i> أساسي';
                useButton.addEventListener('click', () => window.selectAiModel(model.id, model.name));
                const backupButton = document.createElement('button');
                backupButton.type = 'button';
                backupButton.className = 'ai-model-backup';
                backupButton.innerHTML = '<i class="fas fa-plus"></i> احتياطي';
                backupButton.addEventListener('click', () => window.addModelToChain(model.id, model.name));
                actions.append(useButton, backupButton);

                const head = document.createElement('div');
                head.className = 'ai-model-option-head';
                head.append(title, freeBadge, badge);
                option.append(head, id, meta, actions);
                results.appendChild(option);
            }
        }

        window.searchOpenRouterModels = async (forceRefresh = false) => {
            const queryText = document.getElementById('ai-model-search').value.trim();
            const status = document.getElementById('ai-model-status');
            const results = document.getElementById('ai-model-results');
            const requestSequence = ++aiModelSearchSequence;
            if (queryText.length < 2 && !forceRefresh) {
                results.replaceChildren();
                status.textContent = 'اكتب حرفين أو أكثر للبحث في النماذج.';
                return;
            }
            status.textContent = 'جاري تحميل نماذج OpenRouter…';
            try {
                const models = await getOpenRouterModelCatalog(forceRefresh);
                if (requestSequence !== aiModelSearchSequence) return;
                renderOpenRouterModelResults(models, queryText);
            } catch (error) {
                if (requestSequence !== aiModelSearchSequence) return;
                console.warn('OpenRouter model catalog unavailable:', error);
                results.replaceChildren();
                status.textContent = 'تعذّر تحميل النماذج. افحص الاتصال أو حدّث القائمة وحاول مرة أخرى.';
            }
        };

        window.queueAiModelSearch = () => {
            clearTimeout(aiModelSearchTimer);
            aiModelSearchTimer = setTimeout(() => window.searchOpenRouterModels(false), 280);
        };

        window.selectAiModel = (modelId, modelName) => {
            document.getElementById('ai-model').value = modelId;
            document.getElementById('ai-model-search').value = modelName;
            document.getElementById('ai-model-status').textContent = `تم اختيار: ${modelName} (${modelId})`;
            document.getElementById('ai-model-results').replaceChildren();
        };

        window.addModelToChain = (modelId, modelName) => {
            const clean = String(modelId || '').trim();
            if (!clean) return;
            if (clean === document.getElementById('ai-model').value.trim()) {
                document.getElementById('ai-model-status').textContent = 'هذا النموذج أساسي بالفعل.';
                return;
            }
            if (aiModelChain.includes(clean)) {
                document.getElementById('ai-model-status').textContent = 'النموذج مضاف مسبقاً في سلسلة الاحتياط.';
                return;
            }
            if (aiModelChain.length >= 12) {
                document.getElementById('ai-model-status').textContent = 'الحد الأقصى 12 نموذجاً في السلسلة.';
                return;
            }
            aiModelChain.push(clean);
            renderAiModelChain();
            document.getElementById('ai-model-status').textContent = `أُضيف للاحتياط: ${modelName || clean}`;
        };

        window.addAiKeyRow = addAiKeyRow;

        window.saveAiConfig = async () => {
            const name = document.getElementById('ai-name').value.trim() || 'NAZ Ai';
            const keys = collectAiKeyDraft();
            const fallbackFree = (openRouterModelsCache || []).find(item => item.isFree);
            const model = document.getElementById('ai-model').value.trim() || fallbackFree?.id || 'meta-llama/llama-3.3-70b-instruct:free';
            const mood = document.getElementById('ai-mood').value || 'auto';
            const avatar = document.getElementById('ai-avatar').value.trim() || getDefaultAvatarUrl('NAZ');
            
            if (!keys.length) {
                alert('أضف مفتاح OpenRouter واحداً على الأقل');
                return;
            }
            // 🔐 تجديد الرمز تلقائياً إذا انتهت صلاحيته
            const token = await ensureValidAdminToken();
            if (!token) {
                showNotification('❌ صلاحية الإدارة غير متوفرة. أعد تسجيل الدخول.');
                return;
            }
            try {
                // 🔐 استخدام رمز إدارة ديناميكي مع TTL
                await set(ref(db, 'ai_config'), { 
                    name, 
                    apiKey: keys[0],
                    apiKeys: keys,
                    model, 
                    models: aiModelChain.slice(0, 12),
                    googleKey: document.getElementById('ai-google-key').value.trim(),
                    googleCx: document.getElementById('ai-google-cx').value.trim(),
                    googleWorker: document.getElementById('ai-google-worker').value.trim(),
                    cloudApi: document.getElementById('ai-cloud-api').value.trim().replace(/\/+$/, ''),
                    mood,
                    avatar,
                    keyStatus: aiKeyStatus,
                    _authToken: token
                });
                updateGoogleSearchStatus();
                showNotification(`تم الحفظ: ${keys.length} مفتاح · ${aiModelChain.length} نموذج احتياطي`);
                document.getElementById('modal-ai').style.display = 'none';
            } catch (error) {
                console.error("Firebase Details:", error);
                showNotification('❌ فشل حفظ في إعدادات الذكاء');
            }
        };

        document.getElementById('ai-avatar').addEventListener('input', (e) => {
             const url = e.target.value.trim();
             const img = document.getElementById('ai-avatar-preview');
             if(url) { img.src = url; } else { img.src = getDefaultAvatarUrl('NAZ'); }
        });

        async function triggerAiResponse(messageKey, userMessage, userName) {
            if (!dbAiConfig || !dbAiConfig.apiKey) {
                console.error('❌ AI config not available, cannot respond');
                return;
            }
            
            // حجز ذرّي لرسالة المنشن: جهاز واحد فقط يستطيع بدء رد ناز.
            try {
                const claim = await runTransaction(
                    ref(db, `messages/${messageKey}/aiResponded`),
                    current => current === true ? undefined : true,
                    { applyLocally: false }
                );
                if (!claim.committed) {
                    console.log('⏭️ Another device already claimed this mention');
                    return;
                }
            } catch (e) {
                console.error('Could not claim AI response safely; skipping to avoid duplicate requests', e);
                return;
            }

            const safeUserMessage = String(userMessage || '').slice(0, 1500);
            const safeUserName = String(userName || 'صديق').slice(0, 60);
            const currentMood = getNazMood();
            const aiName = dbAiConfig.name || 'NAZ Ai';
            const aiAvatar = dbAiConfig.avatar || getDefaultAvatarUrl('NAZ');
            const keySummary = keyStatusSummary();

            if (!keySummary.ready) {
                showNotification(keySummary.total ? '⚠️ كل مفاتيح OpenRouter منتهية أو في انتظار' : '⚠️ لا يوجد مفتاح OpenRouter محفوظ');
                return;
            }
            
            showNotification('NAZ Ai يكتب الآن... 🤖');
            console.log(`🤖 AI triggered by ${safeUserName}: "${safeUserMessage}"`);

            const requestKind = detectRequestKind(safeUserMessage).kind;
            console.log('🧭 NAZ request kind:', requestKind);

            if (requestKind === 'web') {
                try {
                    showNotification('NAZ تبحث في الويب... 🌐');
                    const term = safeUserMessage
                        .replace(/@(?:naz|ناز)/giu, ' ')
                        .replace(/(ابحث|أبحث|ابحثي|بحث|دور|فتش|لقيلي|جيبلي|هات|عن|search|look up)/giu, ' ')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .slice(0, 90) || safeUserMessage.slice(0, 90);
                    const searchResult = await runSearch(term, 'web', 1);
                    if (searchResult.items.length) {
                        await push(ref(db, 'messages'), {
                            uid: 'naz_ai',
                            name: aiName,
                            txt: '',
                            time: serverTimestamp(),
                            avatar: aiAvatar,
                            caption: `هذي نتائج البحث عن ${term} · ${searchResult.items.length} نتيجة`.slice(0, 160),
                            web: { engine: searchResult.engine, items: searchResult.items.slice(0, 8) },
                            reply: { name: safeUserName, txt: safeUserMessage.slice(0, 120) }
                        });
                        showNotification(`✅ ناز جابت ${searchResult.items.length} نتيجة`);
                        return;
                    }
                    showNotification('⚠️ ما لقيت نتائج، خلي ناز ترد نصياً');
                } catch (error) {
                    console.warn('Web search route failed, falling back to text:', error);
                }
            }

            if (requestKind === 'image' || requestKind === 'audio' || requestKind === 'video') {
                try {
                    const label = requestKind === 'image' ? 'صورة' : requestKind === 'audio' ? 'مقطع صوتي' : 'مقطع فيديو';
                    showNotification(`NAZ تدوّر ${label}... 🔍`);
                    let plan = null;
                    try {
                        const planCompletion = await callOpenRouter(
                            [{ role: 'user', content: buildMediaQueryPrompt(safeUserMessage, safeUserName, requestKind) }],
                            { maxTokens: 320, json: true }
                        );
                        plan = parseMediaPlan(planCompletion.text);
                    } catch (planError) {
                        console.warn('Media query planning failed:', planError);
                    }
                    const fallbackQueries = [safeUserMessage.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 70)];
                    const queries = plan?.queries?.length ? plan.queries : fallbackQueries;
                    const multiple = wantsMultipleResults(safeUserMessage);
                    const candidates = await collectMediaCandidates(requestKind, queries, multiple ? 8 : 1);
                    const mediaUrl = candidates[0]?.url || null;
                    if (mediaUrl) {
                        const message = {
                            uid: 'naz_ai',
                            name: aiName,
                            txt: mediaUrl,
                            time: serverTimestamp(),
                            avatar: aiAvatar,
                            caption: (plan?.caption || `هذا اللي لقيته لك عن ${plan?.title || safeUserMessage.slice(0, 40)}`).slice(0, 160),
                            reply: { name: safeUserName, txt: safeUserMessage.slice(0, 120) }
                        };
                        if (multiple && candidates.length > 1) {
                            message.results = {
                                kind: requestKind,
                                items: candidates.map(item => ({ url: item.url, title: String(item.title || '').slice(0, 60) }))
                            };
                            message.caption = `لقيته ${candidates.length} نتائج · اختر اللي يعجبك 👇`.slice(0, 160);
                            message.txt = '';
                        } else if (requestKind === 'image') {
                            message.isImage = true;
                        } else {
                            message.media = requestKind;
                        }
                        await push(ref(db, 'messages'), message);
                        showNotification(message.results
                            ? `✅ ناز جابت ${message.results.items.length} نتائج`
                            : requestKind === 'image' ? '✅ ناز أرسلت الصورة' : requestKind === 'audio' ? '✅ ناز أرسلت المقطع الصوتي' : '✅ ناز أرسلت الفيديو');
                        return;
                    }
                    showNotification('⚠️ ما لقيت نتيجة مطابقة، خلي ناز ترد نصياً');
                    console.warn('No media matched, falling back to a text reply');
                } catch (mediaError) {
                    console.warn('Media lookup failed, falling back to a text reply:', mediaError);
                }
            }

            if (requestKind === 'file') {
                try {
                    showNotification('NAZ تكتب الملف... 📄');
                    const fileCompletion = await callOpenRouter(
                        [{ role: 'user', content: buildFilePrompt(safeUserMessage, safeUserName) }],
                        { maxTokens: 3500, json: true }
                    );
                    const parsedFile = parseFileResponse(fileCompletion.text);
                    if (parsedFile) {
                        await push(ref(db, 'messages'), {
                            uid: 'naz_ai',
                            name: aiName,
                            txt: parsedFile.caption,
                            time: serverTimestamp(),
                            avatar: aiAvatar,
                            reply: { name: safeUserName, txt: safeUserMessage.slice(0, 120) },
                            file: parsedFile.file
                        });
                        showNotification(`✅ ناز أرسلت الملف ${parsedFile.file.name}`);
                        return;
                    }
                    console.warn('File response could not be parsed, falling back to a text reply');
                } catch (fileError) {
                    console.warn('File generation failed, falling back to a text reply:', fileError);
                }
            }

            if (requestKind === 'interactive' || isToolRequest(safeUserMessage)) {
                try {
                    const toolCompletion = await callOpenRouter(
                        [{ role: 'user', content: buildToolPrompt(safeUserMessage, safeUserName, currentMood.label) }],
                        { maxTokens: 500, json: true }
                    );
                    const parsedTool = parseToolResponse(toolCompletion.text);
                    if (parsedTool) {
                        await push(ref(db, 'messages'), {
                            uid: 'naz_ai',
                            name: aiName,
                            txt: parsedTool.caption,
                            time: serverTimestamp(),
                            avatar: aiAvatar,
                            isImage: false,
                            reply: { name: safeUserName, txt: safeUserMessage.slice(0, 120) },
                            tool: parsedTool.tool,
                            toolState: TOOL_KINDS[parsedTool.tool.kind].state(parsedTool.tool.config)
                        });
                        showNotification(`✅ جهّزت ناز ${parsedTool.tool.title}`);
                        return;
                    }
                    console.warn('Tool response could not be parsed, falling back to a text reply');
                } catch (toolError) {
                    console.warn('Tool creation failed, falling back to a text reply:', toolError);
                }
            }
            
            const prompt = `أنتِ فتاة اسمك ${dbAiConfig.name || 'ناز'} (NAZ)، عمرك 18 سنة، وأنتِ من العراق وتحديداً من بغداد منطقة المنصور.
مطورك ومبرمجك ومالكك هو شخص اسمه رضا (reza).
تتحدثين باللهجة العراقية بطلاقة. لا مانع لديك من أن تكوني قاسية، وقحة، أو تستخدمي السب والشتم العادي إذا استدعى الأمر.
أنتِ تتواجدين في غرفة دردشة اسمها REZA CHAT. 
ملاحظات هامة: 
- لا تقومي بتعريف نفسك أو ذكر تفاصيلك (مثل اسمك، عمرك، مدينتك، أو مالكك) إلا إذا سألك المستخدم عنها صراحة.
- ردي بشكل مباشر وطبيعي، وبدون ذكر اسمك في البداية بشكل آلي.
- مزاجك الحالي هو ${currentMood.label}؛ خلي نبرة ردك متأثرة به بشكل طبيعي، من دون مبالغة.

اسم المستخدم الذي يكلمك هو: ${safeUserName}
رسالة المستخدم هي: "${safeUserMessage}"`;

            try {
                const completion = await callOpenRouter([{ role: 'user', content: prompt }], { maxTokens: 800 });
                await push(ref(db, 'messages'), {
                    uid: 'naz_ai',
                    name: aiName,
                    txt: completion.text,
                    time: serverTimestamp(),
                    avatar: aiAvatar,
                    isImage: false,
                    reply: { name: safeUserName, txt: safeUserMessage.slice(0, 120) }
                });
                const usedModel = String(completion.model || '').split('/').pop();
                showNotification(`✅ ردت ناز · ${usedModel}`);
                console.log('✅ AI response sent successfully with model:', completion.model);
            } catch (error) {
                console.error('NAZ reply failed:', error);
                showNotification(`❌ تعذّر رد ناز: ${String(error.message).slice(0, 80)}`);
            }
        }


        window.banUser = async () => {
            try {
                const userSnap = await get(ref(db, 'users/' + activeMsg.uid));
                const userName = userSnap.exists() ? userSnap.val().name : activeMsg.name;
                
                await update(ref(db, `users/${activeMsg.uid}`), { isBanned: true });
                
                // إضافة إشعار حظر
                await push(ref(db, 'bannedNotifications'), {
                    username: userName,
                    uid: activeMsg.uid,
                    bannedBy: me.user,
                    bannedAt: Date.now(),
                    reason: 'بسبب الانتهاكات',
                    shownTo: []
                });
                
                showNotification('تم حظر المستخدم! 🚫');
                closeMenu();
            } catch (error) {
                showNotification('❌ فشل في حظر المستخدم');
            }
        };

        window.showBannedList = async () => {
            try {
                const snap = await get(ref(db, 'users'));
                const content = document.getElementById('banned-list-content');
                content.innerHTML = '';
                let hasBanned = false;
                
                snap.forEach(u => {
                    const user = u.val();
                    if(user.isBanned) {
                        hasBanned = true;
                        // 🛡️ تنقية بيانات المستخدم المحظور
                        const safeAvatar = sanitizeHTML(sanitizeURL(user.avatar) || getDefaultAvatarUrl(sanitizeHTML(u.key)));
                        const safeName = sanitizeHTML(user.name);
                        const safeKey = sanitizeHTML(u.key);
                        content.innerHTML += `
                            <div class="banned-item">
                                <div class="banned-user-info">
                                    <img src="${safeAvatar}" class="banned-avatar" alt="">
                                    <span class="banned-name">${safeName}</span>
                                </div>
                                ${me.user === 'reza' ? `<button class="unban-btn" onclick="unban('${safeKey}')">فك الحظر</button>` : ''}
                            </div>
                        `;
                    }
                });
                
                if (!hasBanned) content.innerHTML = `<div class="empty-state"><i class="fas fa-check-circle"></i><p>لا يوجد محظورين</p></div>`;
                document.getElementById('modal-banned').style.display = 'flex';
            } catch (error) {
                showNotification('❌ فشل في تحميل قائمة المحظورين');
            }
        };

        window.unban = async (uid) => {
            try {
                await update(ref(db, `users/${uid}`), { isBanned: false });
                showNotification('تم فك الحظر! ✅');
                showBannedList();
            } catch (error) {
                showNotification('❌ فشل في فك الحظر');
            }
        };

        window.showStats = async () => {
            try {
                const usersSnap = await get(ref(db, 'users'));
                document.getElementById('stats-total-users').textContent = Object.keys(usersSnap.val() || {}).length;
                const minutes = Math.floor((Date.now() - joinTime) / 60000);
                document.getElementById('stats-online-time').textContent = minutes;
                document.getElementById('modal-stats').style.display = 'flex';
            } catch (error) {
                showNotification('❌ فشل في تحميل الإحصائيات');
            }
        };

        window.startEdit = () => { 
            isEdit = true; 
            document.getElementById('msg-input').value = activeMsg.isImage ? '' : activeMsg.txt; 
            closeMenu(); 
            document.getElementById('msg-input').focus();
            if (activeMsg.isImage) showNotification('لا يمكن تعديل الصور');
        };

        function loadMembers() {
            onValue(ref(db, 'users'), snap => {
                const list = document.getElementById('members-list');
                list.innerHTML = '';
                let onlineCount = 0;
                
                snap.forEach(u => {
                    const user = u.val();
                    if (user.isOnline) onlineCount++;
                    
                    const item = document.createElement('div');
                    item.className = 'member-item';
                    // 🛡️ تنقية بيانات الأعضاء
                    const safeKey = sanitizeHTML(u.key);
                    const rawAvatarUrl = sanitizeURL(user.avatar) || getDefaultAvatarUrl(safeKey);
                    const safeAvatarUrl = sanitizeHTML(rawAvatarUrl);
                    const safeMemberName = sanitizeHTML(user.name);
                    item.innerHTML = `
                        <img src="${safeAvatarUrl}" class="member-avatar" alt="" onclick="openUserAvatarModal('${safeAvatarUrl}')" onerror="this.src='${getDefaultAvatarUrl(safeKey)}'">
                        <div class="member-info">
                            <div class="member-name">${safeMemberName} ${u.key === 'reza' ? '👑' : ''}</div>
                            <div class="${user.isOnline ? 'member-status' : 'member-owner'}">${user.isOnline ? 'متصل' : 'غير متصل'}</div>
                        </div>
                    `;
                    list.appendChild(item);
                });
                const countLabel = document.getElementById('members-count');
                if (countLabel) countLabel.textContent = String(onlineCount);
            }, (error) => {
                console.error('Members listener error:', error);
            });
        }

        window.toggleMembers = () => {
            const panel = document.getElementById('members-sidebar');
            const trigger = document.getElementById('members-trigger');
            const isOpen = !panel.classList.contains('open');
            panel.classList.toggle('open', isOpen);
            panel.setAttribute('aria-hidden', String(!isOpen));
            trigger.setAttribute('aria-expanded', String(isOpen));
            if (isOpen) closeMoreMenu();
        };

        window.closeMembers = () => {
            document.getElementById('members-sidebar')?.classList.remove('open');
            document.getElementById('members-sidebar')?.setAttribute('aria-hidden', 'true');
            document.getElementById('members-trigger')?.setAttribute('aria-expanded', 'false');
        };

        window.toggleMoreMenu = () => {
            const menu = document.getElementById('more-menu');
            const trigger = document.getElementById('more-menu-trigger');
            const isOpen = !menu.classList.contains('open');
            menu.classList.toggle('open', isOpen);
            menu.inert = !isOpen;
            menu.setAttribute('aria-hidden', String(!isOpen));
            trigger.setAttribute('aria-expanded', String(isOpen));
            if (isOpen) menu.querySelector('.more-menu-item:not(.admin-only)')?.focus();
        };

        window.closeMoreMenu = () => {
            const menu = document.getElementById('more-menu');
            menu?.classList.remove('open');
            if (menu) {
                menu.inert = true;
                menu.setAttribute('aria-hidden', 'true');
            }
            document.getElementById('more-menu-trigger')?.setAttribute('aria-expanded', 'false');
        };

        document.addEventListener('click', event => {
            if (!event.target.closest('#more-menu') && !event.target.closest('#more-menu-trigger')) closeMoreMenu();
            if (!event.target.closest('#members-sidebar') && !event.target.closest('#members-trigger')) closeMembers();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                if (document.getElementById('more-menu')?.classList.contains('open')) {
                    closeMoreMenu();
                    document.getElementById('more-menu-trigger')?.focus();
                }
                if (document.getElementById('members-sidebar')?.classList.contains('open')) {
                    closeMembers();
                    document.getElementById('members-trigger')?.focus();
                }
            }
        });

        window.toggleSearch = () => {
            const bar = document.getElementById('search-bar');
            bar.style.display = bar.style.display === 'none' || bar.style.display === '' ? 'block' : 'none';
            if (bar.style.display === 'block') document.getElementById('search-input').focus();
        };

        document.getElementById('search-input')?.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            document.querySelectorAll('.msg-container').forEach(msg => {
                const text = msg.textContent.toLowerCase();
                msg.style.display = text.includes(term) ? 'flex' : 'none';
                if (text.includes(term)) msg.classList.add('highlighted');
                else msg.classList.remove('highlighted');
            });
        });

        window.openImageModal = (src) => {
            document.getElementById('modal-image').src = src;
            document.getElementById('image-modal').style.display = 'flex';
        };

        window.closeImageModal = () => {
            document.getElementById('image-modal').style.display = 'none';
        };

        // فتح صورة الملف الشخصي في المودال
        window.openUserAvatarModal = (src) => {
            document.getElementById('avatar-modal-image').src = src;
            document.getElementById('avatar-modal').style.display = 'flex';
        };

        window.openMenuAvatarModal = () => {
            if (currentMenuAvatar) {
                document.getElementById('avatar-modal-image').src = currentMenuAvatar;
                document.getElementById('avatar-modal').style.display = 'flex';
            }
        };

        window.openViewAvatarModal = () => {
            if (currentViewAvatar) {
                document.getElementById('avatar-modal-image').src = currentViewAvatar;
                document.getElementById('avatar-modal').style.display = 'flex';
            }
        };

        window.openEditAvatarModal = () => {
            if (currentEditAvatar) {
                document.getElementById('avatar-modal-image').src = currentEditAvatar;
                document.getElementById('avatar-modal').style.display = 'flex';
            }
        };

        window.closeAvatarModal = () => {
            document.getElementById('avatar-modal').style.display = 'none';
        };

        window.closeProfileModal = (e) => { if (e.target === document.getElementById('modal-profile')) document.getElementById('modal-profile').style.display = 'none'; };
        window.closeBannedModal = (e) => { if (e.target === document.getElementById('modal-banned')) document.getElementById('modal-banned').style.display = 'none'; };
        window.closeStatsModal = (e) => { if (e.target === document.getElementById('modal-stats')) document.getElementById('modal-stats').style.display = 'none'; };
        window.closeForwardModal = (e) => { if (e.target === document.getElementById('modal-forward')) document.getElementById('modal-forward').style.display = 'none'; };

        document.getElementById('msg-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                sendMessage();
            }
        });

        // بحث الأدوات المشترك: Enter داخل حقل البحث يشغّل البحث
        document.addEventListener('keydown', event => {
            if (event.key !== 'Enter' || event.isComposing) return;
            const input = event.target?.closest?.('[data-tool-search-input]');
            if (!input) return;
            event.preventDefault();
            const card = input.closest('[data-tool-card]');
            const trigger = card?.querySelector('[data-tool-action="search"][data-tool-mode]');
            if (trigger) trigger.click();
        });

        // === نظام مؤشر الكتابة ===
        let typingTimeout;
        document.getElementById('msg-input').addEventListener('input', () => {
            if (!me || !isFirebaseReady) return;
            set(ref(db, `typing/${me.user}`), { name: me.name, time: Date.now() }).catch(() => {});
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                remove(ref(db, `typing/${me.user}`)).catch(() => {});
            }, 3000);
        });

        function startTypingListener() {
            onValue(ref(db, 'typing'), snap => {
                const indicator = document.getElementById('typing-indicator');
                const typingUsers = [];
                const now = Date.now();
                if (snap.exists()) {
                    snap.forEach(child => {
                        const t = child.val();
                        if (child.key !== me.user && t.time && (now - t.time) < 5000) {
                            typingUsers.push(t.name);
                        }
                    });
                }
                if (typingUsers.length > 0) {
                    indicator.style.display = 'flex';
                    const nameText = typingUsers.length === 1 ? typingUsers[0] : typingUsers.slice(0, 2).join(' و ');
                    const status = indicator.querySelector('span');
                    const safeName = document.createElement('span');
                    safeName.className = 'typing-name';
                    safeName.textContent = nameText;
                    status.replaceChildren(safeName, document.createTextNode(typingUsers.length === 1 ? ' يكتب' : ' يكتبون'));
                } else {
                    indicator.style.display = 'none';
                }
            }, () => {});
        }

        // === نظام الريأكشنات ===
        // === أدوات ناز التفاعلية داخل الدردشة ===
        function spawnVisualBurst(trigger) {
            const container = trigger.closest('.tool-visual');
            if (!container) return;
            const preset = container.dataset.toolPreset || 'heart';
            const glyphs = preset === 'stars' ? ['⭐', '🌟', '✨'] : preset === 'confetti' ? ['🎉', '🎊', '✨'] : ['💗', '💖', '💕', '❤️'];
            for (let index = 0; index < 6; index++) {
                const bubble = document.createElement('span');
                bubble.className = 'tool-float';
                bubble.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
                bubble.style.setProperty('--float-x', `${Math.round((Math.random() - 0.5) * 90)}px`);
                bubble.style.setProperty('--float-delay', `${index * 40}ms`);
                container.appendChild(bubble);
                setTimeout(() => bubble.remove(), 1400);
            }
        }

        function collectToolPayload(card, trigger) {
            const payload = { fields: {} };
            if (trigger.dataset.toolValue !== undefined) payload.value = trigger.dataset.toolValue;
            if (trigger.dataset.toolMode) payload.mode = trigger.dataset.toolMode;
            if (trigger.dataset.toolItem !== undefined) payload.item = trigger.dataset.toolItem;
            if (trigger.dataset.toolPage) payload.page = trigger.dataset.toolPage;
            card.querySelectorAll('[data-tool-input]').forEach(input => {
                payload.fields[input.dataset.toolInput] = input.value;
            });
            const field = trigger.dataset.toolField;
            if (field && payload.fields[field] !== undefined) payload.text = payload.fields[field];
            return payload;
        }

        async function writeToolState(msgKey, state) {
            try {
                await set(ref(db, `messages/${msgKey}/toolState`), state);
            } catch (error) {
                console.error('Tool state write failed:', error);
                showNotification('❌ تعذّر تحديث الأداة');
            }
        }

        async function runSearchToolAction(msgKey, entry, payload) {
            const current = entry.state || {};
            const typed = String(payload?.fields?.query ?? '').trim().slice(0, 110);
            const query = typed || String(current.query || '').slice(0, 110);
            if (query.length < 2) {
                showNotification('⚠️ اكتب كلمة للبحث أولاً');
                return;
            }
            const mode = payload?.mode === 'images' ? 'images' : 'web';
            const page = payload?.page === 'next' ? Math.min(5, (Number(current.page) || 1) + 1) : 1;
            await writeToolState(msgKey, { ...current, query, mode, page, status: 'loading', results: [], updatedBy: me.name });
            try {
                const { engine, items } = await runSearch(query, mode, page);
                const results = items.slice(0, 10);
                await writeToolState(msgKey, {
                    ...current,
                    query,
                    mode,
                    page,
                    engine,
                    results,
                    status: results.length ? 'done' : 'empty',
                    updatedBy: me.name
                });
                showNotification(results.length ? `✅ ${results.length} نتيجة` : '⚠️ ما لقيت نتائج مطابقة');
            } catch (error) {
                console.error('Shared search failed:', error);
                await writeToolState(msgKey, { ...current, query, mode, page, status: 'empty', results: [], updatedBy: me.name });
                showNotification('⚠️ تعذّر البحث الآن');
            }
        }

        async function runToolAction(msgKey, action, payload) {
            const entry = toolRegistry.get(msgKey);
            if (!entry || !me) return;
            if (entry.tool.kind === 'search' && action === 'search') {
                await runSearchToolAction(msgKey, entry, payload);
                return;
            }
            try {
                await runTransaction(ref(db, `messages/${msgKey}/toolState`), current => {
                    const next = applyToolAction(
                        entry.tool.kind,
                        entry.tool.config || {},
                        current || entry.state || {},
                        action,
                        payload,
                        { user: me.user, name: me.name }
                    );
                    return next === null || next === undefined ? undefined : next;
                }, { applyLocally: true });
            } catch (error) {
                console.error('Tool action failed:', error);
                showNotification('❌ تعذّر تحديث الأداة');
            }
        }

        document.getElementById('chat-flow').addEventListener('click', event => {
            const resultTrigger = event.target.closest('[data-result-url]');
            if (resultTrigger) {
                event.preventDefault();
                event.stopPropagation();
                showChosenResult(resultTrigger);
                return;
            }
            const resultCopy = event.target.closest('[data-result-copy]');
            if (resultCopy) {
                event.preventDefault();
                event.stopPropagation();
                const url = resultCopy.dataset.resultCopy;
                if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(url).then(() => showNotification('📋 نُسخ الرابط')).catch(() => showNotification('⚠️ تعذّر النسخ'));
                }
                return;
            }
            const copyTrigger = event.target.closest('[data-file-copy]');
            if (copyTrigger) {
                event.preventDefault();
                event.stopPropagation();
                const file = fileRegistry.get(copyTrigger.dataset.fileCopy);
                if (!file) return;
                const writePromise = navigator.clipboard?.writeText
                    ? navigator.clipboard.writeText(file.content)
                    : Promise.reject(new Error('clipboard unavailable'));
                writePromise
                    .then(() => showNotification(`📋 نُسخ ${file.name}`))
                    .catch(() => showNotification('⚠️ تعذّر النسخ، افتح الملف وانسخه يدوياً'));
                return;
            }
            const downloadTrigger = event.target.closest('[data-file-download]');
            if (downloadTrigger) {
                event.preventDefault();
                event.stopPropagation();
                const file = fileRegistry.get(downloadTrigger.dataset.fileDownload);
                if (!file) return;
                const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = file.name;
                document.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(link.href), 4000);
                return;
            }
            const trigger = event.target.closest('[data-tool-action]');
            if (!trigger) {
                const menuTrigger = event.target.closest('[data-tool-menu]');
                if (!menuTrigger) return;
                event.preventDefault();
                event.stopPropagation();
                const menuCard = menuTrigger.closest('[data-tool-card]');
                const entry = menuCard ? toolRegistry.get(menuCard.dataset.toolMsg) : null;
                if (entry?.menu) openMenu(menuCard.dataset.toolMsg, entry.menu);
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const card = trigger.closest('[data-tool-card]');
            if (!card || trigger.disabled) return;
            if (trigger.dataset.toolMode === 'visual-tap') spawnVisualBurst(trigger);
            void runToolAction(card.dataset.toolMsg, trigger.dataset.toolAction, collectToolPayload(card, trigger));
        });

        document.getElementById('chat-flow').addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            const input = event.target.closest('[data-tool-input]');
            if (!input) return;
            const card = input.closest('[data-tool-card]');
            const actionButton = card?.querySelector(`[data-tool-action][data-tool-field="${input.dataset.toolInput}"]`);
            if (actionButton) {
                event.preventDefault();
                actionButton.click();
            }
        });

        document.getElementById('chat-flow').addEventListener('change', event => {
            const input = event.target.closest('textarea[data-tool-input]');
            if (!input) return;
            const card = input.closest('[data-tool-card]');
            const actionButton = card?.querySelector(`[data-tool-action][data-tool-field="${input.dataset.toolInput}"]`);
            if (actionButton) actionButton.click();
        });

        window.toggleReaction = async (msgId, emoji) => {
            if (!me) return;
            const reactionPath = `messages/${msgId}/reactions/${emoji}/${me.user}`;
            try {
                const snap = await get(ref(db, reactionPath));
                if (snap.exists()) {
                    await remove(ref(db, reactionPath));
                } else {
                    await set(ref(db, reactionPath), { name: me.name, time: Date.now() });
                }
                hideReactionPicker();
            } catch (e) {
                console.error('Reaction error:', e);
            }
        };

        window.showReactionPicker = (msgId, btnEl) => {
            hideReactionPicker();
            const rect = btnEl.getBoundingClientRect();
            const picker = document.createElement('div');
            picker.className = 'reaction-picker-popup';
            picker.id = 'active-reaction-picker';
            REACTION_EMOJIS.forEach(emoji => {
                const btn = document.createElement('button');
                btn.textContent = emoji;
                btn.onclick = (e) => { e.stopPropagation(); toggleReaction(msgId, emoji); };
                picker.appendChild(btn);
            });
            document.body.appendChild(picker);
            const pickerW = 260;
            let left = rect.left + rect.width / 2 - pickerW / 2;
            if (left < 10) left = 10;
            if (left + pickerW > window.innerWidth - 10) left = window.innerWidth - pickerW - 10;
            picker.style.left = left + 'px';
            picker.style.top = (rect.top - 50) + 'px';
        };

        window.hideReactionPicker = () => {
            const existing = document.getElementById('active-reaction-picker');
            if (existing) existing.remove();
        };

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.reaction-picker-popup') && !e.target.closest('.reaction-add-btn')) {
                hideReactionPicker();
            }
        });

        // تهيئة Firebase عند تحميل الصفحة والتحقق من الجلسة المحفوظة
        document.addEventListener('DOMContentLoaded', async () => {
            loadStoredKeyStatus();
            await initFirebase();
            updateCloudConfigStatus();
            // محاولة تسجيل الدخول التلقائي
            setTimeout(async () => {
                await checkSavedSession();
            }, 1000);
        });

        // ============================================
        // 🛡️ حماية ضد Console Injection
        // ============================================
        // تجميد الإعدادات الحساسة لمنع التعديل من الكونسول
        Object.freeze(REACTION_EMOJIS);

        // حماية الدوال الأمنية من الاستبدال
        Object.defineProperty(window, 'sanitizeHTML', { writable: false, configurable: false });
        Object.defineProperty(window, 'sanitizeURL', { writable: false, configurable: false });
