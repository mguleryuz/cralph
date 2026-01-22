/**
 * Configuration loaded from a paths file (e.g., ralph.paths.json)
 */
export interface PathsFileConfig {
  refs: string[];
  output: string;
}

/**
 * Resolved configuration after path selection
 */
export interface RalphConfig {
  /** Paths to reference material directories/files */
  refs: string[];
  /** Output directory for generated docs */
  output: string;
}

/**
 * Runner state during iteration
 */
export interface RunnerState {
  iteration: number;
  startTime: Date;
  logFile: string;
  todoFile: string;
}

/**
 * Result of a single Claude invocation
 */
export interface IterationResult {
  exitCode: number;
  output: string;
  isComplete: boolean;
}
