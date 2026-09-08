begin;
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
set local search_path = public, extensions;

create table public.logo_vehicles (
 id text primary key check (length(id) between 1 and 100), label text not null
);
insert into public.logo_vehicles values ('huracan-stl-v1','Huracán — lambo+H.stl — calibration v1');
alter table public.logo_vehicles enable row level security;
create policy "Read vehicle catalogue" on public.logo_vehicles for select to anon, authenticated using (true);
revoke all on public.logo_vehicles from anon, authenticated;
grant select on public.logo_vehicles to anon, authenticated;

-- Public placement data only: emails remain in auth.users.
create table public.logo_placements (
 id uuid primary key default gen_random_uuid(),
 vehicle_id text not null references public.logo_vehicles(id),
 owner_id uuid not null references auth.users(id) on delete cascade,
 brand text not null check (length(btrim(brand)) between 1 and 60),
 logo_path text not null check (length(logo_path)<=200),
 zone_id text not null check (zone_id in ('hood','door-left','door-right','rear-left','rear-right','front-left','front-right','deck','rear-bumper','front-bumper')),
 col integer not null check (col>=0),
 "row" integer not null check ("row">=0),
 cols integer not null check (cols between 1 and 20),
 rows integer not null check (rows between 1 and 10),
 rotation integer not null default 0 check (rotation in (0,90,180,270)),
 revision integer not null default 1 check (revision>0),
 approval_status text not null default 'pending' check (approval_status in ('pending','approved')),
 payment_status text not null default 'unpaid' check (payment_status in ('unpaid','paid')),
 amount_cents bigint generated always as (
  (case zone_id when 'hood' then 100000 when 'door-left' then 90000 when 'door-right' then 90000
   when 'rear-left' then 40000 when 'rear-right' then 40000 when 'front-left' then 20000 when 'front-right' then 20000
   when 'deck' then 40000 when 'rear-bumper' then 35000 when 'front-bumper' then 25000 end)::bigint * cols * rows / 2
 ) stored,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint logo_inside_grid check (col+cols<=20 and "row"+rows<=10),
 constraint one_logo_per_owner_vehicle unique (vehicle_id,owner_id),
 -- PostgreSQL, not a client-side check, arbitrates concurrent reservations.
 -- Half-open intervals allow touching edges but reject intersecting cells.
 constraint logo_placements_no_overlap exclude using gist (
  vehicle_id with =, zone_id with =,
  int4range(col,col+cols,'[)') with &&,
  int4range("row","row"+rows,'[)') with &&
 )
);
alter table public.logo_placements enable row level security;
create policy "Read shared placements" on public.logo_placements for select to anon, authenticated using (true);
revoke all on public.logo_placements from anon, authenticated;
grant select on public.logo_placements to anon, authenticated;
-- No browser write grants or policies: all writes pass through the RPCs below.

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
 values ('company-logos','company-logos',true,2097152,array['image/png'])
 on conflict (id) do update set public=true,file_size_limit=2097152,allowed_mime_types=array['image/png'];
create policy "Read company logos" on storage.objects for select to anon, authenticated
 using (bucket_id='company-logos');
create policy "Upload own immutable PNG" on storage.objects for insert to authenticated
 with check (bucket_id='company-logos' and (storage.foldername(name))[1]=(select auth.uid())::text
 and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.png$');
create policy "Delete own unreferenced PNG" on storage.objects for delete to authenticated
 using (bucket_id='company-logos' and (storage.foldername(name))[1]=(select auth.uid())::text
 and not exists (select 1 from public.logo_placements p where p.logo_path=name));

create function public.list_logo_placements(p_vehicle_id text)
 returns jsonb language sql stable security invoker set search_path = '' as $$
 -- A single consistent JSON snapshot, not truncated by PostgREST row pagination.
 select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at,p.id),'[]'::jsonb)
 from public.logo_placements p where p.vehicle_id=p_vehicle_id;
$$;
revoke all on function public.list_logo_placements(text) from public;
grant execute on function public.list_logo_placements(text) to anon, authenticated;

create function public.save_logo_placement(
 p_vehicle_id text,p_brand text,p_logo_path text,p_zone_id text,
 p_col integer,p_row integer,p_cols integer,p_rows integer,p_rotation integer,p_expected_revision integer default 0
) returns public.logo_placements language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); previous public.logo_placements; saved public.logo_placements;
begin
 if uid is null then raise exception 'Connexion requise.' using errcode='42501'; end if;
 if not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null)
  then raise exception 'Adresse email non vérifiée.' using errcode='42501'; end if;
 if p_logo_path is null or p_logo_path !~ ('^'||uid::text||'/[0-9a-f-]{36}\.png$')
  then raise exception 'Chemin du logo non autorisé.' using errcode='42501'; end if;
 -- Lock the referenced Storage row against a concurrent deletion while saving.
 perform 1 from storage.objects where bucket_id='company-logos' and name=p_logo_path for key share;
 if not found then raise exception 'Importez le PNG avant sa position.' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_vehicle_id||':'||uid::text,0));
 select * into previous from public.logo_placements where vehicle_id=p_vehicle_id and owner_id=uid for update;
 if found then
  if p_expected_revision is distinct from previous.revision then raise exception 'Révision périmée.' using errcode='40001'; end if;
  if previous.approval_status='approved' or previous.payment_status='paid'
   then raise exception 'Contactez l’opérateur pour modifier un placement confirmé.' using errcode='42501'; end if;
  update public.logo_placements set brand=btrim(p_brand),logo_path=p_logo_path,zone_id=p_zone_id,
   col=p_col,"row"=p_row,cols=p_cols,rows=p_rows,rotation=p_rotation,revision=revision+1,updated_at=now()
   where id=previous.id returning * into saved;
 else
  if p_expected_revision is distinct from 0 then raise exception 'Position supprimée ou révision périmée.' using errcode='40001'; end if;
  insert into public.logo_placements(vehicle_id,owner_id,brand,logo_path,zone_id,col,"row",cols,rows,rotation)
   values(p_vehicle_id,uid,btrim(p_brand),p_logo_path,p_zone_id,p_col,p_row,p_cols,p_rows,p_rotation) returning * into saved;
 end if;
 return saved;
end;
$$;
revoke all on function public.save_logo_placement(text,text,text,text,integer,integer,integer,integer,integer,integer) from public,anon;
grant execute on function public.save_logo_placement(text,text,text,text,integer,integer,integer,integer,integer,integer) to authenticated;

create function public.delete_logo_placement(p_id uuid,p_expected_revision integer)
 returns text language plpgsql security definer set search_path = '' as $$
declare previous public.logo_placements;
begin
 if auth.uid() is null then raise exception 'Connexion requise.' using errcode='42501'; end if;
 select * into previous from public.logo_placements where id=p_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Placement introuvable ou non autorisé.' using errcode='42501'; end if;
 if p_expected_revision is distinct from previous.revision then raise exception 'Révision périmée.' using errcode='40001'; end if;
 if previous.approval_status='approved' or previous.payment_status='paid'
  then raise exception 'Contactez l’opérateur pour retirer un placement confirmé.' using errcode='42501'; end if;
 delete from public.logo_placements where id=previous.id;
 return previous.logo_path;
end;
$$;
revoke all on function public.delete_logo_placement(uuid,integer) from public,anon;
grant execute on function public.delete_logo_placement(uuid,integer) to authenticated;

do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and
  not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='logo_placements') then
  alter publication supabase_realtime add table public.logo_placements;
 end if;
end $$;
commit;
