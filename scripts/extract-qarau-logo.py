#!/usr/bin/env python3
"""Extract pixel-faithful Qarau logo assets from the supplied brand board.

The source assets are never redrawn, recolored, resampled, or synthesized. The
script copies RGB pixels from fixed, label-free regions of the 1536x1024 source
and derives a binary transparency mask from panel contrast. Favicon derivatives
are the only resized outputs and are reported separately.

Example:
    python scripts/extract-qarau-logo.py --source "C:\\path\\to\\brand-board.png"
"""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from statistics import median

from PIL import Image, ImageChops, ImageFilter


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = PROJECT_ROOT / "src" / "assets" / "qarau"
DEFAULT_PUBLIC_OUTPUT = PROJECT_ROOT / "public"
EXPECTED_SOURCE_SIZE = (1536, 1024)


@dataclass(frozen=True)
class Variant:
    filename: str
    source_region: tuple[int, int, int, int]
    background: str
    candidate_delta: int
    seed_delta: int
    grow_iterations: int = 3
    padding: int = 10


# Regions intentionally exclude all panel headings and divider rules.
VARIANTS = (
    Variant(
        filename="monogram-on-dark.png",
        source_region=(405, 85, 588, 275),
        background="dark",
        candidate_delta=4,
        seed_delta=18,
        padding=8,
    ),
    Variant(
        filename="mark-on-dark.png",
        source_region=(180, 480, 600, 625),
        background="dark",
        candidate_delta=4,
        seed_delta=18,
    ),
    Variant(
        filename="wordmark-on-dark.png",
        source_region=(960, 500, 1360, 610),
        background="dark",
        candidate_delta=4,
        seed_delta=18,
    ),
    Variant(
        filename="primary-lockup-on-dark.png",
        source_region=(45, 725, 525, 830),
        background="dark",
        candidate_delta=4,
        seed_delta=18,
    ),
    Variant(
        filename="primary-lockup-on-light.png",
        source_region=(600, 720, 995, 835),
        background="light",
        candidate_delta=7,
        seed_delta=18,
    ),
)


def perimeter_median(image: Image.Image, band: int = 4) -> int:
    """Return a robust grayscale background estimate from the crop perimeter."""
    grayscale = image.convert("L")
    width, height = grayscale.size
    samples: list[int] = []
    pixels = grayscale.load()

    for y in range(height):
        for x in range(band):
            samples.append(pixels[x, y])
            samples.append(pixels[width - 1 - x, y])
    for x in range(band, width - band):
        for y in range(band):
            samples.append(pixels[x, y])
            samples.append(pixels[x, height - 1 - y])

    return int(median(samples))


def contrast_delta(image: Image.Image, background: str, level: int) -> Image.Image:
    """Calculate positive contrast away from the inferred panel background."""
    grayscale = image.convert("L")
    flat_background = Image.new("L", grayscale.size, level)
    if background == "dark":
        return ImageChops.subtract(grayscale, flat_background)
    if background == "light":
        return ImageChops.subtract(flat_background, grayscale)
    raise ValueError(f"Unsupported background mode: {background}")


def threshold(image: Image.Image, minimum: int) -> Image.Image:
    table = [0 if value < minimum else 255 for value in range(256)]
    return image.point(table, mode="L")


def build_alpha(roi: Image.Image, variant: Variant) -> tuple[Image.Image, int]:
    """Build a binary alpha mask with constrained edge recovery.

    Strong-contrast pixels seed the mask. The mask may then grow by at most three
    pixels, and only into pixels that still differ measurably from the panel. This
    removes near-uniform background texture without losing source antialias pixels.
    """
    background_level = perimeter_median(roi)
    delta = contrast_delta(roi, variant.background, background_level)
    candidate = threshold(delta, variant.candidate_delta)
    alpha = threshold(delta, variant.seed_delta)

    for _ in range(variant.grow_iterations):
        expanded = alpha.filter(ImageFilter.MaxFilter(3))
        alpha = ImageChops.multiply(expanded, candidate)

    if variant.filename == "monogram-on-dark.png":
        # The large source Q touches the first bright bridge facet. Separate it
        # along the facet's diagonal edge in source coordinates, changing alpha
        # only; every retained RGB byte still comes directly from the board.
        pixels = alpha.load()
        origin_x, origin_y = variant.source_region[:2]
        for y in range(alpha.height):
            source_y = origin_y + y
            for x in range(alpha.width):
                source_x = origin_x + x
                if (
                    source_x >= 555
                    and source_y >= 218
                    and source_y - source_x < -323
                ):
                    pixels[x, y] = 0

    return alpha, background_level


def expand_bbox(
    bbox: tuple[int, int, int, int],
    padding: int,
    bounds: tuple[int, int],
) -> tuple[int, int, int, int]:
    left, top, right, bottom = bbox
    width, height = bounds
    return (
        max(0, left - padding),
        max(0, top - padding),
        min(width, right + padding),
        min(height, bottom + padding),
    )


