/**
 * SQL Emulator for micro:bit
 * ---------------------------------
 * A lightweight, in-memory SQL-like database engine for the BBC micro:bit.
 * Every mutating operation (CREATE / DROP / INSERT / UPDATE / DELETE) is
 * also written to the built-in Data Logger, so the full history of the
 * database can be recovered later as a CSV file by connecting the
 * micro:bit to a computer (drag MY_DATA.HTM from the micro:bit drive).
 *
 * Supported SQL-like statements (via sql.query):
 *   CREATE TABLE name (col1, col2, col3)
 *   DROP TABLE name
 *   INSERT INTO name VALUES (v1, v2, v3)
 *   SELECT * FROM name [WHERE col OP value]
 *   UPDATE name SET col = value [WHERE col OP value]
 *   DELETE FROM name [WHERE col OP value]
 *
 * OP can be one of: = != < > <= >=
 * Only a single WHERE condition is supported (no AND / OR chaining).
 *
 * All of the same functionality is also exposed as individual blocks
 * (createTable, insert, select, update, deleteRows, ...) for people who
 * prefer not to type raw SQL text.
 */

//% weight=100 color=#0078D7 icon="\uf1c0" block="SQL DB"
namespace sql {

    // ---------------------------------------------------------------
    // Comparison operators used in WHERE clauses
    // ---------------------------------------------------------------
    export enum CompareOp {
        //% block="="
        Equal,
        //% block="!="
        NotEqual,
        //% block="<"
        Less,
        //% block=">"
        Greater,
        //% block="<="
        LessOrEqual,
        //% block=">="
        GreaterOrEqual
    }

    // ---------------------------------------------------------------
    // Aggregate functions
    // ---------------------------------------------------------------
    export enum AggFunc {
        //% block="count"
        Count,
        //% block="sum"
        Sum,
        //% block="average"
        Average,
        //% block="min"
        Min,
        //% block="max"
        Max
    }

    // ---------------------------------------------------------------
    // Internal data model
    // ---------------------------------------------------------------
    class Row {
        values: string[]
        constructor(values: string[]) {
            this.values = values
        }
    }

    class Table {
        name: string
        columns: string[]
        rows: Row[]
        constructor(name: string, columns: string[]) {
            this.name = name
            this.columns = columns
            this.rows = []
        }
        colIndex(col: string): number {
            for (let i = 0; i < this.columns.length; i++) {
                if (this.columns[i] == col) return i
            }
            return -1
        }
    }

    class Condition {
        column: string
        op: CompareOp
        value: string
    }

    let tables: Table[] = []
    let lastResult: Row[] = []
    let lastResultColumns: string[] = []
    let loggerReady = false

    // ---------------------------------------------------------------
    // Data logger helpers - this is where the "storage" happens
    // ---------------------------------------------------------------
    function ensureLogger(): void {
        if (loggerReady) return
        datalogger.setColumnTitles("op", "table", "detail")
        datalogger.includeTimestamp(FlashLogTimeStampFormat.Milliseconds)
        loggerReady = true
    }

    function logEvent(op: string, table: string, detail: string): void {
        ensureLogger()
        datalogger.log(
            datalogger.createCV("op", op),
            datalogger.createCV("table", table),
            datalogger.createCV("detail", detail)
        )
    }

    // ---------------------------------------------------------------
    // Small string / number helpers
    // (avoids relying on parseFloat / isNaN which are not reliable
    // inside the restricted micro:bit compiler)
    // ---------------------------------------------------------------
    function isDigit(c: string): boolean {
        return c >= "0" && c <= "9"
    }

    function isNumericString(s: string): boolean {
        if (!s || s.length == 0) return false
        let i = 0
        if (s.charAt(0) == "-" || s.charAt(0) == "+") i = 1
        let dotCount = 0
        let digits = 0
        for (; i < s.length; i++) {
            let c = s.charAt(i)
            if (c == ".") {
                dotCount += 1
                if (dotCount > 1) return false
            } else if (isDigit(c)) {
                digits += 1
            } else {
                return false
            }
        }
        return digits > 0
    }

