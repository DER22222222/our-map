# 我們的地圖 📍

兩個人的地圖相簿。把合照放在拍照的地點，寫一段話，依旅程把地點連成路線。手機優先，可以加到主畫面當 App 用。

## 功能

- 全世界地圖，可以縮放到街道層級（OpenStreetMap / CARTO）
- **旅程**：每趟旅程有自己的顏色，地點依日期自動連成路線並編號
- **地點**：名稱、日期、多張照片（左右滑）、一段話；點照片可以全螢幕看
- 新增地點的三種方式：搜尋地名、移動地圖對準、**直接用照片裡的 GPS 位置**（日期也會一起帶入）
- 詳細頁可以「上一站 / 下一站」，照著旅程順序瀏覽
- 照片上傳前會先在手機上壓縮（長邊 1800px），另外存一張小縮圖當地圖標記
- 只有你們兩個的帳號能登入，照片存在私人空間，別人拿到網址也看不到

---

## 設定步驟（大約 10 分鐘）

### 1. 建立 Supabase 專案

1. 到 <https://supabase.com> 註冊並 **New project**（Region 選 Tokyo 或 Singapore，離台灣比較近）
2. 進專案後左邊選 **SQL Editor → New query**
3. 打開 **`schema.local.sql`**（這份已經填好你的 email，只要把 `her@example.com` 換成女朋友的，請用小寫），整段貼上按 **Run**

> GitHub Pages 免費方案只支援 **public** repo，所以 repo 裡的東西任何人都看得到。`schema.sql` 留的是假 email 當樣板，真實 email 只寫在 `schema.local.sql`，`.gitignore` 會擋住它不讓它被 commit。**不要**把真實 email 填回 `schema.sql`。

### 2. 建立你們兩個人的帳號

1. 左邊 **Authentication → Users → Add user → Create new user**
2. 輸入 email 和密碼，勾選 **Auto Confirm User**，建兩個帳號（email 要跟 `schema.local.sql` 裡的一樣）
3. **關掉公開註冊**：**Authentication → Sign In / Providers**，把 **Allow new users to sign up** 關掉

> 就算忘了關註冊，陌生人註冊後也讀不到任何資料，因為資料庫只認 `members` 名單裡的 email。關掉只是多一層保險。

### 3. 填設定檔

1. **Project Settings → API**（或 **API Keys**），複製：
   - Project URL
   - **Publishable key**（舊專案叫 `anon` `public` key）
2. 打開 `config.js`，把這兩個值貼進去

> 這個 key 本來就設計成可以公開，放進 GitHub 沒問題。**千萬不要**貼 `service_role` 或 `secret` key。

### 4. 放上 GitHub Pages

先在 GitHub 開一個 **public** 的新 repo（名字例如 `our-map`），**不要**勾 Add a README。本機的 git 已經初始化好、第一版也 commit 過了，所以只要接上遠端再推上去：

```bash
git remote add origin https://github.com/DER22222222/our-map.git
git push -u origin main
```

到 GitHub repo → **Settings → Pages** → Source 選 **Deploy from a branch**，Branch 選 `main` / `/ (root)` → Save。
一兩分鐘後網址會是 `https://DER22222222.github.io/our-map/`。

之後只要改了 `config.js` 或任何檔案，推上去 Pages 就會自動更新：

```powershell
git add . ; git commit -m "更新" ; git push
```

### 5. 加到手機主畫面

- **iPhone**：用 Safari 打開網址 → 分享 → 加入主畫面
- **Android**：用 Chrome 打開 → 右上選單 → 加到主畫面

---

## 使用小提醒

- **照片沒有帶到位置？** iPhone 從相簿選照片時，要點上方的「選項」把「位置」打開，網頁才讀得到 GPS
- **Android（POCO F6）**：原檔的 EXIF 裡確實有 GPS，但系統的相片挑選器有可能把位置遮掉。如果從相簿選讀不到，改用檔案管理（「檔案」或「我的檔案」）從 `DCIM/Camera` 選原檔試試；也可以打開 `tools-exif-test.html` 看診斷訊息
- 點上面已經選中的旅程（有 ✎ 的那個），可以改名、換顏色或刪除
- 沒有日期的地點會排在旅程的最後面
- 從背景切回 App 時會自動重新整理，看得到對方剛新增的內容

## 本機測試

用 `file://` 直接開會被瀏覽器擋，要開一個本機伺服器：

```powershell
python -m http.server 8000
# 打開 http://localhost:8000（你這台機器上要用 python，不是 python3）
```

## 檔案說明

| 檔案 | 用途 |
|---|---|
| `index.html` | 頁面結構 |
| `style.css` | 樣式（手機優先） |
| `app.js` | 主要程式：地圖、登入、旅程、地點、上傳 |
| `config.js` | Supabase 網址和 key |
| `schema.sql` | 資料庫資料表、權限、照片空間（樣板，email 是假的） |
| `schema.local.sql` | 填了真實 email 的版本，只留在本機、不會上 GitHub |
| `manifest.json`、`icon-*.png` | 加到主畫面用的設定和圖示 |

## 免費額度

Supabase 免費方案有 1 GB 檔案空間、500 MB 資料庫。壓縮後一張照片大約 300–500 KB，可以放 2000 張以上。
注意：免費專案**連續一週沒人使用會被暫停**，到後台按一下就能恢復，資料不會不見。
