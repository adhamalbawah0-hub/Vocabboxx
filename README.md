# VocabBox — دليل النشر كتطبيق ويب حقيقي

هذا المشروع نفس تطبيق VocabBox اللي بنيناه، لكن مُعدّل ليعمل كتطبيق ويب مستقل حقيقي
(مش artifact جوه Claude.ai) — بمتصفح حقيقي متصل بالإنترنت، ويعمل Offline فعليًا.

## إيه اللي اتغيّر عن نسخة الـ artifact؟

كانت هناك حاجتان فقط تعتمدان على بيئة Claude.ai تحديدًا، وتم استبدالهما بمكافئ حقيقي:

| في الـ artifact | في هذا المشروع |
|---|---|
| `window.storage` (يوفرها Claude.ai) | IndexedDB حقيقي (`src/storagePolyfill.js`) — بنفس الواجهة تمامًا، فكود `App.jsx` لم يتغيّر تقريبًا |
| استدعاء `api.anthropic.com` مباشرة بدون مفتاح (Claude.ai يحقنه تلقائيًا) | دالة خادم (`api/claude.js`) تحمي المفتاح الحقيقي على السيرفر، والمتصفح يناديها هي بدل Anthropic مباشرة |

كل باقي الكود (الكلمات، Leitner، القصص، المحادثة، إلخ) **لم يتغيّر إطلاقًا**.

---

## الخطوات (الطريقة الأسهل: Vercel — مجاني)

### 1. جهّز حساب Anthropic API
اذهب إلى https://console.anthropic.com واحصل على مفتاح API (يبدأ بـ `sk-ant-...`).
⚠️ لا تضع هذا المفتاح أبدًا في كود الواجهة الأمامية أو في ملف تم رفعه لـ GitHub.

### 2. ارفع المشروع على GitHub
```bash
cd vocabbox-deploy
git init
git add .
git commit -m "VocabBox — نسخة قابلة للنشر"
# أنشئ مستودع جديد فارغ على GitHub ثم:
git remote add origin https://github.com/USERNAME/vocabbox.git
git push -u origin main
```

### 3. اربطه بـ Vercel
1. اذهب إلى https://vercel.com وسجّل دخول (يمكن عبر GitHub مباشرة)
2. اضغط "Add New Project" واختر المستودع اللي رفعته
3. Vercel هتكتشف تلقائيًا إنه مشروع Vite + مجلد `api/` — لا تحتاج أي إعداد يدوي
4. **قبل الضغط على Deploy**: اذهب لـ Environment Variables وأضف:
   - Name: `ANTHROPIC_API_KEY`
   - Value: المفتاح اللي جبته من الخطوة 1
5. اضغط Deploy

بعد دقيقة أو اتنين هيديك رابط حقيقي (`https://vocabbox-xxxx.vercel.app`) شغال بالكامل، بمتصفح حقيقي، متصل بالإنترنت فعليًا.

---

## التجربة محليًا قبل النشر (اختياري)

```bash
cd vocabbox-deploy
npm install
npx vercel dev   # يشغّل الواجهة + دالة api/ سوا محليًا
```
(استخدم `vercel dev` بدل `npm run dev` العادي، عشان `api/claude.js` تشتغل محليًا برضه —
هتحتاج `npm i -g vercel` مرة واحدة، وتربط حساب Vercel، وتحط `ANTHROPIC_API_KEY` في ملف `.env.local`)

---

## بديل: النشر على Netlify بدل Vercel
لو تفضّل Netlify:
1. انقل محتوى `api/claude.js` إلى `netlify/functions/claude.js` (نفس الكود، لكن الـ export بيبقى:
   `export const handler = async (event) => { ... return { statusCode, body: JSON.stringify(data) } }`
   — الشكل مختلف شوية عن Vercel، محتاج تعديل بسيط في التوقيع)
2. غيّر رابط الـ fetch في `App.jsx` من `/api/claude` إلى `/.netlify/functions/claude`
3. أضف `ANTHROPIC_API_KEY` في Netlify → Site settings → Environment variables

---

## تحسينات اختيارية بعد النشر (مش ضرورية للتشغيل)

- **رفع حد `max_tokens`**: في نسخة الـ artifact كان مضبوط على 1000 توكن إجباريًا (قيد من بيئة Claude.ai).
  دلوقتي إنت المتحكم بالكامل — ممكن ترفعه في `generateWordData` و`callClaudeJSON` (داخل `App.jsx`)
  لتحليل قصص أعمق بنداء واحد بدل تعدد النداءات لكل جزء.
- **حماية إضافية**: أضف Rate Limiting بسيط على `api/claude.js` لو التطبيق هيبقى عام للجميع
  (حاليًا أي زائر لموقعك يقدر يستهلك رصيد الـ API بتاعك بلا حدود).
- **نسخ احتياطي سحابي حقيقي**: التصدير/الاستيراد الحالي (JSON يدوي) شغال 100%،
  لكن لو حبيت مزامنة تلقائية بين أجهزة، هتحتاج قاعدة بيانات خلفية حقيقية (مثل Supabase أو Firebase)
  بدل الاعتماد على IndexedDB المحلي فقط.

---

## بنية الملفات

```
vocabbox-deploy/
├── api/claude.js          ← دالة الخادم (تحمي مفتاح API)
├── public/
│   ├── manifest.json      ← PWA — يسمح بتثبيت التطبيق على الشاشة الرئيسية
│   ├── sw.js               ← Service Worker حقيقي (تخزين واجهة التطبيق للعمل Offline)
│   └── icon.svg
├── src/
│   ├── App.jsx             ← نفس كود VocabBox بالكامل (مع تعديل مسارين فقط لرابط API)
│   ├── main.jsx             ← نقطة الدخول + تركيب بديل التخزين
│   └── storagePolyfill.js   ← IndexedDB حقيقي بنفس واجهة window.storage
├── index.html
├── package.json
└── vite.config.js
```
