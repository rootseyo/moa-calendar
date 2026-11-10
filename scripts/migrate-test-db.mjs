const url = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
if (url.pathname === '/share_schedule_db') url.pathname = '/share_schedule_test_db';
if (!url.pathname.endsWith('_test_db')) throw new Error('Refusing to migrate a database not named *_test_db');
process.env.DATABASE_URL = url.href;
await import('./migrate.mjs');
