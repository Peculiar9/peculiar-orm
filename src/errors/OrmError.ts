export class OrmError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'OrmError';
    }
}

export class DatabaseConnectionError extends OrmError {
    public readonly cause?: unknown;
    public readonly poolId?: string;

    constructor(message: string, options?: { cause?: unknown; poolId?: string }) {
        super(message);
        this.name = 'DatabaseConnectionError';
        this.cause = options?.cause;
        this.poolId = options?.poolId;
    }
}

export class DatabaseQueryError extends OrmError {
    constructor(message: string, public readonly query: string, public readonly params: any[]) {
        super(message);
        this.name = 'DatabaseQueryError';
    }
}

export class DatabaseConstraintError extends OrmError {
    constructor(message: string, public readonly constraint?: string) {
        super(message);
        this.name = 'DatabaseConstraintError';
    }
}
