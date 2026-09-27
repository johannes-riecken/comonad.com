-- Browser companion to ../TwoDContouring.hs (Matt Keeter's 2D contouring program).
-- hmatrix does not target wasm32-wasi, so the singular-value solve is written
-- out below. Feature rows are the intersection normals. The original file
-- builds that matrix with fromRows pts; those coordinates send a rectangle's
-- corner outside its cell. Normals are the quadratic error function from the
-- write-up (https://www.mattkeeter.com/projects/contours/).
module ContourDemo (demo) where

import Data.Maybe (catMaybes)
import DemoJSON
import Prelude hiding (Left, Right)

type Point = (Double, Double)
type Shape = Point -> Double

circle :: Point -> Double -> Shape
circle (x0, y0) r (x, y) = sqrt ((x0 - x) * (x0 - x) + (y0 - y) * (y0 - y)) - r

left :: Double -> Shape
left x0 (x, _) = x - x0

right :: Double -> Shape
right x0 (x, _) = x0 - x

lower :: Double -> Shape
lower y0 (_, y) = y - y0

upper :: Double -> Shape
upper y0 (_, y) = y0 - y

(∪) :: Shape -> Shape -> Shape
a ∪ b = \p -> min (a p) (b p)

(∩) :: Shape -> Shape -> Shape
a ∩ b = \p -> max (a p) (b p)

inv :: Shape -> Shape
inv a p = -(a p)

rectangle :: Point -> Point -> Shape
rectangle (xmin, ymin) (xmax, ymax) =
    right xmin ∩ left xmax ∩ upper ymin ∩ lower ymax

hi :: Shape
hi = h ∪ i where
    h = (rectangle (0.1, 0.1) (0.25, 0.9) ∪
         rectangle (0.1, 0.1) (0.6, 0.35) ∪
         circle (0.35, 0.35) 0.25) ∩ inv
         (circle (0.35, 0.35) 0.1 ∪
          rectangle (0.25, 0.1) (0.45, 0.35))
    i = rectangle (0.75, 0.1) (0.9, 0.55) ∪
        circle (0.825, 0.75) 0.1

shapes :: [(String, Shape)]
shapes =
    [ ("hi", hi)
    , ("circle", circle (0.5, 0.5) 0.28)
    , ("rectangle", rectangle (0.2, 0.25) (0.8, 0.75))
    , ("ring", circle (0.5, 0.5) 0.36 ∩ inv (circle (0.5, 0.5) 0.16))
    ]

data Tree_ a = Root (Tree_ a) (Tree_ a) (Tree_ a) (Tree_ a)
             | Empty a | Full a | Leaf a

type Cell = (Point, Point)
type Tree = Tree_ Cell

bounds :: Tree -> Cell
bounds (Empty cell) = cell
bounds (Full cell) = cell
bounds (Leaf cell) = cell
bounds (Root southwest _ _ northeast) = (fst (bounds southwest), snd (bounds northeast))

buildTree :: Point -> Point -> Int -> Tree
buildTree lo hiDepth 0 = Leaf (lo, hiDepth)
buildTree (x0, y0) (x1, y1) depth =
    Root (buildTree (x0, y0) (xm, ym) (depth - 1))
         (buildTree (xm, y0) (x1, ym) (depth - 1))
         (buildTree (x0, ym) (xm, y1) (depth - 1))
         (buildTree (xm, ym) (x1, y1) (depth - 1))
    where xm = (x0 + x1) / 2
          ym = (y0 + y1) / 2

collapse :: Shape -> Tree -> Tree
collapse shape leaf@(Leaf ((xmin, ymin), (xmax, ymax)))
    | all (< 0) values = Full (bounds leaf)
    | all (>= 0) values = Empty (bounds leaf)
    | otherwise = leaf
    where values = [shape (x, y) | x <- [xmin, xmax], y <- [ymin, ymax]]
collapse shape (Root a b c d) = collapse' a' b' c' d'
    where a' = collapse shape a
          b' = collapse shape b
          c' = collapse shape c
          d' = collapse shape d
          parent = (fst (bounds a'), snd (bounds d'))
          collapse' (Empty _) (Empty _) (Empty _) (Empty _) = Empty parent
          collapse' (Full _) (Full _) (Full _) (Full _) = Full parent
          collapse' q r s t = Root q r s t
collapse _ tree = tree

instance Foldable Tree_ where
    foldMap f (Leaf a) = f a
    foldMap f (Root a b c d) = foldMap (foldMap f) [a, b, c, d]
    foldMap _ _ = mempty

data Side = Upper | Lower | Left | Right deriving Show

lut :: [[(Side, Side)]]
lut = [[],
       [(Upper, Right)],
       [(Left, Upper)],
       [(Left, Right)],
       [(Right, Lower)],
       [(Upper, Lower)],
       [(Right, Lower), (Left, Upper)],
       [(Left, Lower)],
       [(Lower, Left)],
       [(Lower, Left), (Upper, Right)],
       [(Lower, Upper)],
       [(Lower, Right)],
       [(Right, Left)],
       [(Upper, Left)],
       [(Right, Upper)],
       []]

index :: Shape -> Cell -> Int
index shape ((xmin, ymin), (xmax, ymax)) =
    sum [if shape corner < 0 then 2 ^ (3 - i) else 0 |
         (corner, i) <- zip pts ([0 ..] :: [Int])]
    where pts = [(x, y) | y <- [ymin, ymax], x <- [xmin, xmax]]

edges :: Shape -> Cell -> [(Side, Side)]
edges shape cell = lut !! index shape cell

pt :: Shape -> Cell -> Side -> Point
pt shape ((xmin, ymin), (xmax, ymax)) side =
    case side of
        Left -> zero shape (xmin, ymin) (xmin, ymax)
        Right -> zero shape (xmax, ymin) (xmax, ymax)
        Lower -> zero shape (xmin, ymin) (xmax, ymin)
        Upper -> zero shape (xmin, ymax) (xmax, ymax)

zero :: Shape -> Point -> Point -> Point
zero s a@(ax, ay) b@(bx, by)
    | s a >= 0 = zero s b a
    | otherwise = zero' 0.5 0.25 (10 :: Int)
    where pos f = (ax * (1 - f) + bx * f, ay * (1 - f) + by * f)
          zero' f _ 0 = pos f
          zero' f step i
            | s (pos f) < 0 = zero' (f + step) (step / 2) (i - 1)
            | otherwise = zero' (f - step) (step / 2) (i - 1)

type Edge = (Point, Point)

contours :: Shape -> Cell -> [Edge]
contours shape cell = [(pt' a, pt' b) | (a, b) <- edges shape cell]
    where pt' = pt shape cell

interpolate :: Shape -> Cell -> Point -> Double
interpolate shape ((xmin, ymin), (xmax, ymax)) (x, y) =
    let dx = (x - xmin) / (xmax - xmin)
        dy = (y - ymin) / (ymax - ymin)
        ab = shape (xmin, ymin) * (1 - dx) + shape (xmax, ymin) * dx
        cd = shape (xmin, ymax) * (1 - dx) + shape (xmax, ymax) * dx
    in ab * (1 - dy) + cd * dy

score :: Shape -> Cell -> Point -> Double
score shape cell sample = abs (interpolate shape cell sample - shape sample)

merge :: Shape -> Tree -> Tree
merge shape (Root a b c d) =
    let a' = merge shape a
        b' = merge shape b
        c' = merge shape c
        d' = merge shape d
    in case (a', b', c', d') of
        (Leaf (lo, i), Leaf (q, r), Leaf (s, t), Leaf (_, hiPt)) ->
            let scores = map (score shape (lo, hiPt)) [i, q, r, s, t]
            in if all (< 0.001) scores then Leaf (lo, hiPt) else Root a' b' c' d'
        _ -> Root a' b' c' d'
merge _ tree = tree

deriv :: Shape -> Point -> Point
deriv shape (x, y) =
    let epsilon = 0.001
        dx = shape (x + epsilon, y) - shape (x - epsilon, y)
        dy = shape (x, y + epsilon) - shape (x, y - epsilon)
        len = sqrt (dx * dx + dy * dy)
    in if len == 0 then (0, 0) else (dx / len, dy / len)

dot :: Point -> Point -> Double
dot (ax, ay) (bx, by) = ax * bx + ay * by

sub :: Point -> Point -> Point
sub (ax, ay) (bx, by) = (ax - bx, ay - by)

add :: Point -> Point -> Point
add (ax, ay) (bx, by) = (ax + bx, ay + by)

scale :: Double -> Point -> Point
scale k (x, y) = (k * x, k * y)

unit :: Point -> Point
unit (x, y) =
    let n = sqrt (x * x + y * y)
    in if n == 0 then (1, 0) else (x / n, y / n)

-- Eigenpairs of a symmetric 2×2 matrix, largest eigenvalue first.
-- The second vector is the first rotated a quarter turn, so the pair stays orthonormal.
eigen2 :: Double -> Double -> Double -> ((Point, Double), (Point, Double))
eigen2 g00 g01 g11
    | abs g01 <= 1e-15 * (abs g00 + abs g11 + 1) =
        if g00 >= g11 then (((1, 0), g00), ((0, 1), g11)) else (((0, 1), g11), ((1, 0), g00))
    | otherwise =
        let disc = sqrt ((g00 - g11) * (g00 - g11) + 4 * g01 * g01)
            large = (g00 + g11 + disc) / 2
            axis = unit (g01, large - g00)
        in ((axis, large), ((-snd axis, fst axis), (g00 + g11 - disc) / 2))

-- Minimum-norm least squares for an n×2 system. Rows are normals.
-- Singular values at or below machine precision times the largest are dropped,
-- matching hmatrix's linearSolveSVD (LAPACK dgelss with the default rcond).
leastSquares :: [(Point, Double)] -> Point
leastSquares rows =
    let g00 = sum [x * x | ((x, _), _) <- rows]
        g01 = sum [x * y | ((x, y), _) <- rows]
        g11 = sum [y * y | ((_, y), _) <- rows]
        rhs0 = sum [x * b | ((x, _), b) <- rows]
        rhs1 = sum [y * b | ((_, y), b) <- rows]
        ((v1, l1), (v2, l2)) = eigen2 g00 g01 g11
        sigmaMax = max (sqrt (max 0 l1)) (sqrt (max 0 l2))
        cutoff = let eps = 2.2204460492503131e-16 * sigmaMax in eps * eps
        apply (vx, vy) lambda
            | lambda <= cutoff = (0, 0)
            | otherwise = scale ((rhs0 * vx + rhs1 * vy) / lambda) (vx, vy)
    in add (apply v1 l1) (apply v2 l2)

feature :: Shape -> Cell -> Maybe Point
feature shape cell =
    let pts = concatMap (\(a, b) -> [a, b]) (contours shape cell)
    in if length pts < 2 then Nothing else
        let nms = map (deriv shape) pts
            count = fromIntegral (length pts)
            center = scale (1 / count) (foldl add (0, 0) pts)
            fitted = leastSquares (zip nms (zipWith (\p nm -> dot (sub p center) nm) pts nms))
        in Just (add center fitted)

dc :: Shape -> Tree -> [Edge]
dc = faceProc

faceProc :: Shape -> Tree -> [Edge]
faceProc shape (Root a b c d) =
    concatMap (faceProc shape) [a, b, c, d] ++
    edgeProcH shape a b ++ edgeProcH shape c d ++
    edgeProcV shape a c ++ edgeProcV shape b d
faceProc _ _ = []

joinLeaves :: Shape -> Cell -> Cell -> [Edge]
joinLeaves shape a b = case (feature shape a, feature shape b) of
    (Just p, Just q) -> [(p, q)]
    _ -> []

edgeProcH :: Shape -> Tree -> Tree -> [Edge]
edgeProcH shape (Leaf a) (Leaf b) = joinLeaves shape a b
edgeProcH shape leaf@(Leaf _) (Root a _ c _) =
    edgeProcH shape leaf a ++ edgeProcH shape leaf c
edgeProcH shape (Root _ b _ d) leaf@(Leaf _) =
    edgeProcH shape b leaf ++ edgeProcH shape d leaf
edgeProcH shape (Root _ b _ d) (Root a _ c _) =
    edgeProcH shape b a ++ edgeProcH shape d c
edgeProcH _ _ _ = []

edgeProcV :: Shape -> Tree -> Tree -> [Edge]
edgeProcV shape (Leaf a) (Leaf b) = joinLeaves shape a b
edgeProcV shape (Root _ _ c d) leaf@(Leaf _) =
    edgeProcV shape c leaf ++ edgeProcV shape d leaf
edgeProcV shape leaf@(Leaf _) (Root a b _ _) =
    edgeProcV shape leaf a ++ edgeProcV shape leaf b
edgeProcV shape (Root _ _ c d) (Root a b _ _) =
    edgeProcV shape c a ++ edgeProcV shape d b
edgeProcV _ _ _ = []

terminals :: Tree -> [(String, Cell)]
terminals (Leaf cell) = [("leaf", cell)]
terminals (Empty cell) = [("empty", cell)]
terminals (Full cell) = [("full", cell)]
terminals (Root a b c d) = concatMap terminals [a, b, c, d]

gridN :: Int
gridN = 48

point :: Point -> J
point (x, y) = Arr [Num x, Num y]

edge :: Edge -> J
edge (a, b) = Arr [point a, point b]

demo :: Int -> Int -> J
demo shapeId depth
    | shapeId < 0 || shapeId >= length shapes = Obj [("error", Str "Unknown shape.")]
    | depth < 2 || depth > 6 = Obj [("error", Str "Depth must be from 2 to 6.")]
    | otherwise = Obj
        [ ("name", Str name)
        , ("depth", Num (fromIntegral depth))
        , ("grid", Num (fromIntegral gridN))
        , ("signs", Str signs)
        , ("cells", Arr (map cell (terminals tree)))
        , ("squares", Arr (map edge squareEdges))
        , ("dual", Arr (map edge dualEdges))
        , ("features", Arr (map point feats))
        ]
    where
        (name, shape) = shapes !! shapeId
        tree = collapse shape (merge shape (buildTree (0, 0) (1, 1) depth))
        squareEdges = foldMap (contours shape) tree
        dualEdges = dc shape tree
        feats = catMaybes (foldMap (\c -> [feature shape c]) tree)
        n = fromIntegral gridN :: Double
        signs = [if shape ((fromIntegral x + 0.5) / n, (fromIntegral y + 0.5) / n) < 0 then '1' else '0' |
                 y <- [0 .. gridN - 1], x <- [0 .. gridN - 1]]
        cell (kind, (lo, hiPt)) = Obj [("kind", Str kind), ("min", point lo), ("max", point hiPt)]
