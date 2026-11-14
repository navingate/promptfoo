"""Disposable, bounded SQLite execution for the F4 v9 alert-rule benchmark."""

import json
import os
import resource
import socket
import sqlite3
import sys
import time


SCHEMA = {
    "grants": ("capture_id", "grant_id", "client_id", "tenant", "principal_binding",
               "scopes_json", "catalog_scopes_json", "approval_route", "grantor_type",
               "verification_state", "issue_time", "refresh_lineage"),
    "events": ("capture_id", "event_id", "caused_by_event_id", "grant_id", "kind",
               "time", "resource", "credential_lineage", "export_ref"),
    "registry": ("capture_id", "policy_entry_id", "client_or_app_selector",
                 "tenant_selector", "principal_selector", "scope_selector",
                 "approval_route_selector", "valid_from", "valid_until", "revoked_at"),
    "base_policy": ("capture_id", "grantor_type", "approval_route",
                    "verification_state", "scopes_within_catalog"),
    "remediation": ("capture_id", "reset_time", "compromised_user"),
    "revoked_grants": ("capture_id", "grant_id"),
}
JSON_EACH_COLUMNS = {"key", "value", "type", "atom", "id", "parent", "fullkey", "path", "json", "root"}
FUNCTIONS = {
    "json_each", "json_valid", "json_extract", "json_type", "json_array_length",
    "coalesce", "ifnull", "nullif", "lower", "upper", "length", "substr", "trim",
    "abs", "min", "max", "count",
}


def sql_tokens(sql):
    """Yield unquoted SQL words, skipping SQLite comments and quoted text."""
    index = 0
    while index < len(sql):
        char = sql[index]
        following = sql[index:index + 2]
        if following == "--":
            newline = sql.find("\n", index + 2)
            index = len(sql) if newline < 0 else newline + 1
        elif following == "/*":
            end = sql.find("*/", index + 2)
            index = len(sql) if end < 0 else end + 2
        elif char in ("'", '"', "`", "["):
            closing = "]" if char == "[" else char
            index += 1
            while index < len(sql):
                if sql[index] == closing:
                    index += 1
                    if closing != "]" and index < len(sql) and sql[index] == closing:
                        index += 1
                        continue
                    break
                index += 1
        elif char.isascii() and (char.isalpha() or char == "_"):
            end = index + 1
            while end < len(sql) and sql[end].isascii() and (sql[end].isalnum() or sql[end] == "_"):
                end += 1
            yield sql[index:end].upper()
            index = end
        else:
            index += 1


def install_memory_limit():
    limit = int(os.environ["F4_SQL_MEMORY_LIMIT"])
    if limit < 64 * 1024 * 1024:
        raise ValueError("memory limit too small")
    try:
        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
    except (ValueError, OSError) as error:
        raise RuntimeError("process memory limit unavailable") from error
    soft, hard = resource.getrlimit(resource.RLIMIT_AS)
    if (soft, hard) != (limit, limit):
        raise RuntimeError("memory limit not enforced")
    return limit


def authorizer(action, arg1, arg2, _database, _source):
    if action == sqlite3.SQLITE_SELECT:
        return sqlite3.SQLITE_OK
    if action == sqlite3.SQLITE_READ:
        if arg1 in SCHEMA and (arg2 in SCHEMA[arg1] or arg2 == ""):
            return sqlite3.SQLITE_OK
        if arg1 == "json_each" and (arg2 in JSON_EACH_COLUMNS or arg2 == ""):
            return sqlite3.SQLITE_OK
    if action == sqlite3.SQLITE_FUNCTION and (arg2 or arg1 or "").lower() in FUNCTIONS:
        return sqlite3.SQLITE_OK
    return sqlite3.SQLITE_DENY