    function toNumber(s: string): number {
        if (!isNumericString(s)) return 0
        let neg = false
        let i = 0
        if (s.charAt(0) == "-") {
            neg = true
            i = 1
        } else if (s.charAt(0) == "+") {
            i = 1
        }
        let intPart = 0
        while (i < s.length && s.charAt(i) != ".") {
            intPart = intPart * 10 + (s.charCodeAt(i) - 48)
            i += 1
        }
        let frac = 0
        let fracDiv = 1
        if (i < s.length && s.charAt(i) == ".") {
            i += 1
            while (i < s.length) {
                frac = frac * 10 + (s.charCodeAt(i) - 48)
                fracDiv = fracDiv * 10
                i += 1
            }
        }
        let result = intPart + frac / fracDiv
        return neg ? -result : result
    }

    function stripQuotes(s: string): string {
        let t = s.trim()
        if (t.length >= 2) {
            let f = t.charAt(0)
            let l = t.charAt(t.length - 1)
            if ((f == "'" && l == "'") || (f == "\"" && l == "\"")) {
                return t.substr(1, t.length - 2)
            }
        }
        return t
    }

    function splitAndTrim(s: string): string[] {
        let parts = s.split(",")
        let result: string[] = []
        for (let p of parts) {
            result.push(stripQuotes(p))
        }
        return result
    }

    function compareValues(a: string, b: string, op: CompareOp): boolean {
        let numeric = isNumericString(a) && isNumericString(b)
        if (numeric) {
            let na = toNumber(a)
            let nb = toNumber(b)
            switch (op) {
                case CompareOp.Equal: return na == nb
                case CompareOp.NotEqual: return na != nb
                case CompareOp.Less: return na < nb
                case CompareOp.Greater: return na > nb
                case CompareOp.LessOrEqual: return na <= nb
                case CompareOp.GreaterOrEqual: return na >= nb
            }
        } else {
            switch (op) {
                case CompareOp.Equal: return a == b
                case CompareOp.NotEqual: return a != b
                case CompareOp.Less: return a < b
                case CompareOp.Greater: return a > b
                case CompareOp.LessOrEqual: return a <= b
                case CompareOp.GreaterOrEqual: return a >= b
            }
        }
        return false
    }

    function findTable(name: string): Table {
        for (let t of tables) {
            if (t.name == name) return t
        }
        return null
    }

    function matchRows(t: Table, whereColumn: string, op: CompareOp, whereValue: string): number[] {
        let result: number[] = []
        if (!whereColumn || whereColumn.length == 0) {
            for (let i = 0; i < t.rows.length; i++) result.push(i)
            return result
        }
        let idx = t.colIndex(whereColumn)
        if (idx < 0) return result
        for (let i = 0; i < t.rows.length; i++) {
            if (compareValues(t.rows[i].values[idx], whereValue, op)) result.push(i)
        }
        return result
    }

    // =================================================================
    //  BLOCK API - core CRUD operations
    // =================================================================

    /**
     * Create a new table with the given comma separated column names.
     * Data is stored in RAM and every change is also written to the
     * data logger.
     */
    //% blockId=sql_create_table
    //% block="create table %name with columns %columns"
    //% columns.defl="col1,col2,col3"
    //% weight=95
    export function createTable(name: string, columns: string): void {
        if (findTable(name)) return
        let cols = splitAndTrim(columns)
        let t = new Table(name, cols)
        tables.push(t)
        logEvent("CREATE", name, columns)
    }

    /**
     * Delete a whole table and all of its rows.
     */
    //% blockId=sql_drop_table
    //% block="drop table %name"
    //% weight=94
    export function dropTable(name: string): void {
        for (let i = 0; i < tables.length; i++) {
            if (tables[i].name == name) {
                tables.splice(i, 1)
                logEvent("DROP", name, "")
                return
            }
        }
    }

    /**
     * Insert one new row of comma separated values into a table.
     * Values must be given in the same order as the table's columns.
     */
    //% blockId=sql_insert
    //% block="insert into %name values %values"
    //% weight=93
    export function insert(name: string, values: string): void {
        let t = findTable(name)
        if (!t) return
        let vals = splitAndTrim(values)
        t.rows.push(new Row(vals))
        logEvent("INSERT", name, values)
    }

    /**
     * Select rows from a table matching a single WHERE condition.
     * Leave whereColumn empty to select every row.
     * Returns the number of matching rows (also stored for reading with
     * resultRowCount / resultCell / resultAsText).
     */
    //% blockId=sql_select
    //% block="select from %name where %whereColumn %op %whereValue"
    //% weight=92
    export function select(name: string, whereColumn: string, op: CompareOp, whereValue: string): number {
        let t = findTable(name)
        lastResult = []
        lastResultColumns = []
        if (!t) return 0
        lastResultColumns = t.columns
        let idxs = matchRows(t, whereColumn, op, whereValue)
        for (let i of idxs) lastResult.push(t.rows[i])
        return lastResult.length
    }

