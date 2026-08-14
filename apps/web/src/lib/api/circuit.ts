const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 60_000;

const circuits = new Map<string, { failures: number; openUntil: number }>();

export function circuitKey(path: string): string {
  const queryIndex = path.indexOf("?");
  return queryIndex === -1 ? path : path.slice(0, queryIndex);
}

export function circuitOpen(key: string): boolean {
  const circuit = circuits.get(key);
  return circuit ? circuit.openUntil > Date.now() : false;
}

export function recordHardFailure(key: string): void {
  const circuit = circuits.get(key) ?? { failures: 0, openUntil: 0 };
  circuit.failures += 1;
  if (circuit.failures >= CIRCUIT_THRESHOLD) circuit.openUntil = Date.now() + CIRCUIT_OPEN_MS;
  circuits.set(key, circuit);
}

export function recordReachable(key: string): void {
  if (circuits.has(key)) circuits.delete(key);
}

export function openCircuitCount(): number {
  let count = 0;
  for (const circuit of circuits.values()) {
    if (circuit.openUntil > Date.now()) count += 1;
  }
  return count;
}
