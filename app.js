(() => {
'use strict';

const cfg = window.APP_CONFIG || {};
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = ['#e4572e', '#f3a712', '#29a37c', '#2e86ab', '#7b5ea7', '#d1495b', '#3d5a80', '#8a6f4e'];
const BUCKET = 'photos';
const SIGN_TTL = 60 * 60 * 12;          // 照片連結有效 12 小時
const today = () => new Date().toLocaleDateString('sv');   // YYYY-MM-DD（本地時間）

if (!cfg.supabaseUrl || !/^https:\/\//.test(cfg.supabaseUrl) || cfg.supabaseUrl.includes('xxxxxxxx')) {
  document.body.innerHTML = '<div class="setup-msg">還沒設定好喔<br>請先在 <b>config.js</b> 填入 Supabase 的網址和 key</div>';
  return;
}
const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
if (cfg.title) { document.title = cfg.title; $('#login-title').textContent = cfg.title; }

const state = { trips: [], places: [], photos: {}, urls: {}, urlsAt: 0, active: null, user: null };
let map, layer;
let form = null;     // 正在新增或編輯的地點

/* ============ 小工具 ============ */
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return `${y}/${m}/${day}`;
}
function fmtRange(a, b) {
  if (!a) return '';
  if (!b || a === b) return fmtDate(a);
  const [ya] = a.split('-'), [yb, mb, db] = b.split('-').map(Number);
  return ya === String(yb) ? `${fmtDate(a)} – ${mb}/${db}` : `${fmtDate(a)} – ${fmtDate(b)}`;
}
const trip = id => state.trips.find(t => t.id === id);
function byDate(a, b) {
  const da = a.visited_on || '9999-12-31', db = b.visited_on || '9999-12-31';
  if (da !== db) return da < db ? -1 : 1;
  return a.created_at < b.created_at ? -1 : 1;
}
const uuid = () => crypto.randomUUID ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const tripPlaces = id => state.places.filter(p => p.trip_id === id).sort(byDate);

// 讓某個座標出現在畫面上方 40% 處（下面留給面板）
function centerAt(latlng, zoom, ratio = 0.1) {
  map.setView(latlng, zoom ?? map.getZoom(), { animate: false });
  map.panBy([0, map.getSize().y * ratio], { animate: false });
}
function pickPoint() {
  const s = map.getSize();
  return map.containerPointToLatLng([s.x / 2, s.y * 0.4]);
}

/* ============ 底部面板 ============ */
function openSheet(html, { backdrop = true } = {}) {
  const sh = $('#sheet');
  sh.innerHTML = '<div class="grab"></div>' + html;
  sh.scrollTop = 0;
  sh.classList.add('open');
  $('#backdrop').classList.toggle('show', backdrop);
  return sh;
}
function closeSheet() {
  $('#sheet').classList.remove('open');
  $('#backdrop').classList.remove('show');
}

/* ============ 登入 ============ */
async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) start(session.user); else showLogin();
  sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') location.reload(); });
}
function showLogin() {
  $('#login').hidden = false;
  $('#login-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button');
    btn.disabled = true; $('#login-err').textContent = '';
    const { data, error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    btn.disabled = false;
    if (error) { $('#login-err').textContent = '登入失敗：帳號或密碼不對'; return; }
    $('#login').hidden = true;
    start(data.user);
  };
}

/* ============ 啟動 ============ */
function start(user) {
  state.user = user;
  map = L.map('map', { zoomControl: false, worldCopyJump: true }).setView([23.7, 121], 7);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 貢獻者',
  }).addTo(map);
  layer = L.layerGroup().addTo(map);

  map.on('locationfound', e => L.circleMarker(e.latlng, { radius: 7, color: '#fff', weight: 3, fillColor: '#2e86ab', fillOpacity: 1 }).addTo(map));
  map.on('locationerror', () => toast('拿不到目前位置，請確認有開啟定位權限'));

  $('#fab').onclick = startAdd;
  $('#btn-locate').onclick = () => map.locate({ setView: true, maxZoom: 16 });
  $('#btn-menu').onclick = openMenu;
  $('#backdrop').onclick = () => { if (!document.body.classList.contains('picking')) { closeSheet(); form = null; } };
  $('#lightbox').onclick = () => { $('#lightbox').hidden = true; };

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !form) load();   // 回到 App 時抓對方新增的內容
  });
  load(true);
}

