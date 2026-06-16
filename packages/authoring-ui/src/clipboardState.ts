import type { DisplayObject, EaseCurve } from "@flash/core";

/** Tween parameters captured by Copy Motion / applied by Paste Motion. */
export interface MotionClipboard {
  tweenType: "none" | "motion" | "shape";
  motionEase: number;
  motionEaseCurve?: EaseCurve | null;
  motionRotate: "none" | "auto" | "cw" | "ccw";
  motionRotateCount: number;
  motionOrientToPath: boolean;
  motionSync: boolean;
  motionScale: boolean;
  shapeEase: number;
  shapeBlend: "distributive" | "angular";
}

/**
 * Module-level editor clipboards (avoids async navigator.clipboard complexity and
 * survives re-renders). A single mutable container so the clipboard hook can read
 * and write without prop threading.
 */
export const clipboard: {
  items: DisplayObject[];
  motion: MotionClipboard | null;
} = {
  items: [],
  motion: null,
};
