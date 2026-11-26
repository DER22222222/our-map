# 我們的地圖（map-album）— 交接筆記

給接手的 Claude Code：這份筆記整理了在 claude.ai 對話中做好的決定和目前進度。請用**繁體中文**和使用者溝通。

## 專案目標
使用者和女朋友兩個人共用的「地圖相簿」網站：在世界地圖上標地點，上傳合照、寫一段話，並依「旅程」把地點連成路線。

## 已確定的需求
- **使用者**：只有兩個人（使用者和女朋友），兩人都能新增、編輯、刪除；其他人不能看
- **地圖**：全世界，要能看到街道層級
- **部署**：自己架在 GitHub Pages（使用者 GitHub：DER22222222）
- **每個地點**：多張照片、日期、一段話；依日期連成旅程路線
- **路線**：分成多趟「旅程」，每趟有自己的顏色和路線
- **介面**：手機優先，全中文

## 技術架構
- 純前端（沒有 build step）：`index.html`、`style.css`、`app.js`、`config.js`
- 地圖：Leaflet 1.9.4（unpkg）+ **OpenStreetMap 官方圖磚**（`tile.openstreetmap.org`，maxZoom 19）
  - 原本用 CARTO Voyager，2026-11-21 實測發現 **CARTO 免金鑰的圖磚已經停用**：不管 referer 是什麼，回傳的都是 2KB 的「API KEY REQUIRED」浮水印圖（HTTP 200，不是 403），所以已改掉。不要改回去。
- 後端：Supabase（登入、Postgres、Storage），supabase-js v2 從 jsdelivr 載入
- 地名搜尋和反查：Nominatim（`accept-language=zh-TW`）
- 讀照片 EXIF（GPS、拍攝日期）：exifr lite 7（jsdelivr）
- 照片上傳前在瀏覽器用 canvas 壓縮：原圖長邊 1800px（JPEG 0.84），縮圖 360px（0.78），縮圖當地圖標記用
- 照片 bucket 是私人的，用 `createSignedUrls` 取得 12 小時的連結
- 有 PWA manifest 和圖示，可以加到手機主畫面

## 資料庫（schema.sql）
**三層結構**（2026-11-26 改的）：類別 →（旅程 → 地點）或（直接是單點）
- `members(email)`：允許名單；`is_member()` 是 security definer 函式，檢查 `auth.jwt()->>'email'`
- `categories(id, title, color, created_by, created_at)`：**顏色在這一層**，名字和顏色都可自訂
- `trips(id, category_id → categories on delete cascade, title, ...)`：**沒有 color 欄位**，顏色跟著類別走
- `places(id, category_id → categories on delete cascade, trip_id → trips on delete cascade **可為 null**, name, lat, lng, visited_on date, note, ...)`
  - `trip_id` 是 null＝**單點**：照常顯示在地圖上，但不編號、不連進任何路線
  - `trip_id` 有值＝屬於那趟旅程，依日期排序後連成虛線並標上站號
- `photos(id, place_id → places on delete cascade, path, thumb_path, sort, ...)`
- 所有資料表都開了 RLS，policy 為 `to authenticated using (is_member())`；storage bucket `photos` 也一樣
- Storage 路徑：`{place_id}/{uuid}.jpg` 和 `{place_id}/{uuid}_t.jpg`
- 刪除地點或旅程時，app 會先刪 storage 檔案再刪資料列（資料列靠 cascade 一起刪）

## app.js 主要流程
- `init` → 有 session 就 `start`，沒有就顯示登入畫面（email + 密碼）
- `load()`：抓 trips、places、photos，產生縮圖的 signed URL，畫出旅程列和地圖
- 上方有**兩排**：第一排是類別（`renderChips`），選了類別之後第二排才出現，是那個類別底下的旅程（`renderSubChips`）
  - 兩排都是「點一下已選中的那個就開啟編輯」：類別可改名、換色、刪除；旅程只能改名、刪除（顏色由類別決定）
  - 第二排還會顯示「單點 N」當作數量提示，那顆是 disabled 的，不能點
