"""CLI interface for clean_py validator."""

import argparse
import json
import sys
from pathlib import Path

from .validator import validate_file


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="clean-py",
        description="Unified 11-Gate AST & Code Quality Validator",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate_p = subparsers.add_parser("validate", help="Validate a file against all 11 gates")
    validate_p.add_argument("file", help="File to validate")
    validate_p.add_argument("--target", help="Logical target path (if different from file, e.g. for temp files)")
    validate_p.add_argument("--workspace", help="Root workspace directory")
    validate_p.add_argument("--json", action="store_true", help="Output results as JSON")

    args = parser.parse_args()

    if args.command == "validate":
        file_path = Path(args.file)
        target_path = Path(args.target) if args.target else None
        workspace_dir = Path(args.workspace) if args.workspace else None

        result = validate_file(
            file_path=file_path,
            target_path=target_path,
            workspace_dir=workspace_dir,
        )

        if args.json:
            print(json.dumps(result.model_dump()))
        else:
            if result.valid:
                print(f"[clean_py] PASSED: {args.target or args.file} satisfies all quality constraints.")
            else:
                print(f"[clean_py] FAILED: {args.target or args.file}")
                for err in result.errors:
                    print(f"  - {err}")

        return 0 if result.valid else 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