/* ============ 讀資料 ============ */
async function load(fit = false) {
  const [t, p, ph] = await Promise.all([
    sb.from('trips').select('*').order('created_at'),
    sb.from('places').select('*'),
    sb.from('photos').select('*').order('sort').order('created_at'),
  ]);
  const err = t.error || p.error || ph.error;
  if (err) { toast('讀取失敗：' + err.message); return; }
  state.trips = t.data; state.places = p.data; state.photos = {};
  for (const x of ph.data) (state.photos[x.place_id] ||= []).push(x);
  if (state.active && !trip(state.active)) state.active = null;
  if (Date.now() - state.urlsAt > SIGN_TTL * 500) { state.urls = {}; state.urlsAt = Date.now(); }
  await signPaths(Object.values(state.photos).map(list => list[0].thumb_path));
  renderTrips();
  renderMap(fit);
}

async function signPaths(paths) {
  const need = [...new Set(paths.filter(p => p && !state.urls[p]))];
  for (let i = 0; i < need.length; i += 100) {
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(need.slice(i, i + 100), SIGN_TTL);
    (data || []).forEach(d => { if (d.signedUrl && d.path) state.urls[d.path] = d.signedUrl; });
  }
}

/* ============ 畫面：旅程列 ============ */
function renderTrips() {
  const chips = $('#chips');
  let html = `<button class="chip ${state.active ? '' : 'active'}" data-id="">全部</button>`;
  for (const t of state.trips) {
    const on = state.active === t.id;
    html += `<button class="chip ${on ? 'active' : ''}" data-id="${t.id}" style="--c:${esc(t.color)}">
      <span class="dot"></span>${esc(t.title)}${on ? '<span class="edit">✎</span>' : ''}</button>`;
  }
  html += `<button class="chip add" data-new="1">＋ 旅程</button>`;
  chips.innerHTML = html;
  chips.querySelectorAll('.chip').forEach(b => b.onclick = () => {
    if (b.dataset.new) return openTripEditor(null);
    const id = b.dataset.id || null;
    if (id && id === state.active) return openTripEditor(id);
    state.active = id;
    renderTrips(); renderMap(true);
    if (id) b.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
  });
}

function renderInfo() {
  const info = $('#info');
  if (!state.active) {
    info.hidden = state.places.length > 0;
    info.textContent = state.trips.length ? '還沒有地點，按下面的「＋ 新增地點」開始吧' : '先建立一趟旅程，再把地點放上地圖';
    return;
  }
  const ps = tripPlaces(state.active);
  const dates = ps.map(p => p.visited_on).filter(Boolean).sort();
  info.hidden = false;
  info.textContent = ps.length
    ? `${ps.length} 個地點${dates.length ? ' · ' + fmtRange(dates[0], dates[dates.length - 1]) : ''}`
    : '這趟旅程還沒有地點';
}

/* ============ 畫面：地圖 ============ */
function renderMap(fit) {
  layer.clearLayers();
  const trips = state.active ? state.trips.filter(t => t.id === state.active) : state.trips;
  const bounds = [];
  for (const t of trips) {
    const ps = tripPlaces(t.id);
    if (ps.length > 1) {
      L.polyline(ps.map(p => [p.lat, p.lng]), { color: t.color, weight: 3, opacity: .85, dashArray: '2 8', lineCap: 'round' }).addTo(layer);
    }
    ps.forEach((p, i) => {
      const ph = state.photos[p.id]?.[0];
      const url = ph && state.urls[ph.thumb_path];
      const html = `<div class="pin${url ? ' has-img' : ''}" style="--c:${esc(t.color)}">${url ? `<img src="${esc(url)}" alt="">` : ''}<b>${i + 1}</b></div>`;
      L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html, iconSize: [44, 44], iconAnchor: [22, 22] }) })
        .on('click', () => openDetail(p.id))
        .addTo(layer);
      bounds.push([p.lat, p.lng]);
    });
  }
  if (fit && bounds.length) {
    map.fitBounds(bounds, { paddingTopLeft: [40, 120], paddingBottomRight: [40, 110], maxZoom: 15 });
  }
  renderInfo();
}

