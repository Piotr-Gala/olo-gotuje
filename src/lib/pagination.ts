// Each call must create a fresh query with a deterministic, unique ordering.
export async function fetchAllRows<T, E>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: E | null }>,
): Promise<{ data: T[]; error: E | null }> {
  const rows: T[] = [];
  const pageSize = 100;
  while (true) {
    const { data, error } = await page(rows.length, rows.length + pageSize - 1);
    if (error) return { data: [], error };
    if (!data?.length) return { data: rows, error: null };
    rows.push(...data);
    // Continue after short pages too: the API may enforce a lower row limit.
  }
}
