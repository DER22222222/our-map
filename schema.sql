-- ============================================================
-- 地圖相簿：Supabase 資料庫設定
-- 用法：Supabase 後台 → SQL Editor → New query → 整段貼上 → Run
-- 執行前先把下面兩個 email 改成你們兩個人的（請用小寫）
-- ============================================================

-- 1. 允許使用的帳號（只有這裡列出的 email 能讀寫資料）
create table public.members (
  email text primary key
);

insert into public.members (email) values
  ('you@example.com'),
  ('her@example.com');

create or replace function public.is_member()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
    where email = lower(auth.jwt() ->> 'email')
  );
$$;

-- 2. 資料表
create table public.trips (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  color       text not null default '#e4572e',
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create table public.places (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  name        text not null default '',
  lat         double precision not null,
  lng         double precision not null,
  visited_on  date,
  note        text not null default '',
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create table public.photos (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid not null references public.places(id) on delete cascade,
  path        text not null,
  thumb_path  text not null,
  sort        int  not null default 0,
  created_at  timestamptz not null default now()
);

create index on public.places (trip_id);
create index on public.photos (place_id);

-- 3. 權限：只有 members 裡的帳號能存取
alter table public.members enable row level security;  -- 不開任何 policy：外部完全讀不到名單
alter table public.trips   enable row level security;
alter table public.places  enable row level security;
alter table public.photos  enable row level security;

create policy "members only" on public.trips
  for all to authenticated using (public.is_member()) with check (public.is_member());
create policy "members only" on public.places
  for all to authenticated using (public.is_member()) with check (public.is_member());
create policy "members only" on public.photos
  for all to authenticated using (public.is_member()) with check (public.is_member());

-- 3b. 資料表層級的權限
-- RLS 只決定「哪些列看得到」，還要 GRANT 才有資料表的使用權。
-- 建專案時如果沒勾「Grant API access to new tables automatically」，
-- 新表預設不會給 authenticated 權限，app 會收到 42501 permission denied。
-- members 故意不給權限：is_member() 是 security definer，由它代為讀取。
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.trips  to authenticated;
grant select, insert, update, delete on public.places to authenticated;
grant select, insert, update, delete on public.photos to authenticated;

-- 4. 照片儲存空間（私人，不公開）
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false);

create policy "members read photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and public.is_member());
create policy "members upload photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and public.is_member());
create policy "members update photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and public.is_member());
create policy "members delete photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and public.is_member());
