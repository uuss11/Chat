#!/usr/bin/env bash
# REZA CHAT · إصلاح مفتاح Google Custom Search بأمر واحد
# يفعّل Custom Search API ويضيفه لقيود كل مفاتيح المشروع ثم يختبر البحث فعلياً.
#
#   curl -sL https://uuss11.github.io/Chat/tools/fix-google-key.sh | bash
#
# يحتاج gcloud مصادق عليه (Google Cloud Shell يجهّزه تلقائياً).

set -u

CX_VALUE="${CX_VALUE:-d3704a7eb546d46c5}"
API="customsearch.googleapis.com"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ما لكيت gcloud. شغّله من Google Cloud Shell: https://shell.cloud.google.com"
  exit 1
fi

PROJECT="${PROJECT:-}"
if [ -z "$PROJECT" ]; then
  PROJECT=$(gcloud projects list --filter="name=reza OR projectId=reza" --format="value(projectId)" 2>/dev/null | tr -d '\r' | head -1)
fi
if [ -z "$PROJECT" ]; then
  PROJECT=$(gcloud config get-value project 2>/dev/null | tr -d '\r')
fi
case "$PROJECT" in
  ""|"(unset)") echo "ما لكيت المشروع. شغّل: PROJECT=معرّف_المشروع bash fix-google-key.sh"; exit 1 ;;
esac
echo "▶ المشروع: $PROJECT"
gcloud config set project "$PROJECT" >/dev/null 2>&1

echo "▶ 1/3 تفعيل $API"
gcloud services enable "$API" --project="$PROJECT" || { echo "✖ فشل التفعيل — تأكد من الصلاحيات"; exit 1; }

echo "▶ 2/3 تعديل قيود مفاتيح الـ API"
cat > /tmp/reza_fix_key.py <<'PYEOF'
import json, sys, urllib.request

token = sys.argv[1]
resource = sys.argv[2]
BASE = 'https://apikeys.googleapis.com/v2/'

def rq(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={'Authorization': 'Bearer ' + token,
                                          'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req))

current = rq('GET', BASE + resource)
targets = (current.get('restrictions') or {}).get('apiTargets') or []
services = [t['service'] for t in targets if t.get('service')]
if 'customsearch.googleapis.com' in services:
    print('   = ' + resource.split('/')[-1] + ' : موجود مسبقاً (' + str(len(services)) + ' API)')
else:
    services.append('customsearch.googleapis.com')
    rq('PATCH', BASE + resource + '?updateMask=restrictions',
       {'restrictions': {'apiTargets': [{'service': s} for s in services]}})
    print('   + ' + resource.split('/')[-1] + ' : أضفت customsearch (' + str(len(services)) + ' API)')
PYEOF

TOKEN=$(gcloud auth print-access-token 2>/dev/null | tr -d '\r')
if [ -z "$TOKEN" ]; then echo "✖ ما كدرت أجيب صلاحية gcloud — سجّل دخول أول: gcloud auth login"; exit 1; fi

KEYS=$(gcloud services api-keys list --project="$PROJECT" --format="value(name)" 2>/dev/null | tr -d '\r')
if [ -z "$KEYS" ]; then echo "✖ ما بيه مفاتيح API بهذا المشروع"; exit 1; fi

FIRST_KEY=""
while read -r K; do
  [ -z "$K" ] && continue
  [ -z "$FIRST_KEY" ] && FIRST_KEY="$K"
  python3 /tmp/reza_fix_key.py "$TOKEN" "$K" || echo "   ! فشل تعديل $K"
done <<< "$KEYS"

echo "▶ 3/3 انتظار 60 ثانية ثم اختبار بحث حقيقي"
sleep 60
KEY_VALUE=$(gcloud services api-keys get-key-string "$FIRST_KEY" --format="value(keyString)" 2>/dev/null | tr -d '\r')
RESULT=$(curl -s "https://www.googleapis.com/customsearch/v1?key=${KEY_VALUE}&cx=${CX_VALUE}&q=baghdad&num=2")
if printf '%s' "$RESULT" | grep -q '"items"'; then
  echo "✅ تمام — بحث جوجل يشتغل الآن."
  printf '%s' "$RESULT" | python3 -c "import json,sys;d=json.load(sys.stdin);[print('   •',i['title'][:60]) for i in d.get('items',[])[:3]]" 2>/dev/null
else
  echo "❌ ما زال مردود:"
  printf '%s' "$RESULT" | head -c 320
  echo
  echo "   إذا الظاهر API_KEY_SERVICE_BLOCKED → المشروع غلط، شغّل: PROJECT=المشروع_الصح bash fix-google-key.sh"
  echo "   وإذا الظاهر SERVICE_DISABLED → انتظر 5 دقائق وأعد نفس الأمر."
fi
