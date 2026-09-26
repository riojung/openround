import { describe, expect, it } from "vitest";
import {
  createDatabaseTableFingerprints,
  parseDatabaseTableNames,
  quotePostgresIdentifier,
} from "../smoke/backup-restore-support.js";

describe("backup and restore table discovery", () => {
  it("parses the catalog table list without dropping newly added tables", () => {
    expect(parseDatabaseTableNames('["_openround_migrations","answers","new_table"]')).toEqual([
      "_openround_migrations",
      "answers",
      "new_table",
    ]);
  });

  it("rejects malformed or duplicate catalog output", () => {
    expect(() => parseDatabaseTableNames("not-json")).toThrow(
      "PostgreSQL returned an invalid durable-table list",
    );
    expect(() => parseDatabaseTableNames('["answers",null]')).toThrow(
      "PostgreSQL returned an invalid durable-table list",
    );
    expect(() => parseDatabaseTableNames('["answers","answers"]')).toThrow(
      "PostgreSQL returned duplicate durable-table names",
    );
  });

  it("quotes catalog identifiers before interpolating them into fingerprint queries", () => {
    expect(quotePostgresIdentifier("answers")).toBe('"answers"');
    expect(quotePostgresIdentifier('answers"; DROP TABLE users; --')).toBe(
      '"answers""; DROP TABLE users; --"',
    );
  });

  it("preserves fingerprints for table names that are inherited object properties", () => {
    const fingerprints = createDatabaseTableFingerprints();

    fingerprints.__proto__ = "1:prototype-fingerprint";
    fingerprints.constructor = "2:constructor-fingerprint";

    expect(Object.getPrototypeOf(fingerprints)).toBeNull();
    expect(Object.hasOwn(fingerprints, "__proto__")).toBe(true);
    expect(fingerprints.__proto__).toBe("1:prototype-fingerprint");
    expect(fingerprints.constructor).toBe("2:constructor-fingerprint");
  });
});
