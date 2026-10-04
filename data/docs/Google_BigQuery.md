
## Example queries

### Cost analysis by model

```sql lines theme={null}
SELECT
  DATE(timestamp) as day,
  model,
  SUM(total_cost) as total_cost,
  SUM(total_tokens) as total_tokens,
  COUNT(*) as request_count
FROM `my-gcp-project.openrouter.openrouter_traces`
WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  AND status = 'ok'
GROUP BY day, model
ORDER BY day DESC, total_cost DESC;
```

### User activity analysis

```sql lines theme={null}
SELECT
  user_id,
  COUNT(DISTINCT trace_id) as trace_count,
  COUNT(DISTINCT session_id) as session_count,
  SUM(total_tokens) as total_tokens,
  SUM(total_cost) as total_cost,
  AVG(duration_ms) as avg_duration_ms
FROM `my-gcp-project.openrouter.openrouter_traces`
WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY user_id
ORDER BY total_cost DESC;
```

### Error analysis

```sql lines theme={null}
SELECT
  trace_id,
  timestamp,
  model,
  level,
  finish_reason,
  metadata,
  input,
  output
FROM `my-gcp-project.openrouter.openrouter_traces`
WHERE status = 'error'
  AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
ORDER BY timestamp DESC;
```

### Provider performance comparison

```sql lines theme={null}
SELECT
  provider_name,
  model,
  AVG(duration_ms) as avg_duration_ms,
  APPROX_QUANTILES(duration_ms, 100)[OFFSET(50)] as p50_duration_ms,
  APPROX_QUANTILES(duration_ms, 100)[OFFSET(95)] as p95_duration_ms,
  COUNT(*) as request_count
FROM `my-gcp-project.openrouter.openrouter_traces`
WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
  AND status = 'ok'
GROUP BY provider_name, model
HAVING request_count >= 10
ORDER BY avg_duration_ms;
```

### Usage by API key

```sql lines theme={null}
SELECT
  api_key_name,
  COUNT(DISTINCT trace_id) as trace_count,
  SUM(total_cost) as total_cost,
  SUM(prompt_tokens) as prompt_tokens,
  SUM(completion_tokens) as completion_tokens
FROM `my-gcp-project.openrouter.openrouter_traces`
WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY api_key_name
ORDER BY total_cost DESC;
```

### Accessing JSON columns

The `attributes`, `input`, `output`, `metadata`, `model_parameters`, and `resource_attributes` columns are `JSON` typed. Use BigQuery's JSON functions to query nested fields:

```sql lines theme={null}
SELECT
  trace_id,
  JSON_VALUE(metadata, '$.custom_field') as custom_value,
  JSON_VALUE(attributes, '$."gen_ai.request.model"') as requested_model
FROM `my-gcp-project.openrouter.openrouter_traces`
WHERE JSON_VALUE(metadata, '$.custom_field') IS NOT NULL;
```

To parse input messages:

```sql lines theme={null}
SELECT
  trace_id,
  JSON_VALUE(input, '$.messages[0].role') as first_message_role,
  JSON_VALUE(input, '$.messages[0].content') as first_message_content
FROM `my-gcp-project.openrouter.openrouter_traces`
LIMIT 10;
```

## Schema design

### Typed columns

The schema extracts commonly-queried fields as typed columns for efficient filtering and aggregation:

* **Identifiers**: `trace_id`, `user_id`, `session_id`, etc.
* **Timestamps**: `TIMESTAMP` columns for time-series analysis
* **Model Info**: For cost and performance analysis
* **Metrics**: Tokens and costs for billing

### JSON columns

Less commonly-accessed and variable-structure data is stored in `JSON` columns:

* **attributes**: Full OTEL attribute set
* **input/output**: Variable message structures
* **metadata**: User-defined key-values
* **model\_parameters**: Model-specific configurations

The `tags` column is a repeated `STRING` column (`ARRAY<STRING>`). Use BigQuery's `JSON_VALUE` and `JSON_QUERY` functions to query the JSON fields.

## Custom Metadata

Custom metadata from the `trace` field is stored in the `metadata` JSON column. You can query it using BigQuery's JSON functions.

### Supported Metadata Keys

| Key               | BigQuery Mapping                    | Description                          |
| ----------------- | ----------------------------------- | ------------------------------------ |
| `trace_id`        | `trace_id` column / `metadata` JSON | Custom trace identifier for grouping |
| `trace_name`      | `metadata` JSON                     | Custom name for the trace            |
| `span_name`       | `metadata` JSON                     | Name for intermediate spans          |
| `generation_name` | `metadata` JSON                     | Name for the LLM generation          |

### Example

```json lines theme={null}
{
  "model": "openai/gpt-4o",
  "messages": [{ "role": "user", "content": "Forecast next quarter revenue..." }],
  "user": "user_12345",
  "session_id": "session_abc",
  "trace": {
    "trace_name": "Revenue Forecasting",
    "generation_name": "Generate Forecast",
    "department": "finance",
    "quarter": "Q2-2026",
    "model_version": "v3"
  }
}
```

### Querying Custom Metadata

```sql lines theme={null}
SELECT
  trace_id,
  JSON_VALUE(metadata, '$.department') as department,
  JSON_VALUE(metadata, '$.quarter') as quarter,
  JSON_VALUE(metadata, '$.model_version') as model_version,
  total_cost,
  total_tokens
FROM `my-gcp-project.openrouter.openrouter_traces`
WHERE JSON_VALUE(metadata, '$.department') IS NOT NULL
ORDER BY timestamp DESC;
```

### Additional Context

* The `user` field maps to the `user_id` typed column
* The `session_id` field maps to the `session_id` typed column
* All custom metadata keys from `trace` are stored in the `metadata` JSON column for flexible querying

## Troubleshooting

* **Project not found or permission denied**: Confirm that the configured project ID is the project containing the dataset and that the service account belongs to the expected project.
* **Table not found**: Confirm the dataset and table IDs and that the table was created in the configured dataset location.
* **403 permission denied**: Grant the service account **BigQuery Data Editor** on the dataset. Project-level access may be restricted by organization policy, so verify the dataset permission directly.
* **400 invalid or schema mismatch**: Compare the table schema with the DDL from the setup instructions. In particular, timestamps must be `TIMESTAMP`, nested trace fields must be `JSON`, and `tags` must be `ARRAY<STRING>`.

## Additional resources

* [BigQuery Documentation](https://cloud.google.com/bigquery/docs)
* [Streaming Data into BigQuery](https://cloud.google.com/bigquery/docs/streaming-data-into-bigquery)
* [JSON Functions in GoogleSQL](https://cloud.google.com/bigquery/docs/reference/standard-sql/json_functions)

## Privacy Mode

When [Privacy Mode](/docs/guides/features/broadcast#privacy-mode) is enabled for this destination, prompt and completion content is excluded from traces. All other trace data — token usage, costs, timing, model information, and custom metadata — is still sent normally. See [Privacy Mode](/docs/guides/features/broadcast#privacy-mode) for details.
