import {query} from './db.mjs';

const migrations=[
"CREATE TABLE IF NOT EXISTS businesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_email text NOT NULL UNIQUE, password_hash text NOT NULL, name text NOT NULL, slug text NOT NULL UNIQUE, description text NOT NULL DEFAULT '', services text NOT NULL DEFAULT '', faq text NOT NULL DEFAULT '', contact_email text NOT NULL DEFAULT '', timezone text NOT NULL DEFAULT 'America/Chicago', subscription_status text NOT NULL DEFAULT 'pending_payment', created_at timestamptz NOT NULL DEFAULT now())",
"CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now())",
"CREATE TABLE IF NOT EXISTS leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, name text NOT NULL, email text NOT NULL, phone text NOT NULL DEFAULT '', inquiry text NOT NULL, consent boolean NOT NULL DEFAULT false, source text NOT NULL DEFAULT 'public_form', status text NOT NULL DEFAULT 'new', created_at timestamptz NOT NULL DEFAULT now(), last_contact_at timestamptz, follow_up_count int NOT NULL DEFAULT 0)",
"CREATE TABLE IF NOT EXISTS appointments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, lead_id uuid REFERENCES leads(id) ON DELETE SET NULL, starts_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'requested', created_at timestamptz NOT NULL DEFAULT now())",
"CREATE TABLE IF NOT EXISTS invoices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, customer_name text NOT NULL, email text NOT NULL, amount_cents int NOT NULL CHECK(amount_cents>=0), due_at timestamptz NOT NULL, payment_url text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'unpaid', reminded_count int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now())",
"CREATE TABLE IF NOT EXISTS business_scans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, website text NOT NULL, page_title text NOT NULL DEFAULT '', evidence jsonb NOT NULL DEFAULT '{}'::jsonb, ai_analysis text NOT NULL, outreach_draft text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now())",
"CREATE TABLE IF NOT EXISTS prospects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, website text NOT NULL, host text NOT NULL, company_name text NOT NULL DEFAULT '', contact_email text NOT NULL DEFAULT '', source_url text NOT NULL DEFAULT '', priority int NOT NULL DEFAULT 0, priority_basis text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'pending', observation jsonb NOT NULL DEFAULT '{}'::jsonb, analysis jsonb NOT NULL DEFAULT '{}'::jsonb, scanned_at timestamptz, contacted_at timestamptz, discovered_at timestamptz NOT NULL DEFAULT now(), UNIQUE(business_id,host))",
"CREATE TABLE IF NOT EXISTS correspondence (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, prospect_id uuid REFERENCES prospects(id) ON DELETE SET NULL, lead_id uuid REFERENCES leads(id) ON DELETE SET NULL, direction text NOT NULL, sender text NOT NULL, recipient text NOT NULL, subject text NOT NULL, body text NOT NULL, status text NOT NULL DEFAULT 'draft', provider_message_id text UNIQUE, reply_to_id text, created_at timestamptz NOT NULL DEFAULT now())",
"CREATE TABLE IF NOT EXISTS optouts (business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, email text NOT NULL, reason text NOT NULL DEFAULT 'unsubscribe', created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(business_id,email))",
"CREATE TABLE IF NOT EXISTS payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, monthly_amount int NOT NULL DEFAULT 299, month text NOT NULL, status text NOT NULL DEFAULT 'unverified', reported_at timestamptz NOT NULL DEFAULT now(), UNIQUE(business_id,month))",
"CREATE TABLE IF NOT EXISTS jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, lead_id uuid REFERENCES leads(id) ON DELETE CASCADE, kind text NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb, run_at timestamptz NOT NULL, attempts int NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'pending', last_error text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(business_id,lead_id,kind))",
"ALTER TABLE invoices ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES leads(id) ON DELETE SET NULL",
"ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_reminded_at timestamptz",
"CREATE TABLE IF NOT EXISTS mail_connections (connection_name text PRIMARY KEY, account_email text NOT NULL, secret_encrypted text NOT NULL, verified_at timestamptz NOT NULL, postal_address text NOT NULL DEFAULT '', outreach_enabled boolean NOT NULL DEFAULT false, ai_replies_enabled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())",
"CREATE TABLE IF NOT EXISTS inbox_poll_state (mailbox text PRIMARY KEY, uid_validity text NOT NULL DEFAULT '', last_uid bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now())",
"ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS send_attempts int NOT NULL DEFAULT 0",
"ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS last_send_attempt_at timestamptz",
"ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS send_error text NOT NULL DEFAULT ''",
"ALTER TABLE businesses ADD COLUMN IF NOT EXISTS booking_enabled boolean NOT NULL DEFAULT false",
"ALTER TABLE businesses ADD COLUMN IF NOT EXISTS booking_start_hour int NOT NULL DEFAULT 9",
"ALTER TABLE businesses ADD COLUMN IF NOT EXISTS booking_end_hour int NOT NULL DEFAULT 17",
"ALTER TABLE businesses ADD COLUMN IF NOT EXISTS booking_slot_minutes int NOT NULL DEFAULT 30",
"ALTER TABLE businesses ADD COLUMN IF NOT EXISTS booking_weekdays text NOT NULL DEFAULT '1,2,3,4,5'",
"CREATE UNIQUE INDEX IF NOT EXISTS booked_appointments_unique ON appointments(business_id,starts_at) WHERE status='confirmed'",
"CREATE INDEX IF NOT EXISTS prospects_pending_priority ON prospects(business_id,priority DESC,discovered_at) WHERE status='pending'",
"CREATE INDEX IF NOT EXISTS correspondence_business_time ON correspondence(business_id,created_at DESC)",
"CREATE INDEX IF NOT EXISTS leads_business_time ON leads(business_id,created_at DESC)",
"CREATE INDEX IF NOT EXISTS appointments_business_time ON appointments(business_id,starts_at DESC)"
];
let initialized;
export function ensureSchema(){
  if(!initialized) initialized=(async()=>{for(const migration of migrations) await query(migration);return true;})();
  return initialized.catch(e=>{initialized=undefined;throw e;});
}
