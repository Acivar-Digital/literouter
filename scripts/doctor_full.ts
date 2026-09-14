#!/usr/bin/env bun
import { runDoctor } from "./doctor";

if (import.meta.main) {
  await runDoctor({ full: true });
}
