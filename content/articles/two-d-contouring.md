A shape can be a function from a point to a number. The point is inside where that number is negative, outside where it is positive, and on the contour where it is zero.

Matt Keeter’s [2D contouring write-up](https://www.mattkeeter.com/projects/contours/) builds these functions from circles, half-planes, union, intersection, and complement. [`TwoDContouring.hs`](../../../source/TwoDContouring.hs) is that program. The figure runs it in the browser.

<!-- demo:contour -->

The page draws the picture. Sampling, the quadtree, the marching-squares segments, and the dual contour are computed by GHC, compiled to WebAssembly, in the same reactor as the [cellular automaton figure](https://www.schoolofhaskell.com/user/edwardk/cellular-automata/part-1).

## What the controls change

**Shape** selects `hi` (the write-up’s test picture), a circle, a rectangle, or a ring. **Quadtree depth** is how far the square is subdivided before cells are kept or collapsed. Depth 5 is the `res` in the program’s `main`.

**Field** colors samples of the function. **Quadtree** draws the collapsed cells: filled, empty, and the leaves that still contain the contour. **Marching squares** draws a segment across each leaf, between the sides whose corners change sign. **Dual contour** places one vertex in each leaf and joins vertices that share a side. On the rectangle those vertices sit on the corners, so the outline stays sharp. Marching squares cuts across the same corners.

Each vertex is the minimum-norm solution of a small least-squares system. A row is the normal where the contour crosses the cell, and the right-hand side is that normal dotted with the point’s offset from the average of those crossings. [`TwoDContouring.hs`](../../../source/TwoDContouring.hs) writes the matrix as `fromRows pts`. The coordinates in `pts` send a rectangle’s corner outside the cell, so the [WebAssembly module](../../../source/ContourDemo.hs) uses the normals. That is the quadratic error function described in the write-up. The 2×2 singular-value step stands in for hmatrix, which does not build for wasm32-wasi. The quadtree, the lookup table, and the dual walk follow the original program.

## The test shape

```haskell
(∪) :: Shape -> Shape -> Shape
a ∪ b = \p -> min (a p) (b p)

(∩) :: Shape -> Shape -> Shape
a ∩ b  = \p -> max (a p) (b p)

inv :: Shape -> Shape
inv a p = -(a p)

hi :: Shape
hi = h ∪ i where
    h = (rectangle (0.1, 0.1) (0.25, 0.9) ∪
         rectangle (0.1, 0.1) (0.6, 0.35) ∪
         circle (0.35, 0.35) 0.25) ∩ inv
         (circle (0.35, 0.35) 0.1 ∪
          rectangle (0.25, 0.1) (0.45, 0.35))
    i = rectangle (0.75, 0.1) (0.9, 0.55) ∪
        circle (0.825, 0.75) 0.1
```

Union keeps the more negative sample, intersection the more positive one, and `inv` flips the sign. `hi` is a letter H with a round counter, next to a dotted I.
