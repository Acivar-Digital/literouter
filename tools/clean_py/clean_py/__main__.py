import sys

# The clean_python plugin invokes `python -m clean_py.verify ...` directly, which
# resolves to `python -m clean_py.__main__ verify ...`. Route on the first
# positional argument so both entry points work without a separate module.
if len(sys.argv) > 1 and sys.argv[1] == "verify":
    sys.argv.pop(1)
    from clean_py.verify import main
else:
    from clean_py.cli import main

if __name__ == "__main__":
    sys.exit(main())