    /**
     * Select every row of a table (equivalent to SELECT * FROM name).
     */
    //% blockId=sql_select_all
    //% block="select all from %name"
    //% weight=91
    export function selectAll(name: string): number {
        return select(name, "", CompareOp.Equal, "")
    }

    /**
     * Update every row matching a WHERE condition, setting one column to
     * a new value. Leave whereColumn empty to update every row.
     * Returns the number of rows changed.
     */
    //% blockId=sql_update
    //% block="update %name set %setColumn to %setValue where %whereColumn %op %whereValue"
    //% weight=90
    export function update(name: string, setColumn: string, setValue: string, whereColumn: string, op: CompareOp, whereValue: string): number {
        let t = findTable(name)
        if (!t) return 0
        let setIdx = t.colIndex(setColumn)
        if (setIdx < 0) return 0
        let idxs = matchRows(t, whereColumn, op, whereValue)
        for (let i of idxs) t.rows[i].values[setIdx] = setValue
        logEvent("UPDATE", name, setColumn + "=" + setValue)
        return idxs.length
    }

    /**
     * Delete every row matching a WHERE condition.
     * Leave whereColumn empty to delete every row in the table.
     * Returns the number of rows removed.
     */
    //% blockId=sql_delete
    //% block="delete from %name where %whereColumn %op %whereValue"
    //% weight=89
    export function deleteRows(name: string, whereColumn: string, op: CompareOp, whereValue: string): number {
        let t = findTable(name)
        if (!t) return 0
        let idxs = matchRows(t, whereColumn, op, whereValue)
        for (let k = idxs.length - 1; k >= 0; k--) {
            t.rows.splice(idxs[k], 1)
        }
        logEvent("DELETE", name, whereColumn + " " + whereValue)
        return idxs.length
    }

    // =================================================================
    //  BLOCK API - reading back the last select() result
    // =================================================================

    /**
     * Sort the current result set (from the last select) by a column.
     */
    //% blockId=sql_order_by
    //% block="order results by %column||descending %descending"
    //% expandableArgumentMode="toggle"
    //% weight=85
    export function orderResultsBy(column: string, descending?: boolean): void {
        let idx = -1
        for (let i = 0; i < lastResultColumns.length; i++) {
            if (lastResultColumns[i] == column) idx = i
        }
        if (idx < 0) return
        for (let i = 0; i < lastResult.length; i++) {
            for (let j = 0; j < lastResult.length - i - 1; j++) {
                let a = lastResult[j].values[idx]
                let b = lastResult[j + 1].values[idx]
                let numeric = isNumericString(a) && isNumericString(b)
                let shouldSwap: boolean
                if (numeric) {
                    shouldSwap = descending ? toNumber(a) < toNumber(b) : toNumber(a) > toNumber(b)
                } else {
                    shouldSwap = descending ? a < b : a > b
                }
                if (shouldSwap) {
                    let tmp = lastResult[j]
                    lastResult[j] = lastResult[j + 1]
                    lastResult[j + 1] = tmp
                }
            }
        }
    }

    /**
     * Keep only the first n rows of the current result set.
     */
    //% blockId=sql_limit
    //% block="limit results to %n"
    //% weight=84
    export function limitResults(n: number): void {
        if (lastResult.length > n) lastResult = lastResult.slice(0, n)
    }

    /**
     * Number of rows in the current result set (from the last select).
     */
    //% blockId=sql_result_row_count
    //% block="result row count"
    //% weight=83
    export function resultRowCount(): number {
        return lastResult.length
    }

    /**
     * Read one cell out of the current result set.
     */
    //% blockId=sql_result_cell
    //% block="result row %row column %column"
    //% weight=82
    export function resultCell(row: number, column: string): string {
        if (row < 0 || row >= lastResult.length) return ""
        let idx = -1
        for (let i = 0; i < lastResultColumns.length; i++) {
            if (lastResultColumns[i] == column) idx = i
        }
        if (idx < 0) return ""
        return lastResult[row].values[idx]
    }

    /**
     * Return the whole current result set as CSV-style text
     * (header row, then one row per line).
     */
    //% blockId=sql_result_as_text
    //% block="result as text"
    //% weight=81
    export function resultAsText(): string {
        let s = lastResultColumns.join(",") + "\n"
        for (let r of lastResult) {
            s += r.values.join(",") + "\n"
        }
        return s
    }

