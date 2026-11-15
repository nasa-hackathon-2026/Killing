import {
  DataTexture,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";
import { paintSeason, type SeasonalCycle } from "./seasonal";

// The texture of the trend map overlay and the calendar position it shows.
// Kept in one object so the overlay component only calls methods on it.
export class SeasonalSurface {
  readonly texture: DataTexture;
  private readonly pixels: Uint8Array;
  private shown: number | null = null;

  constructor(
    private readonly base: Uint8Array,
    nLon: number,
    nLat: number,
  ) {
    this.pixels = new Uint8Array(base);
    this.texture = new DataTexture(
      this.pixels,
      nLon,
      nLat,
      RGBAFormat,
      UnsignedByteType,
    );
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = NearestFilter;
    this.texture.needsUpdate = true;
  }

  // The map as computed, without the seasonal strength.
  showStatic(): void {
    this.shown = null;
    this.pixels.set(this.base);
    this.texture.needsUpdate = true;
  }

  // Forget the shown month, so the next call to `show` paints at once.
  forget(): void {
    this.shown = null;
  }

  // Calendar position being shown; null before the first paint.
  get position(): number | null {
    return this.shown;
  }

  // Paints calendar position `position` (0 ≤ p < 12) if it is not the one
  // already shown.
  show(
    months: readonly Float32Array[],
    cycle: SeasonalCycle,
    position: number,
  ): void {
    if (position === this.shown) return;
    this.shown = position;
    paintSeason(this.base, this.pixels, months, cycle, position);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
