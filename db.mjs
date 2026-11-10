import pg from 'pg';
const databaseUrl = process.env.DATABASE_URL;
export const db = databaseUrl ? new pg.Pool({
 connectionString: databaseUrl, max: 10,
 connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
 application_name: 'share_schedule',
}) : null;
if (db) db.on('error', error => console.error('PostgreSQL pool error:', error.code || 'connection failed'));
export const query = (sql, values = []) => {
 if (!db) throw new Error('DATABASE_URL에 PostgreSQL 연결 주소를 설정해 주세요.');
 return db.query(sql, values);
};
export async function transaction(fn) {
 if (!db) throw new Error('DATABASE_URL에 PostgreSQL 연결 주소를 설정해 주세요.');
 const client = await db.connect();
 try { await client.query('BEGIN'); const value = await fn(client); await client.query('COMMIT'); return value; }
 catch(error) { await client.query('ROLLBACK'); throw error; }
 finally { client.release(); }
}
