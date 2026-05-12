"""Pick the best rooftop samples for the demo.

Criteria — we want photos where:
  - The roof is clearly visible (10-30 % of the image)
  - There is ONE dominant building (largest component >= 70 % of roof pixels)
  - The roof is contiguous (low fragmentation)
  - Some variety in size (small / medium / large rooftop)

Usage:
    python scripts/pick_rooftop_samples.py [--top N] [--copy] [--inspect]

Without --copy, the script just prints the top candidates.
With --copy, it copies the top N tiles AND their labels to the samples/ folder
under sample_1.tif … sample_N.tif (overwriting the existing samples).
"""
from __future__ import annotations
import argparse
from pathlib import Path
import shutil

import numpy as np
import tifffile

THIS = Path(__file__).resolve().parent
ROOT = THIS.parent.parent
EXPORT_DIR = (
    ROOT / "models_input" / "02_rooftop_segmentation"
    / "export_rooftop-20260428T231533Z-3-001" / "export_rooftop"
)
IMG_DIR = EXPORT_DIR / "images_labels"
OUT_DIR = EXPORT_DIR / "samples"


def load_label_binary(path: Path) -> np.ndarray:
    arr = tifffile.imread(str(path))
    if arr.ndim == 3:
        arr = arr[..., 0]
    return (arr > 0).astype(np.uint8)


def largest_component_ratio(mask: np.ndarray) -> float:
    """Return (size of largest connected component) / (total roof pixels)."""
    if mask.sum() == 0:
        return 0.0
    try:
        from scipy.ndimage import label as cc_label
    except ImportError:
        # Fallback: simple flood-fill (slow). Skip if scipy missing.
        return 1.0
    labeled, n = cc_label(mask)
    if n == 0:
        return 0.0
    sizes = np.bincount(labeled.flat)[1:]
    return float(sizes.max()) / float(mask.sum())


def edge_touch_score(mask: np.ndarray) -> float:
    """Penalize roofs that touch the image border heavily (incomplete buildings)."""
    if mask.sum() == 0:
        return 1.0
    H, W = mask.shape
    border_pixels = (
        mask[0, :].sum() + mask[-1, :].sum()
        + mask[:, 0].sum() + mask[:, -1].sum()
    )
    perimeter = 2 * (H + W)
    return float(border_pixels) / max(1, perimeter)


def score_tile(label_path: Path) -> dict | None:
    try:
        mask = load_label_binary(label_path)
    except Exception as e:
        return None
    H, W = mask.shape
    n_roof = int(mask.sum())
    coverage = n_roof / (H * W)
    if coverage < 0.05 or coverage > 0.45:
        return None   # too small or too crowded
    largest_ratio = largest_component_ratio(mask)
    edge = edge_touch_score(mask)
    # Composite score — favor mid-coverage + single dominant building + away from edges
    coverage_score = 1.0 - abs(coverage - 0.18) / 0.18  # peak around 18 % coverage
    score = (
        max(0, coverage_score) * 0.4
        + largest_ratio * 0.45
        + (1 - min(1, edge * 8)) * 0.15
    )
    return {
        "image": label_path.name.replace("_label.tif", ".tif"),
        "label": label_path.name,
        "coverage_pct": round(coverage * 100, 1),
        "largest_component_pct": round(largest_ratio * 100, 1),
        "edge_touch_pct": round(edge * 100, 1),
        "score": round(score, 3),
        "n_roof_pixels": n_roof,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=10,
                    help="How many top candidates to print")
    ap.add_argument("--copy", type=int, default=0,
                    help="Copy the top N as sample_1.tif … sample_N.tif (and overwrite)")
    ap.add_argument("--inspect", action="store_true",
                    help="Print extra diagnostic info per candidate")
    args = ap.parse_args()

    if not IMG_DIR.exists():
        print(f"[err] Image dir not found: {IMG_DIR}")
        return

    label_paths = sorted(IMG_DIR.glob("*_label.tif"))
    print(f"Scanning {len(label_paths)} labels in {IMG_DIR}\n")

    results = []
    for i, lp in enumerate(label_paths):
        if i % 200 == 0 and i > 0:
            print(f"  ... {i}/{len(label_paths)}")
        info = score_tile(lp)
        if info is not None:
            results.append(info)
    print(f"\nKept {len(results)} candidates after filtering "
          f"(coverage 5-45 %).\n")

    # Diversity: pick top by score but spread coverage so we don't get all
    # near-identical roofs.
    results.sort(key=lambda r: r["score"], reverse=True)

    # Bucket by coverage range so we get variety
    buckets = {"small": [], "mid": [], "large": []}
    for r in results:
        c = r["coverage_pct"]
        if c < 12:    buckets["small"].append(r)
        elif c < 22:  buckets["mid"].append(r)
        else:         buckets["large"].append(r)

    diverse = []
    # interleave best-of-each-bucket
    for i in range(max(args.top, args.copy)):
        for bk in ("mid", "small", "large"):
            if i < len(buckets[bk]):
                diverse.append(buckets[bk][i])
            if len(diverse) >= max(args.top, args.copy):
                break
        if len(diverse) >= max(args.top, args.copy):
            break

    print(f"Top {min(args.top, len(diverse))} candidates (after diversity pass):\n")
    print(f"  {'rank':<4} {'file':<28} {'cover%':<8} {'largest%':<10} "
          f"{'edge%':<7} {'score':<6}")
    print("  " + "-" * 70)
    for i, r in enumerate(diverse[:args.top], 1):
        print(f"  {i:<4} {r['image']:<28} {r['coverage_pct']:<8} "
              f"{r['largest_component_pct']:<10} {r['edge_touch_pct']:<7} "
              f"{r['score']:<6}")

    if args.copy > 0:
        n = min(args.copy, len(diverse))
        OUT_DIR.mkdir(exist_ok=True)
        # Backup existing samples once
        backup = OUT_DIR / "_backup_original"
        if not backup.exists():
            backup.mkdir()
            for f in OUT_DIR.glob("sample_*.tif"):
                shutil.copy2(f, backup / f.name)
            print(f"\n[backup] original samples saved to {backup}")

        for i, r in enumerate(diverse[:n], 1):
            src_img = IMG_DIR / r["image"]
            src_lab = IMG_DIR / r["label"]
            dst_img = OUT_DIR / f"sample_{i}.tif"
            dst_lab = OUT_DIR / f"sample_{i}_label.tif"
            shutil.copy2(src_img, dst_img)
            shutil.copy2(src_lab, dst_lab)
            print(f"  [copy] {r['image']:<28} -> sample_{i}.tif "
                  f"(cover {r['coverage_pct']}%)")
        print(f"\nWrote {n} new samples to {OUT_DIR}")


if __name__ == "__main__":
    main()
