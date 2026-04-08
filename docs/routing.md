# 🎯 Deterministic Routing Policy

LiteRouter implements a **Stateful Sequential Round-Robin** algorithm. This ensures that load is distributed perfectly evenly across all available API keys.

## How it Works

1. **Global Counter**: LiteRouter maintains a internal index (counter) that persists for the lifetime of the server process.
2. **Sequential Selection**:
   - For every request, the router calculates the starting position based on the current counter: `start = counter % N`.
   - It selects the key at that index and immediately increments the counter: `counter = (index + 1)`.
3. **Deterministic Persistence**:
   - If a request is fulfilled by **Key 3**, the internal state is updated such that the **very next** request is guaranteed to start its search from **Key 4**.
   - It **does not reset to Key 1** until it has fully cycled through all $N$ keys.

## Even Distribution Guarantee

Unlike "Random" or "Weighted" routing which only approach evenness over large samples, LiteRouter's distribution is **mathematically perfectly even**.

| Request # | Key Used (Assuming 5 Keys) |
| :--- | :--- |
| 1 | Key 1 |
| 2 | Key 2 |
| 3 | Key 3 |
| **--- Server waits ---** | |
| 4 | Key 4 |
| 5 | Key 5 |
| 6 | Key 1 |

## Error Resilience & Skipping

If a key is on **cooldown** (429) or **quarantined** (401/403):
- The router will "skip" that key in the sequence.
- It will find the next available key in the order.
- The counter is updated based on the position found, maintaining the sequential "flow" relative to the list of keys.

> [!NOTE]
> The counter is currently stored in-memory. If the LiteRouter process is restarted, the counter resets to 0 (Key 1), but will maintain perfect sequential distribution for the duration of its uptime.
