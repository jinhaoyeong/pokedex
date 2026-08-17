declare module "better-sqlite3" {
  interface Statement {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }

  interface Database {
    prepare(sql: string): Statement;
    close(): void;
  }

  interface DatabaseConstructor {
    new (
      filename: string,
      options?: { readonly?: boolean; fileMustExist?: boolean },
    ): Database;
  }

  const Database: DatabaseConstructor;
  export default Database;
}
