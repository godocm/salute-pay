CREATE TABLE IF NOT EXISTS salute_merchants (
 id text PRIMARY KEY, address text NOT NULL, family text NOT NULL CHECK(family IN ('evm','solana','tron')),
 plan text NOT NULL DEFAULT 'free' CHECK(plan IN ('free','growth','scale')), webhook_url text,
 webhook_secret text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS salute_challenges (
 id text PRIMARY KEY, merchant_id text NOT NULL, address text NOT NULL, chain text NOT NULL,
 message text NOT NULL, expires_at timestamptz NOT NULL, used boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS salute_sessions (
 token_hash text PRIMARY KEY, merchant_id text NOT NULL REFERENCES salute_merchants(id), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS salute_payments (
 slug text PRIMARY KEY, merchant_id text NOT NULL REFERENCES salute_merchants(id), order_key text NOT NULL UNIQUE,
 intent jsonb NOT NULL, public_listing boolean NOT NULL DEFAULT true, webhook_enabled boolean NOT NULL DEFAULT false,
 received numeric(78,0) NOT NULL DEFAULT 0, collected numeric(78,0) NOT NULL DEFAULT 0,
 balance numeric(78,0) NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'awaiting',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS salute_payments_owner ON salute_payments(merchant_id,created_at);
CREATE TABLE IF NOT EXISTS salute_receipts (
 id text PRIMARY KEY, slug text NOT NULL REFERENCES salute_payments(slug), chain text NOT NULL,
 tx_hash text NOT NULL, event_index integer NOT NULL, asset text NOT NULL,
 received numeric(78,0) NOT NULL, merchant_amount numeric(78,0) NOT NULL, reward numeric(78,0) NOT NULL,
 invoice_asset boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(chain,tx_hash,event_index)
);
CREATE TABLE IF NOT EXISTS salute_webhooks (
 id text PRIMARY KEY, merchant_id text NOT NULL REFERENCES salute_merchants(id), slug text REFERENCES salute_payments(slug),
 payload jsonb NOT NULL, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz, locked_until timestamptz, last_status integer, dead boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS salute_webhook_queue ON salute_webhooks(next_attempt_at) WHERE delivered_at IS NULL AND NOT dead;
CREATE TABLE IF NOT EXISTS salute_cursors (chain text PRIMARY KEY, block_number bigint NOT NULL);
CREATE TABLE IF NOT EXISTS salute_job_locks (name text PRIMARY KEY, owner text NOT NULL, locked_until timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS salute_rate_limits (key text PRIMARY KEY, count integer NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL);
-- The app alone accesses these tables with its server-side PostgreSQL role. Never expose DATABASE_URL to browsers.
CREATE TABLE IF NOT EXISTS salute_submitted_transactions (
 slug text NOT NULL REFERENCES salute_payments(slug), chain text NOT NULL, hash text NOT NULL,
 checked boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(slug,chain,hash)
);
