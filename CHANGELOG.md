# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-09-26

### Added
- `TransactionManager.runStandalone(fn)`: lease one pooled client with no transaction open, for reads. One round trip per statement instead of six for a `SELECT`. Joins an open transaction (or an outer lease) instead of taking a second client. `isStandalone()` reports the state; `standaloneLeases` is counted in the metrics.
- `TransactionOptions.localSettings`: `SET LOCAL` settings applied in the same round trip as `BEGIN`.
- `TransactionManager.beginStatement(options)`: the single-statement BEGIN, exposed for tests.
- `BaseRepository.executeQuery` refuses a non-read statement while a standalone lease is held, before it is sent. A `READ ONLY` transaction would have refused it after (SQLSTATE 25006); this refuses it earlier and never auto-commits a stray write.
- A test suite (`bun test`): fake-pool unit tests plus Postgres integration tests that skip when no local server is reachable.

### Changed
- `beginTransaction` sends `BEGIN [ISOLATION LEVEL ...] [READ ONLY|READ WRITE]; SET LOCAL ...` as one statement. Four round trips become one; behaviour is identical.

## [1.0.5] - 2026-08-12

### Fixed
- The client `'error'` listener is attached once per physical client (was re-added on every acquire, leaking listeners).

## [1.0.1] - 2026-01-21

### Fixed
- Fixed `package.json` repository URLs.
- Resolved build dependency issues.
- Added community health files (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `LICENSE`).

## [1.0.0] - 2026-01-09

### Added
- Initial release of `peculiar-orm`.
- Core features: `ConnectionPoolManager`, `TransactionManager`, `BaseRepository`.
- Decorators for Entity definitions (`@Column`, `@Index`).
- Comprehensive README and usage examples.
