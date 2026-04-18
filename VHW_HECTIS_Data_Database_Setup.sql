-- 1. Create table
CREATE TABLE vhw_hectis_data (
  id                        bigserial primary key,
  age_raw                   text,
  age_years                 numeric,
  sex                       text,
  triage_category           text,
  trauma                    text,
  arrival_time              timestamptz,
  triage_time               timestamptz,
  consultation_time         timestamptz,
  disposal_time             timestamptz,
  exit_time                 timestamptz,
  disposal                  text,
  location                  text,
  arrival_to_triage_min     numeric,
  triage_to_doctor_min      numeric,
  doctor_to_disposal_min    numeric,
  disposal_to_exit_min      numeric,
  total_los_min             numeric,
  access_block_4hr          boolean,
  source_file               text,
  upload_month              integer,
  upload_year               integer,
  uploaded_at               timestamptz default now()
);

-- 2. RLS policies
ALTER TABLE vhw_hectis_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read"   ON vhw_hectis_data FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON vhw_hectis_data FOR INSERT WITH CHECK (true);

-- 3. Dedup indexes (NULL-safe, three partial indexes)
CREATE UNIQUE INDEX vhw_hectis_data_dedup
ON vhw_hectis_data (arrival_time, triage_time, consultation_time)
WHERE triage_time IS NOT NULL AND consultation_time IS NOT NULL;

CREATE UNIQUE INDEX vhw_hectis_data_dedup_null_triage
ON vhw_hectis_data (arrival_time, consultation_time)
WHERE triage_time IS NULL;

CREATE UNIQUE INDEX vhw_hectis_data_dedup_all_null
ON vhw_hectis_data (arrival_time)
WHERE triage_time IS NULL AND consultation_time IS NULL;

-- 4. Query performance indexes
CREATE INDEX vhw_hectis_data_disposal_time ON vhw_hectis_data(disposal_time);
CREATE INDEX vhw_hectis_data_disposal      ON vhw_hectis_data(disposal);
CREATE INDEX vhw_hectis_data_upload        ON vhw_hectis_data(upload_year, upload_month);