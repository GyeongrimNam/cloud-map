-- Cloud Map DB 초기화
-- 1) 테이블 생성  2) 비어 있으면 샘플 JSON 적재  3) 웹에 공개할 api 스키마(View)와 읽기 전용 역할 생성

BEGIN;

------------------------------------------------------------------------------
-- 1. 테이블
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.resources (
  resource_id   TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  region        TEXT NOT NULL,
  is_synthetic  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS public.relationships (
  source_id     TEXT NOT NULL REFERENCES public.resources(resource_id),
  target_id     TEXT NOT NULL REFERENCES public.resources(resource_id),
  relation_type TEXT NOT NULL,
  is_synthetic  BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (source_id, target_id, relation_type)
);

CREATE TABLE IF NOT EXISTS public.findings (
  finding_id     TEXT PRIMARY KEY,
  resource_id    TEXT,
  scope_type     TEXT NOT NULL CHECK (scope_type IN ('resource', 'account', 'region')),
  account_id     TEXT,
  region         TEXT,
  check_id       TEXT NOT NULL,
  check_title    TEXT,
  check_title_ko TEXT,
  status         TEXT,
  severity       TEXT,
  scanned_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.finding_details (
  finding_id       TEXT PRIMARY KEY REFERENCES public.findings(finding_id) ON DELETE CASCADE,
  description      TEXT,
  description_ko   TEXT,
  status_detail    TEXT,
  status_detail_ko TEXT,
  risk_details     TEXT,
  risk_details_ko  TEXT,
  remediation      TEXT,
  remediation_ko   TEXT,
  compliance       JSONB,
  raw_data         JSONB
);

------------------------------------------------------------------------------
-- 2. 샘플 적재 (resources가 비어 있을 때만)
------------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM public.resources) AS need_load \gset

\if :need_load
\echo 'cloud-map: loading sample data'
\set arch_json `cat /cloud-map-data/architecture-sample.json`
\set prowler_json `cat /cloud-map-data/prowler-sample.json`
\set ko_json `cat /cloud-map-data/translations.json`

CREATE TEMP TABLE input_json (name TEXT PRIMARY KEY, payload JSONB) ON COMMIT DROP;
INSERT INTO input_json VALUES
  ('arch', :'arch_json'::jsonb),
  ('prowler', :'prowler_json'::jsonb),
  ('ko', :'ko_json'::jsonb);

INSERT INTO public.resources
SELECT r->>'resource_id', r->>'resource_type', r->>'resource_name', r->>'region',
       COALESCE((r->>'is_synthetic')::boolean, FALSE)
FROM input_json, jsonb_array_elements(payload->'resources') AS r
WHERE name = 'arch';

INSERT INTO public.relationships
SELECT r->>'source_id', r->>'target_id', r->>'relation_type',
       COALESCE((r->>'is_synthetic')::boolean, FALSE)
FROM input_json, jsonb_array_elements(payload->'relationships') AS r
WHERE name = 'arch';

-- 샘플 Prowler 리소스 ID를 데모 구성도의 리소스 ID로 연결하는 표 (데모 전용)
CREATE TEMP TABLE demo_map ON COMMIT DROP AS
SELECT m->>'source_resource_id' AS source_id, m->>'target_resource_id' AS target_id
FROM input_json, jsonb_array_elements(payload->'finding_resource_mappings') AS m
WHERE name = 'arch';

INSERT INTO public.findings
  (finding_id, resource_id, scope_type, account_id, region, check_id,
   check_title, status, severity, scanned_at)
SELECT f->'sample'->>'finding_id',
       CASE WHEN f->'sample'->>'scope_type' = 'resource' THEN m.target_id END,
       f->'sample'->>'scope_type',
       f->'sample'->>'account_id',
       f->'sample'->>'region',
       f->'metadata'->>'event_code',
       f->'finding_info'->>'title',
       f->>'status_code',
       f->>'severity',
       (f->>'time_dt')::timestamptz
FROM input_json, jsonb_array_elements(payload->'findings') AS f
LEFT JOIN demo_map m ON m.source_id = f->'sample'->>'resource_id'
WHERE name = 'prowler';

INSERT INTO public.finding_details
  (finding_id, description, status_detail, risk_details, remediation, compliance, raw_data)
SELECT f->'sample'->>'finding_id',
       f->'finding_info'->>'desc',
       COALESCE(f->>'status_detail', f->>'message'),
       f->>'risk_details',
       f->'remediation'->>'desc',
       f->'unmapped'->'compliance',
       f
FROM input_json, jsonb_array_elements(payload->'findings') AS f
WHERE name = 'prowler';

-- 한국어 번역 (원문은 그대로 두고 *_ko 컬럼에 저장)
UPDATE public.findings f SET check_title_ko = t->>'check_title_ko'
FROM input_json, jsonb_array_elements(payload->'translations') AS t
WHERE name = 'ko' AND f.finding_id = t->>'finding_id';

UPDATE public.finding_details d SET
  description_ko   = t->>'description_ko',
  status_detail_ko = t->>'status_detail_ko',
  risk_details_ko  = t->>'risk_details_ko',
  remediation_ko   = t->>'remediation_ko'
FROM input_json, jsonb_array_elements(payload->'translations') AS t
WHERE name = 'ko' AND d.finding_id = t->>'finding_id';
\else
\echo 'cloud-map: existing data kept'
\endif

------------------------------------------------------------------------------
-- 3. 웹 API (PostgREST가 api 스키마의 View만 읽기 전용으로 공개)
------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'web_anon') THEN
    CREATE ROLE web_anon NOLOGIN;
  END IF;
