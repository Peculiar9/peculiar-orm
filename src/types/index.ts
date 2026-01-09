import { PoolConfig } from 'pg';

export enum DatabaseIsolationLevel {
    READ_UNCOMMITTED = 'READ UNCOMMITTED',
    READ_COMMITTED = 'READ COMMITTED',
    REPEATABLE_READ = 'REPEATABLE_READ',
    SERIALIZABLE = 'SERIALIZABLE',
}

export interface ConnectionOptions {
    isolationLevel?: string;
    readOnly?: boolean;
}

export interface IConnectionConfig extends PoolConfig { }
