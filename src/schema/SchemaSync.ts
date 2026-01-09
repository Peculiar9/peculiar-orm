import { TransactionManager } from '../connection/TransactionManager';
import { getEntityMetadata, getIndexMetadata } from '../decorators';
import { OrmError } from '../errors/OrmError';
import { Logger, LogLevel } from '../utils/Logger';

export class SchemaSync {
    constructor(
        private transactionManager: TransactionManager,
    ) { }

    async sync(entities: { entity: Function, tableName: string }[]): Promise<void> {
        for (const { entity, tableName } of entities) {
            Logger.info(`Starting schema sync for table: ${tableName}`);
            try {
                await this.transactionManager.beginTransaction();

                const tableExists = await this.checkTableExists(tableName);

                if (!tableExists) {
                    Logger.info(`-> Table does not exist. Attempting to create: ${tableName}`);
                    await this.createTable(entity, tableName);
                    Logger.info(`-> Successfully created table: ${tableName}`);
                } else {
                    Logger.info(`-> Table exists. Attempting to update schema: ${tableName}`);
                    await this.updateTableSchema(entity, tableName);
                    Logger.info(`-> Successfully updated schema for table: ${tableName}`);
                }

                await this.transactionManager.commit();
                Logger.info(`Committed transaction for table: ${tableName}\n`);

            } catch (error: any) {
                Logger.error(error, { message: `FATAL ERROR: Sync failed for table: ${tableName}.` });

                try {
                    await this.transactionManager.rollback();
                } catch (rollbackError) {
                    Logger.error(rollbackError as Error, { message: 'Rollback failed after sync error.' });
                }

                throw new OrmError(`Failed to sync table: ${tableName}. Reason: ${error.message}`);
            }
        }

        Logger.info('All database tables synced successfully');
    }

    private async createTable(entity: Function, tableName: string): Promise<void> {
        try {
            const metadata = getEntityMetadata(entity);
            const indexMetaData = getIndexMetadata(entity, tableName);
            Logger.info("Entity metadata retrieved", { tableName, columnsCount: metadata.columns.length, constraintsCount: metadata.constraints.length });

            const allDefinitions = [
                ...metadata.columns,
                ...metadata.constraints
            ].join(',\n');

            const query = `
                CREATE TABLE IF NOT EXISTS "${tableName}" (
                    ${allDefinitions}
                );`;

            Logger.info("Executing table creation query", { tableName });
            await this.transactionManager.getClient().query(query);

            if (indexMetaData.length > 0) {
                Logger.info(`Creating indexes`, { tableName, indexCount: indexMetaData.length });
                for (const indexStatement of indexMetaData) {
                    await this.transactionManager.getClient().query(indexStatement);
                }
            }
        } catch (error: any) {
            Logger.error(error, { message: `Failed to create table`, tableName });
            throw new OrmError(`Failed to create table ${tableName}: ${error.message}`);
        }
    }

    private async updateTableSchema(entity: Function, tableName: string): Promise<void> {
        try {
            const metadata = getEntityMetadata(entity);
            const indexMetaData = getIndexMetadata(entity, tableName); // Indexes are generally safe to re-run with IF NOT EXISTS

            const currentSchemaQuery = `
                SELECT column_name
                FROM information_schema.columns 
                WHERE table_name = $1 AND table_schema = 'public';
            `;
            const { rows: currentColumns } = await this.transactionManager.getClient().query(currentSchemaQuery, [tableName]);

            for (const column of metadata.columns) {
                const columnName = column.split(' ')[0].replace(/"/g, '');

                const existingColumn = currentColumns.find(c => c.column_name === columnName);

                if (!existingColumn) {
                    const addColumnQuery = `ALTER TABLE "${tableName}" ADD COLUMN ${column};`;
                    Logger.info(`Adding new column`, { tableName, columnName });
                    await this.transactionManager.getClient().query(addColumnQuery);
                }
            }

            if (indexMetaData.length > 0) {
                Logger.info(`Updating indexes`, { tableName, indexCount: indexMetaData.length });
                for (const indexStatement of indexMetaData) {
                    await this.transactionManager.getClient().query(indexStatement);
                }
            }
        } catch (error: any) {
            Logger.error(error, { message: `Failed to update schema`, tableName });
            throw new OrmError(`Failed to update schema for ${tableName}: ${error.message}`);
        }
    }

    private async checkTableExists(tableName: string): Promise<boolean> {
        try {
            const query = `
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = $1
                );
            `;
            const { rows } = await this.transactionManager.getClient().query(query, [tableName]);
            return rows[0].exists;
        } catch (error: any) {
            Logger.error(error, { message: `Failed to check if table exists`, tableName });
            throw new OrmError(`Failed to check if table ${tableName} exists: ${error.message}`);
        }
    }
}