/* ============ 地點詳細 ============ */
async function openDetail(id) {
  const p = state.places.find(x => x.id === id);
  if (!p) return;
  const t = trip(p.trip_id);
  const ps = tripPlaces(p.trip_id);
  const idx = ps.findIndex(x => x.id === id);
  const photos = state.photos[id] || [];
  await signPaths(photos.flatMap(x => [x.path, x.thumb_path]));

  const imgs = photos.map(x => `<figure><img src="${esc(state.urls[x.path] || state.urls[x.thumb_path] || '')}" data-full="${esc(state.urls[x.path] || '')}" loading="lazy" alt=""></figure>`).join('');
  const sh = openSheet(`
    ${photos.length ? `<div class="carousel">${imgs}</div>${photos.length > 1 ? `<div class="counter">1 / ${photos.length}</div>` : ''}` : ''}
    <div class="detail-head"><h2>${esc(p.name || '未命名地點')}</h2></div>
    <div class="meta">
      ${p.visited_on ? `<span>${fmtDate(p.visited_on)}</span>` : ''}
      ${t ? `<span class="tag" style="--c:${esc(t.color)}"><span class="dot"></span>${esc(t.title)} · 第 ${idx + 1} 站</span>` : ''}
    </div>
    <p class="note ${p.note ? '' : 'empty'}">${p.note ? esc(p.note) : '（還沒寫下想說的話）'}</p>
    ${ps.length > 1 ? `<div class="stepper">
      <button class="btn" data-go="${ps[idx - 1]?.id || ''}" ${idx > 0 ? '' : 'disabled'}>← 上一站</button>
      <button class="btn" data-go="${ps[idx + 1]?.id || ''}" ${idx < ps.length - 1 ? '' : 'disabled'}>下一站 →</button>
    </div>` : ''}
    <div class="actions">
      <button class="btn danger" id="d-del">刪除</button>
      <button class="btn primary" id="d-edit">編輯</button>
    </div>`);

  const car = sh.querySelector('.carousel');
  if (car && photos.length > 1) {
    car.addEventListener('scroll', () => {
      const i = Math.round(car.scrollLeft / car.firstElementChild.offsetWidth);
      sh.querySelector('.counter').textContent = `${Math.min(i + 1, photos.length)} / ${photos.length}`;
    }, { passive: true });
  }
  sh.querySelectorAll('.carousel img').forEach(img => img.onclick = () => {
    $('#lightbox img').src = img.dataset.full || img.src;
    $('#lightbox').hidden = false;
  });
  sh.querySelectorAll('[data-go]').forEach(b => b.onclick = () => b.dataset.go && openDetail(b.dataset.go));
  $('#d-edit').onclick = () => startEdit(id);
  $('#d-del').onclick = () => deletePlace(id);

  centerAt([p.lat, p.lng], Math.max(map.getZoom(), 13), Math.min(sh.offsetHeight / map.getSize().y, 0.9) / 2);
}

async function deletePlace(id) {
  const p = state.places.find(x => x.id === id);
  if (!confirm(`確定要刪除「${p?.name || '這個地點'}」嗎？照片也會一起刪掉。`)) return;
  const paths = (state.photos[id] || []).flatMap(x => [x.path, x.thumb_path]);
  if (paths.length) await sb.storage.from(BUCKET).remove(paths);
  const { error } = await sb.from('places').delete().eq('id', id);
  if (error) return toast('刪除失敗：' + error.message);
  closeSheet();
  toast('已刪除');
  load();
}

/* ============ 新增 / 編輯地點 ============ */
function startAdd() {
  if (!state.trips.length) { toast('先建立一趟旅程吧'); return openTripEditor(null, true); }
  form = {
    id: null, lat: null, lng: null, name: '', note: '', visited_on: today(),
    trip_id: state.active || [...state.trips].pop().id,
    keep: [], removed: [], files: [],
  };
  enterPick();
}
function startEdit(id) {
  const p = state.places.find(x => x.id === id);
  form = { ...p, keep: [...(state.photos[id] || [])], removed: [], files: [] };
  openForm();
}

