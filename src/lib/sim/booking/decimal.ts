/**
 * A tiny exact decimal, enough to mirror java.math.BigDecimal for the NeonStays pricing chain.
 *
 * The Java code multiplies BigDecimals with no MathContext, so every product is exact and its scale
 * is the sum of the operands' scales (2000.00 x 1.2 = 2400.000, scale 3). We keep the same
 * (unscaled value, scale) pair so `toString()` prints what Java's BigDecimal.toPlainString() would.
 *
 * BigInt literals need an ES2020 target and this project targets ES2017, so constants are built
 * with BigInt(n) calls.
 */

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TEN = BigInt(10);

export interface Decimal {
  /** Unscaled value: the number is unscaled x 10^-scale. */
  readonly unscaled: bigint;
  readonly scale: number;
}

function pow10(n: number): bigint {
  let r = ONE;
  for (let i = 0; i < n; i++) r *= TEN;
  return r;
}

/**
 * Parse a plain decimal string ("2000", "1999.99", "-0.5"). Throws on anything else.
 * Mirrors new BigDecimal(String): the scale is the number of digits after the point.
 */
export function dec(text: string): Decimal {
  const t = text.trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) throw new Error(`Not a plain decimal: "${text}"`);
  const [, sign, intPart, frac = ""] = m;
  let unscaled = BigInt(intPart + frac);
  if (sign) unscaled = -unscaled;
  return { unscaled, scale: frac.length };
}

/**
 * Mirror of BigDecimal.valueOf(double): goes through Double.toString, so 1.2 becomes "1.2" (scale 1)
 * and 1.25 becomes "1.25" (scale 2). Only used for the literal multipliers in the strategy classes.
 */
export function valueOfDouble(d: number): Decimal {
  if (!Number.isFinite(d)) throw new Error("Not finite");
  // JS shortest round-trip formatting matches Java's Double.toString for these short literals.
  const s = String(d);
  if (/e/i.test(s)) throw new Error(`Unsupported magnitude: ${s}`);
  // Java prints a whole double as "2.0" (scale 1); JS prints "2".
  return dec(s.includes(".") ? s : `${s}.0`);
}

export function mul(a: Decimal, b: Decimal): Decimal {
  return { unscaled: a.unscaled * b.unscaled, scale: a.scale + b.scale };
}

export function add(a: Decimal, b: Decimal): Decimal {
  if (a.scale === b.scale) return { unscaled: a.unscaled + b.unscaled, scale: a.scale };
  if (a.scale > b.scale) return { unscaled: a.unscaled + b.unscaled * pow10(a.scale - b.scale), scale: a.scale };
  return { unscaled: a.unscaled * pow10(b.scale - a.scale) + b.unscaled, scale: b.scale };
}

export function fromInt(n: number): Decimal {
  if (!Number.isInteger(n)) throw new Error("fromInt needs an integer");
  return { unscaled: BigInt(n), scale: 0 };
}

/** BigDecimal.ZERO (scale 0), the identity used by calculateTotalPrice's reduce. */
export const DEC_ZERO: Decimal = { unscaled: ZERO, scale: 0 };

/**
 * Round to `scale` digits, half away from zero. That is what PostgreSQL does when a value is stored
 * into a numeric(p, s) column, and equals RoundingMode.HALF_UP for positive amounts.
 */
export function roundHalfUp(a: Decimal, scale: number): Decimal {
  if (a.scale <= scale) return { unscaled: a.unscaled * pow10(scale - a.scale), scale };
  const div = pow10(a.scale - scale);
  const neg = a.unscaled < ZERO;
  const abs = neg ? -a.unscaled : a.unscaled;
  let q = abs / div;
  const r = abs % div;
  if (r * BigInt(2) >= div) q += ONE;
  return { unscaled: neg ? -q : q, scale };
}

/** Plain string with the full scale, like BigDecimal.toPlainString(): "4200.00000000". */
export function toPlain(a: Decimal): string {
  const neg = a.unscaled < ZERO;
  const digits = (neg ? -a.unscaled : a.unscaled).toString();
  if (a.scale === 0) return (neg ? "-" : "") + digits;
  const padded = digits.padStart(a.scale + 1, "0");
  const i = padded.length - a.scale;
  return `${neg ? "-" : ""}${padded.slice(0, i)}.${padded.slice(i)}`;
}

/** Rounded to 2 dp with thousands separators (Indian grouping is not used; plain commas). */
export function format2(a: Decimal): string {
  const r = toPlain(roundHalfUp(a, 2));
  const [i, f] = r.split(".");
  const neg = i.startsWith("-");
  const body = (neg ? i.slice(1) : i).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${body}.${f}`;
}

export function eq(a: Decimal, b: Decimal): boolean {
  return add(a, { unscaled: -b.unscaled, scale: b.scale }).unscaled === ZERO;
}

/** Truncating conversion to an integer, like BigDecimal.longValue() for these magnitudes. */
export function truncToBigInt(a: Decimal): bigint {
  return a.unscaled / pow10(a.scale);
}
