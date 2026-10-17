import { GifReader } from 'omggif'
import { PNG } from 'pngjs'

/**
 * GIF → PNG biçim dönüşümü (Gemini GIF okumaz). Metin çıkarma değildir (K11): piksel verisi
 * aynen taşınır; animasyonlu GIF'te yalnız ilk kare alınır.
 */
export function gifToPng(gif: Uint8Array): Buffer {
  const reader = new GifReader(Buffer.from(gif))
  const { width, height } = reader
  const rgba = Buffer.alloc(width * height * 4)
  reader.decodeAndBlitFrameRGBA(0, rgba)
  const png = new PNG({ width, height })
  // Saydam pikseller beyaz zemine oturtulur (tablo görüntülerinde okunabilirlik).
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3]!
    png.data[i] = a ? rgba[i]! : 255
    png.data[i + 1] = a ? rgba[i + 1]! : 255
    png.data[i + 2] = a ? rgba[i + 2]! : 255
    png.data[i + 3] = 255
  }
  return PNG.sync.write(png)
}