def create_tables(connection, tables):
    if not isinstance(tables, dict) or set(tables) != set(SCHEMA):
        raise ValueError("exactly six published tables required")
    for name, columns in SCHEMA.items():
        definitions = ", ".join(
            f'"{column}" {"INTEGER" if column in {"issue_time", "time", "valid_from", "valid_until", "revoked_at", "reset_time", "scopes_within_catalog"} else "TEXT"}'
            for column in columns
        )
        connection.execute(f'CREATE TABLE "{name}" ({definitions})')
        rows = tables[name]
        if not isinstance(rows, list) or len(rows) > 10000:
            raise ValueError("table row limit exceeded")
        placeholders = ", ".join("?" for _ in columns)
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError("table rows must be objects")
            values = [row.get(column) for column in columns]
            if any(isinstance(value, (dict, list)) for value in values):
                raise ValueError("projected columns must be scalar")
            connection.execute(f'INSERT INTO "{name}" VALUES ({placeholders})', values)


def run_one(request, tables, deadline):
    sql = request["sql"]
    if not isinstance(sql, str) or len(sql.encode("utf-8")) > 8192:
        raise ValueError("SQL exceeds 8192 bytes")
    tokens = sql_tokens(sql)
    if next(tokens, None) not in {"SELECT", "WITH"}:
        raise ValueError("one SELECT statement required")
    if "RECURSIVE" in tokens:
        raise ValueError("recursive SQL denied")
    connection = sqlite3.connect(":memory:")
    connection.enable_load_extension(False)
    connection.execute("PRAGMA temp_store=MEMORY")
    connection.execute("PRAGMA trusted_schema=OFF")
    create_tables(connection, tables)
    connection.execute("PRAGMA query_only=ON")
    connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 1024 * 1024)
    connection.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 8192)
    valid_ids = {row["grant_id"] for row in tables["grants"]}
    max_steps = int(request.get("maxVmSteps", 2_000_000))
    if not 1 <= max_steps <= 10_000_000:
        raise ValueError("invalid VM step limit")
    steps = 0

    def progress():
        nonlocal steps
        steps += 100
        return int(steps > max_steps or time.monotonic() > deadline)

    connection.set_authorizer(authorizer)
    connection.set_progress_handler(progress, 100)
    if time.monotonic() > deadline:
        raise TimeoutError("SQL execution budget exceeded")
    cursor = connection.execute(sql, {"protected_scope": request["protectedScope"]})
    if [column[0] for column in cursor.description] != ["grant_id"]:
        raise ValueError("result must have one grant_id column")
    max_rows = int(request.get("maxRows", 1024))
    max_bytes = int(request.get("maxOutputBytes", 262144))
    if not 0 <= max_rows <= 10000 or not 0 <= max_bytes <= 1048576:
        raise ValueError("invalid output limit")
    output = []
    seen = set()
    used_bytes = 0
    for index, (grant_id,) in enumerate(cursor):
        if time.monotonic() > deadline:
            raise TimeoutError("SQL execution budget exceeded")
        if index >= max_rows:
            raise ValueError("row limit exceeded")
        if not isinstance(grant_id, str) or grant_id not in valid_ids:
            raise ValueError("result contains an unknown or non-string grant_id")
        used_bytes += len(grant_id.encode("utf-8"))
        if used_bytes > max_bytes:
            raise ValueError("output byte limit exceeded")
        if grant_id not in seen:
            seen.add(grant_id)
            output.append(grant_id)
    return output


