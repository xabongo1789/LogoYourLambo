-- Isolated CI PostgreSQL only. Never execute this fixture in a Supabase project.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create schema storage;
create schema tests;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,unique(bucket_id,name));
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
alter table storage.objects enable row level security;
grant usage on schema auth,storage,tests to anon,authenticated;
grant select on storage.objects to anon;
grant select,insert,update,delete on storage.objects to authenticated;
create publication supabase_realtime;
create function tests.assert(ok boolean,label text) returns text language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; return 'PASS: '||label; end $$;
create function tests.expect_error(query text,expected text) returns text language plpgsql as $$
declare actual text;
begin
 begin execute query; exception when others then get stacked diagnostics actual=returned_sqlstate; end;
 if actual is distinct from expected then raise exception 'Expected SQLSTATE %, got % for %',expected,actual,query; end if;
 return 'PASS: SQLSTATE '||expected;
end $$;
