export function createQueryMetrics() {
  const startedAt = Date.now();
  const queries = [];

  return {
    async measure(label, promiseFactory) {
      const queryStartedAt = Date.now();
      const result = await promiseFactory();
      const rows = Array.isArray(result?.data) ? result.data.length : (result?.data ? 1 : 0);

      queries.push({
        label,
        ms: Date.now() - queryStartedAt,
        rows,
      });

      return result;
    },
    summary(extra = {}) {
      return {
        total_ms: Date.now() - startedAt,
        query_count: queries.length,
        rows_read: queries.reduce((acc, query) => acc + Number(query.rows || 0), 0),
        queries,
        ...extra,
      };
    },
  };
}
