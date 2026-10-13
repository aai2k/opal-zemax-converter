export class ByteWriter {
  private buf = new Uint8Array(1024);
  private view = new DataView(this.buf.buffer);
  length = 0;

  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.length + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.length));
    this.buf = nb;
    this.view = new DataView(nb.buffer);
  }

  u16(v: number): this {
    this.ensure(2);
    this.view.setUint16(this.length, v, true);
    this.length += 2;
    return this;
  }

  i16(v: number): this {
    if (!Number.isInteger(v) || v < -32768 || v > 32767) throw new RangeError(`value ${v} does not fit in int16`);
    this.ensure(2);
    this.view.setInt16(this.length, v, true);
    this.length += 2;
    return this;
  }

  u32(v: number): this {
    this.ensure(4);
    this.view.setUint32(this.length, v, true);
    this.length += 4;
    return this;
  }

  i32(v: number): this {
    this.ensure(4);
    this.view.setInt32(this.length, v, true);
    this.length += 4;
    return this;
  }

  f32(v: number): this {
    this.ensure(4);
    this.view.setFloat32(this.length, v, true);
    this.length += 4;
    return this;
  }

  f64(v: number): this {
    this.ensure(8);
    this.view.setFloat64(this.length, v, true);
    this.length += 8;
    return this;
  }

  bytes(b: Uint8Array): this {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
    return this;
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

export class ByteReader {
  readonly data: Uint8Array;
  readonly view: DataView;

  constructor(data: Uint8Array) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  u16(p: number): number {
    return this.view.getUint16(p, true);
  }

  i16(p: number): number {
    return this.view.getInt16(p, true);
  }

  u32(p: number): number {
    return this.view.getUint32(p, true);
  }

  i32(p: number): number {
    return this.view.getInt32(p, true);
  }

  f32(p: number): number {
    return this.view.getFloat32(p, true);
  }

  f64(p: number): number {
    return this.view.getFloat64(p, true);
  }

  private arr(p: number, n: number, size: number, get: (q: number) => number): number[] {
    if (p + n * size > this.data.length) throw new RangeError("read past end of block");
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(get.call(this, p + i * size));
    return out;
  }

  f32s(p: number, n: number): number[] {
    return this.arr(p, n, 4, this.f32);
  }

  f64s(p: number, n: number): number[] {
    return this.arr(p, n, 8, this.f64);
  }

  i16s(p: number, n: number): number[] {
    return this.arr(p, n, 2, this.i16);
  }
}

export const f32 = Math.fround;