/* --- 第一步：在地圖上選位置 --- */
function enterPick() {
  document.body.classList.add('picking');
  if (form.lat != null) centerAt([form.lat, form.lng], Math.max(map.getZoom(), 15));
  const sh = openSheet(`
    <h2>${form.id ? '調整位置' : '這張合照在哪裡拍的？'}</h2>
    <div class="sub" style="margin:-8px 0 12px">移動地圖，把紅色圖釘對準地點</div>
    <div class="search"><input id="p-q" type="search" placeholder="搜尋地名，例如：清水寺" enterkeyhint="search"></div>
    <ul class="results" id="p-res"></ul>
    <div class="pick-tools">
      ${form.id ? '' : '<label class="btn" style="display:grid;place-items:center">📷 用照片的位置<input type="file" id="p-photo" accept="image/*" multiple hidden></label>'}
      <button class="btn" id="p-me">📍 我現在的位置</button>
    </div>
    <div class="actions">
      <button class="btn" id="p-cancel">取消</button>
      <button class="btn primary" id="p-ok">就是這裡</button>
    </div>`, { backdrop: false });

  const q = $('#p-q', sh), res = $('#p-res', sh);
  let timer;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => search(q.value, res), 450); });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); search(q.value, res); q.blur(); } });

  $('#p-me', sh).onclick = () => {
    if (!navigator.geolocation) return toast('這個瀏覽器不支援定位');
    navigator.geolocation.getCurrentPosition(
      pos => centerAt([pos.coords.latitude, pos.coords.longitude], 17),
      () => toast('拿不到目前位置，請確認有開啟定位權限'),
      { enableHighAccuracy: true, timeout: 10000 });
  };
  const pf = $('#p-photo', sh);
  if (pf) pf.onchange = () => usePhotoLocation([...pf.files]);
  $('#p-cancel', sh).onclick = () => {
    document.body.classList.remove('picking');
    if (form.id) openForm(); else { form = null; closeSheet(); }
  };
  $('#p-ok', sh).onclick = async () => {
    const c = pickPoint().wrap();
    form.lat = +c.lat.toFixed(6); form.lng = +c.lng.toFixed(6);
    document.body.classList.remove('picking');
    if (!form.name) {
      $('#p-ok', sh).disabled = true; $('#p-ok', sh).textContent = '查詢地名…';
      form.name = await reverseName(form.lat, form.lng);
    }
    openForm();
  };
}

async function search(text, res) {
  text = text.trim();
  if (text.length < 2) { res.innerHTML = ''; return; }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=zh-TW,zh,en&q=${encodeURIComponent(text)}`);
    const list = await r.json();
    if (!list.length) { res.innerHTML = '<li><small>找不到，換個關鍵字試試</small></li>'; return; }
    res.innerHTML = list.map((x, i) => {
      const parts = x.display_name.split(',').map(s => s.trim());
      return `<li data-i="${i}">${esc(x.name || parts[0])}<small>${esc(parts.slice(1, 4).join(', '))}</small></li>`;
    }).join('');
    res.querySelectorAll('li[data-i]').forEach(li => li.onclick = () => {
      const x = list[+li.dataset.i];
      form.name = x.name || x.display_name.split(',')[0];
      centerAt([+x.lat, +x.lon], 17);
      res.innerHTML = '';
    });
  } catch { res.innerHTML = '<li><small>搜尋失敗，請檢查網路</small></li>'; }
}

async function reverseName(lat, lng) {
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=zh-TW,zh,en&lat=${lat}&lon=${lng}`, { signal: ctl.signal });
    const x = await r.json();
    const a = x.address || {};
    return x.name || a.attraction || a.tourism || a.amenity || a.road || a.suburb || a.city || a.town || '';
  } catch { return ''; }
}

async function usePhotoLocation(files) {
  if (!files.length) return;
  form.files.push(...files);
  let found = false;
  for (const f of files) {
    try {
      const gps = await exifr.gps(f);
      if (gps && isFinite(gps.latitude)) {
        centerAt([gps.latitude, gps.longitude], 17);
        found = true;
        try {
          // exifr lite 版不支援 pick（會丟 undefined is not iterable），要整包 parse
          const meta = await exifr.parse(f);
          if (meta?.DateTimeOriginal instanceof Date) form.visited_on = meta.DateTimeOriginal.toLocaleDateString('sv');
        } catch { /* 日期讀不到就算了，位置已經抓到 */ }
        break;
      }
    } catch { /* 有些格式讀不到 EXIF，略過 */ }
  }
  toast(found
    ? `已加入 ${files.length} 張照片，地圖移到拍照位置了`
    : `已加入 ${files.length} 張照片，但照片沒有位置資訊，請手動移動地圖`, 3500);
}

