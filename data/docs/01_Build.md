Here is exactly what you can give to your AI coding assistant (like ChatGPT, Claude, Cursor, etc.) to get it to write the code for you, along with a working Python script you can use right now.

### 1. Give this prompt to your AI coding assistant:
*Copy and paste this block to your LLM so it understands your database structure and what you are trying to do:*

> "I have set up OpenRouter to stream LLM traces to my Google BigQuery database. My project ID is `project-7b250e67-6e23-4c02-ab5`, and the table is `project-7b250e67-6e23-4c02-ab5.openrouter.openrouter_traces`. 
>
> I am passing custom trading metadata into OpenRouter when I prompt it, which gets stored in the `metadata` JSON column.
> 
> I need a Python script to:
> 1. Authenticate using a local `openrouter-key.json` service account file.
> 2. Query BigQuery to download the last 1000 AI traces.
> 3. Extract the JSON metadata (like ticker, strategy, or trade ID) using `JSON_VALUE`.
> 4. Load the results into a Pandas DataFrame so I can mine the data to study AI failure rates, latency (`duration_ms`), costs, and my trading outputs.
> 5. Print a basic summary of the data."

***

### 2. The Python Script (You can run this right now)

To run this yourself on your local computer, you just need to do two things:

**Step A:** Install the required Python libraries in your terminal:
```bash
pip install google-cloud-bigquery pandas db-dtypes
```

**Step B:** Save that JSON key you created earlier as a file on your computer named `openrouter-key.json` in the same folder as this Python script. 

**Step C:** Run this Python code:

```python
import os
import pandas as pd
from google.cloud import bigquery
from google.oauth2 import service_account

# 1. Point to the JSON key you downloaded earlier
KEY_PATH = "openrouter-key.json"
PROJECT_ID = "project-7b250e67-6e23-4c02-ab5"

print("Authenticating with Google Cloud...")
credentials = service_account.Credentials.from_service_account_file(KEY_PATH)
client = bigquery.Client(credentials=credentials, project=PROJECT_ID)

# 2. Write the SQL Query to download your trades and AI metrics
# We use JSON_VALUE to pull your specific trade data out of the metadata column
query = """
SELECT 
    timestamp,
    model,
    status,
    level,
    finish_reason,
    duration_ms,
    total_cost,
    JSON_VALUE(metadata, '$.ticker') AS ticker,
    JSON_VALUE(metadata, '$.strategy') AS strategy,
    output
FROM `project-7b250e67-6e23-4c02-ab5.openrouter.openrouter_traces`
ORDER BY timestamp DESC
LIMIT 1000;
"""

# 3. Download the data into a Pandas DataFrame
print("Downloading trades from BigQuery...")
query_job = client.query(query)
df = query_job.to_dataframe()

# 4. Data Mining & Analysis
print(f"\nSuccessfully downloaded {len(df)} traces!\n")

# -- MINING EXAMPLE 1: Check for Failures & Retries --
print("--- AI INFERENCE STATUS ---")
print(df['status'].value_counts())
print("\n")

# -- MINING EXAMPLE 2: Average Latency by Model --
print("--- AVERAGE RESPONSE TIME (Latency) ---")
if not df.empty:
    latency = df.groupby('model')['duration_ms'].mean().round(2)
    print(latency)
print("\n")

# -- MINING EXAMPLE 3: View the actual Trades --
print("--- LATEST TRADES ---")
print(df[['timestamp', 'ticker', 'strategy', 'status']].head())
```

### How to use this for learning:
Whenever you send an API request to OpenRouter from now on, include a `metadata` dictionary in your JSON payload. 

For example, if you are asking the LLM to analyze Bitcoin, pass this in your OpenRouter request:
```json
"metadata": {
  "ticker": "BTC",
  "strategy": "Moving Average Breakout"
}
```
BigQuery will instantly save it. Then, when you run the Python script above, it will extract `BTC` and `Moving Average Breakout` right into your Pandas DataFrame. 

From there, you can use Pandas to easily answer questions like:
* *"Which model fails the most when analyzing crypto?"*
* *"What is the average response time for Llama 3 vs GPT-4o?"*
* *"If a request failed with a 'timeout' finish_reason, did my script retry it successfully?"*