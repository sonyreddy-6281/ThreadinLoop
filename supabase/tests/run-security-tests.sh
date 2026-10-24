#!/usr/bin/env bash
set -euo pipefail
task_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
task_container="madhu-shop-security-${RANDOM}-${RANDOM}"
task_temp_dir="$(mktemp -d)"
cleanup() { docker rm -f "$task_container" >/dev/null 2>&1 || true; rm -rf "$task_temp_dir"; }
trap cleanup EXIT

docker run --detach --rm --network none --name "$task_container" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
task_ready=false
for task_attempt in {1..40}; do
  if docker exec "$task_container" pg_isready -U postgres >/dev/null 2>&1; then task_ready=true; break; fi
  sleep 0.25
done
if [[ "$task_ready" != true ]]; then docker logs "$task_container"; exit 1; fi

docker exec -i "$task_container" psql -X -v ON_ERROR_STOP=1 -U postgres < "$task_repo_root/supabase/tests/bootstrap.sql"
docker exec -i "$task_container" psql -X -v ON_ERROR_STOP=1 -U postgres < "$task_repo_root/supabase/migrations/202610120001_crochet_shop.sql"
docker exec -i "$task_container" psql -X -v ON_ERROR_STOP=1 -U postgres < "$task_repo_root/supabase/tests/security.sql"

# Both sessions attempt to buy the last unit. Exactly one must succeed.
set +e
docker exec -i "$task_container" psql -X -v ON_ERROR_STOP=1 -U postgres < "$task_repo_root/supabase/tests/race.sql" >"$task_temp_dir/first.log" 2>&1 &
task_first_pid=$!
docker exec -i "$task_container" psql -X -v ON_ERROR_STOP=1 -U postgres < "$task_repo_root/supabase/tests/race.sql" >"$task_temp_dir/second.log" 2>&1 &
task_second_pid=$!
wait "$task_first_pid"; task_first_result=$?
wait "$task_second_pid"; task_second_result=$?
set -e
if ! { [[ "$task_first_result" == 0 && "$task_second_result" != 0 ]] || [[ "$task_first_result" != 0 && "$task_second_result" == 0 ]]; }; then
  cat "$task_temp_dir/first.log" "$task_temp_dir/second.log"
  echo 'FAIL: exactly one simultaneous last-unit checkout must succeed.'
  exit 1
fi
docker exec -i "$task_container" psql -X -v ON_ERROR_STOP=1 -U postgres <<'SQL'
select public.test_assert((select stock from public.products where id = '00000000-0000-0000-0000-000000000003') = 0, 'simultaneous purchases cannot oversell');
select public.test_assert((select count(*) from public.order_items where product_id = '00000000-0000-0000-0000-000000000003') = 1, 'simultaneous purchases create exactly one last-unit order');
SQL
echo 'All backend security and concurrent-checkout checks passed.'
