-- SYNTHETIC LOAD DATA for measuring backup/restore time (ADR 0025). NOT for production.
-- Usage: psql -v n=100000 -d ishan_loadtest -f loadtest-seed.sql   (database must be migrated, empty)
-- Per 1 customer it creates ~2 contacts, ~5 activities, ~10 audit entries, ~5 domain events.
-- Safety: refuses to run unless the database name ends in "_loadtest".
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF current_database() !~ '_loadtest$' THEN
    RAISE EXCEPTION 'refusing to seed % - the database name must end in _loadtest', current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM organizations) THEN
    RAISE EXCEPTION 'refusing to seed: organizations is not empty';
  END IF;
END $$;

SET synchronous_commit = off;
INSERT INTO organizations (id, name, created_at, updated_at)
VALUES ('00000000-0000-7000-8000-000000000001', 'Loadtest Org', now(), now());

-- Persian words give realistic multi-byte text; md5 suffixes keep values varied (and less compressible).
CREATE TEMP TABLE words AS
  SELECT row_number() OVER () AS i, w FROM unnest(ARRAY[
    'شرکت','بازرگانی','صنعتی','تجارت','پارس','ایران','آریا','نوین','پیشرو','گستر','فناوری','خدمات','مهندسی','توسعه',
    'سپهر','البرز','تهران','اصفهان','شیراز','مشهد','تبریز','پیگیری','قرارداد','پیش‌فاکتور','جلسه','تماس','پشتیبانی'
  ]) AS w;
CREATE FUNCTION pg_temp.fa(seed bigint, n int) RETURNS text LANGUAGE sql AS $f$
  SELECT string_agg((SELECT w FROM words WHERE i = 1 + ((seed * 31 + k * 17) % 27)), ' ')
  FROM generate_series(1, n) k
$f$;

INSERT INTO customers (id, organization_id, kind, name, national_id, email, phone, province, city, address, notes,
                       search_text, created_at, updated_at)
SELECT gen_random_uuid(), '00000000-0000-7000-8000-000000000001',
       CASE WHEN g % 3 = 0 THEN 'ORGANIZATION' ELSE 'PERSON' END::customer_kind,
       pg_temp.fa(g, 3) || ' ' || g,
       lpad((g::bigint * 7919 % 10000000000)::text, 10, '0'),
       'c' || g || '@example.test', '0912' || lpad((g % 10000000)::text, 7, '0'),
       'تهران', 'تهران', pg_temp.fa(g + 5, 6) || ' پلاک ' || (g % 200),
       pg_temp.fa(g + 9, 10) || ' ' || md5(g::text),
       pg_temp.fa(g, 3) || ' ' || g || ' c' || g || '@example.test',
       now() - (g % 900 || ' days')::interval, now() - (g % 300 || ' days')::interval
FROM generate_series(1, :n) g;

CREATE TEMP TABLE cust AS
  SELECT id, row_number() OVER () AS r FROM customers;
CREATE INDEX ON cust (r);

INSERT INTO contacts (id, organization_id, customer_id, first_name, last_name, job_title, email, mobile, is_primary,
                      notes, search_text, created_at, updated_at)
SELECT gen_random_uuid(), '00000000-0000-7000-8000-000000000001', c.id,
       pg_temp.fa(c.r + k, 1), pg_temp.fa(c.r * 3 + k, 1), pg_temp.fa(c.r + 2, 2),
       'p' || c.r || '_' || k || '@example.test', '0935' || lpad(((c.r * 2 + k) % 10000000)::text, 7, '0'),
       k = 1, pg_temp.fa(c.r + k, 8), pg_temp.fa(c.r + k, 2) || ' p' || c.r,
       now() - (c.r % 700 || ' days')::interval, now() - (c.r % 200 || ' days')::interval
FROM cust c, generate_series(1, 2) k;

INSERT INTO activities (id, organization_id, type, status, priority, title, description, completed_at, outcome,
                        customer_id, search_text, created_at, updated_at)
SELECT gen_random_uuid(), '00000000-0000-7000-8000-000000000001',
       (ARRAY['CALL','MEETING','TASK','NOTE'])[1 + (c.r + k) % 4]::activity_type, 'DONE',
       (ARRAY['LOW','NORMAL','HIGH'])[1 + (c.r + k) % 3]::activity_priority,
       pg_temp.fa(c.r + k, 3), pg_temp.fa(c.r * 5 + k, 25), now() - ((c.r + k) % 400 || ' days')::interval,
       pg_temp.fa(c.r + k, 4), c.id, pg_temp.fa(c.r + k, 3),
       now() - ((c.r + k) % 400 || ' days')::interval, now() - ((c.r + k) % 400 || ' days')::interval
FROM cust c, generate_series(1, 5) k;

INSERT INTO audit_logs (id, organization_id, action, entity_type, entity_id, metadata, ip, created_at)
SELECT gen_random_uuid(), '00000000-0000-7000-8000-000000000001',
       (ARRAY['customer.created','customer.updated','contact.created','activity.created','quote.sent'])[1 + (c.r + k) % 5],
       'customer', c.id::text,
       jsonb_build_object('fields', jsonb_build_array('name','email','phone'), 'note', pg_temp.fa(c.r + k, 6), 'ref', md5((c.r * k)::text)),
       '203.0.113.' || ((c.r + k) % 250),
       now() - ((c.r + k) % 600 || ' days')::interval - ((k * 7) || ' minutes')::interval
FROM cust c, generate_series(1, 10) k;

INSERT INTO domain_events (id, organization_id, type, entity_type, entity_id, payload, occurred_at, dispatched_at)
SELECT gen_random_uuid(), '00000000-0000-7000-8000-000000000001', 'customer.created', 'customer', c.id,
       jsonb_build_object('name', pg_temp.fa(c.r + k, 3), 'k', k, 'ref', md5((c.r + k)::text)),
       now() - ((c.r + k) % 300 || ' days')::interval, now() - ((c.r + k) % 300 || ' days')::interval
FROM cust c, generate_series(1, 5) k;

ANALYZE;
SELECT 'customers' t, count(*) FROM customers UNION ALL SELECT 'contacts', count(*) FROM contacts
UNION ALL SELECT 'activities', count(*) FROM activities UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs
UNION ALL SELECT 'domain_events', count(*) FROM domain_events;
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;
