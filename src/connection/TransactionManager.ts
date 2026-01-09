import { PoolClient } from 'pg';
import { ConnectionPoolManager } from './ConnectionPoolManager';
import { injectable, inject } from 'inversify';
import { Logger, LogLevel } from '../utils/Logger';
import { DatabaseIsolationLevel } from '../types';
import { OrmError } from '../errors/OrmError';

// Define a symbol for Dependency Injection if users want to use it
export const PECULIAR_ORM_TYPES = {
    ConnectionPoolManager: Symbol.for('ConnectionPoolManager'),
};

interface TransactionOptions {
    isolationLevel?: DatabaseIsolationLevel;
    readOnly?: boolean;
}

interface TransactionMetrics {
    totalTransactions: number;
    activeTransactions: number;
    completedTransactions: number;
    committedTransactions: number;
    rolledBackTransactions: number;
    failedTransactions: number;
    transactionDurations: number[];
    lastMetricsResetTime: Date;
    transactionHistory: Array<{
        transactionId: string;
        startTime: Date;
        endTime?: Date;
        duration?: number;
        status: 'active' | 'committed' | 'rolled_back' | 'failed';
        isolationLevel?: DatabaseIsolationLevel;
        readOnly?: boolean;
        error?: string;
    }>;
}

@injectable()
export class TransactionManager {
    private client: PoolClient | null = null;
    private isTransactionActive = false;
    private poolManager: ConnectionPoolManager;
    private requestId: string;
    private metrics: TransactionMetrics = {
        totalTransactions: 0,
        activeTransactions: 0,
        completedTransactions: 0,
        committedTransactions: 0,
        rolledBackTransactions: 0,
        failedTransactions: 0,
        transactionDurations: [],
        lastMetricsResetTime: new Date(),
        transactionHistory: []
    };

    private transactionStartTime: Date | null = null;
    private currentTransactionOptions?: TransactionOptions;
    private metricsLoggingInterval: NodeJS.Timeout | null = null;

    // Constructor accepting ConnectionPoolManager. 
    // If using DI, ensure the symbol matches.
    constructor(@inject(PECULIAR_ORM_TYPES.ConnectionPoolManager) poolManager: ConnectionPoolManager) {
        this.poolManager = poolManager;
        this.requestId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.startMetricsLogging();
    }

    public getTransactionId(): string {
        return this.requestId;
    }

    public async getStandaloneClient(): Promise<PoolClient> {
        try {
            const client = await this.poolManager.getConnection();
            return client;
        } catch (error: unknown) {
            Logger.error(error as Error, {
                message: 'Failed to acquire standalone client',
                requestId: this.requestId
            });
            throw new OrmError('Failed to acquire database client from pool');
        }
    }

