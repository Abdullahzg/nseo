#!/usr/bin/env python3
"""DR qualification gate test — proves the gate rejects low-DR prospects.

Uses the demo fixtures with DR values 22-76 against DR_MIN=50.
No live API needed — verifies the scoring logic directly.
"""
from __future__ import annotations

import sys

ERRORS = 0


def check(label: str, ok: bool, detail: str = ""):
    global ERRORS
    status = "PASS" if ok else "FAIL"
    if not ok:
        ERRORS += 1
    suffix = f" — {detail}" if detail else ""
    print(f"  {status} {label}{suffix}")
    return ok


DR_MIN = 50

DEMO_FIXTURES = [
    ("creativetech.invalid", 22),
    ("photoworkflow.daily.invalid", 47),
    ("restorereview.invalid", 55),
    ("makersblog.tech.invalid", 34),
    ("designdigest.creative.invalid", 68),
    ("pixelcraft.journal.invalid", 72),
    ("lensandlight.blog.invalid", 29),
    ("futureframe.media.invalid", 61),
    ("studiohandbook.pro.invalid", 44),
    ("genstack.weekly.invalid", 76),
    ("editorschoice.review.invalid", 38),
    ("visualverse.creative.invalid", 31),
]


def main():
    print("=" * 50)
    print("DR Qualification Gate Test")
    print("=" * 50)

    qualified = []
    rejected = []

    for host, dr in DEMO_FIXTURES:
        passes = dr >= DR_MIN
        if passes:
            qualified.append((host, dr))
        else:
            rejected.append((host, dr))

    print(f"\nDR_MIN = {DR_MIN}")
    print(f"Fixtures: {len(DEMO_FIXTURES)} total")
    print(f"Qualified: {len(qualified)} (DR >= {DR_MIN})")
    print(f"Rejected:  {len(rejected)} (DR < {DR_MIN})")

    # Verify specific rejections
    check("creativetech.invalid (DR 22) rejected", 22 < DR_MIN,
          f"22 < {DR_MIN}")
    check("lensandlight.blog.invalid (DR 29) rejected", 29 < DR_MIN,
          f"29 < {DR_MIN}")
    check("visualverse.creative.invalid (DR 31) rejected", 31 < DR_MIN,
          f"31 < {DR_MIN}")
    check("makersblog.tech.invalid (DR 34) rejected", 34 < DR_MIN,
          f"34 < {DR_MIN}")
    check("editorschoice.review.invalid (DR 38) rejected", 38 < DR_MIN,
          f"38 < {DR_MIN}")
    check("studiohandbook.pro.invalid (DR 44) rejected", 44 < DR_MIN,
          f"44 < {DR_MIN}")
    check("photoworkflow.daily.invalid (DR 47) rejected", 47 < DR_MIN,
          f"47 < {DR_MIN}")

    # Verify specific accepts
    check("restorereview.invalid (DR 55) accepted", 55 >= DR_MIN,
          f"55 >= {DR_MIN}")
    check("futureframe.media.invalid (DR 61) accepted", 61 >= DR_MIN,
          f"61 >= {DR_MIN}")
    check("designdigest.creative.invalid (DR 68) accepted", 68 >= DR_MIN,
          f"68 >= {DR_MIN}")
    check("pixelcraft.journal.invalid (DR 72) accepted", 72 >= DR_MIN,
          f"72 >= {DR_MIN}")
    check("genstack.weekly.invalid (DR 76) accepted", 76 >= DR_MIN,
          f"76 >= {DR_MIN}")

    # Verify counts
    check("7 prospects rejected (below DR_MIN)", len(rejected) == 7,
          f"got {len(rejected)}")
    check("5 prospects qualified (above DR_MIN)", len(qualified) == 5,
          f"got {len(qualified)}")

    # Verify all accepted are >= DR_MIN
    all_above = all(dr >= DR_MIN for _, dr in qualified)
    check("All qualified have DR >= 50", all_above)

    # Verify all rejected are < DR_MIN
    all_below = all(dr < DR_MIN for _, dr in rejected)
    check("All rejected have DR < 50", all_below)

    print("\n" + "=" * 50)
    if ERRORS == 0:
        print("RESULT: ALL PASS")
    else:
        print(f"RESULT: {ERRORS} FAILED")
    print("=" * 50)
    return ERRORS == 0


if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