def add_origin(
    bbox: tuple[int, int, int, int],
    origin: tuple[int, int],
) -> tuple[int, int, int, int]:
    left, top, right, bottom = bbox
    origin_x, origin_y = origin
    return (
        left + origin_x,
        top + origin_y,
        right + origin_x,
        bottom + origin_y,
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def extract_variant(
    source: Image.Image,
    output_dir: Path,
    variant: Variant,
) -> dict[str, object]:
    roi = source.crop(variant.source_region)
    alpha, background_level = build_alpha(roi, variant)
    detected_bbox = alpha.getbbox()
    if detected_bbox is None:
        raise RuntimeError(f"No logo pixels detected for {variant.filename}")

    output_bbox = expand_bbox(detected_bbox, variant.padding, roi.size)
    rgb_crop = roi.crop(output_bbox).convert("RGBA")
    alpha_crop = alpha.crop(output_bbox)
    rgb_crop.putalpha(alpha_crop)

    output_path = output_dir / variant.filename
    rgb_crop.save(output_path, format="PNG", compress_level=9)

    # PNG is lossless; verify that writing/reading it did not alter any RGB byte.
    with Image.open(output_path) as written:
        rgb_difference = ImageChops.difference(
            written.convert("RGB"), roi.crop(output_bbox).convert("RGB")
        )
        if rgb_difference.getbbox() is not None:
            raise RuntimeError(f"RGB verification failed for {variant.filename}")

    origin = (variant.source_region[0], variant.source_region[1])
    source_content_bbox = add_origin(detected_bbox, origin)
    source_output_bbox = add_origin(output_bbox, origin)
    opaque_pixels = alpha_crop.histogram()[255]

    return {
        "path": str(output_path),
        "dimensions": list(rgb_crop.size),
        "source_region": list(variant.source_region),
        "source_content_bbox": list(source_content_bbox),
        "source_output_bbox": list(source_output_bbox),
        "background": variant.background,
        "background_luma": background_level,
        "candidate_delta": variant.candidate_delta,
        "seed_delta": variant.seed_delta,
        "edge_growth_pixels": variant.grow_iterations,
        "adjacent_bridge_excluded": variant.filename == "monogram-on-dark.png",
        "padding_pixels": variant.padding,
        "opaque_pixels": opaque_pixels,
        "source_rgb_exact": True,
        "sha256": sha256(output_path),
    }


def make_square_icon(source_path: Path, output_path: Path, size: int) -> dict[str, object]:
    """Fit the light monogram into a universal black square icon canvas."""
    with Image.open(source_path) as opened:
        monogram = opened.convert("RGBA")

    target = max(1, round(size * 0.82))
    scale = min(target / monogram.width, target / monogram.height)
    resized_size = (
        max(1, round(monogram.width * scale)),
        max(1, round(monogram.height * scale)),
    )
    # Pillow's premultiplied-alpha mode prevents hidden black source pixels from
    # bleeding into the antialiased edge during the only resampling in this flow.
    resized = (
        monogram.convert("RGBa")
        .resize(resized_size, Image.Resampling.LANCZOS)
        .convert("RGBA")
    )
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 255))
    position = ((size - resized.width) // 2, (size - resized.height) // 2)
    canvas.alpha_composite(resized, position)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, format="PNG", compress_level=9)

    return {
        "path": str(output_path),
        "dimensions": [size, size],
        "source": str(source_path),
        "resized_content_dimensions": list(resized_size),
        "position": list(position),
        "canvas": "#000000",
        "resampling": "Pillow LANCZOS in premultiplied-alpha RGBa mode",
        "sha256": sha256(output_path),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        required=True,
        type=Path,
        help="Path to the original 1536x1024 Qarau brand-board PNG.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Asset output directory (default: {DEFAULT_OUTPUT}).",
    )
    parser.add_argument(
        "--public-output",
        type=Path,
        default=DEFAULT_PUBLIC_OUTPUT,
        help=f"Favicon output directory (default: {DEFAULT_PUBLIC_OUTPUT}).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source_path = args.source.expanduser().resolve()
    output_dir = args.output.expanduser().resolve()
    public_output_dir = args.public_output.expanduser().resolve()

    if not source_path.is_file():
        raise SystemExit(f"Source image does not exist: {source_path}")

    with Image.open(source_path) as opened:
        source = opened.convert("RGB")

    if source.size != EXPECTED_SOURCE_SIZE:
        raise SystemExit(
            f"Expected source size {EXPECTED_SOURCE_SIZE}, got {source.size}. "
            "The fixed extraction regions would not be pixel-faithful."
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    assets = [extract_variant(source, output_dir, variant) for variant in VARIANTS]
    monogram_path = output_dir / "monogram-on-dark.png"
    icons = [
        make_square_icon(monogram_path, public_output_dir / filename, size)
        for filename, size in (
            ("favicon-32.png", 32),
            ("favicon-48.png", 48),
            ("apple-touch-icon.png", 180),
        )
    ]

    report = {
        "source": str(source_path),
        "source_dimensions": list(source.size),
        "source_sha256": sha256(source_path),
        "method": (
            "Original RGB pixels plus binary alpha. Perimeter-median panel luma; "
            "strong contrast seeds; three-pixel constrained growth into low-contrast "
            "edge pixels; fixed label-free regions; no resampling or recoloring."
        ),
        "assets": assets,
        "resized_icon_derivatives": icons,
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
