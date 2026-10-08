#!/usr/bin/env python3
"""Compiles phpMyAdmin's resources/po/*.po into <out>/<code>/LC_MESSAGES/phpmyadmin.mo with polib
(an implementation independent from packages/i18n/src/po.ts), for the PHP fixture generator and for
running a reference phpMyAdmin with translations (bin/generate-mo needs msgfmt, which may be missing).

Only locales listed on the command line (or all when none) are written.

Usage: python3 -I scripts/build-mo.py /path/to/phpmyadmin /out/locale [de fr ...]
Requires: pip install polib
"""
import os
import sys

import polib


def main() -> None:
    pma, out, *codes = sys.argv[1:]
    po_dir = os.path.join(pma, 'resources', 'po')
    for name in sorted(os.listdir(po_dir)):
        if not name.endswith('.po'):
            continue
        code = name[:-3]
        if codes and code not in codes:
            continue
        po = polib.pofile(os.path.join(po_dir, name))
        target = os.path.join(out, code, 'LC_MESSAGES')
        os.makedirs(target, exist_ok=True)
        po.save_as_mofile(os.path.join(target, 'phpmyadmin.mo'))
        print(f'{code}: {len(po.translated_entries())} translated, {po.percent_translated()}%')


if __name__ == '__main__':
    main()
