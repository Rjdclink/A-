import pg from 'pg';
let pool;
export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    pool = new pg.Pool({connectionString:process.env.DATABASE_URL,max:4,connectionTimeoutMillis:12000,idleTimeoutMillis:25000});
    pool.on('error',(error)=>console.error('Idle database connection:',error.code||error.message));
  }
  return pool;
}
export async function query(sql,values=[]) { return getPool().query(sql,values); }
export async function tx(operation) {
  const client=await getPool().connect();
  try { await client.query('BEGIN'); const result=await operation(client); await client.query('COMMIT'); return result; }
  catch(e) { await client.query('ROLLBACK'); throw e; }
  finally {client.release();}
}
