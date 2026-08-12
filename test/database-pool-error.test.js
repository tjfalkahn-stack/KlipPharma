import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { attachPostgresPoolErrorHandler } from "../lib/database.js";

test("PostgreSQL pool errors are handled without leaking connection details", () => {
  const pool = new EventEmitter();
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);

  try {
    attachPostgresPoolErrorHandler(pool);
    const error = Object.assign(new Error("Connection terminated unexpectedly postgres://user:secret@host/db"), {
      code: "57P01",
      password: "secret",
      connectionString: "postgres://user:secret@host/db",
    });
    assert.doesNotThrow(() => pool.emit("error", error));
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(logs, [["Unexpected PostgreSQL pool error: 57P01"]]);
});
