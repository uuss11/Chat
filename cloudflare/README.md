# نشر Cloudflare Worker · REZA CHAT API

الملف: `cloudflare/chat-api-worker.js`

## 1) الطريقة الأسرع (لصق يدوي بدون أي أداة)

1. افتح <https://dash.cloudflare.com> ← **Workers & Pages** ← **Create** ← **Worker**.
2. اسم الـ Worker: `reza-chat-api` ثم **Deploy**.
3. اضغط **Edit code**، احذف الكود الافتراضي، والصق كامل محتوى `chat-api-worker.js`، ثم **Deploy**.
4. من **Settings ← Variables and Secrets** أضف:

| الاسم | النوع | القيمة |
|---|---|---|
| `FIREBASE_API_KEY` | Secret | `AIza...` |
| `FIREBASE_AUTH_DOMAIN` | Secret | `reza-3d325.firebaseapp.com` |
| `FIREBASE_DB_URL` | Secret | `https://reza-3d325-default-rtdb.europe-west1.firebasedatabase.app` |
| `FIREBASE_PROJECT_ID` | Secret | `reza-3d325` |
| `FIREBASE_STORAGE_BUCKET` | Secret | `reza-3d325.appspot.com` |
| `FIREBASE_SENDER_ID` | Secret | رقم المرسل |
| `FIREBASE_APP_ID` | Secret | معرّف التطبيق |
| `GOOGLE_API_KEY` | Secret | مفتاح Google Custom Search (اختياري) |
| `GOOGLE_CX` | Secret | معرّف محرك البحث (اختياري) |
| `OPENROUTER_KEYS` | Secret | مفتاح أو أكثر مفصولة بفاصلة `key1,key2` |
| `ALLOWED_ORIGINS` | Variable | `https://uuss11.github.io` |

5. الرابط النهائي يصير: `https://reza-chat-api.<حسابك>.workers.dev`
   - فحص: افتح الرابط ← يجب أن يرد `{"ok":true,...}`
   - الإعدادات: `https://reza-chat-api.<حسابك>.workers.dev/config`

## 2) الطريقة الآلية (توكن API)

تحتاج توكن من <https://dash.cloudflare.com/profile/api-tokens> بصلاحية
**Account → Workers Scripts → Edit**، وبعدها:

```bash
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts/reza-chat-api" \
  -H "Authorization: Bearer <TOKEN>" \
  -F 'metadata={"main_module":"chat-api-worker.js","compatibility_date":"2026-01-01"};type=application/json' \
  -F 'chat-api-worker.js=@cloudflare/chat-api-worker.js;type=application/javascript+module'
```

ثم الأسرار:

```bash
echo -n '<VALUE>' | curl -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts/reza-chat-api/secrets" \
  -H "Authorization: Bearer <TOKEN>" -H 'Content-Type: application/json' \
  --data '{"name":"OPENROUTER_KEYS","text":"<VALUE>","type":"secret_text"}'
```

## 3) المسارات

| المسار | الوصف |
|---|---|
| `GET /health` | فحص سريع |
| `GET /config` | إعدادات فايربيس + قدرات الموقع (بدون أي مفتاح سري) |
| `POST /search` | `{query,mode:"web"\|"images",page}` ← بحث جوجل |
| `POST /ai` | `{model,messages,maxTokens}` ← OpenRouter بتدوير المفاتيح |

## 4) ملاحظة أمنية مهمة

إعدادات فايربيس في مواقع الويب **ليست سرّية بطبيعتها** — أي أحد يفتح الموقع يقدر يشوفها.
الأمان الحقيقي يجي من **قواعد فايربيس** (`Realtime Database → Rules`) ومن نقل
**مفاتيح OpenRouter ومفاتيح جوجل** إلى أسرار الـ Worker (هذا الملف) حتى ما تبقى مقروءة
من قاعدة البيانات العامة. بعد نشر الـ Worker، احذف مفاتيح OpenRouter المخزّنة في
`ai_config` داخل قاعدة البيانات واعتمد على الـ Worker فقط.
