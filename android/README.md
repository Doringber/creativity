# Pango GO — Android (WebView wrapper)

A minimal Android app that runs the Pango GO AR game inside a `WebView`.
Android's WebView keeps the camera much more stable than mobile Safari, so the
iOS "blue flash" doesn't occur here. This is also the easiest way to embed the
game inside your existing Pango app.

## בנייה והרצה (Android Studio — מומלץ)
1. פתח את התיקייה **`android/`** ב-Android Studio (Open → בחר את `android`).
2. Android Studio יוריד Gradle/SDK וייצור את ה-wrapper אוטומטית (Sync).
3. חבר מכשיר אנדרואיד (או אמולטור) → **Run ▶**.
4. בכניסה הראשונה תופיע בקשת **הרשאת מצלמה** → אשר.

> בנייה מה-CLI: צריך Gradle מותקן (`gradle wrapper` ליצירת ה-wrapper פעם אחת),
> ואז `./gradlew assembleDebug`. ב-Android Studio זה אוטומטי.

## מה כבר מוגדר
- `INTERNET` + `CAMERA` ב-Manifest, והרשאת מצלמה מועברת ל-WebView
  (`onPermissionRequest` + בקשת runtime).
- `domStorageEnabled` (ל-localStorage: פנגודקס/מטבעות/שיאים),
  `mediaPlaybackRequiresUserGesture=false`, מסך מלא immersive, ושמירת מסך דלוק.
- חיישני תנועה (ג'יירו) עובדים אוטומטית ב-WebView מעל HTTPS — בלי בקשת הרשאה.

## להחליף לכתובת שלכם
ב-`app/src/main/java/co/pango/pangogo/MainActivity.kt`:
```kotlin
const val GAME_URL = "https://doringber.github.io/creativity/"
```
החלף לדומיין HTTPS שלכם (למשל subdomain של Pango). **חובה HTTPS** — המצלמה לא
עובדת מעל HTTP.

### אופציה: לארוז את המשחק אופליין (בלי תלות ברשת)
השתמש ב-`WebViewAssetLoader` (כבר תלוי דרך `androidx.webkit`) כדי להגיש את
קבצי המשחק מתוך ה-APK על `https://appassets.androidplatform.net/` — זה
context מאובטח, אז המצלמה עובדת גם ללא אינטרנט. מעתיקים את קבצי המשחק
(index.html, css, js, assets, icons) ל-`app/src/main/assets/` ומחברים loader.
אפשר שאוסיף את זה אם תרצו.

## לשלב באפליקציית Pango הקיימת
אתם כבר פותחים מצלמה ל-QR — אפשר לפתוח את המשחק כ-Activity/Fragment עם WebView,
או אפילו מתוך סריקת QR (סורקים קוד → פותח את ה-WebView עם המשחק). הליבה:
```kotlin
webView.settings.apply {
    javaScriptEnabled = true
    domStorageEnabled = true
    mediaPlaybackRequiresUserGesture = false
}
webView.webChromeClient = object : WebChromeClient() {
    override fun onPermissionRequest(r: PermissionRequest) { r.grant(r.resources) }
}
webView.loadUrl("https://<your-domain>/")
```
(ודאו שהרשאת `CAMERA` של האפליקציה ניתנה ב-runtime לפני הטעינה.)

## חלופה: פרסום בחנות כ-TWA (PWA → אפליקציה)
המשחק כבר PWA, אז אפשר לעטוף כ-**Trusted Web Activity**:
1. **PWABuilder.com** → הדבק את כתובת המשחק → הורד חבילת Android.
2. הוסף **Digital Asset Links** (`/.well-known/assetlinks.json`) באתר לאימות הדומיין.
TWA רץ ב-Chrome מתחת למכסה → מצלמה/ג'יירו/PWA במלואם, ומוכן ל-Play Store.

## הערות
- `applicationId`/`namespace` = `co.pango.pangogo` — שנו לפי הצורך.
- אייקון: וקטור זמני (`res/drawable/ic_launcher.xml`) — החליפו באייקון Pango האמיתי.
- מומלץ `compileSdk 34`, `minSdk 24`, JDK 17.
