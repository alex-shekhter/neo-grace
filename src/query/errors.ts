// START_MODULE_CONTRACT
//   PURPOSE: Shared CLI command error surface
//   SCOPE: GraceCommandError, error envelope, asGraceCommandError, runGraceCommand, and runQueryCommand
//   DEPENDS: none
//   LINKS: M-CLI-INFRA
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   GraceCommandError
//   GraceCommandErrorCode
//   GraceCommandErrorEnvelope
//   asGraceCommandError
//   runGraceCommand
//   runQueryCommand
// END_MODULE_MAP
/** Stable user-facing query command error code. */
export type GraceCommandErrorCode = "invalid-project" | "not-found" | "ambiguous-target" | "invalid-arguments";

/** Error intentionally safe to render without a stack trace. */
export class GraceCommandError extends Error {
  /** Machine-readable error code. */
  readonly code: GraceCommandErrorCode;
  /** Process exit code used by query commands. */
  readonly exitCode: number;
  /** Optional lint or projection issue codes supporting the failure. */
  readonly issues?: string[];

  /** Creates one renderable command error. */
  constructor(
    code: GraceCommandErrorCode,
    message: string,
    options: { cause?: unknown; exitCode?: number; issues?: string[] } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "GraceCommandError";
    this.code = code;
    this.exitCode = options.exitCode ?? 1;
    this.issues = options.issues;
  }
}

/** JSON output returned for every query-command failure requested in JSON mode. */
export type GraceCommandErrorEnvelope = {
  schemaVersion: "1.0.0";
  ok: false;
  error: {
    code: GraceCommandErrorCode;
    message: string;
    issues?: string[];
  };
};

const NON_ERROR_THROWN_MARKER = "[non-Error thrown]";

/** Name a non-Error thrown value so two throws are not the same sentence. */
function thrownValueLabel(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (value === "") return "empty string";
  if (typeof value === "string") return `string ${JSON.stringify(value)}`;
  if (typeof value === "object") return Object.prototype.toString.call(value);
  return `${typeof value} ${String(value)}`;
}

/** Editorial diagnostic: not a stack. The marker is the class; the label is the value. */
function synthesizedDiagnostic(value: unknown): string {
  return `${NON_ERROR_THROWN_MARKER} ${thrownValueLabel(value)}`;
}

/** Format a foreign error and its `.cause` chain for stderr. */
function formatCauseChain(error: unknown): string {
  if (!(error instanceof Error)) {
    return synthesizedDiagnostic(error);
  }
  const seen = new Set<unknown>();
  const parts: string[] = [];
  let current: unknown = error;
  let prefix = "";
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    const block =
      current instanceof Error
        ? current.stack && current.stack.length > 0
          ? current.stack
          : `${current.name}: ${current.message}`
        : synthesizedDiagnostic(current);
    parts.push(`${prefix}${block}`);
    prefix = "Caused by: ";
    current = current instanceof Error ? current.cause : undefined;
  }
  return parts.join("\n");
}

/**
 * Convert a caught value into a renderable GraceCommandError.
 * Foreign errors are attached as object `cause` and their chain is written to
 * stderr once. An error that is already a GraceCommandError is returned as-is.
 * An empty `message` is replaced by the synthesized diagnostic so the envelope
 * never carries an empty machine-readable report.
 */
export function asGraceCommandError(error: unknown, message: string): GraceCommandError {
  if (error instanceof GraceCommandError) return error;
  process.stderr.write(`${formatCauseChain(error)}\n`);
  const rendered = message.length > 0 ? message : synthesizedDiagnostic(error);
  return new GraceCommandError("invalid-project", rendered, { cause: error });
}

/** Executes any GRACE command operation with stable text or JSON failures. */
export async function runGraceCommand(
  format: "text" | "json",
  operation: () => void | Promise<void>,
  fallbackMessage: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const commandError = asGraceCommandError(error, fallbackMessage);
    if (format === "json") {
      const envelope: GraceCommandErrorEnvelope = {
        schemaVersion: "1.0.0",
        ok: false,
        error: {
          code: commandError.code,
          message: commandError.message,
          ...(commandError.issues?.length ? { issues: commandError.issues } : {}),
        },
      };
      process.stdout.write(`${JSON.stringify(envelope)}\n`);
    } else {
      process.stderr.write(`${commandError.message}\n`);
    }
    process.exitCode = commandError.exitCode;
  }
}

/** Executes a query command and renders stable text or JSON failures without stack traces. */
export async function runQueryCommand(
  format: "text" | "json",
  operation: () => void | Promise<void>,
): Promise<void> {
  return runGraceCommand(format, operation, "Unable to complete the GRACE query. Run `ngrace lint --path PROJECT` for actionable diagnostics.");
}
