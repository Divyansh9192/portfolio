/**
 * Kafka's RangeAssignor for one topic (org.apache.kafka.clients.consumer.RangeAssignor, non-rack-aware path):
 * members are sorted lexicographically by member id, partitions are laid out in order, and each member gets
 * floor(P / M) partitions with the first P % M members taking one extra.
 *
 * Array.prototype.sort with no comparator orders by UTF-16 code units, the same as Java's String.compareTo.
 */
export function rangeAssign(memberIds: readonly string[], numPartitions: number): Map<string, number[]> {
  const sorted = [...memberIds].sort();
  const out = new Map<string, number[]>();
  if (sorted.length === 0) return out;
  const per = Math.floor(numPartitions / sorted.length);
  const extra = numPartitions % sorted.length;
  let next = 0;
  sorted.forEach((id, i) => {
    const count = per + (i < extra ? 1 : 0);
    out.set(
      id,
      Array.from({ length: count }, (_, j) => next + j),
    );
    next += count;
  });
  return out;
}
