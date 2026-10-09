/**
 * Kafka's default partitioning for keyed records, ported from kafka-clients 4.1.1
 * (the version Spring Boot 4.0.1 manages for the LinkedIn clone's services):
 *
 *   org.apache.kafka.common.utils.Utils.murmur2(byte[])
 *   org.apache.kafka.common.utils.Utils.toPositive(int)          = n & 0x7fffffff
 *   BuiltInPartitioner.partitionForKey(serializedKey, partitions) = toPositive(murmur2(key)) % partitions
 *
 * Java int arithmetic is reproduced with Math.imul and `| 0` / `>>>`.
 */

const SEED = 0x9747b28c | 0;
const M = 0x5bd1e995;
const R = 24;

export function murmur2(data: Uint8Array): number {
  const length = data.length;
  let h = (SEED ^ length) | 0;
  const length4 = length >>> 2;

  for (let i = 0; i < length4; i++) {
    const i4 = i * 4;
    let k = (data[i4] & 0xff) | ((data[i4 + 1] & 0xff) << 8) | ((data[i4 + 2] & 0xff) << 16) | ((data[i4 + 3] & 0xff) << 24);
    k = Math.imul(k, M);
    k ^= k >>> R;
    k = Math.imul(k, M);
    h = Math.imul(h, M);
    h ^= k;
  }

  const tail = length & ~3;
  switch (length % 4) {
    case 3:
      h ^= (data[tail + 2] & 0xff) << 16;
    // falls through
    case 2:
      h ^= (data[tail + 1] & 0xff) << 8;
    // falls through
    case 1:
      h ^= data[tail] & 0xff;
      h = Math.imul(h, M);
  }

  h ^= h >>> 13;
  h = Math.imul(h, M);
  h ^= h >>> 15;
  return h | 0;
}

/** Utils.toPositive: clears the sign bit (not Math.abs, so Integer.MIN_VALUE maps to 0). */
export function toPositive(n: number): number {
  return n & 0x7fffffff;
}

/**
 * org.apache.kafka.common.serialization.LongSerializer: the 8 big-endian bytes of a Java long.
 * Accepts any safe JS integer (negative values use two's complement, like Java).
 */
export function longToBytes(value: number): Uint8Array {
  if (!Number.isSafeInteger(value)) throw new RangeError(`not a safe integer: ${value}`);
  const hi = Math.floor(value / 4294967296);
  const lo = value - hi * 4294967296; // 0 <= lo < 2^32
  const hi32 = hi | 0;
  const out = new Uint8Array(8);
  out[0] = (hi32 >>> 24) & 0xff;
  out[1] = (hi32 >>> 16) & 0xff;
  out[2] = (hi32 >>> 8) & 0xff;
  out[3] = hi32 & 0xff;
  out[4] = (lo >>> 24) & 0xff;
  out[5] = (lo >>> 16) & 0xff;
  out[6] = (lo >>> 8) & 0xff;
  out[7] = lo & 0xff;
  return out;
}

/** BuiltInPartitioner.partitionForKey. */
export function partitionForKey(serializedKey: Uint8Array, numPartitions: number): number {
  return toPositive(murmur2(serializedKey)) % numPartitions;
}

/** "00 00 00 00 00 00 00 2a" */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
}

/** The UTF-8 bytes of a string (for test vectors and value sizes). */
export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
