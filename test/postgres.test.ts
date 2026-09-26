import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Pool } from 'pg';
import { ConnectionPoolManager } from '../src/connection/ConnectionPoolManager';
import { TransactionManager } from '../src/connection/TransactionManager';
import { DatabaseIsolationLevel } from '../src/types';

/**
 * Against a real Postgres on localhost (skipped when there is none): proves
 * the collapsed BEGIN applies every mode, and that a standalone lease reads
 * without a transaction.
 */
const cfg = { host: process.env.PGHOST ?? 'localhost', port: Number(process.env.PGPORT ?? 5432), database: process.env.PGDATABASE ?? 'postgres', user: process.env.PGUSER, password: process.env.PGPASSWORD };
let reachable = false;
try { const p = new Pool({ ...cfg, connectionTimeoutMillis: 1500 }); await p.query('SELECT 1'); await p.end(); reachable = true; } catch { reachable = false; }

describe.skipIf(!reachable)('against Postgres', () => {
    const table = `peculiar_orm_test_${Date.now()}`;
    let setup: Pool; let pm: ConnectionPoolManager;
    beforeAll(async () => {
        setup = new Pool(cfg);
        await setup.query(`CREATE TABLE ${table} (id int primary key, v text)`);
        await setup.query(`INSERT INTO ${table} VALUES (1, 'a')`);
        pm = new ConnectionPoolManager({ ...cfg, max: 3 } as any);
    });
    afterAll(async () => { await pm.dispose(); await setup.query(`DROP TABLE IF EXISTS ${table}`); await setup.end(); });

    it('the one-statement BEGIN sets isolation, read-only and the SET LOCAL, and the fence holds', async () => {
        const tm = new TransactionManager(pm);
        await tm.beginTransaction({ isolationLevel: DatabaseIsolationLevel.READ_COMMITTED, readOnly: true, localSettings: ['idle_in_transaction_session_timeout = 60000'] });
        const c = tm.getClient();
        expect((await c.query('SHOW transaction_read_only')).rows[0].transaction_read_only).toBe('on');
        expect((await c.query('SHOW transaction_isolation')).rows[0].transaction_isolation).toBe('read committed');
        expect((await c.query('SHOW idle_in_transaction_session_timeout')).rows[0].idle_in_transaction_session_timeout).toBe('1min');
        let code = '';
        try { await c.query(`UPDATE ${table} SET v = 'b' WHERE id = 1`); } catch (e: any) { code = e.code; }
        expect(code).toBe('25006');
        await tm.rollback();
    });

    it('a standalone lease reads with no transaction open', async () => {
        const tm = new TransactionManager(pm);
        const row = await tm.runStandalone(async () => {
            const c = tm.getClient();
            // no transaction: pg reports an idle backend, not one in a transaction block
            const inTx = (await c.query("SELECT now() = statement_timestamp() AS same")).rows[0].same;
            const v = (await c.query(`SELECT v FROM ${table} WHERE id = 1`)).rows[0].v;
            return { inTx, v };
        });
        expect(row.v).toBe('a');
        expect(row.inTx).toBe(true);   // now() == statement_timestamp() only outside a transaction block
        expect(tm.isActive()).toBe(false);
    });
});