/* --- 第二步：填內容 --- */
function openForm() {
  document.body.classList.remove('picking');
  const tripOpts = state.trips.map(t => `<option value="${t.id}" ${t.id === form.trip_id ? 'selected' : ''}>${esc(t.title)}</option>`).join('');
  const sh = openSheet(`
    <h2>${form.id ? '編輯地點' : '新增地點'}</h2>
    <label class="field"><span>旅程</span><select id="f-trip">${tripOpts}</select></label>
    <label class="field"><span>地點名稱</span><input id="f-name" value="${esc(form.name)}" placeholder="例如：清水寺"></label>
    <div class="loc-row"><span>📍 ${form.lat?.toFixed(4)}, ${form.lng?.toFixed(4)}</span><button class="small-btn" id="f-repick">改位置</button></div>
    <label class="field"><span>日期</span><input id="f-date" type="date" value="${esc(form.visited_on || '')}"></label>
    <div class="field"><span>照片</span><div class="thumbs" id="f-thumbs"></div></div>
    <label class="field"><span>想說的話</span><textarea id="f-note" rows="4" placeholder="那天發生了什麼…">${esc(form.note)}</textarea></label>
    <div class="actions">
      <button class="btn" id="f-cancel">取消</button>
      <button class="btn primary" id="f-save">儲存</button>
    </div>`);
  renderThumbs();
  $('#f-repick', sh).onclick = () => { syncForm(); enterPick(); };
  $('#f-cancel', sh).onclick = () => { const id = form.id; form = null; id ? openDetail(id) : closeSheet(); };
  $('#f-save', sh).onclick = save;
}

function syncForm() {
  form.trip_id = $('#f-trip').value;
  form.name = $('#f-name').value.trim();
  form.visited_on = $('#f-date').value || null;
  form.note = $('#f-note').value.trim();
}

function renderThumbs() {
  const box = $('#f-thumbs');
  form._objUrls?.forEach(u => URL.revokeObjectURL(u));
  form._objUrls = form.files.map(f => URL.createObjectURL(f));
  box.innerHTML =
    form.keep.map((x, i) => `<div class="t"><img src="${esc(state.urls[x.thumb_path] || '')}" alt=""><button class="x" data-k="${i}">✕</button></div>`).join('') +
    form._objUrls.map((u, i) => `<div class="t"><img src="${u}" alt=""><button class="x" data-f="${i}">✕</button></div>`).join('') +
    `<label class="add"><div><b>＋</b>加照片</div><input type="file" accept="image/*" multiple hidden></label>`;
  box.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { form.removed.push(...form.keep.splice(+b.dataset.k, 1)); renderThumbs(); });
  box.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { form.files.splice(+b.dataset.f, 1); renderThumbs(); });
  const inp = box.querySelector('input');
  inp.onchange = () => { form.files.push(...inp.files); renderThumbs(); };
}

async function resize(file, max, quality) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    src = await new Promise((ok, fail) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => fail(new Error(`無法讀取照片「${file.name}」，請換成 JPG 或 PNG`));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = src.width, h = src.height, s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise(ok => c.toBlob(ok, 'image/jpeg', quality));
}

async function save() {
  syncForm();
  const btn = $('#f-save');
  const setBtn = t => { btn.textContent = t; };
  btn.disabled = true; setBtn('儲存中…');
  try {
    const row = { trip_id: form.trip_id, name: form.name, lat: form.lat, lng: form.lng, visited_on: form.visited_on, note: form.note };
    let placeId = form.id;
    if (placeId) {
      const { error } = await sb.from('places').update(row).eq('id', placeId);
      if (error) throw error;
    } else {
      const { data, error } = await sb.from('places').insert(row).select().single();
      if (error) throw error;
      placeId = form.id = data.id;   // 之後上傳失敗按「再試一次」不會重複新增
    }

    if (form.removed.length) {
      await sb.storage.from(BUCKET).remove(form.removed.flatMap(x => [x.path, x.thumb_path]));
      const { error } = await sb.from('photos').delete().in('id', form.removed.map(x => x.id));
      if (error) throw error;
      form.removed = [];
    }

    let sort = form.keep.length ? Math.max(...form.keep.map(x => x.sort)) + 1 : 0;
    const total = form.files.length;
    while (form.files.length) {
      setBtn(`上傳照片 ${total - form.files.length + 1} / ${total}…`);
      const f = form.files[0];
      const [full, thumb] = await Promise.all([resize(f, 1800, 0.84), resize(f, 360, 0.78)]);
      const base = `${placeId}/${uuid()}`;
      const up1 = await sb.storage.from(BUCKET).upload(`${base}.jpg`, full, { contentType: 'image/jpeg' });
      if (up1.error) throw up1.error;
      const up2 = await sb.storage.from(BUCKET).upload(`${base}_t.jpg`, thumb, { contentType: 'image/jpeg' });
      if (up2.error) throw up2.error;
      const { data, error } = await sb.from('photos').insert({ place_id: placeId, path: `${base}.jpg`, thumb_path: `${base}_t.jpg`, sort: sort++ }).select().single();
      if (error) throw error;
      form.keep.push(data);
      form.files.shift();
    }

    form._objUrls?.forEach(u => URL.revokeObjectURL(u));
    form = null;
    if (state.active && state.active !== row.trip_id) state.active = row.trip_id;
    await load();
    toast('已儲存 ✓');
    openDetail(placeId);
  } catch (e) {
    console.error(e);
    toast('儲存失敗：' + (e.message || e), 4000);
    btn.disabled = false; setBtn('再試一次');
  }
}