def preflight(limit):
    connection = sqlite3.connect(":memory:")
    connection.enable_load_extension(False)
    json_result = connection.execute("SELECT json_valid('[]'), json_extract('[1]', '$[0]')").fetchone()
    try:
        _pressure = bytearray(limit * 2)
        del _pressure
        pressure_denied = False
    except MemoryError:
        pressure_denied = True
    write_denied = True
    for path in ("/app/f4-preflight-write", "/etc/f4-preflight-write"):
        try:
            with open(path, "ab") as stream:
                stream.write(b"x")
            write_denied = False
            os.unlink(path)
        except OSError:
            pass
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.2)
        network_denied = probe.connect_ex(("1.1.1.1", 53)) != 0
    tables = {name: [] for name in SCHEMA}
    tables["grants"] = [{"capture_id": "preflight-capture", "grant_id": "preflight-grant",
                          "scopes_json": "[1,2,3,4,5,6,7,8,9,10]"}]
    base = {"tables": tables, "protectedScope": "reports.export"}
    deadline = time.monotonic() + 5
    normal_query = run_one({**base, "sql": "SELECT grant_id FROM grants"}, tables, deadline)
    forbidden = [
        "DELETE FROM grants", "ATTACH DATABASE '/tmp/f4-preflight.sqlite' AS external",
        "PRAGMA database_list", "SELECT name AS grant_id FROM sqlite_master",
        "SELECT load_extension('x') AS grant_id", "SELECT randomblob(8) AS grant_id FROM grants",
        "SELECT grant_id FROM grants; SELECT grant_id FROM grants",
        "WITH /* gap */ RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x) SELECT grant_id FROM grants",
    ]
    for sql in forbidden:
        try:
            run_one({**base, "sql": sql}, tables, deadline)
        except (ValueError, sqlite3.Error):
            continue
        raise RuntimeError("forbidden SQL preflight failed")
    for overrides in ({"maxRows": 0}, {"maxOutputBytes": 1}, {"maxVmSteps": 100}):
        sql = ("SELECT g.grant_id FROM grants g, json_each(g.scopes_json) a, json_each(g.scopes_json) b"
               if "maxVmSteps" in overrides else "SELECT grant_id FROM grants")
        try:
            run_one({**base, "sql": sql, **overrides}, tables, deadline)
        except (ValueError, sqlite3.Error):
            continue
        raise RuntimeError("SQL limit preflight failed")
    return {
        "memoryLimitEnforced": resource.getrlimit(resource.RLIMIT_AS) == (limit, limit),
        "memoryPressureDenied": pressure_denied,
        "jsonFunctionsAvailable": json_result == (1, 1),
        "environmentStripped": set(os.environ) <= {"F4_SQL_MEMORY_LIMIT", "PATH", "LANG", "LC_ALL"},
        "filesystemReadOnly": write_denied,
        "rootFilesystemReadOnly": bool(os.statvfs("/").f_flag & os.ST_RDONLY),
        "nonRootUser": os.getuid() == 65534,
        "networkUnavailable": network_denied,
        "normalQueryPassed": normal_query == ["preflight-grant"],
        "forbiddenActionsDenied": True,
        "outputAndVmLimitsEnforced": True,
    }


def run(request, limit):
    if request.get("mode") == "preflight":
        return preflight(limit)
    batches = request.get("batches")
    if batches is None:
        batches = [request["tables"]]
    if not isinstance(batches, list) or not 1 <= len(batches) <= 36:
        raise ValueError("invalid corpus batch count")
    query_timeout_ms = int(request.get("queryTimeoutMs", 5000))
    if not 1 <= query_timeout_ms <= 5000:
        raise ValueError("invalid SQL execution budget")
    deadline = time.monotonic() + query_timeout_ms / 1000
    started = time.monotonic()
    results = []
    total_rows = 0
    total_bytes = 0
    for tables in batches:
        result = run_one(request, tables, deadline)
        results.append(result)
        total_rows += len(result)
        total_bytes += sum(len(grant_id.encode("utf-8")) for grant_id in result)
        if total_rows > 4096 or total_bytes > 262144:
            raise ValueError("corpus output limit exceeded")
    return {"grant_ids_by_batch": results, "queryDurationMs": round((time.monotonic() - started) * 1000, 3)}


def main():
    try:
        limit = install_memory_limit()
        raw = sys.stdin.buffer.read(16 * 1024 * 1024 + 1)
        if len(raw) > 16 * 1024 * 1024:
            raise ValueError("input byte limit exceeded")
        result = run(json.loads(raw), limit)
        sys.stdout.write(json.dumps({"ok": True, **result}, separators=(",", ":")))
    except (Exception, MemoryError) as error:
        sys.stdout.write(json.dumps({"ok": False, "error": str(error)[:300]}, separators=(",", ":")))
        sys.exit(1)


if __name__ == "__main__":
    main()
