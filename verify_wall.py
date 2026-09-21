#!/usr/bin/env python3
"""Measure ONE finished wall clip and print its signature as JSON.

Used by /api/verify-motion to check that a generated set actually performs the
rig move it was generated under. Deliberately the same measurement code as the
reference library (learn_rig.measure_region), because comparing a clip measured
one way against a reference measured another way compares nothing.
"""
import json
import sys

import learn_rig as L


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'usage: verify_wall.py <clip>'}))
        sys.exit(1)
    sig = L.measure_region(sys.argv[1])
    if not sig:
        print(json.dumps({'error': 'no usable motion could be measured in this clip'}))
        return
    sig['strength'] = round(L.motion_strength(sig), 4)
    print(json.dumps(sig))


if __name__ == '__main__':
    main()
