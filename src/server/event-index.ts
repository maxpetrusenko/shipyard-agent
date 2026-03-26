// ---------------------------------------------------------------------------
// EventIndex — secondary-indexed in-memory store for InvokeEvents
//
// Maintains O(1) add/remove/get and O(k) filtered queries where k is the
// size of the smallest matching index bucket, instead of O(n) full scans.
// ---------------------------------------------------------------------------

/**
 * Generic indexed collection.  Items must have a string `id` field.
 * Secondary indexes are built for each field name passed to the constructor.
 * Insertion order is preserved (newest-first) for query results.
 */
export class EventIndex<T extends { id: string }> {
  /** Primary lookup: id -> item */
  private byId: Map<string, T> = new Map();

  /** Secondary indexes: field -> value -> Set<id> */
  private byField: Map<string, Map<string, Set<string>>> = new Map();

  /** Ordered IDs (newest first — mirrors the old unshift-based array) */
  private ordered: string[] = [];

  constructor(private indexedFields: string[]) {
    for (const f of indexedFields) {
      this.byField.set(f, new Map());
    }
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  /** Add an item.  Prepends (newest-first ordering). */
  add(item: T): void {
    const id = item.id;
    if (this.byId.has(id)) return; // idempotent
    this.byId.set(id, item);
    this.ordered.unshift(id);

    for (const field of this.indexedFields) {
      const value = String((item as Record<string, unknown>)[field] ?? '');
      const fieldMap = this.byField.get(field)!;
      let bucket = fieldMap.get(value);
      if (!bucket) {
        bucket = new Set();
        fieldMap.set(value, bucket);
      }
      bucket.add(id);
    }
  }

  /** Remove an item by id.  Returns the removed item or undefined. */
  remove(id: string): T | undefined {
    const item = this.byId.get(id);
    if (!item) return undefined;

    this.byId.delete(id);

    for (const field of this.indexedFields) {
      const value = String((item as Record<string, unknown>)[field] ?? '');
      const fieldMap = this.byField.get(field)!;
      const bucket = fieldMap.get(value);
      if (bucket) {
        bucket.delete(id);
        if (bucket.size === 0) fieldMap.delete(value);
      }
    }

    // Remove from ordered list — scan from tail (eviction removes oldest)
    const idx = this.ordered.lastIndexOf(id);
    if (idx !== -1) this.ordered.splice(idx, 1);

    return item;
  }

  /**
   * Evict the oldest `count` items.  Returns evicted items (oldest first).
   * More efficient than repeated `remove()` because it trims the ordered
   * array in one splice.
   */
  evict(count: number): T[] {
    if (count <= 0) return [];
    const toRemove = this.ordered.splice(this.ordered.length - count, count);
    const evicted: T[] = [];
    for (const id of toRemove) {
      const item = this.byId.get(id);
      if (!item) continue;
      this.byId.delete(id);
      for (const field of this.indexedFields) {
        const value = String((item as Record<string, unknown>)[field] ?? '');
        const fieldMap = this.byField.get(field)!;
        const bucket = fieldMap.get(value);
        if (bucket) {
          bucket.delete(id);
          if (bucket.size === 0) fieldMap.delete(value);
        }
      }
      evicted.push(item);
    }
    return evicted;
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** Get a single item by id. */
  get(id: string): T | undefined {
    return this.byId.get(id);
  }

  /** Total number of items. */
  size(): number {
    return this.byId.size;
  }

  /** All items in insertion order (newest first). */
  all(limit?: number): T[] {
    const ids = limit != null && limit < this.ordered.length
      ? this.ordered.slice(0, limit)
      : this.ordered;
    const result: T[] = [];
    for (const id of ids) {
      const item = this.byId.get(id);
      if (item) result.push(item);
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Filtered query
  // -------------------------------------------------------------------------

  /**
   * Return items matching ALL provided filters, in insertion order.
   *
   * Only indexed fields are used.  Non-indexed filter keys are silently
   * ignored (they never match).  If `filters` is empty, returns all items.
   */
  query(filters: Record<string, string>, limit?: number): T[] {
    const activeFilters = Object.entries(filters).filter(
      ([, v]) => v !== '' && v !== undefined,
    );

    // No filters — return everything (with optional limit)
    if (activeFilters.length === 0) return this.all(limit);

    // Gather candidate ID sets from each filter
    const sets: Set<string>[] = [];
    for (const [field, value] of activeFilters) {
      const fieldMap = this.byField.get(field);
      if (!fieldMap) return []; // non-indexed field -> no matches
      const bucket = fieldMap.get(value);
      if (!bucket || bucket.size === 0) return []; // empty bucket -> nothing
      sets.push(bucket);
    }

    // Intersect: iterate over the smallest set, check membership in others
    sets.sort((a, b) => a.size - b.size);
    const smallest = sets[0]!;
    const rest = sets.slice(1);

    const matchingIds = new Set<string>();
    for (const id of smallest) {
      if (rest.every((s) => s.has(id))) {
        matchingIds.add(id);
      }
    }

    // Walk insertion order, collect matches up to limit
    const cap = limit ?? Infinity;
    const result: T[] = [];
    for (const id of this.ordered) {
      if (result.length >= cap) break;
      if (!matchingIds.has(id)) continue;
      const item = this.byId.get(id);
      if (item) result.push(item);
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Aggregation
  // -------------------------------------------------------------------------

  /**
   * Count items grouped by the distinct values of an indexed field.
   * O(distinct_values) — does NOT scan all items.
   */
  countByField(field: string): Record<string, number> {
    const fieldMap = this.byField.get(field);
    if (!fieldMap) return {};
    const counts: Record<string, number> = {};
    for (const [value, bucket] of fieldMap) {
      counts[value] = bucket.size;
    }
    return counts;
  }
}
