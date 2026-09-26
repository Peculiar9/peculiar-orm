import { describe, it, expect } from 'bun:test';
import { TransactionManager } from '../src/connection/TransactionManager';
import { BaseRepository } from '../src/repository/BaseRepository';
import { OrmError } from '../src/errors/OrmError';
import { DatabaseIsolationLevel } from '../src/types';

/** A pool that records every statement and every lease, and never talks to Postgres. */
function fakePool() {
    const sent: string[] = [];
    let leased = 0, released = 0;
    const client = {
        query: async (text: string) => { sent.push(text); return { rows: [], rowCount: 0 }; },
        release: () => { released++; },
    };
    const pool = {
        getConnection: async () => { leased++; return client; },
        releaseConnection: async () => { released++; },
    } as any;
    return { pool, sent, leases: () => leased, releases: () => released };
}

class Users extends BaseRepository<{ _id: string }> {
    constructor(tm: TransactionManager) { super(tm, 'users'); }
    read(sql: string) { return this.executeQuery(sql, []); }
    findAll = async () => []; findByCondition = async () => []; create = async (e: any) => e;
    update = async () => null; delete = async () => true; count = async () => 0;
    bulkCreate = async () => []; bulkUpdate = async () => []; bulkDelete = async () => 0;
    findById = async () => null;
}

describe('beginStatement: one round trip carries every transaction mode', () => {
    it('plain BEGIN when nothing is asked for', () => {
        expect(TransactionManager.beginStatement()).toBe('BEGIN');
    });
    it('folds isolation, read-only and SET LOCALs into one statement', () => {
        expect(TransactionManager.beginStatement({
            isolationLevel: DatabaseIsolationLevel.READ_COMMITTED,
            readOnly: true,
            localSettings: ['idle_in_transaction_session_timeout = 60000'],
        })).toBe('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY; SET LOCAL idle_in_transaction_session_timeout = 60000');
    });
    it('READ WRITE when readOnly is explicitly false', () => {
        expect(TransactionManager.beginStatement({ readOnly: false })).toBe('BEGIN READ WRITE');
    });
    it('beginTransaction sends exactly that one statement', async () => {
        const { pool, sent } = fakePool();
        const tm = new TransactionManager(pool);
        await tm.beginTransaction({ isolationLevel: DatabaseIsolationLevel.REPEATABLE_READ, readOnly: true });
        expect(sent).toEqual(['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY']);
        await tm.commit();
        expect(sent).toEqual(['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'COMMIT']);
    });
});

describe('runStandalone: a lease with no transaction', () => {
    it('leases one client, sends only the statement, and releases it', async () => {
        const { pool, sent, leases, releases } = fakePool();
        const tm = new TransactionManager(pool);
        const users = new Users(tm);
        await tm.runStandalone(() => users.read('SELECT 1'));
        expect(sent).toEqual(['SELECT 1']);            // no BEGIN, no COMMIT
        expect(leases()).toBe(1);
        expect(releases()).toBe(1);
        expect(tm.isActive()).toBe(false);
        expect(tm.isStandalone()).toBe(false);
    });
    it('releases the client even when the work throws', async () => {
        const { pool, releases } = fakePool();
        const tm = new TransactionManager(pool);
        await expect(tm.runStandalone(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
        expect(releases()).toBe(1);
        expect(() => tm.getClient()).toThrow(OrmError);
    });
    it('refuses to send a write, before anything reaches the database', async () => {
        const { pool, sent } = fakePool();
        const tm = new TransactionManager(pool);
        const users = new Users(tm);
        for (const sql of ["UPDATE users SET x = 1", "insert into users values (1)", "DELETE FROM users", "TRUNCATE users"]) {
            await expect(tm.runStandalone(() => users.read(sql))).rejects.toThrow(/standalone read attempted to write/);
        }
        expect(sent).toEqual([]);
    });
    it('lets every read shape through', async () => {
        const { pool, sent } = fakePool();
        const tm = new TransactionManager(pool);
        const users = new Users(tm);
        const reads = ['SELECT * FROM users', '  WITH x AS (SELECT 1) SELECT * FROM x', '(SELECT 1) UNION (SELECT 2)', 'SHOW transaction_read_only', 'EXPLAIN SELECT 1'];
        for (const sql of reads) await tm.runStandalone(() => users.read(sql));
        expect(sent).toEqual(reads);
    });
    it('joins an open transaction instead of leasing a second client', async () => {
        const { pool, sent, leases } = fakePool();
        const tm = new TransactionManager(pool);
        const users = new Users(tm);
        await tm.beginTransaction();
        await users.read('UPDATE users SET x = 1');                      // a write, inside the transaction
        await tm.runStandalone(() => users.read('SELECT 1'));           // a read, joining it
        await tm.commit();
        expect(leases()).toBe(1);
        expect(sent).toEqual(['BEGIN', 'UPDATE users SET x = 1', 'SELECT 1', 'COMMIT']);
    });
    it('nested standalone reads share the one lease', async () => {
        const { pool, leases } = fakePool();
        const tm = new TransactionManager(pool);
        const users = new Users(tm);
        await tm.runStandalone(() => tm.runStandalone(() => users.read('SELECT 1')));
        expect(leases()).toBe(1);
    });
    it('cannot begin a transaction over a standalone lease on the same client', async () => {
        const { pool } = fakePool();
        const tm = new TransactionManager(pool);
        await expect(tm.runStandalone(async () => {
            // the manager is single-client: a transaction on top would clobber the lease
            await tm.beginTransaction();
        })).rejects.toThrow();
    });
});