END
$$;

-- PostgREST는 앱 계정으로 접속한 뒤 요청마다 web_anon 권한으로 전환합니다.
GRANT web_anon TO :"app_user";

CREATE SCHEMA IF NOT EXISTS api;

CREATE OR REPLACE VIEW api.resources AS
SELECT resource_id, resource_type, resource_name, region
FROM public.resources;

CREATE OR REPLACE VIEW api.relationships AS
SELECT source_id, target_id, relation_type
FROM public.relationships;

-- 보안 점검 목록: 한국어 우선/영문 fallback, FAIL → 중요도 → 번호 순
CREATE OR REPLACE VIEW api.findings AS
SELECT
  f.finding_id,
  regexp_replace(COALESCE(NULLIF(f.check_title_ko, ''), f.check_title, '-'),
                 '[[:space:]]+점검[[:space:]]*$', '') AS title,
  f.status,
  CASE lower(f.severity)
    WHEN 'critical' THEN 'Critical' WHEN 'high' THEN 'High'
    WHEN 'medium' THEN 'Medium' WHEN 'low' THEN 'Low'
    ELSE COALESCE(f.severity, '-')
  END AS severity,
  CASE f.scope_type
    WHEN 'account' THEN '계정 전체'
    WHEN 'region' THEN '리전 전체' || COALESCE(' (' || NULLIF(f.region, '') || ')', '')
    ELSE COALESCE(NULLIF(r.resource_name, ''), '-')
  END AS target,
  COALESCE((
    SELECT string_agg(DISTINCT code, ', ' ORDER BY code)
    FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(COALESCE(d.compliance->'KISA-ISMS-P-2023',
                                      d.compliance->'KISA-ISMS-P-2023-korean')) = 'array'
        THEN COALESCE(d.compliance->'KISA-ISMS-P-2023', d.compliance->'KISA-ISMS-P-2023-korean')
        ELSE '[]'::jsonb END
    ) AS mapping(code)
  ), '-') AS isms_p,
  -- 구성도 노드와 연결하는 리소스 ID (계정·리전 단위 점검은 NULL)
  f.resource_id,
  -- 표시용 리소스 종류·이름: 구성도 리소스 → 계정·리전 범위 → Prowler 원본 리소스 순으로 사용
  COALESCE(r.resource_type,
    CASE f.scope_type WHEN 'account' THEN 'account' WHEN 'region' THEN 'region' END,
    d.raw_data->'resources'->0->>'type', '-') AS resource_type,
  COALESCE(r.resource_name,
    CASE f.scope_type WHEN 'account' THEN '계정 전체' WHEN 'region' THEN NULLIF(f.region, '') END,
    d.raw_data->'resources'->0->>'name', '-') AS resource_name
FROM public.findings f
LEFT JOIN public.resources r ON r.resource_id = f.resource_id
LEFT JOIN public.finding_details d ON d.finding_id = f.finding_id
ORDER BY CASE f.status WHEN 'FAIL' THEN 0 ELSE 1 END,
  CASE lower(f.severity) WHEN 'critical' THEN 0 WHEN 'high' THEN 1
    WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
  f.finding_id;

-- 점검 상세: 결과·위험·개선 권고 (한국어 우선/영문 fallback)
CREATE OR REPLACE VIEW api.finding_details AS
SELECT
  d.finding_id,
  COALESCE(NULLIF(d.status_detail_ko, ''), NULLIF(d.status_detail, ''), '-') AS status_detail,
  COALESCE(NULLIF(d.risk_details_ko, ''), NULLIF(d.risk_details, ''), '-') AS risk_details,
  COALESCE(NULLIF(d.remediation_ko, ''), NULLIF(d.remediation, ''), '-') AS remediation
FROM public.finding_details d;

-- web_anon은 api View만 읽을 수 있고, public 원본 테이블에는 직접 접근하지 못합니다.
GRANT USAGE ON SCHEMA api TO web_anon;
GRANT SELECT ON ALL TABLES IN SCHEMA api TO web_anon;

COMMIT;

-- 스키마가 바뀌었을 수 있으므로 PostgREST에 캐시 갱신을 알립니다.
NOTIFY pgrst, 'reload schema';

SELECT 'resources' AS table_name, count(*) FROM public.resources
UNION ALL SELECT 'relationships', count(*) FROM public.relationships
UNION ALL SELECT 'findings', count(*) FROM public.findings
UNION ALL SELECT 'finding_details', count(*) FROM public.finding_details;
