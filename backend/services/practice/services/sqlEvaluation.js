import initSqlJs from "sql.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let SQLPromise;
const getSql = () => SQLPromise ||= initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
const cell = (value) => value instanceof Uint8Array ? Array.from(value) : value;
const rowsEqual = (left, right) => JSON.stringify(left.map((row) => row.map(cell))) === JSON.stringify(right.map((row) => row.map(cell)));

export const evaluateSqlAnswer = async ({ problem, query }) => {
  const normalized = query.trim().replace(/;\s*$/, "");
  if (!/^(select|with)\b/i.test(normalized) || normalized.includes(";") || /\bwith\s+recursive\b/i.test(normalized) || /\b(attach|detach|pragma|insert|update|delete|drop|create|alter|vacuum|load_extension)\b/i.test(normalized)) return { passed: false, actual: null, message: "Submit one read-only SELECT query without recursive CTEs." };
  const SQL = await getSql();
  const db = new SQL.Database();
  try {
    db.exec(problem.schemaSql);
    db.exec(problem.seedSql);
    const resultSets = db.exec(normalized);
    if (resultSets.length !== 1) return { passed: false, actual: null, message: "Write a query that returns one result set." };
    const actual = { columns: resultSets[0].columns, rows: resultSets[0].values };
    const expected = problem.expectedResult;
    const rows = actual.rows.map((row) => row.map(cell));
    const expectedRows = expected.rows.map((row) => row.map(cell));
    if (!problem.orderSensitive) { rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); expectedRows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); }
    const passed = actual.columns.length === expected.columns.length && actual.columns.every((name, index) => name === expected.columns[index]) && rowsEqual(rows, expectedRows);
    return { passed, actual, message: passed ? "Correct — result sets match." : "Not quite. Compare the columns and rows, then try again." };
  } catch (error) { return { passed: false, actual: null, message: error.message.slice(0, 240) }; }
  finally { db.close(); }
};
