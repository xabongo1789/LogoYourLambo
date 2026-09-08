#!/usr/bin/env bash
# Uses the same ephemeral PostgreSQL database as database.test.sql.
set -euo pipefail
log=$(mktemp)
trap 'rm -f "$log"' EXIT
psql -X -v ON_ERROR_STOP=1 >"$log" 2>&1 <<'SQL' &
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select public.save_logo_placement('huracan-stl-v1','Three','00000000-0000-0000-0000-000000000003/10000000-0000-0000-0000-000000000003.png','hood',8,0,4,2,0,0);
\echo FIRST_INSERTED
select pg_sleep(3);
commit;
SQL
pid=$!
for i in $(seq 1 100); do grep -q FIRST_INSERTED "$log" && break; sleep 0.1; done
grep -q FIRST_INSERTED "$log" || { cat "$log"; exit 1; }
psql -X -v ON_ERROR_STOP=1 <<'SQL'
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
select tests.expect_error($$select public.save_logo_placement('huracan-stl-v1','Four','00000000-0000-0000-0000-000000000004/10000000-0000-0000-0000-000000000004.png','hood',8,0,4,2,0,0)$$,'23P01');
reset role;
select tests.assert((select count(*)=1 from public.logo_placements where zone_id='hood' and col=8),'only one concurrent placement wins');
SQL
wait "$pid"
cat "$log"
