import { QueryResult, QueryResultRow } from 'pg';
import { IRepository } from './IRepository';
import { TransactionManager } from '../connection/TransactionManager';
import { Logger, LogLevel } from '../utils/Logger';
import {
    DatabaseConstraintError,
    DatabaseQueryError,
    DatabaseConnectionError,
    OrmError
} from '../errors/OrmError';
import { getEntityMetadata } from '../decorators';

export abstract class BaseRepository<T> implements IRepository<T> {
    protected readonly tableName: string;
    protected transactionManager: TransactionManager;

    constructor(transactionManager: TransactionManager, tableName: string) {
        this.transactionManager = transactionManager;
        this.tableName = tableName;
    }

    protected async executeQuery<R extends QueryResultRow = any>(query: string, params: any[] = []): Promise<QueryResult<R>> {
        const startTime = Date.now();
        try {
            const client = this.transactionManager.getClient();
            const result = await client.query<R>(query, params);

            Logger.write('Query executed successfully', LogLevel.INFO, {
                operation: 'query',
                table: this.tableName,
                duration: Date.now() - startTime,
                rowCount: result.rowCount,
                transactionId: this.transactionManager.getTransactionId()
            });

            return result;
        } catch (error: any) {
            Logger.write('Query execution failed', LogLevel.ERROR, {
                operation: 'query',
                table: this.tableName,
                query: query.replace(/\s+/g, ' ').trim(),
                params,
                duration: Date.now() - startTime,
                transactionId: this.transactionManager.getTransactionId(),
                errorCode: error.code,
            });

            switch (error.code) {
                case '23505':
                    throw new DatabaseConstraintError('Unique constraint violation', error.constraint);
                case '23503':
                    throw new DatabaseConstraintError('Foreign key constraint violation', error.constraint);
                case '23502':
                    throw new DatabaseConstraintError('Not null constraint violation', error.constraint);
                case '42P01':
                case '42703':
                    throw new DatabaseQueryError('Invalid query structure', query, params);
                case '08006':
                case '08001':
                    throw new DatabaseConnectionError(error.message, { cause: error.code });
                default:
                    throw new OrmError(`An unexpected database error occurred: ${error.message}`);
            }
        }
    }

    protected getEntityColumns(entity: Partial<T>): {
        columns: string[];
        values: any[];
        placeholders: string[];
    } {
        const columns: string[] = [];
        const values: any[] = [];
        const placeholders: string[] = [];
        let parameterIndex = 1;

        for (const [key, value] of Object.entries(entity)) {
            if (value === undefined) continue;
            columns.push(key);
            values.push(value);
            placeholders.push(`$${parameterIndex}`);
            parameterIndex++;
        }

        return { columns, values, placeholders };
    }

    protected buildWhereClause(predicate: Partial<T>): {
        whereClause: string;
        values: any[]
    } {
        const conditions: string[] = [];
        const values: any[] = [];
        let parameterIndex = 1;

        for (const [key, value] of Object.entries(predicate)) {
            conditions.push(`${key} = $${parameterIndex}`);
            values.push(value);
            parameterIndex++;
        }

        return {
            whereClause: conditions.length > 0
                ? `WHERE ${conditions.join(' AND ')}`
                : '',
            values
        };
    }

    protected buildUpdateSet(entity: Partial<T>): {
        setClause: string;
        values: any[];
    } {
        const updates: string[] = [];
        const values: any[] = [];
        let parameterIndex = 1;

        for (const [key, value] of Object.entries(entity)) {
            if (key !== 'id' && key !== '_id' && value !== undefined) {
                updates.push(`${key} = $${parameterIndex}`);
                values.push(value);
                parameterIndex++;
            }
        }

        return {
            setClause: updates.join(', '),
            values
        };
    }

    protected buildBulkInsertClause(entities: T[]): {
        valuesClause: string;
        values: any[];
        columns: string[];
    } {
        if (entities.length === 0) {
            return { valuesClause: '', values: [], columns: [] };
        }

        const firstEntity = entities[0];
        const { columns } = this.getEntityColumns(firstEntity);
        const values: any[] = [];
        const valueSets: string[] = [];

        entities.forEach((entity, entityIndex) => {
            const entityValues: any[] = [];
            columns.forEach(column => {
                const value = (entity as any)[column];
                entityValues.push(value);
                values.push(value);
            });

            const placeholders = entityValues
                .map((_, i) => `$${entityIndex * columns.length + i + 1}`)
                .join(', ');
            valueSets.push(`(${placeholders})`);
        });

        return {
            valuesClause: valueSets.join(', '),
            values,
            columns
        };
    }

    protected buildBulkUpdateClause(entities: Partial<T>[]): {
        updateClause: string;
        values: any[];
    } {
        const values: any[] = [];
        const cases: string[] = [];
        let parameterIndex = 1;

        const updateFields = Object.keys(entities[0])
            .filter(key => key !== 'id' && key !== '_id');

        updateFields.forEach(field => {
            const caseStatements: string[] = [];

            entities.forEach(entity => {
                const id = (entity as any)._id || (entity as any).id;
                if (id !== undefined && (entity as any)[field] !== undefined) {
                    caseStatements.push(`WHEN _id = $${parameterIndex} THEN $${parameterIndex + 1}`);
                    values.push(id, (entity as any)[field]);
                    parameterIndex += 2;
                }
            });

            if (caseStatements.length > 0) {
                cases.push(`${field} = (CASE ${caseStatements.join(' ')} ELSE ${field} END)`);
            }
        });

        return {
            updateClause: cases.join(', '),
            values
        };
    }

    protected buildWhereInClause(ids: string[], startIndex: number = 1): {
        whereClause: string;
        values: any[];
    } {
        const placeholders = ids.map((_, index) => `$${startIndex + index}`).join(', ');
        return {
            whereClause: `WHERE _id IN (${placeholders})`,
            values: ids
        };
    }

    // Abstract methods to be implemented by specific repositories
    // The BaseRepository provides helper methods but enforcing these methods is good practice
    abstract findById(id: string): Promise<T | null>;
    abstract findAll(): Promise<T[]>;
    abstract findByCondition(condition: Partial<T>): Promise<T[]>;
    abstract create(entity: T): Promise<T>;
    abstract update(id: string, entity: Partial<T>): Promise<T | null>;
    abstract delete(id: string, deletedBy?: string): Promise<boolean>;
    abstract count(condition?: Partial<T>): Promise<number>;
    abstract bulkCreate(entities: T[]): Promise<T[]>;
    abstract bulkUpdate(entities: Partial<T>[]): Promise<T[]>;
    abstract bulkDelete(ids: string[]): Promise<number>;

    async executeRawQuery<T extends QueryResultRow = any>(query: string, values: any[] = []): Promise<QueryResult<T>> {
        try {
            return await this.executeQuery<T>(query, values);
        } catch (error: any) {
            throw new DatabaseQueryError(`Failed to execute raw query: ${error.message}`, query, values);
        }
    }
}
