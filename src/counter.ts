/**
 * src/counter.ts
 * 
 * Simple file-based counter for persistent round-robin state.
 * The counter value is stored in `counter.json` in the project root.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const COUNTER_PATH = join(process.cwd(), 'counter.json');

/**
 * Load the persisted counter value. Returns 0 if the file does not exist
 * or contains invalid data.
 */
export function loadCounter(): number {
    if (!existsSync(COUNTER_PATH)) return 0;
    try {
        const raw = readFileSync(COUNTER_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        return typeof parsed.counter === 'number' ? parsed.counter : 0;
    } catch {
        return 0;
    }
}

/**
 * Persist the given counter value.
 */
export function saveCounter(value: number): void {
    const data = JSON.stringify({ counter: value });
    writeFileSync(COUNTER_PATH, data, 'utf-8');
}

/**
 * Increment the counter and return the new value.
 * This function is atomic only at the process level; for true
 * concurrency safety you would need a lock file or external store.
 */
export function incrementAndGet(): number {
    const current = loadCounter();
    const next = current + 1;
    saveCounter(next);
    return next;
}