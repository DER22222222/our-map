-- ============================================================
-- 搬移：加入「類別」這一層（2026-11-26）
-- 用法：Supabase 後台 → SQL Editor → New query → 整段貼上 → Run
--
-- 改成什麼樣子：
--   類別（有名字、有顏色）
--     ├─ 旅程（多個地點，依日期連成一條線）
--     └─ 單點（單獨的地點，不連線）
--
-- 現有資料怎麼處理（不會掉東西）：
--   每一趟舊的旅程 → 變成一個「同名同色的類別」，
--   並且在那個類別底下保留一趟同名的旅程，原本的地點和路線都不變。
--   之後你可以自己改名、換色、把地點搬成單點。
--
-- 跑之前會先把 trips / places 複製一份到 _backup_* 資料表當保險。
-- 確認新版 app 用起來沒問題後，可以手動把備份刪掉：
--   drop table public._backup_trips_20261126, public._backup_places_20261126;
-- ============================================================

begin;

-- 0. 保險：先備份
create table public._backup_trips_20261126  as select * from public.trips;
create table public._backup_places_20261126 as select * from public.places;
alter table public._backup_trips_20261126  enable row level security;
alter table public._backup_places_20261126 enable row level security;

-- 1. 類別
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  color       text not null default '#e4572e',
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

alter table public.categories enable row level security;
create policy "members only" on public.categories
  for all to authenticated using (public.is_member()) with check (public.is_member());
grant select, insert, update, delete on public.categories to authenticated;

-- 2. 每一趟舊旅程變成一個同名同色的類別
--    沿用同一個 id，待會對應起來最單純
insert into public.categories (id, title, color, created_by, created_at)
  select id, title, color, created_by, created_at from public.trips;

-- 3. 旅程掛到類別底下；顏色改由類別決定
alter table public.trips add column category_id uuid references public.categories(id) on delete cascade;
update public.trips set category_id = id;
alter table public.trips alter column category_id set not null;
alter table public.trips drop column color;
create index on public.trips (category_id);

-- 4. 地點：直接掛類別，trip_id 改成可以是 null（null 就是「單點」）
alter table public.places add column category_id uuid references public.categories(id) on delete cascade;
update public.places p set category_id = t.category_id from public.trips t where p.trip_id = t.id;
alter table public.places alter column category_id set not null;
alter table public.places alter column trip_id drop not null;
create index on public.places (category_id);

commit;

-- 檢查結果
select
  (select count(*) from public.categories) as 類別數,
  (select count(*) from public.trips)      as 旅程數,
  (select count(*) from public.places)     as 地點數,
  (select count(*) from public.places where trip_id is null) as 單點數,
  (select count(*) from public.photos)     as 照片數,
  (select count(*) from public.places where category_id is null) as 沒分到類別的地點;
