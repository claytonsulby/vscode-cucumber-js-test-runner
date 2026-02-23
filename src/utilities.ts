import * as vscode from 'vscode';

// Kanał logów dla pluginu
const outputChannel = vscode.window.createOutputChannel('Cucumber JS Test Runner');

export function safeJsonParse(string_: string): object | undefined {
  try {
    return JSON.parse(string_);
  } catch {
    return undefined;
  }
}

/**
 * Zamienia timestamp w formacie { seconds, nanos } na milisekundy
 */
export function timestampToMilliseconds(timestamp: { seconds: number; nanos: number }): number {
  return timestamp.seconds * 1000 + Math.floor(timestamp.nanos / 1_000_000);
}

export function logDevelopment(message?: unknown, ...optionalParameters: unknown[]): void {
  console.log(message, ...optionalParameters);
}

export function logChannel(message: string): void {
  outputChannel.appendLine(message);
}

export function logRun(message: string, run: vscode.TestRun | undefined): void {
  if (run) {
    run.appendOutput(message + '\r\n');
  }
}

export function getExtensionConfig() {
  const config = vscode.workspace.getConfiguration('cucumber-js-test-runner');
  const featureGlobs = config.get<string[]>('featureGlobs') ?? [
    'docs/features/**/*.feature',
    'features/**/*.feature',
  ];
  const stepGlobs = config.get<string[]>('stepGlobs') ?? [
    'tests/bdd-steps/**/*.{ts,js}',
    'features/**/*.{ts,js}',
  ];
  const useImport = config.get<boolean>('useImport') ?? false;
  const importGlobs = config.get<string[]>('importGlobs') ?? [
    'tests/bdd-steps/**/*.{ts,mts,js,mjs}',
    'features/**/*.{ts,mts,js,mjs}',
  ];
  const requireModule = config.get<string[]>('requireModule') ?? ['ts-node/register'];
  const nodeOptions = config.get<string[]>('nodeOptions') ?? [];
  return { featureGlobs, stepGlobs, requireModule, useImport, importGlobs, nodeOptions };
}
