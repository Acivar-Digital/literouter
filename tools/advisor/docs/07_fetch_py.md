# 07 Fetch py

Documentation for `advisor/fetch/views.py`, a scrapling wrapper scaffold that provides clean, agent-targeted HTML view transformations and safe temporary file lifecycle handling.

## a. Inputs-required dependencies

- **Source File**: `advisor/fetch/views.py` (`advisor/fetch/views.py:1-21`).
- **Scrapling Wrapper Role**: Python wrapper interface producing clean agent-targeted HTML without secret or token storage (`advisor/fetch/views.py:2-3`).
- **Standard Library Dependencies**:
  - `tempfile`: Secure scratch file creation (`advisor/fetch/views.py:4`).
  - `os`: File descriptor opening and environment variable access (`advisor/fetch/views.py:5`).
- **Environment Inputs**:
  - `ADVISOR_SELECTORS`: Read via `os.environ.get("ADVISOR_SELECTORS", "body")` defaulting to `"body"` (`advisor/fetch/views.py:7`).
- **Function Arguments**:
  - `clean_view(html: str, selectors: str = SELECTORS)`: Accepts target `html` string and optional DOM/CSS `selectors` string (`advisor/fetch/views.py:9`).
  - `temp_file(html: str)`: Accepts raw input `html` string to process and persist (`advisor/fetch/views.py:13`).

## b. Transformation

- **View Cleaning (`clean_view`)** (`advisor/fetch/views.py:9-11`):
  - Filters noise and prepares content for downstream agent consumption without storing tokens or secrets (`advisor/fetch/views.py:10`).
  - Injects selector metadata comment and strips outer whitespace:
    `f"<!-- selectors={selectors} -->\n{html.strip()}"` (`advisor/fetch/views.py:11`).
- **Temporary File Writing (`temp_file`)** (`advisor/fetch/views.py:13-17`):
  - Allocates a secure file descriptor and path using `tempfile.mkstemp(prefix="advisor_views_", suffix=".html")` (`advisor/fetch/views.py:14`).
  - Safely wraps the file descriptor with `os.fdopen(fd, "w")` context manager (`advisor/fetch/views.py:15`).
  - Writes the sanitized HTML from `clean_view(html)` into the file (`advisor/fetch/views.py:16`).

## c. Outputs-dependencies

- **Return Values**:
  - `clean_view`: Returns transformed HTML string with selector header comment (`advisor/fetch/views.py:11`).
  - `temp_file`: Returns filesystem path string to the generated temporary HTML file (`advisor/fetch/views.py:17`).
- **CLI Scaffold Output** (`advisor/fetch/views.py:19-21`):
  - Direct execution (`__main__`) emits scaffold status noting ruff/test hygiene and zero-secret guarantee (`advisor/fetch/views.py:21`).
- **Downstream Consumers & Dependencies**:
  - Scrapling fetch orchestrators, agent scraping pipelines, and downstream parsers reading generated temporary files.
