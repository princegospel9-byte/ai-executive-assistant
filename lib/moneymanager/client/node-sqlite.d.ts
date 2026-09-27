// Minimal ambient type declaration for node:sqlite. The installed
// @types/node (^20) predates this Node built-in (stabilized in Node 22+ /
// used here on Node 24) so TypeScript doesn't know about it yet. Only the
// surface lib/moneymanager actually uses is declared - not a full mirror of
// Node's sqlite API.
declare module 'node:sqlite' {
  export interface DatabaseSyncOptions {
    readOnly?: boolean;
    open?: boolean;
    enableForeignKeyConstraints?: boolean;
  }

  export interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  export class StatementSync {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): StatementResultingChanges;
  }

  export class DatabaseSync {
    constructor(location: string, options?: DatabaseSyncOptions);
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
  }
}
