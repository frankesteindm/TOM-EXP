-- =========================================================
-- TOMORO COFFEE EXPIRY MONITOR - SUPABASE SETUP
-- Jalankan seluruh script ini di Supabase > SQL Editor
-- =========================================================

create extension if not exists pgcrypto;

-- 1) Workspace / outlet
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- 2) Membership: satu user dapat menjadi anggota workspace/outlet
create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner','admin','staff')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- 3) Produk expiry
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  batch text,
  category text,
  location text,
  qty numeric,
  unit text,
  expiry_at timestamptz not null,
  note text,
  warning_minutes integer not null default 10 check (warning_minutes >= 0),
  status text not null default 'active' check (status in ('active','used','discarded')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_workspace on public.products(workspace_id);
create index if not exists idx_products_expiry on public.products(expiry_at);

-- 4) Helper: cek membership
create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.workspace_members wm
    where wm.workspace_id = ws
      and wm.user_id = auth.uid()
  );
$$;

-- 5) RLS
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.products enable row level security;

-- Bersihkan policy lama jika script dijalankan ulang
drop policy if exists "members can view workspace" on public.workspaces;
drop policy if exists "members can view memberships" on public.workspace_members;
drop policy if exists "members can read products" on public.products;
drop policy if exists "members can insert products" on public.products;
drop policy if exists "members can update products" on public.products;
drop policy if exists "members can delete products" on public.products;

create policy "members can view workspace"
on public.workspaces
for select
to authenticated
using (public.is_workspace_member(id));

create policy "members can view memberships"
on public.workspace_members
for select
to authenticated
using (public.is_workspace_member(workspace_id));

create policy "members can read products"
on public.products
for select
to authenticated
using (public.is_workspace_member(workspace_id));

create policy "members can insert products"
on public.products
for insert
to authenticated
with check (
  public.is_workspace_member(workspace_id)
  and created_by = auth.uid()
);

create policy "members can update products"
on public.products
for update
to authenticated
using (public.is_workspace_member(workspace_id))
with check (
  public.is_workspace_member(workspace_id)
  and updated_by = auth.uid()
);

create policy "members can delete products"
on public.products
for delete
to authenticated
using (public.is_workspace_member(workspace_id));

-- 6) Grants untuk browser client
grant usage on schema public to authenticated;
grant select on public.workspaces to authenticated;
grant select on public.workspace_members to authenticated;
grant select, insert, update, delete on public.products to authenticated;

-- 7) Realtime / Postgres Changes
-- Jika products belum berada di publication, tambahkan.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'products'
  ) then
    execute 'alter publication supabase_realtime add table public.products';
  end if;
end
$$;

-- =========================================================
-- SETELAH MEMBUAT USER DI Authentication > Users,
-- buat workspace dan hubungkan user tersebut.
--
-- CONTOH:
--
-- insert into public.workspaces(name)
-- values ('TOMORO Bintaro')
-- returning id;
--
-- Lalu copy UUID workspace hasil di atas.
--
-- Cari UUID user dari Authentication > Users, lalu:
--
-- insert into public.workspace_members(workspace_id, user_id, role)
-- values (
--   'UUID_WORKSPACE_DI_SINI',
--   'UUID_USER_DI_SINI',
--   'owner'
-- );
--
-- Untuk user kedua/ketiga yang harus melihat data outlet yang sama:
--
-- insert into public.workspace_members(workspace_id, user_id, role)
-- values
-- ('UUID_WORKSPACE_YANG_SAMA', 'UUID_USER_2', 'staff'),
-- ('UUID_WORKSPACE_YANG_SAMA', 'UUID_USER_3', 'staff');
-- =========================================================
