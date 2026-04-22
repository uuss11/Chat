import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
        import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";
        import { getDatabase, ref, set, get, push, onValue, query, limitToLast, remove, update, serverTimestamp, onDisconnect } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

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
        function sanitizeURL(url) {
            if (!url) return '';
            const trimmed = String(url).trim();
            if (/^javascript:/i.test(trimmed) || /^data:text\/html/i.test(trimmed) || /^vbscript:/i.test(trimmed)) {
                return '';
            }
            return trimmed;
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
        const firebaseConfig = {
            apiKey: "AIzaSyBvGWF0u83mrdtBTLWgGV-ExuO6-4j-1Xk",
            authDomain: "reza-3d325.firebaseapp.com",
            databaseURL: "https://reza-3d325-default-rtdb.europe-west1.firebasedatabase.app",
            projectId: "reza-3d325",
            storageBucket: "reza-3d325.firebasestorage.app",
            messagingSenderId: "454599070550",
            appId: "1:454599070550:web:48f519a98dcf302bbe3cf7",
            measurementId: "G-Z6951JPFL2"
        };

        let app, db, analytics;
        let me = null, activeMsg = null, isEdit = false, replyData = null, forwardData = null;
        let dbAiConfig = null;
        const processedAiMsgs = new Set();
        let isInitialLoad = true;
        let currentTheme = 'ocean';
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
            errorText.innerHTML = message;
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

        // تهيئة Firebase
        function initFirebase() {
            try {
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

        avatarInput.addEventListener('input', (e) => {
            const url = e.target.value.trim();
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
            });
        });

        window.toggleTheme = () => {
            const themes = ['ocean', 'purple', 'sunset', 'emerald', 'rose', 'gold', 'midnight', 'cherry', 'arctic', 'lavender', 'neon', 'coffee'];
            const currentIndex = themes.indexOf(currentTheme);
            const nextIndex = (currentIndex + 1) % themes.length;
            currentTheme = themes[nextIndex];
            document.body.setAttribute('data-theme', currentTheme);
            document.querySelectorAll('.theme-option').forEach(o => o.classList.toggle('active', o.dataset.theme === currentTheme));
            showNotification(`تم تغيير الثيم إلى ${getThemeName(currentTheme)}`);
        };

        const getThemeName = (theme) => ({ ocean: '🌊 أوشن', purple: '👑 بنفسجي', sunset: '🌅 غروب', emerald: '💎 زمرد', rose: '🌹 وردي', gold: '✨ ذهبي', midnight: '🌙 منتصف الليل', cherry: '🍒 كرزي', arctic: '❄️ جليدي', lavender: '💜 لافندر', neon: '💚 نيون', coffee: '☕ قهوة' }[theme]);

        function showNotification(text) {
            const notif = document.getElementById('notification');
            document.getElementById('notification-text').textContent = text;
            notif.classList.add('show');
            setTimeout(() => notif.classList.remove('show'), 3000);
        }

        // === دوال مساعدة بريميوم ===
        const REACTION_EMOJIS = ['❤️', '👍', '😂', '😢', '😮', '🔥'];

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
            for (const emoji of REACTION_EMOJIS) {
                if (reactions[emoji]) {
                    const users = Object.keys(reactions[emoji]);
                    const count = users.length;
                    if (count > 0) {
                        const isMine = me && users.includes(me.user);
                        html += `<span class="reaction-chip ${isMine ? 'my-reaction' : ''}" onclick="event.stopPropagation(); toggleReaction('${msgKey}', '${emoji}')"><span class="r-emoji">${emoji}</span><span class="r-count">${count}</span></span>`;
                    }
                }
            }
            html += `<span class="reaction-add-btn" onclick="event.stopPropagation(); showReactionPicker('${msgKey}', this)"><i class="far fa-smile"></i></span></div>`;
            return html;
        }

        // ✅ دالة تسجيل الدخول / إنشاء الحساب
        window.attemptLogin = async () => {
            const uid = document.getElementById('user-id').value.trim().toLowerCase();
            const pass = document.getElementById('user-pass').value;
            const name = document.getElementById('user-display').value.trim() || uid;
            const avatar = document.getElementById('user-avatar').value.trim();
            const loginBtn = document.getElementById('login-btn');
            
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
                if (!initFirebase()) {
                    return;
                }
            }

            // تعطيل الزر وإظهار التحميل
            loginBtn.disabled = true;
            document.getElementById('loading-overlay').style.display = 'flex';
            document.getElementById('error-box').classList.remove('show');

            loadingTimeout = setTimeout(() => {
                hideLoading();
                showError('⏱️ انتهى وقت الانتظار! تحقق من:<br>1. اتصالك بالإنترنت<br>2. إعدادات Firebase<br>3. Firebase Rules');
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
                    initFirebase();
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
                    if (m.isImage) {
                        const safeImgUrl = sanitizeURL(m.txt) || '';
                        const safeImgAttr = sanitizeHTML(safeImgUrl);
                        content = `<img src="${safeImgAttr}" class="bubble-image" onclick="openImageModal('${safeImgAttr}')" alt="صورة">`;
                        if (m.caption) content += `<div class="image-caption">${sanitizeHTML(m.caption)}</div>`;
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
                        <div class="bubble ${isBanned ? 'banned-msg' : ''}" onclick="openMenu('${sanitizeHTML(child.key)}', ${safeM})">
                            ${m.reply ? `<div class="reply-preview"><span class="reply-name">${sanitizeHTML(m.reply.name)}</span><div class="reply-text">${sanitizeHTML(m.reply.txt.substring(0, 50))}${m.reply.txt.length > 50 ? '...' : ''}</div></div>` : ''}
                            ${content}
                        </div>
                        ${renderReactions(child.key, m.reactions)}
                    `;
                    flow.appendChild(div);

                    // AI Logic - 🔐 فقط جهاز المالك يقدر يرسل ردود AI
                    if (!isInitialLoad && dbAiConfig && dbAiConfig.apiKey && me.user === 'reza') {
                        if (!processedAiMsgs.has(child.key) && m.uid !== 'naz_ai') {
                            processedAiMsgs.add(child.key);
                            
                            // التحقق أن الرسالة جديدة (بعد وقت دخول المالك) لتجنب الرد على رسائل قديمة 
                            // تظهر بسبب إزاحة النافذة عند حذف رسائل أخرى
                            const isNewMessage = m.time >= joinTime;
                            
                            if (isNewMessage && !m.aiResponded) {
                                const isMention = (m.txt && !m.forwarded && (m.txt.toLowerCase().includes('@naz') || m.txt.includes('ناز')));
                                const isReplyToNaz = (!m.forwarded && m.reply && (m.reply.name === (dbAiConfig.name || 'NAZ Ai') || m.reply.name === 'NAZ Ai'));
                                
                                if (isMention || isReplyToNaz) {
                                    triggerAiResponse(child.key, m.txt, m.name);
                                }
                            }
                        }
                    }
                });
                
                if (isInitialLoad) {
                    snap.forEach(child => processedAiMsgs.add(child.key));
                    isInitialLoad = false;
                }
                
                document.getElementById('stats-total-messages').textContent = msgCount;
                document.getElementById('stats-total-images').textContent = imgCount;
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
            return url.match(/\.(jpeg|jpg|gif|png|webp|svg)(\?.*)?$/i) != null || 
                   url.includes('catbox.moe') ||
                   url.includes('imgur.com') ||
                   url.includes('ibb.co');
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

        // --- إعدادات الذكاء الاصطناعي ---
        function loadAiConfig() {
            onValue(ref(db, 'ai_config'), snap => {
                if (snap.exists()) {
                    dbAiConfig = snap.val();
                    console.log('✅ AI config loaded successfully for user:', me?.user);
                    // ملء حقول الإعدادات للمالك فقط
                    if (me && me.user === 'reza') {
                        document.getElementById('ai-name').value = dbAiConfig.name || '';
                        document.getElementById('ai-api-key').value = dbAiConfig.apiKey || '';
                        document.getElementById('ai-model').value = dbAiConfig.model || '';
                        document.getElementById('ai-avatar').value = dbAiConfig.avatar || '';
                        if (dbAiConfig.avatar) {
                            document.getElementById('ai-avatar-preview').src = dbAiConfig.avatar;
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
        };

        window.saveAiConfig = async () => {
            const name = document.getElementById('ai-name').value.trim() || 'NAZ Ai';
            const apiKey = document.getElementById('ai-api-key').value.trim();
            const model = document.getElementById('ai-model').value.trim() || 'meta-llama/llama-3-8b-instruct';
            const avatar = document.getElementById('ai-avatar').value.trim() || getDefaultAvatarUrl('NAZ');
            
            if (!apiKey) {
                alert('يرجى وضع API Key');
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
                    apiKey, 
                    model, 
                    avatar,
                    _authToken: token
                });
                showNotification('تم حفظ إعدادات الذكاء الاصطناعي بنجاح! 🤖');
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
            
            // إعادة التحقق من قاعدة البيانات لمنع التكرار من عدة أجهزة
            try {
                const msgCheck = await get(ref(db, `messages/${messageKey}/aiResponded`));
                if (msgCheck.exists() && msgCheck.val() === true) {
                    console.log('⏭️ Message already responded to, skipping');
                    return;
                }
            } catch (e) {
                console.warn('Could not verify aiResponded status, proceeding anyway');
            }
            
            // وضع علامة فوراً لمنع أي جهاز ثاني من الرد
            try {
                await update(ref(db, `messages/${messageKey}`), { aiResponded: true });
            } catch (e) {
                console.warn('Could not set aiResponded flag');
            }
            
            showNotification('NAZ Ai يكتب الآن... 🤖');
            console.log(`🤖 AI triggered by ${userName}: "${userMessage}"`);
            
            const prompt = `أنتِ فتاة اسمك ${dbAiConfig.name || 'ناز'} (NAZ)، عمرك 18 سنة، وأنتِ من العراق وتحديداً من بغداد منطقة المنصور.
مطورك ومبرمجك ومالكك هو شخص اسمه رضا (reza).
تتحدثين باللهجة العراقية بطلاقة. لا مانع لديك من أن تكوني قاسية، وقحة، أو تستخدمي السب والشتم العادي إذا استدعى الأمر.
أنتِ تتواجدين في غرفة دردشة اسمها REZA CHAT. 
ملاحظات هامة: 
- لا تقومي بتعريف نفسك أو ذكر تفاصيلك (مثل اسمك، عمرك، مدينتك، أو مالكك) إلا إذا سألك المستخدم عنها صراحة.
- ردي بشكل مباشر وطبيعي، وبدون ذكر اسمك في البداية بشكل آلي.

اسم المستخدم الذي يكلمك هو: ${userName}
رسالة المستخدم هي: "${userMessage}"`;

            try {
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${dbAiConfig.apiKey}`,
                        'HTTP-Referer': 'https://uuss11.github.io/Chat/',
                        'X-Title': 'REZA CHAT',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: dbAiConfig.model || 'meta-llama/llama-3-8b-instruct',
                        messages: [{ role: 'user', content: prompt }]
                    })
                });
                const data = await response.json();
                console.log('🤖 OpenRouter response:', data);
                if (data.choices && data.choices.length > 0) {
                    const aiText = data.choices[0].message.content.trim();
                    await push(ref(db, 'messages'), {
                        uid: 'naz_ai',
                        name: dbAiConfig.name || 'NAZ Ai',
                        txt: aiText,
                        time: serverTimestamp(),
                        avatar: dbAiConfig.avatar || getDefaultAvatarUrl('NAZ'),
                        isImage: false
                    });
                    console.log('✅ AI response sent successfully');
                } else {
                     console.error("OpenRouter Error", data);
                     showNotification('❌ NAZ Ai فشل في الرد');
                }
            } catch (e) {
                console.error("AI fetch error: ", e);
                showNotification('❌ خطأ في الاتصال بـ NAZ Ai');
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
            }, (error) => {
                console.error('Members listener error:', error);
            });
        }

        window.toggleMembers = () => {
            document.getElementById('members-sidebar').classList.toggle('open');
        };

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

        document.getElementById('msg-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

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
                    indicator.querySelector('span').innerHTML = `<span class="typing-name">${nameText}</span> ${typingUsers.length === 1 ? 'يكتب' : 'يكتبون'}`;
                } else {
                    indicator.style.display = 'none';
                }
            }, () => {});
        }

        // === نظام الريأكشنات ===
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
            initFirebase();
            // محاولة تسجيل الدخول التلقائي
            setTimeout(async () => {
                await checkSavedSession();
            }, 1000);
        });

        // ============================================
        // 🛡️ حماية ضد Console Injection
        // ============================================
        // تجميد الإعدادات الحساسة لمنع التعديل من الكونسول
        Object.freeze(firebaseConfig);
        Object.freeze(REACTION_EMOJIS);

        // حماية الدوال الأمنية من الاستبدال
        Object.defineProperty(window, 'sanitizeHTML', { writable: false, configurable: false });
        Object.defineProperty(window, 'sanitizeURL', { writable: false, configurable: false });