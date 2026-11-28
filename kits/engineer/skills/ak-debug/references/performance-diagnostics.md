# Performance Diagnostics

Measure before optimizing: record the expected and actual numbers, when degradation started,
which operations are affected, and whether it is consistent. Those numbers are the baseline
every change must beat.

## Find the Bottleneck Layer

Measure time at each layer to find where the delay occurs.

| Layer | Check | Tool |
|-------|-------|------|
| Network | Latency, DNS, TLS | `curl -w` timing, network logs |
| Web server | Request queue, connections | Server metrics, access logs |
| Application | CPU profiling, memory | Profiler, APM, `process.memoryUsage()` |
| Database | Query time, connections | `EXPLAIN ANALYZE`, `pg_stat_statements` |
| Filesystem | I/O wait, disk usage | `iostat`, `df -h` |
| External APIs | Response time, timeouts | Request logging with durations |

## Database (PostgreSQL)

```sql
-- Slow queries (requires pg_stat_statements extension)
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC LIMIT 20;

-- Active queries right now
SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY duration DESC;

-- Table sizes and bloat
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC LIMIT 20;

-- Missing indexes (sequential scans on large tables)
SELECT relname, seq_scan, seq_tup_read, idx_scan
FROM pg_stat_user_tables
WHERE seq_scan > 100 AND seq_tup_read > 10000
ORDER BY seq_tup_read DESC;

-- Connection pool status
SELECT count(*), state FROM pg_stat_activity GROUP BY state;
```

```sql
-- Analyze specific query execution plan
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) <your-query>;
```

**Look for:** Sequential scans on large tables, nested loops with high row counts, sorts without indexes, excessive buffer hits.

## Application Bottlenecks

| Issue | Symptom | Fix |
|-------|---------|-----|
| N+1 queries | Many small DB calls per request | Eager loading, batch queries |
| Memory leaks | Growing memory over time | Profile heap, check event listeners |
| Blocking I/O | High response time, low CPU | Async operations, connection pooling |
| CPU-bound | High CPU, proportional to load | Optimize algorithms, caching |
| Connection exhaustion | Intermittent timeouts | Pool sizing, connection reuse |
| Large payloads | Slow transfers, high memory | Pagination, compression, streaming |

## Optimization Order

Try quick wins (missing index, N+1 query, caching), then configuration (pool sizes, timeouts,
buffers, workers), then code changes, then architecture (caching layer, read replicas, async
processing, CDN). Make one change at a time and measure against the baseline after each. Report
baseline versus current numbers, the bottleneck evidence, the cause, and the expected impact of
each recommended fix. Before reporting any before/after number, apply
`../../ak-test/references/explain-the-number.md` and state its verdict and named limiter.