    // =================================================================
    //  BLOCK API - aggregates & table info
    // =================================================================

    /**
     * Run an aggregate function (count / sum / average / min / max) over
     * a column, optionally filtered by a WHERE condition.
     */
    //% blockId=sql_aggregate
    //% block="%func of column %column in %name where %whereColumn %op %whereValue"
    //% weight=75
    export function aggregate(func: AggFunc, column: string, name: string, whereColumn: string, op: CompareOp, whereValue: string): number {
        let t = findTable(name)
        if (!t) return 0
        let idxs = matchRows(t, whereColumn, op, whereValue)
        if (func == AggFunc.Count) return idxs.length
        let colIdx = t.colIndex(column)
        if (colIdx < 0) return 0
        let sum = 0
        let count = 0
        let mn = 0
        let mx = 0
        let first = true
        for (let i of idxs) {
            let v = toNumber(t.rows[i].values[colIdx])
            sum += v
            count += 1
            if (first) {
                mn = v
                mx = v
                first = false
            } else {
                if (v < mn) mn = v
                if (v > mx) mx = v
            }
        }
        if (func == AggFunc.Sum) return sum
        if (func == AggFunc.Average) return count > 0 ? sum / count : 0
        if (func == AggFunc.Min) return mn
        if (func == AggFunc.Max) return mx
        return 0
    }

    /**
     * Number of rows currently stored in a table.
     */
    //% blockId=sql_row_count
    //% block="row count of %name"
    //% weight=74
    export function rowCount(name: string): number {
        let t = findTable(name)
        return t ? t.rows.length : 0
    }

    /**
     * True if a table with this name currently exists.
     */
    //% blockId=sql_table_exists
    //% block="table %name exists"
    //% weight=73
    export function tableExists(name: string): boolean {
        return findTable(name) != null
    }

    /**
     * Remove every table and every row from memory.
     * (Does not erase the history already written to the data logger -
     * use clearLog() for that.)
     */
    //% blockId=sql_clear_all
    //% block="clear all tables"
    //% weight=72
    export function clearAll(): void {
        tables = []
        lastResult = []
        lastResultColumns = []
        logEvent("CLEAR", "*", "")
    }

    // =================================================================
    //  BLOCK API - data logger storage
    // =================================================================

    /**
     * Write the full current contents of a table into the data logger,
     * one log row per database row. Use this to take a snapshot you can
     * retrieve later as a CSV file from the micro:bit's USB drive.
     */
    //% blockId=sql_export_snapshot
    //% block="save snapshot of table %name to data logger"
    //% weight=65
    export function exportSnapshot(name: string): void {
        let t = findTable(name)
        if (!t) return
        ensureLogger()
        for (let r of t.rows) {
            datalogger.log(
                datalogger.createCV("op", "SNAPSHOT"),
                datalogger.createCV("table", name),
                datalogger.createCV("detail", r.values.join(" "))
            )
        }
    }

    /**
     * Erase the entire data logger history stored in flash memory.
     */
    //% blockId=sql_clear_log
    //% block="clear data logger history"
    //% weight=64
    export function clearLog(): void {
        datalogger.deleteLog()
        loggerReady = false
    }

    // =================================================================
    //  BLOCK API - raw SQL text parser
    // =================================================================

    function parseCondition(s: string): Condition {
        let c = new Condition()
        let ops = ["<=", ">=", "!=", "=", "<", ">"]
        for (let o of ops) {
            let idx = s.indexOf(o)
            if (idx >= 0) {
                c.column = s.substr(0, idx).trim()
                c.value = stripQuotes(s.substr(idx + o.length))
                if (o == "=") c.op = CompareOp.Equal
                else if (o == "!=") c.op = CompareOp.NotEqual
                else if (o == "<=") c.op = CompareOp.LessOrEqual
                else if (o == ">=") c.op = CompareOp.GreaterOrEqual
                else if (o == "<") c.op = CompareOp.Less
                else c.op = CompareOp.Greater
                return c
            }
        }
        c.column = ""
        c.op = CompareOp.Equal
        c.value = ""
        return c
    }

    /**
     * Run a small SQL statement written as plain text, for example:
     *   CREATE TABLE pets (name, kind, age)
     *   INSERT INTO pets VALUES (Rex, dog, 3)
     *   SELECT * FROM pets WHERE kind = dog
     *   UPDATE pets SET age = 4 WHERE 
