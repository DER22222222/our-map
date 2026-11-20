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
- 地圖：Leaflet 1.9.4（unpkg）+ CARTO Voyager 圖磚（OpenStreetMap 資料）
- 後端：Supabase（登入、Postgres、Storage），supabase-js v2 從 jsdelivr 載入
- 地名搜尋和反查：Nominatim（`accept-language=zh-TW`）
- 讀照片 EXIF（GPS、拍攝日期）：exifr lite 7（jsdelivr）
- 照片上傳前在瀏覽器用 canvas 壓縮：原圖長邊 1800px（JPEG 0.84），縮圖 360px（0.78），縮圖當地圖標記用
- 照片 bucket 是私人的，用 `createSignedUrls` 取得 12 小時的連結
- 有 PWA manifest 和圖示，可以加到手機主畫面

## 資料庫（schema.sql）
- `members(email)`：允許名單；`is_member()` 是 security definer 函式，檢查 `auth.jwt()->>'email'`
- `trips(id, title, color, created_by, created_at)`
- `places(id, trip_id → trips on delete cascade, name, lat, lng, visited_on date, note, ...)`
- `photos(id, place_id → places on delete cascade, path, thumb_path, sort, ...)`
- 所有資料表都開了 RLS，policy 為 `to authenticated using (is_member())`；storage bucket `photos` 也一樣
- Storage 路徑：`{place_id}/{uuid}.jpg` 和 `{place_id}/{uuid}_t.jpg`
- 刪除地點或旅程時，app 會先刪 storage 檔案再刪資料列（資料列靠 cascade 一起刪）

## app.js 主要流程
- `init` → 有 session 就 `start`，沒有就顯示登入畫面（email + 密碼）
- `load()`：抓 trips、places、photos，產生縮圖的 signed URL，畫出旅程列和地圖
- 上方旅程列：「全部」＋每趟旅程；點一下已選中的旅程會開啟編輯（改名、換色、刪除）
- 新增地點分兩步：
  1. `enterPick()`：準心固定在畫面高度 40% 的位置，可以搜尋、定位，或「用照片的位置」讀 EXIF
  2. `openForm()`：填旅程、名稱、日期、照片、想說的話，然後 `save()`
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

## 部署待辦（使用者自己要做，README.md 有步驟）
1. 建立 Supabase 專案，把 `schema.sql` 裡的兩個 email 改成他們的，執行 SQL
2. 建立兩人的帳號（Auto Confirm），然後關掉公開註冊
3. 在 `config.js` 填 Project URL 和 Publishable key（絕對不要放 service_role 或 secret key）
4. 推上 GitHub，開啟 Pages（main / root）

## 可以考慮的後續功能（使用者還沒要求）
- 照片排序或設定封面、地點拖曳排序
- 用 Supabase Realtime 即時同步
- 在「從檔案選」的入口加入 iPhone、Android 的操作提示