/* ============ 旅程 ============ */
function openTripEditor(id, thenAdd = false) {
  const t = id ? trip(id) : null;
  let color = t?.color || COLORS[state.trips.length % COLORS.length];
  const sh = openSheet(`
    <h2>${t ? '編輯旅程' : '新的旅程'}</h2>
    <label class="field"><span>旅程名稱</span><input id="t-title" value="${esc(t?.title || '')}" placeholder="例如：2025 京都五日"></label>
    <div class="field"><span>路線顏色</span><div class="swatches">${COLORS.map(c => `<button style="--c:${c}" data-c="${c}" class="${c === color ? 'on' : ''}" aria-label="${c}"></button>`).join('')}</div></div>
    <div class="actions">
      ${t ? '<button class="btn danger" id="t-del">刪除旅程</button>' : '<button class="btn" id="t-cancel">取消</button>'}
      <button class="btn primary" id="t-save">${t ? '儲存' : '建立'}</button>
    </div>`);
  sh.querySelectorAll('.swatches button').forEach(b => b.onclick = () => {
    color = b.dataset.c;
    sh.querySelectorAll('.swatches button').forEach(x => x.classList.toggle('on', x === b));
  });
  if (!t) setTimeout(() => $('#t-title').focus(), 300);
  $('#t-cancel', sh)?.addEventListener('click', closeSheet);
  $('#t-save', sh).onclick = async () => {
    const title = $('#t-title').value.trim();
    if (!title) return toast('幫這趟旅程取個名字吧');
    $('#t-save').disabled = true;
    const q = t
      ? sb.from('trips').update({ title, color }).eq('id', t.id).select().single()
      : sb.from('trips').insert({ title, color }).select().single();
    const { data, error } = await q;
    if (error) { $('#t-save').disabled = false; return toast('儲存失敗：' + error.message); }
    state.active = data.id;
    closeSheet();
    await load(true);
    if (thenAdd) startAdd();
  };
  $('#t-del', sh)?.addEventListener('click', async () => {
    const n = tripPlaces(t.id).length;
    if (!confirm(`確定要刪除「${t.title}」嗎？${n ? `裡面的 ${n} 個地點和所有照片都會一起刪掉。` : ''}`)) return;
    const paths = tripPlaces(t.id).flatMap(p => (state.photos[p.id] || []).flatMap(x => [x.path, x.thumb_path]));
    for (let i = 0; i < paths.length; i += 100) await sb.storage.from(BUCKET).remove(paths.slice(i, i + 100));
    const { error } = await sb.from('trips').delete().eq('id', t.id);
    if (error) return toast('刪除失敗：' + error.message);
    state.active = null;
    closeSheet();
    load(true);
  });
}

/* ============ 選單 ============ */
function openMenu() {
  const nPhotos = Object.values(state.photos).reduce((s, l) => s + l.length, 0);
  const sh = openSheet(`
    <h2>${esc(cfg.title || '我們的地圖')}</h2>
    <p class="sub">${state.trips.length} 趟旅程 · ${state.places.length} 個地點 · ${nPhotos} 張照片</p>
    <p class="sub">目前登入：${esc(state.user?.email || '')}</p>
    <div class="actions" style="margin-top:16px">
      <button class="btn" id="m-reload">重新整理</button>
      <button class="btn danger" id="m-out">登出</button>
    </div>`);
  $('#m-reload', sh).onclick = () => { closeSheet(); load(true); };
  $('#m-out', sh).onclick = () => sb.auth.signOut();
}

init();
})();
