"""CLI entry-point invoked by the OpenCode clean_python plugin as `python -m clean_py.verify`.

Usage:
    python -m clean_py.verify --file <path> --display-path <relpath>

Exits 0 on success, non-zero on failure. All errors are printed to stdout
so the calling plugin can capture and surface them.
"""

import argparse
import sys

from .validator import validate_file


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="clean_py.verify",
        description="Validate a Python file against the clean_py 11-gate quality pipeline.",
    )
    parser.add_argument("--file", required=True, help="Absolute or relative path to the file to validate.")
    parser.add_argument(
        "--display-path",
        default=None,
        help="Logical path used for reporting (e.g. relative to workspace). Defaults to --file.",
    )
    parser.add_argument("--workspace", default=None, help="Root workspace directory.")
    args = parser.parse_args()

    result = validate_file(
        file_path=args.file,
        target_path=args.display_path,
        workspace_dir=args.workspace,
    )

    if result.valid:
        return 0

    for err in result.errors:
        print(err)
    return 1


if __name__ == "__main__":
    sys.exit(main())