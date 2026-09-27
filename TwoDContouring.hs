-- Source: https://www.mattkeeter.com/projects/contours/
import Data.Bifoldable
import Data.List.Extra (mconcatMap)
import Data.Maybe (catMaybes, fromJust)
import Numeric.LinearAlgebra.HMatrix hiding ((<>), Upper, Lower, inv)
import Prelude hiding (Left, Right)

type Point = (Double, Double)
type Shape = Point -> Double

circle :: Point -> Double -> Shape
circle (x0, y0) r (x, y) = sqrt ((x0 - x)**2 + (y0 - y)**2) - r

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
a ∩ b  = \p -> max (a p) (b p)

inv :: Shape -> Shape
inv a p = -(a p)

type Min = Point
type Max = Point

rectangle :: Min -> Max -> Shape
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

data Tree_ a = Root (Tree_ a) (Tree_ a) (Tree_ a) (Tree_ a) |
               Empty | Full | Leaf a
     deriving (Show, Eq)

type Cell = (Min, Max)
type Tree = Tree_ Cell


buildTree :: Min -> Max -> Int -> Tree
buildTree min max 0 = Leaf (min, max)
buildTree (xmin, ymin) (xmax, ymax) i =
    Root (buildTree (xmin, ymin) (xmid, ymid) (i - 1))
         (buildTree (xmid, ymin) (xmax, ymid) (i - 1))
         (buildTree (xmin, ymid) (xmid, ymax) (i - 1))
         (buildTree (xmid, ymid) (xmax, ymax) (i - 1))
    where xmid = (xmin + xmax) / 2
          ymid = (ymin + ymax) / 2



collapse :: Shape -> Tree -> Tree

collapse shape leaf@(Leaf ((xmin, ymin), (xmax, ymax)))
  | all (<  0) values = Full
  | all (>= 0) values = Empty
  | otherwise = leaf
  where
      values = [shape (x, y) | x <- [xmin, xmax], y <- [ymin, ymax]]

collapse shape (Root a b c d) =
    collapse' $ fmap (collapse shape) [a, b, c, d]
    where collapse' [Empty, Empty, Empty, Empty] = Empty
          collapse' [Full, Full, Full, Full] = Full
          collapse' [q, r, s, t] = Root q r s t

collapse _ t = t

instance Foldable Tree_ where
    foldMap f (Leaf a) = f a
    foldMap f (Root a b c d) = mconcatMap (foldMap f) [a, b, c, d]
    foldMap _ _ = mempty


data Side = Upper | Lower | Left | Right deriving Show

-- This lookup table takes a bitmask abcd and
-- returns a list of edges between which we
-- should draw contours (to outline the shape)
lut :: [[(Side, Side)]]
lut = [[],                          -- 0000
       [(Upper,Right)],             -- 000d
       [(Left,Upper)],              -- 00c0
       [(Left,Right)],              -- 00cd
       [(Right,Lower)],             -- 0b00
       [(Upper,Lower)],             -- 0b0d
       [(Right,Lower),(Left,Upper)],-- 0bc0
       [(Left,Lower)],              -- 0bcd
       [(Lower,Left)],              -- a000
       [(Lower,Left),(Upper,Right)],-- a00d
       [(Lower,Upper)],             -- a0c0
       [(Lower,Right)],             -- a0cd
       [(Right,Left)],              -- ab00
       [(Upper,Left)],              -- ab0d
       [(Right,Upper)],             -- abc0
       []]                          -- abcd

index :: Shape -> Cell -> Int
index shape ((xmin, ymin), (xmax, ymax)) =
    sum [if shape pt < 0 then 2^(3 - i) else 0 |
         (pt, i) <- zip pts [0..]]
    where pts = [(x,y) | y <- [ymin, ymax], x <- [xmin, xmax]]

edges :: Shape -> Cell -> [(Side, Side)]
edges shape c = lut !! index shape c


pt :: Shape -> Cell -> Side -> Point
pt shape ((xmin, ymin), (xmax, ymax)) side =
    case side of Left  -> zero shape (xmin, ymin) (xmin, ymax)
                 Right -> zero shape (xmax, ymin) (xmax, ymax)
                 Lower -> zero shape (xmin, ymin) (xmax, ymin)
                 Upper -> zero shape (xmin, ymax) (xmax, ymax)

zero :: Shape -> Point -> Point -> Point
zero s a@(ax, ay) b@(bx, by)
    | s a >= 0 = zero s b a
    | otherwise = zero' 0.5 0.25 10
    where pos f = (ax * (1-f) + bx * f, ay * (1-f) + by * f)
          zero' f step i
            | i == 0 = pos f
            | s (pos f) < 0 = zero' (f + step) (step / 2) (i - 1)
            | otherwise = zero' (f - step) (step / 2) (i - 1)

type Edge = (Point, Point)

contours :: Shape -> Cell -> [Edge]
contours shape cell = [(pt' a, pt' b) |
                       (a, b) <- edges shape cell]
    where pt' = pt shape cell




