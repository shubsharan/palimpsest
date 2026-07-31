# Contract: Returned Reasoning Summary

## Captured

```json
{
  "reasoningSummary": "Inspect the repository. Then test the solver.",
  "returnedReasoningSummary": {
    "status": "captured",
    "items": [
      {
        "id": "rs_123",
        "summary": [
          { "type": "summary_text", "text": "Inspect the repository." },
          { "type": "summary_text", "text": "Then test the solver." }
        ]
      }
    ]
  }
}
```

Item and entry order are provider order. Text is retained exactly.

## Captured Empty

```json
{
  "returnedReasoningSummary": {
    "status": "captured",
    "items": []
  }
}
```

## Body Unavailable

```json
{
  "returnedReasoningSummary": {
    "status": "response-body-unavailable"
  }
}
```

The retained value never contains the complete response body, encrypted reasoning, headers, credentials, or unrelated output items.