- 新增地點分兩步：
  1. `enterPick()`：準心固定在畫面高度 40% 的位置，可以搜尋、定位，或「用照片的位置」讀 EXIF
  2. `openForm()`：填**類別**、**放在哪裡**（「單獨一個點（不連線）」或該類別底下的某趟旅程）、名稱、日期、照片、想說的話，然後 `save()`
     - 換類別時 `renderTripOptions()` 會重畫「放在哪裡」，並把 `trip_id` 歸零
- `save()` 在新增地點後就把 `form.id` 設好，照片逐張上傳並移進 `form.keep`，所以失敗後「再試一次」不會重複新增
- 詳細頁：照片輪播（scroll-snap）、全螢幕燈箱、上一站／下一站、編輯、刪除
- App 回到前景（`visibilitychange`）時會重新載入，才看得到對方新增的內容

## 測試狀態
- 用模擬的 Supabase（in-memory）在 390×844 手機尺寸跑過 Playwright 冒煙測試：建旅程、搜尋、新增地點、上傳 2 張照片、反查地名、路線連線、刪照片、選單、刪旅程（含 cascade 和 storage 清除），console 沒有錯誤
- 測試中修掉的 bug：
  - Leaflet 的 CSS（`.leaflet-container .leaflet-marker-pane img { width:auto }`）把標記照片撐成原尺寸，已改成 `.leaflet-container .pin img { width/height: 100% !important }`
  - 非 secure context 沒有 `crypto.randomUUID`，已加上 fallback 的 `uuid()`
  - 上傳失敗按「再試一次」會重複新增地點，已修正
- **還沒接過真的 Supabase**，第一次部署後要實測

## 照片 GPS：原檔確定有，問題在 exifr 的用法（2026-11-20 查清）
- **原檔 EXIF 確實有 GPS**。用 USB（MTP，「This PC」底下的 POCO F6 裝置）把 `DCIM/Camera/IMG_20261118_131751.jpg`（3072×4096、2,708,746 bytes）複製到電腦後讀出來：
  - `GPSLatitude 24°47'44.67696" N`、`GPSLongitude 120°59'37.44348" E` → 24.7957436, 120.9937343（新竹）
  - `DateTimeOriginal 2026:11:18 13:17:51`、`Make Xiaomi`、`Model POCO F6`、共 75 個 EXIF 欄位
  - MTP 列整個 Camera 資料夾會超過兩分鐘，要用 `GetFolder.ParseName('檔名')` 直接取檔
- **真正的 bug：exifr lite 版不支援 `pick`**。`exifr.parse(file, ['DateTimeOriginal'])` 一定會丟 `undefined is not iterable`，因為 lite 版沒帶 tag 字典。改成不給選項的 `exifr.parse(file)` 就好，輸出會包含 `latitude`、`longitude`、`DateTimeOriginal`、`Make`、`Model` 和所有 `GPS*` 欄位（這個檔案 61 個）。`exifr.gps(file)` 本來就正常。
  - `app.js` 的 `usePhotoLocation()` 已修：改用 `exifr.parse(f)`，並把日期那段包進自己的 try，免得丟錯時跳過 `break`
  - `tools-exif-test.html` 已修兩個 bug：同樣的 `pick` 用法，以及 **`diag` 這個變數從來沒定義**——每選一張照片就 ReferenceError，整張卡片都不會 render，所以之前一直拿不到診斷結果
- **已實測**：本機起 HTTP 伺服器載入修好的 `tools-exif-test.html`，餵進手機原檔 → 「✓ 讀得到位置 24.79574, 120.99373」、拍攝時間 2026/11/18 下午1:17:51、相機 Xiaomi POCO F6、61 個欄位、11 個 GPS 欄位、無錯誤。app.js 那條路徑也驗過：`visited_on` 會得到 `2026-11-18`（Asia/Taipei）
- **還沒確認**：Android Chrome 從相簿挑照片時會不會把 GPS 拿掉（沒有 ACCESS_MEDIA_LOCATION 時系統會遮蔽位置）。這要等部署後在使用者手機上實測；在那之前不要假設它是壞的——之前的「讀不到」有很大機會就是上面那兩個 bug
- 透過 Claude App 上傳的照片會被壓縮（1449×2576），EXIF 全被清掉，不能用來測