-- interpolate samples a Shape at the four corners of a Cell,
-- then uses those values to estimate the function's result at
-- an arbitrary (x,y) position
interpolate :: Shape -> Cell -> Point -> Double
interpolate shape ((xmin, ymin), (xmax, ymax)) (x,y) =
    let dx = (x - xmin) / (xmax - xmin)
        dy = (y - ymin) / (ymax - ymin)
        ab = shape (xmin, ymin) * (1 - dx) +
             shape (xmax, ymin) * dx
        cd = shape (xmin, ymax) * (1 - dx) +
             shape (xmax, ymax) * dx
    in ab * (1 - dy) + cd * dy

-- score returns the difference between an interpolated
-- estimate and the function value at a given point
score :: Shape -> Cell -> Point -> Double
score shape cell pt = abs $
                      interpolate shape cell pt - shape pt


merge :: Shape -> Tree -> Tree
merge shape (Root a b c d) =
    merge' a' b' c' d'
    where [a', b', c', d'] = fmap (merge shape) [a, b, c, d]
          merge' (Leaf (min, i)) (Leaf (q, r))
                 (Leaf (s, t)) (Leaf (_, max)) =
            let scores = fmap (score shape (min, max))
                         [i, q, r, s, t]
            in if all (< 0.001) scores
               then Leaf (min, max)
               else Root a' b' c' d'
          merge' _ _ _ _ = Root a' b' c' d'
merge _ t = t

deriv :: Shape -> Point -> Point
deriv shape (x,y) =
    let epsilon = 0.001
        dx = shape (x + epsilon, y) - shape (x - epsilon, y)
        dy = shape (x, y + epsilon) - shape (x, y - epsilon)
        len = sqrt $ dx**2 + dy**2
    in (dx / len, dy / len)


feature :: Shape -> Cell -> Maybe Point
feature shape cell =
    if length pts_ >= 2 then
        let pts = fmap fromTuple pts_
            nms = fmap (fromTuple . deriv shape) pts_
            center = sum pts / fromIntegral (length pts)

            a = fromRows pts
            b = col $ zipWith (\pt nm -> (pt - center) <·> nm)
                      pts nms

            p = center + head (toColumns $ linearSolveSVD a b)
        in (Just . (\[x,y] -> (x,y)) $ toList p)
    else Nothing
    where pts_ = concatMap biList $ contours shape cell
          fromTuple (x,y) = fromList [x,y]



dc :: Shape -> Tree -> [Edge]
dc = faceProc

faceProc :: Shape -> Tree -> [Edge]
faceProc shape (Root a b c d) =
    concatMap (faceProc shape) [a,b,c,d] <> (edgeProcH shape a b <> (edgeProcH shape c d <> (edgeProcV shape a c <> edgeProcV shape b d)))
faceProc _ _ = []

edgeProcH :: Shape -> Tree -> Tree -> [Edge]
edgeProcH shape (Leaf a) (Leaf b) =
    [(fromJust $ feature shape a, fromJust $ feature shape b)]
edgeProcH shape leaf@(Leaf _) (Root a _ c _) =
    edgeProcH shape leaf a <> edgeProcH shape leaf c
edgeProcH shape (Root _ b _ d) leaf@(Leaf _) =
    edgeProcH shape b leaf <> edgeProcH shape d leaf
edgeProcH shape (Root _ b _ d) (Root a _ c _) =
    edgeProcH shape b a <> edgeProcH shape d c
edgeProcH _ _ _ = []

edgeProcV :: Shape -> Tree -> Tree -> [Edge]
edgeProcV shape (Leaf a) (Leaf b) = [(fromJust $ feature shape a,
                                      fromJust $ feature shape b)]
edgeProcV shape (Root _ _ c d) leaf@(Leaf _) =
    edgeProcV shape c leaf <> edgeProcV shape d leaf
edgeProcV shape leaf@(Leaf _) (Root a b _ _) =
    edgeProcV shape leaf a <> edgeProcV shape leaf b
edgeProcV shape (Root _ _ c d) (Root a b _ _) =
    edgeProcV shape c a <> edgeProcV shape d b
edgeProcV _ _ _ = []




main :: IO ()
main = do
    let res = 5
    ((print . dc hi) . collapse hi) . merge hi $ buildTree (0,0) (1,1) res
    let tree = collapse hi . merge hi $ buildTree (0,0) (1,1) 5
    print . catMaybes $ foldMap (\cell -> [feature hi cell]) tree
    print $ deriv (circle (0,0) 1) (1,0)
    print $ deriv (circle (0,0) 1) (1,1)
    print $ deriv (circle (0,0) 1) (0,1)
    (print . collapse hi) . merge hi $ buildTree (0,0) (1,1) res
    (print . foldMap (contours hi)) . collapse hi $ buildTree (0,0) (1,1) 5
    let center ((x,y), (x',y')) = ((x+x')/2, (y+y')/2)
    print . foldMap (\cell -> [center cell]) $ buildTree (0,0) (1,1) 2
    print $ buildTree (0,0) (1,1) 2
    let c = circle (0,0) 1
    print $ c (2,0)      -- points outside the circle are positive
    print $ c (1,0)      -- points on the contour are zero
    print $ c (0,0)      -- points inside the circle are negative
