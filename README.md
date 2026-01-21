# Peculiar ORM

A lightweight, transparent, and robust Object-Relational Mapper (ORM) for PostgreSQL, built with TypeScript.

`peculiar-orm` is designed for applications that need:
- **Resilient Connection Management**: Built-in pooling, diagnostics, and metrics.
- **Explicit Transaction Control**: Clean API for handling complex transactions.
- **Repository Pattern**: A structured way to organize data access logic.
- **Observability**: Detailed metrics on connection usage, query performance, and transaction history.
- **Dependency Injection**: First-class support for `inversify`.

## Perfect for Microservices
Lightweight and resilient, `peculiar-orm` is built to thrive in distributed environments:
- **Zero bloat**: Wraps `pg` directly without the overhead of massive ORM frameworks.
- **Resilient**: Handles connection drops and query timeouts gracefully, preventing cascading failures.
- **Observable**: Exposes internal metrics (pool saturation, transaction durations), making it easy to monitor service health.
- **Stateless-ready**: Transaction manager supports request-scoped transactions, ideal for REST/gRPC handlers.

## Installation

```bash
npm install peculiar-orm pg reflect-metadata inversify
npm install --save-dev @types/pg
```--

Ensure you have `experimentalDecorators` and `emitDecoratorMetadata` enabled in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

## Quick Start

### 1. Define Entities
Use decorators to define your database schema options.

```typescript
import { Column, Index, IndexType } from 'peculiar-orm';

export class User {
    @Column('uuid DEFAULT gen_random_uuid() PRIMARY KEY')
    id?: string;

    @Column('varchar(255) NOT NULL')
    @Index({ unique: true })
    email!: string;

    @Column('varchar(255)')
    name?: string;

    @Column('timestamp with time zone DEFAULT now()')
    createdAt?: Date;
}
```

### 2. Create a Repository
Extend `BaseRepository` to implement your data access logic. The base class provides helpers for query building, error handling, and transaction management.

```typescript
import { BaseRepository, TransactionManager } from 'peculiar-orm';
import { User } from './User';

export class UserRepository extends BaseRepository<User> {
    constructor(transactionManager: TransactionManager) {
        super(transactionManager, 'users');
    }

    async create(user: User): Promise<User> {
        const { columns, values, placeholders } = this.getEntityColumns(user);
        const sql = `
            INSERT INTO ${this.tableName} (${columns.join(', ')})
            VALUES (${placeholders.join(', ')})
            RETURNING *
        `;
        
        const result = await this.executeQuery<User>(sql, values);
        return result.rows[0];
    }

    async findById(id: string): Promise<User | null> {
        const sql = `SELECT * FROM ${this.tableName} WHERE id = $1`;
        const result = await this.executeQuery<User>(sql, [id]);
        return result.rows[0] || null;
    }

    // ... implement other abstract methods (update, delete, etc.)
}
```

### 3. Setup Dependencies
Configure the `ConnectionPoolManager` and `TransactionManager`.

```typescript
import { Container } from 'inversify';
import { ConnectionPoolManager, TransactionManager } from 'peculiar-orm';
import { UserRepository } from './UserRepository';

const container = new Container();

// 1. Configure the Pool
const poolConfig = {
    host: 'localhost',
    database: 'my_db',
    user: 'postgres',
    password: 'password',
    max: 20,
    idleTimeoutMillis: 30000
};

container.bind(ConnectionPoolManager).toDynamicValue(() => new ConnectionPoolManager(poolConfig)).inSingletonScope();

// 2. Bind TransactionManager
container.bind(TransactionManager).toSelf().inRequestScope(); 
// Note: InRequestScope is recommended for web apps to isolate transactions per request

// 3. Bind Repository
container.bind(UserRepository).toSelf();
```

### 4. Use in Application
Execute operations within a transaction.

```typescript
const transactionManager = container.get(TransactionManager);
const userRepo = container.get(UserRepository);

try {
    await transactionManager.beginTransaction();

    const newUser = await userRepo.create({
        email: 'alice@example.com',
        name: 'Alice'
    });

    console.log('User created:', newUser.id);

    await transactionManager.commit();
} catch (error) {
    console.error('Operation failed:', error);
    await transactionManager.rollback();
}
```

## Core Components

### ConnectionPoolManager
Manages the `pg` pool with added reliability features:
- **Metrics**: Tracks acquired/released connections, leasing durations, and wait times.
- **Query Timeouts**: Automatically cancels queries that exceed a threshold (default 10s) using `pg_cancel_backend`.
- **Diagnostics**: Logs warnings for long-running connections or pool exhaustion.

### TransactionManager
Handles the lifecycle of a database transaction.
- `beginTransaction(options)`: Starts a transaction (supports isolation levels).
- `commit()`: Commits changes.
- `rollback()`: Rolls back changes.
- `getMetrics()`: Returns stats on active/committed/rolled-back transactions.

### BaseRepository
A foundation for your repositories.
- **`executeQuery<T>(sql, params)`**: Wraps `pg` query execution with logging and standardized error handling (maps PG error codes to `DatabaseConstraintError`, `DatabaseConnectionError`, etc.).
- **Helpers**: `getEntityColumns`, `buildWhereClause`, `buildUpdateSet` help construct SQL dynamically.

## License
ISC