## 真的 Supabase 上的端對端實測（2026-11-21，全部通過）

在本機 `python -m http.server` + 手機尺寸 375x812，連真正的 Supabase 跑完整條路：

| 步驟 | 結果 |
|---|---|
| 登入 | ✅ 用 members 名單裡的帳號（真實 email 只在 schema.local.sql）|
| 建旅程 | ✅ 「測試旅程（可刪）」寫進 trips |
| 📷 用照片的位置 | ✅ 餵進手機原檔，地圖直接跳到 24.7957, 120.9937（陽明交大光復校區）|
| EXIF 日期自動帶入 | ✅ `visited_on` = 2026-11-18（就是修好的那個 bug）|
| Nominatim 中文反查 | ✅ 地點名稱自動填「光復路二段」|
| 照片壓縮＋上傳 | ✅ 2.71 MB → 192 KB，存成 `{place_id}/{uuid}.jpg` 和 `_t.jpg` |
| 私人 bucket 簽名連結 | ✅ `createSignedUrls` 取得的連結 fetch 回 200 |
| 地圖標記縮圖 | ✅ 正常顯示 |
| 重新載入後 | ✅ 30 個資源、0 個失敗、console 無錯誤 |

**所以「照片 GPS 讀不到」在桌面瀏覽器上已經確定解決了**——原因就是 exifr lite 不支援 pick，不是 Android 拿掉 GPS。
唯一還沒驗的是：Android Chrome 從相簿挑照片時，系統會不會因為沒有 ACCESS_MEDIA_LOCATION 而遮蔽位置。
這要等推上 GitHub Pages 後，在使用者手機上實測。

### 刪除按鈕沒反應：native confirm() 會被擋掉

使用者回報「旅程刪不掉」。按下「刪除旅程」完全沒反應，也沒有錯誤訊息。

原因不是權限——用 client 直接打 `storage.remove()` + `trips.delete()` 完全正常。
問題是 `window.confirm()` 在部分瀏覽器／內嵌環境會被自動取消並**立刻回傳 false**
（在 Claude 的瀏覽器窗格裡實測就是這樣），程式走到 `if (!confirm(...)) return;` 就安靜地結束了。

已改成 app 自己的確認視窗 `askConfirm()`（`index.html` 的 `#confirm` + `style.css` 的樣式 + `app.js` 的 Promise helper），
兩個呼叫端（刪地點、刪旅程）都換掉了。**不要再用 native confirm()／alert()／prompt()。**

實測：確認視窗正常跳出 → 按刪除 → 旅程、地點、照片、storage 檔案全部清掉（trips/places/photos 都是 0，bucket 也空了），cascade 和 storage 清理都正確。

測試資料已經全部刪乾淨，資料庫現在是空的。

## 2026-11-26 的三項修改

### 1. 照片會超出圓形標記（已修）
`.pin` 是 `display:grid` 而且列高 auto，所以 `.pin img` 的 `height:100%` 變成**循環參照**，
瀏覽器退回 `auto`＝依寬度和原始比例算高度。實測：3000×4000 的直式照片在 44×44 的 pin 裡算成 **39×52**，
400×3000 更誇張，算成 39×294。**手機拍的大多是直式，所以很容易遇到。**
改成 `position:absolute; inset:0` 讓圖片貼著 `.pin` 的 padding box 撐滿，百分比就不再循環。
選擇器也從 `.leaflet-container .pin img` 改成 `.pin img`，這樣 pin 用在地圖以外的地方也不會爆
（舊的寫法在 `.leaflet-container` 外完全不生效，圖片會用原始尺寸）。
`!important` 要留著，是為了壓過 Leaflet 的 `.leaflet-marker-pane img { width:auto }`。
實測 5 種比例 ×（地圖內／外）共 10 個，全部 39×39、零溢出、編號角標也還在。

