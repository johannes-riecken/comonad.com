{-# LANGUAGE ForeignFunctionInterface #-}
-- This adapter is compiled by GHC to WebAssembly, not translated to JavaScript.
module Browser where

import CRC
import qualified PNGDemo
import qualified Automaton
import qualified BindingDemo
import qualified MortonDemo
import qualified ADDemo
import qualified LCADemo
import qualified ContourDemo
import DemoJSON (encode)
import Foreign.C.String (CString, newCString)
import Foreign.C.Types (CInt)
import Data.Word
import Foreign.Marshal.Array (peekArray, pokeArray)
import Foreign.Ptr (Ptr)

foreign export ccall crc_direct :: Ptr Word8 -> Int -> IO Word32
foreign export ccall crc_remainder :: Ptr Word8 -> Int -> IO Word32
foreign export ccall crc_factor :: Int -> Word32
foreign export ccall crc_multiply :: Word32 -> Word32 -> Word32
foreign export ccall crc_combine :: Word32 -> Word32 -> Word32 -> Word32
foreign export ccall crc_finish :: Word32 -> Word32 -> Word32
foreign export ccall image_demo :: Int -> Int -> Int -> Int -> Int -> Double -> Double -> Double -> IO CString
foreign export ccall automaton_step :: Word8 -> Ptr Word8 -> Int -> IO ()
foreign export ccall binding_demo :: Int -> Int -> IO CString
foreign export ccall morton_demo :: Int -> Int -> Int -> IO CString
foreign export ccall ad_demo :: Double -> Double -> IO CString
foreign export ccall lca_demo :: Ptr CInt -> Int -> Int -> Int -> IO CString
foreign export ccall contour_demo :: Int -> Int -> IO CString

-- Returned JSON strings are allocated with malloc; the browser frees them.
binding_demo :: Int -> Int -> IO CString
binding_demo preset spelling = newCString (encode (BindingDemo.demo preset spelling))
morton_demo :: Int -> Int -> Int -> IO CString
morton_demo x y block = newCString (encode (MortonDemo.demo x y block))
ad_demo :: Double -> Double -> IO CString
ad_demo x y = newCString (encode (ADDemo.demo x y))
contour_demo :: Int -> Int -> IO CString
contour_demo shape depth = newCString (encode (ContourDemo.demo shape depth))

lca_demo :: Ptr CInt -> Int -> Int -> Int -> IO CString
lca_demo ptr len a b
  | len < 1 || len > 64 = newCString "{\"error\":\"Tree size must be between 1 and 64.\"}"
  | otherwise = do
      parents <- map fromIntegral <$> peekArray len ptr
      newCString (encode (LCADemo.demo parents a b))

image_demo :: Int -> Int -> Int -> Int -> Int -> Double -> Double -> Double -> IO CString
image_demo kind parameter w h option cx cy spanX = newCString (encode (PNGDemo.demo kind parameter w h option cx cy spanX))

automaton_step :: Word8 -> Ptr Word8 -> Int -> IO ()
automaton_step rule ptr len = peekArray len ptr >>= pokeArray ptr . Automaton.step rule

crc_direct :: Ptr Word8 -> Int -> IO Word32
crc_direct ptr len = direct <$> peekArray len ptr

crc_remainder :: Ptr Word8 -> Int -> IO Word32
crc_remainder ptr len = remainder . summarize <$> peekArray len ptr

crc_factor :: Int -> Word32
crc_factor = shiftFactor

crc_multiply :: Word32 -> Word32 -> Word32
crc_multiply = multiply

crc_combine :: Word32 -> Word32 -> Word32 -> Word32
crc_combine p q n = remainder (combine (Summary p 0) (Summary q n))

crc_finish :: Word32 -> Word32 -> Word32
crc_finish p m = finish (Summary p m)
