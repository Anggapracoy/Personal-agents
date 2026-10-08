-- Removes only the retired app subscription/metering storage.
-- Before applying to a previously billed installation, retire subscriptions in
-- Stripe separately: dropping local tables does not cancel external charges.
DROP TABLE IF EXISTS billing_usage;
DROP TABLE IF EXISTS billing_webhook_events;
DROP TABLE IF EXISTS billing_accounts;
DELETE FROM app_feature_flags WHERE key = 'billing';