    private startMetricsLogging(): void {
        const metricsId = `metric_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;

        this.metricsLoggingInterval = setInterval(() => {
            const summary = this.getMetricsSummary();

            const longRunningTransactions = this.metrics.transactionHistory
                .filter(txn => txn.status === 'active' &&
                    new Date().getTime() - txn.startTime.getTime() > 5 * 60 * 1000);

            if (longRunningTransactions.length > 0) {
                Logger.write(`[${metricsId}] WARNING: ${longRunningTransactions.length} long-running transactions detected`,
                    LogLevel.WARNING, {
                    transactions: longRunningTransactions.map(txn => ({
                        transactionId: txn.transactionId,
                        durationMinutes: Math.round((new Date().getTime() - txn.startTime.getTime()) / (1000 * 60)),
                        isolationLevel: txn.isolationLevel,
                        readOnly: txn.readOnly
                    }))
                });
            }
        }, 60000);
    }

    public isActive(): boolean {
        return this.isTransactionActive;
    }

    public async beginTransaction(options?: TransactionOptions): Promise<void> {
        const transactionId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.requestId = transactionId;
        this.currentTransactionOptions = options;

        if (this.isTransactionActive) {
            const err = new OrmError('Transaction already in progress');

            this.metrics.failedTransactions++;
            this.metrics.transactionHistory.push({
                transactionId,
                startTime: new Date(),
                status: 'failed',
                isolationLevel: options?.isolationLevel,
                readOnly: options?.readOnly,
                error: 'Transaction already in progress'
            });

            if (this.metrics.transactionHistory.length > 100) {
                this.metrics.transactionHistory = this.metrics.transactionHistory.slice(-100);
            }

            throw err;
        }

        this.transactionStartTime = new Date();
        this.metrics.totalTransactions++;

        try {
            this.client = await this.poolManager.getConnection(options);
            await this.client.query('BEGIN');

            if (options?.isolationLevel) {
                await this.client.query(`SET TRANSACTION ISOLATION LEVEL ${options.isolationLevel}`);
            }

            if (options?.readOnly !== undefined) {
                await this.client.query(options.readOnly ? 'SET TRANSACTION READ ONLY' : 'SET TRANSACTION READ WRITE');
            }

            this.isTransactionActive = true;
            this.metrics.activeTransactions++;

            this.metrics.transactionHistory.push({
                transactionId,
                startTime: this.transactionStartTime,
                status: 'active',
                isolationLevel: options?.isolationLevel,
                readOnly: options?.readOnly
            });

            if (this.metrics.transactionHistory.length > 100) {
                this.metrics.transactionHistory = this.metrics.transactionHistory.slice(-100);
            }

        } catch (error: any) {
            this.metrics.failedTransactions++;

            const historyEntry = this.metrics.transactionHistory.find(t => t.transactionId === transactionId);
            if (historyEntry) {
                historyEntry.status = 'failed';
                historyEntry.endTime = new Date();
                historyEntry.duration = historyEntry.endTime.getTime() - historyEntry.startTime.getTime();
                historyEntry.error = error.message;
            }

            if (this.client) {
                try {
                    await this.releaseClient();
                } catch (releaseError: any) {
                    // Ignore release errors on failure
                }
            }
            throw error;
        }
    }

    public async commit(): Promise<void> {
        if (!this.isTransactionActive || !this.client) {
            const err = new OrmError('No active transaction to commit');
            this.metrics.failedTransactions++;
            throw err;
        }

        try {
            await this.client.query('COMMIT');

            this.metrics.committedTransactions++;
            this.metrics.completedTransactions++;

            const historyEntry = this.metrics.transactionHistory.find(t => t.transactionId === this.requestId);
            if (historyEntry) {
                historyEntry.status = 'committed';
                historyEntry.endTime = new Date();
                if (this.transactionStartTime) {
                    historyEntry.duration = historyEntry.endTime.getTime() - historyEntry.startTime.getTime();
                    this.metrics.transactionDurations.push(historyEntry.duration);

                    if (this.metrics.transactionDurations.length > 1000) {
                        this.metrics.transactionDurations = this.metrics.transactionDurations.slice(-1000);
                    }
                }
            }

        } catch (error: any) {
            const historyEntry = this.metrics.transactionHistory.find(t => t.transactionId === this.requestId);
            if (historyEntry) {
                historyEntry.status = 'failed';
                historyEntry.endTime = new Date();
                historyEntry.error = `Commit failed: ${error.message}`;
                if (this.transactionStartTime) {
                    historyEntry.duration = historyEntry.endTime.getTime() - historyEntry.startTime.getTime();
                }
            }

            throw error;
        } finally {
            this.releaseClient();
        }
    }

    public async rollback(): Promise<void> {
        if (!this.isTransactionActive || !this.client) {
            return;
        }

        try {
            await this.client.query('ROLLBACK');

            this.metrics.rolledBackTransactions++;
            this.metrics.completedTransactions++;

            const historyEntry = this.metrics.transactionHistory.find(t => t.transactionId === this.requestId);
            if (historyEntry) {
                historyEntry.status = 'rolled_back';
                historyEntry.endTime = new Date();
                if (this.transactionStartTime) {
                    historyEntry.duration = historyEntry.endTime.getTime() - historyEntry.startTime.getTime();
                    this.metrics.transactionDurations.push(historyEntry.duration);
                }
            }

        } catch (error: any) {
            const historyEntry = this.metrics.transactionHistory.find(t => t.transactionId === this.requestId);
            if (historyEntry) {
                historyEntry.status = 'failed';
                historyEntry.endTime = new Date();
                historyEntry.error = `Rollback failed: ${error.message}`;
                if (this.transactionStartTime) {
                    historyEntry.duration = historyEntry.endTime.getTime() - historyEntry.startTime.getTime();
                }
            }

            throw error;
        } finally {
            this.releaseClient();
        }
    }

    public getClient(): PoolClient {
        if (!this.client || !this.isTransactionActive) {
            throw new OrmError('No active transaction client');
        }
        return this.client;
    }

    public getMetrics(): TransactionMetrics {
        return { ...this.metrics };
    }

    public getMetricsSummary(): any {
        const durations = this.metrics.transactionDurations;
        const avgDuration = durations.length > 0
            ? durations.reduce((sum, val) => sum + val, 0) / durations.length
            : 0;

        return {
            totalTransactions: this.metrics.totalTransactions,
            activeTransactions: this.metrics.activeTransactions,
            committedTransactions: this.metrics.committedTransactions,
            rolledBackTransactions: this.metrics.rolledBackTransactions,
            failedTransactions: this.metrics.failedTransactions,
            completedTransactions: this.metrics.completedTransactions,
            avgTransactionDurationMs: Math.round(avgDuration),
            maxTransactionDurationMs: durations.length > 0 ? Math.max(...durations) : 0,
            minTransactionDurationMs: durations.length > 0 ? Math.min(...durations) : 0,
            transactionCount: durations.length,
            longRunningTransactions: this.getLongRunningTransactions()
        };
    }

    public resetMetrics(): void {
        this.metrics = {
            totalTransactions: 0,
            activeTransactions: this.metrics.activeTransactions,
            completedTransactions: 0,
            committedTransactions: 0,
            rolledBackTransactions: 0,
            failedTransactions: 0,
            transactionDurations: [],
            lastMetricsResetTime: new Date(),
            transactionHistory: this.metrics.transactionHistory.filter(t => t.status === 'active')
        };

        Logger.write('Transaction metrics reset', LogLevel.INFO, {
            timestamp: new Date().toISOString(),
            activeTransactionsRemaining: this.metrics.activeTransactions
        });
    }

    private getLongRunningTransactions(): any[] {
        return this.metrics.transactionHistory
            .filter(txn => txn.status === 'active')
            .map(txn => {
                const durationMs = new Date().getTime() - txn.startTime.getTime();
                return {
                    transactionId: txn.transactionId,
                    durationMs,
                    durationMinutes: Math.round(durationMs / (1000 * 60) * 10) / 10,
                    isolationLevel: txn.isolationLevel,
                    readOnly: txn.readOnly,
                    startTime: txn.startTime.toISOString()
                };
            })
            .filter(txn => txn.durationMs > 30000);
    }

    private releaseClient(): void {
        if (this.client) {

            if (this.isTransactionActive) {
                this.metrics.activeTransactions = Math.max(0, this.metrics.activeTransactions - 1);
            }

            this.client.release();
            this.client = null;
            this.isTransactionActive = false;
            this.transactionStartTime = null;
        }
    }

    public dispose(): void {
        if (this.metricsLoggingInterval) {
            clearInterval(this.metricsLoggingInterval);
            this.metricsLoggingInterval = null;
        }
    }
}
