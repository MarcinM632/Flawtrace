// Settings of the Flawtrace Cloud gateway. Everything comes from environment variables (see cloud/.env.example).
const path = require('path');
const crypto = require('crypto');

const env = process.env;
const int = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : d);

const PORT = int(env.CLOUD_PORT, 8080);
const DATA = path.resolve(env.CLOUD_DATA || path.join(__dirname, '..', '..', 'cloud-data'));
// Two host names: the public site (marketing, legal) and the app (login + the product). In development both are
// *.localhost, which every browser sends to the local machine.
const SITE_HOST = (env.SITE_HOST || `localhost:${PORT}`).toLowerCase();
const APP_HOST = (env.APP_HOST || `app.localhost:${PORT}`).toLowerCase();
const SECURE = (env.PUBLIC_SCHEME || 'http') === 'https';
const siteUrl = `${SECURE ? 'https' : 'http'}://${SITE_HOST}`;
const appUrl = `${SECURE ? 'https' : 'http'}://${APP_HOST}`;

// The master secret derives every customer's own key and signs nothing else. Without one, a random secret is made and
// kept in the data folder (fine for a trial run; a deployment must set CLOUD_MASTER_SECRET and back it up).
const MASTER_SECRET = env.CLOUD_MASTER_SECRET || '';

module.exports = {
  PORT, DATA, SITE_HOST, APP_HOST, SECURE, siteUrl, appUrl, MASTER_SECRET,
  HOST: env.CLOUD_HOST || '127.0.0.1',
  SESSION_DAYS: int(env.SESSION_DAYS, 14),
  TRIAL_DAYS: int(env.TRIAL_DAYS, 14),
  PAST_DUE_GRACE_DAYS: int(env.PAST_DUE_GRACE_DAYS, 7),
  MAX_SEATS: int(env.MAX_SEATS, 5),
  SIGNUPS_PER_HOUR_PER_IP: int(env.SIGNUPS_PER_HOUR_PER_IP, 10),
  MAX_RUNNING_TENANTS: int(env.MAX_RUNNING_TENANTS, 20),
  IDLE_MINUTES: int(env.TENANT_IDLE_MINUTES, 20),
  TENANT_DISK_MB: int(env.TENANT_DISK_MB, 2048),
  TENANT_MEMORY_MB: int(env.TENANT_MEMORY_MB, 768),
  // Closed beta: when set, sign-up needs this code.
  BETA_CODE: env.BETA_CODE || '',
  REQUIRE_VERIFIED_EMAIL: env.REQUIRE_VERIFIED_EMAIL !== '0',
  ADMIN_EMAILS: String(env.ADMIN_EMAILS || '').toLowerCase().split(/[\s,;]+/).filter(Boolean),
  // Mail: with RESEND_API_KEY mails go out through Resend; otherwise they are printed in the log (development).
  RESEND_API_KEY: env.RESEND_API_KEY || '',
  MAIL_FROM: env.MAIL_FROM || 'Flawtrace <no-reply@localhost>',
  // Billing: without STRIPE_SECRET_KEY the cloud is free (closed beta) and no card is asked for.
  STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET || '',
  STRIPE_PRICE_ID: env.STRIPE_PRICE_MONTHLY || env.STRIPE_PRICE_ID || '',
  // Cennik: ceny pokazywane na stronie (w walucie PRICE_CURRENCY) i identyfikatory cen w Stripe dla każdego okresu.
  // Plan bez ceny w Stripe nie jest sprzedawany w checkoutcie; cena 0 ukrywa plan także na stronie.
  PRICE_CURRENCY: (env.PRICE_CURRENCY || 'USD').toUpperCase(),
  PRICES: { monthly: Number(env.PRICE_MONTHLY || 15), semiannual: Number(env.PRICE_SEMIANNUAL || 78), annual: Number(env.PRICE_ANNUAL || 144) },
  STRIPE_PRICES: { monthly: env.STRIPE_PRICE_MONTHLY || env.STRIPE_PRICE_ID || '', semiannual: env.STRIPE_PRICE_SEMIANNUAL || '', annual: env.STRIPE_PRICE_ANNUAL || '' },
  // Enterprise: umowa i faktura (bez Stripe Checkout), włączany komendą admin.js enterprise.
  ENTERPRISE_FROM: Number(env.ENTERPRISE_FROM_MONTHLY || 99),
  ENTERPRISE_SEATS: int(env.ENTERPRISE_SEATS, 25),
  STRIPE_TAX: env.STRIPE_TAX === '1',
  PRICE_LABEL: env.PRICE_LABEL || '',
  // Karta od razu: trial startuje dopiero po podaniu metody płatności w Stripe Checkout (pierwsza opłata po trialu).
  TRIAL_REQUIRES_CARD: env.TRIAL_REQUIRES_CARD === '1',
  PLAN_NAME: env.PLAN_NAME || 'Team workspace',
  // Legal identity shown on the legal pages (fill in before going public).
  COMPANY_NAME: env.COMPANY_NAME || '[Company name]',
  COMPANY_ADDRESS: env.COMPANY_ADDRESS || '[Registered address]',
  COMPANY_ID: env.COMPANY_ID || '[Company registration / tax number]',
  CONTACT_EMAIL: env.CONTACT_EMAIL || 'contact@example.com',
  GOVERNING_LAW: env.GOVERNING_LAW || '[governing law and courts]',
  BACKUP_DAYS: int(env.BACKUP_DAYS, 35),
  HOSTING_REGION: env.HOSTING_REGION || '[hosting region]',
  HOSTING_PROVIDER: env.HOSTING_PROVIDER || '[hosting provider]',
  APP_DIR: path.resolve(__dirname, '..'),
  randomSecret: () => crypto.randomBytes(32).toString('hex'),
};
