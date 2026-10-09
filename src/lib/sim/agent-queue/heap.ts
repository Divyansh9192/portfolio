/** Min-heap ordered by (t, seq): equal times pop in insertion order, which keeps the sim deterministic. */
export interface HeapItem<T> {
  t: number;
  seq: number;
  value: T;
}

export class EventHeap<T> {
  private items: HeapItem<T>[] = [];
  private seq = 0;

  get size(): number {
    return this.items.length;
  }

  push(t: number, value: T): void {
    const item = { t, seq: this.seq++, value };
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(a[i], a[p])) {
        [a[i], a[p]] = [a[p], a[i]];
        i = p;
      } else break;
    }
  }

  peek(): HeapItem<T> | undefined {
    return this.items[0];
  }

  pop(): HeapItem<T> | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

function less<T>(x: HeapItem<T>, y: HeapItem<T>): boolean {
  return x.t < y.t || (x.t === y.t && x.seq < y.seq);
}
