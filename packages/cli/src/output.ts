/**
 * Output helpers — human output is EN by default (D8/§11), `--json` is
 * machine-readable on every command that reports data.
 */

export interface JsonEnvelope {
  command: string;
  ok: boolean;
  /** Exit code the process (would) use — mirrors process.exitCode. */
  exitCode: number;
  data?: unknown;
  error?: { kind: string; message: string; violations?: { path: string; message: string }[] };
}

let jsonMode = false;

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

/** Print the final envelope (human or JSON) and return the exit code to use. */
export function report(
  command: string,
  ok: boolean,
  exitCode: number,
  payload: { data?: unknown; error?: JsonEnvelope["error"] },
): number {
  if (jsonMode) {
    const envelope: JsonEnvelope = {
      command,
      ok,
      exitCode,
      ...(payload.data !== undefined ? { data: payload.data } : {}),
      ...(payload.error !== undefined ? { error: payload.error } : {}),
    };
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return exitCode;
  }
  if (payload.error !== undefined && !ok) {
    process.stderr.write(`${command}: ${payload.error.message}\n`);
    for (const v of payload.error.violations ?? []) {
      process.stderr.write(`  ${v.path || "<root>"}: ${v.message}\n`);
    }
  }
  return exitCode;
}

/** Human-only section printer (no-op in JSON mode — data goes in the envelope). */
export function section(title: string): void {
  if (jsonMode) return;
  process.stdout.write(`\n${title}\n`);
}

export function line(text: string): void {
  if (jsonMode) return;
  process.stdout.write(`${text}\n`);
}

export function warn(text: string): void {
  if (jsonMode) return;
  process.stderr.write(`warning: ${text}\n`);
}
