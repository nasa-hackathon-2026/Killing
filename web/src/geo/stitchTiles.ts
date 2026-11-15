import { CanvasTexture, SRGBColorSpace } from "three";
import {
  blitRect,
  gibsTileUrl,
  type GibsTile,
  type LonLatBounds,
} from "./detailCoverage";

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(url));
    image.src = url;
  });
}

// Draws every tile into one square whose edges are `frame`, so a city at
// the centre of `frame` is the centre of the canvas.
export async function stitchedTexture(
  frame: LonLatBounds,
  tiles: readonly GibsTile[],
  size = 1024,
): Promise<CanvasTexture> {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  const images = await Promise.all(
    tiles.map(async (tile) => ({
      tile,
      image: await loadImage(gibsTileUrl(tile.col, tile.row)),
    })),
  );
  for (const { tile, image } of images) {
    const rect = blitRect(tile, frame, size);
    context.drawImage(image, rect.x, rect.y, rect.w, rect.h);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}
