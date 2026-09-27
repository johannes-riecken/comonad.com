import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {createEngine} from '../dist/engine.js';

globalThis.fetch = async url => new Response(await readFile(url));
const engine = await createEngine();
const read = path => readFile(path, 'utf8');

const circle = (x0, y0, r) => (x, y) => Math.hypot(x0 - x, y0 - y) - r;
const left = x0 => (x, _y) => x - x0;
const right = x0 => (x, _y) => x0 - x;
const lower = y0 => (_x, y) => y - y0;
const upper = y0 => (_x, y) => y0 - y;
const rectangle = (xmin, ymin, xmax, ymax) => (x, y) => Math.max(right(xmin)(x, y), left(xmax)(x, y), upper(ymin)(x, y), lower(ymax)(x, y));
const hi = (x, y) => {
  const bars = Math.min(rectangle(0.1, 0.1, 0.25, 0.9)(x, y), rectangle(0.1, 0.1, 0.6, 0.35)(x, y), circle(0.35, 0.35, 0.25)(x, y));
  const counter = Math.min(circle(0.35, 0.35, 0.1)(x, y), rectangle(0.25, 0.1, 0.45, 0.35)(x, y));
  const letter = Math.min(rectangle(0.75, 0.1, 0.9, 0.55)(x, y), circle(0.825, 0.75, 0.1)(x, y));
  return Math.min(Math.max(bars, -counter), letter);
};
const shapes = [
  ['hi', hi],
  ['circle', circle(0.5, 0.5, 0.28)],
  ['rectangle', rectangle(0.2, 0.25, 0.8, 0.75)],
  ['ring', (x, y) => Math.max(circle(0.5, 0.5, 0.36)(x, y), -circle(0.5, 0.5, 0.16)(x, y))],
];
const samples = shape => {
  let text = '';
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) text += shape((x + 0.5) / 48, (y + 0.5) / 48) < 0 ? '1' : '0';
  return text;
};
const area = cells => cells.reduce((sum, cell) => sum + (cell.max[0] - cell.min[0]) * (cell.max[1] - cell.min[1]), 0);
let checks = 0;
const near = (actual, expected, tol, message) => {
  assert.ok(Math.abs(actual - expected) < tol, message || `${actual} ≈ ${expected}`);
  checks++;
};

for (const [id, [name, shape]] of shapes.entries()) {
  const demo = engine.contour(id, 5);
  assert.equal(demo.error, undefined, name);
  assert.equal(demo.name, name);
  assert.equal(demo.signs, samples(shape), `${name} samples`);
  assert.equal(demo.signs.length, 48 * 48);
  near(area(demo.cells), 1, 1e-9, `${name} cells cover the square`);
  for (const kind of ['leaf', 'empty', 'full']) assert.ok(demo.cells.some(cell => cell.kind === kind), `${name} ${kind}`);
  let endpoint = 0;
  for (const segment of demo.squares) for (const [x, y] of segment) endpoint = Math.max(endpoint, Math.abs(shape(x, y)));
  near(endpoint, 0, 1e-3, `${name} marching-squares endpoints lie on the zero set`);
  const placed = new Set(demo.features.map(point => point.join(',')));
  for (const segment of demo.dual) for (const point of segment) assert.ok(placed.has(point.join(',')), `${name} dual vertex is a feature`);
  assert.ok(demo.dual.length > 8 && demo.features.length > 8, `${name} has a contour`);
  checks += 6;
}
const circle5 = engine.contour(1, 5);
for (const [x, y] of circle5.features) near(Math.hypot(x - 0.5, y - 0.5), 0.28, 1e-3, 'circle feature stays on the radius');
assert.ok(engine.contour(1, 3).squares.length < circle5.squares.length, 'finer quadtrees keep more of the circle');
assert.equal(engine.contour(1, 2).signs, circle5.signs);
assert.equal(engine.contour(1, 6).signs, circle5.signs);
const rectangleDemo = engine.contour(2, 5);
for (const corner of [[0.2, 0.25], [0.8, 0.25], [0.2, 0.75], [0.8, 0.75]]) {
  const distance = Math.min(...rectangleDemo.features.map(([x, y]) => Math.hypot(x - corner[0], y - corner[1])));
  near(distance, 0, 1e-4, `rectangle corner ${corner}`);
}
for (const [x, y] of rectangleDemo.features) {
  const onSide = (Math.min(Math.abs(x - 0.2), Math.abs(x - 0.8)) < 1e-3 && y >= 0.25 - 1e-3 && y <= 0.75 + 1e-3)
    || (Math.min(Math.abs(y - 0.25), Math.abs(y - 0.75)) < 1e-3 && x >= 0.2 - 1e-3 && x <= 0.8 + 1e-3);
  assert.ok(onSide, `rectangle feature (${x}, ${y}) lies on the boundary`);
  checks++;
}
for (const args of [[-1, 5], [4, 5], [0, 1], [0, 7]]) assert.ok(engine.contour(...args).error, `rejected ${args}`);
checks += 4;

const page = parseHTML(await read('dist/reader/2026/two-d-contouring/index.html')).document;
assert.equal(page.querySelector('h1').textContent, '2D Contouring');
assert.equal(page.querySelector('.article-meta time').getAttribute('datetime'), '2026-09-27');
assert.ok(page.querySelector('#contour-figure canvas'));
assert.ok(page.querySelector('script[src$="contour.js"]'));
assert.ok(page.querySelector('a[href$="source/TwoDContouring.hs"]'));
assert.ok(page.querySelector('a[href$="source/ContourDemo.hs"]'));
assert.ok(page.querySelector('a[href*="cellular-automata-part-1"]'));
assert.equal(page.querySelector('a[href="https://www.mattkeeter.com/projects/contours/"]').textContent, '2D contouring write-up');
const archive = parseHTML(await read('dist/reader/index.html')).document;
assert.ok(archive.querySelector('a[href$="reader/2026/two-d-contouring/"]'), 'Demo is in the archive');
console.log(`${checks} contour checks passed: samples, quadtree cover, zero crossings, circle radius, and rectangle corners.`);
