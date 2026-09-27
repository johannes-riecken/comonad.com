import { WASI, File, OpenFile, ConsoleStdout } from './vendor/wasi/index.js';

export async function createEngine() {
  const errors = [];
  const wasi = new WASI(['crc.wasm'], [], [
    new OpenFile(new File([])),
    ConsoleStdout.lineBuffered(text => console.info(text)),
    ConsoleStdout.lineBuffered(text => errors.push(text)),
  ]);
  const wasmURL=new URL('./crc.wasm',import.meta.url);
  wasmURL.search=new URL(import.meta.url).search;
  const response = await fetch(wasmURL);
  if (!response.ok) throw new Error(`Cannot load Haskell module (${response.status})`);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {
    wasi_snapshot_preview1: wasi.wasiImport,
  });
  wasi.initialize(instance);
  const e = instance.exports;
  e.hs_init(0, 0);
  const withBytes = (bytes, operation) => {
    const pointer = e.malloc(Math.max(1, bytes.length));
    if (!pointer) throw new Error('Haskell module could not allocate an input buffer');
    try {
      new Uint8Array(e.memory.buffer, pointer, bytes.length).set(bytes);
      return operation(pointer, bytes.length);
    } finally { e.free(pointer); }
  };
  const jsonResult = pointer => {
    if (!pointer) throw new Error('Haskell module could not allocate a result');
    try {
      const memory = new Uint8Array(e.memory.buffer);
      const end = memory.indexOf(0, pointer);
      if (end < pointer) throw new Error('Unterminated Haskell result');
      return JSON.parse(new TextDecoder().decode(memory.subarray(pointer, end)));
    } finally { e.free(pointer); }
  };
  return {
    image: (kind, parameter, width, height, option, cx=-0.5, cy=0, span=3) => jsonResult(e.image_demo(kind, parameter, width, height, option, cx, cy, span)),
    binding: (preset, spelling) => jsonResult(e.binding_demo(preset, spelling)),
    morton: (x, y, block) => jsonResult(e.morton_demo(x, y, block)),
    ad: (x, y) => jsonResult(e.ad_demo(x, y)),
    contour: (shape, depth) => jsonResult(e.contour_demo(shape, depth)),
    lca: (parents, a, b) => {
      const bytes = new Uint8Array(parents.length * 4), view = new DataView(bytes.buffer);
      parents.forEach((p, i) => view.setInt32(i * 4, p, true));
      return withBytes(bytes, p => jsonResult(e.lca_demo(p, parents.length, a, b)));
    },
    automatonStep: (rule, cells) => withBytes(cells, (p, n) => {
      e.automaton_step(rule, p, n);
      return new Uint8Array(e.memory.buffer, p, Math.max(0, n - 2)).slice();
    }),
    direct: bytes => withBytes(bytes, (p, n) => e.crc_direct(p, n) >>> 0),
    summarize: bytes => withBytes(bytes, (p, n) => ({
      p: e.crc_remainder(p, n) >>> 0,
      m: e.crc_factor(n) >>> 0,
    })),
    combine: (a, b) => ({
      p: e.crc_combine(a.p, b.p, b.m) >>> 0,
      m: e.crc_multiply(a.m, b.m) >>> 0,
    }),
    finish: s => e.crc_finish(s.p, s.m) >>> 0,
  };
}