### 2. 加入「類別」這一層
見上面的「資料庫」段落。

**migration 已經在正式環境跑完了（2026-11-27）**，結果：
- 2 個類別：台北木柵尋寶趣 `#8a6f4e`、補吃生日餐！ `#7b5ea7`（名字和顏色都從舊 trips 沿用）
- 2 趟旅程（站數 5 和 1）、6 個地點、10 張照片，數量跟跑之前一樣，沒有孤兒資料
- 備份留在 `_backup_trips_20261126`（2 筆）和 `_backup_places_20261126`（6 筆）。
  確認用一陣子沒問題後可以 `drop table` 掉。
- Supabase 會對 `drop column` 和不帶 WHERE 的 `UPDATE` 跳「destructive operations」確認，那是正常的

**線上也驗過了**（真資料、手機尺寸）：類別顏色正確、選類別後第二排出現、
5 站那趟連線顏色是 `#8a6f4e` 並編號 1–5、只有 1 站的那趟不畫線、切回「全部」顯示 6 個標記。
**標記溢出也用他們真的照片驗過：6 張裡有 4 張是直式（270×360），全部 39×39、零溢出。**

如果之後要在新專案重建，`schema.sql` 已經是新結構，不必再跑 migration。
`migrate-categories.sql` 只有在「舊結構的既有資料」才需要
（每一趟舊旅程 → 一個同名同色的類別，底下保留一趟同名旅程，地點和路線都不變；
跑之前會自動備份到 `_backup_trips_20261126` / `_backup_places_20261126`）。

**順序很重要：先跑 migration，再部署新版 app。** 反過來的話 app 會查不到 `categories` 這張表。

用假的 in-memory Supabase（`scratchpad/mock/mock.js`，有模擬 cascade）在 375×812 跑過：
建類別、建旅程、類別／旅程兩層篩選、單點不連線也不編號、旅程連線並編號 1..N、
把單點改成旅程的一站（編號變 1..4）、刪旅程（底下地點 cascade，其他類別的單點不受影響）、
刪類別（整包清掉）、表單換類別時旅程清單跟著換。console 無錯誤。

### 3. 改名
標題「我們的地圖」→「**回憶地圖**」（`config.js`、`index.html` 的 title 和 apple-mobile-web-app-title、
`manifest.json` 的 name/short_name、`app.js` 的預設值），登入畫面的副標「只有我們兩個能看」整行刪掉，
順手把因此沒用到的 `#login-form p` 樣式也拿掉。

## 部署狀態（2026-11-21）

Supabase **已經設定完成並實測通過**，專案 `our-map`（Region: Northeast Asia / Tokyo）：
- Project URL `https://jqjlxfcrwcuihpezrhph.supabase.co`，publishable key 已填進 `config.js` 並 commit
- 資料表、RLS、政策、私人 photos bucket 都建好；members 名單是兩個人的 email
- 兩個帳號都建好（Auto Confirm），公開註冊已關閉

**踩到的坑：RLS 之外還要 GRANT。** 建專案時沒勾「Grant API access to new tables automatically」，
所以新表沒有給 `authenticated` 角色權限，app 收到 `42501 permission denied for table trips`，
畫面症狀是旅程建不起來、console 一堆 403。`schema.sql` 已經補上 `-- 3b. 資料表層級的權限` 那段 GRANT，
之後在新專案重跑整份 schema 就不會再遇到。`members` 故意不給權限（靠 security definer 的 `is_member()` 代讀）。

**還沒做的只剩 GitHub：**
1. 開一個 public repo（本機 git 已經 init 好、也 commit 了，見 README 步驟 4）
2. `git remote add origin ...` 然後 `git push -u origin main`
3. Settings → Pages → main / root

## 可以考慮的後續功能（使用者還沒要求）
- 照片排序或設定封面、地點拖曳排序
- 用 Supabase Realtime 即時同步
- 在「從檔案選」的入口加入 iPhone、Android 的操作提示
