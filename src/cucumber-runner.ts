import { spawn } from 'node:child_process';
import path from 'node:path';

import * as vscode from 'vscode';

import { cleanAndCopyCucumberConfigAsync } from './cucumber-config-manager';
import { getExtensionConfig, logChannel, logDevelopment, logRun, safeJsonParse } from './utilities';
import { CucumberEvent, GherkinDocument, parseCucumberEvent, Pickle } from './zod-schemas';

export type CucumberRunnerEvent =
  | CucumberEvent
  | { type: 'stderr'; data: string }
  | { type: 'close'; data: number }
  | { type: 'error'; data: Error };

export class CucumberRunner {
  private onEventEmitter = new vscode.EventEmitter<CucumberRunnerEvent>();
  public readonly onEvent = this.onEventEmitter.event;

  constructor(private rootPath: string) {}

  public runCucumber(
    arguments_: string[] = [],
    run?: vscode.TestRun,
    eventCallback?: (event: CucumberRunnerEvent) => void,
    _eventCallbacks?: {
      all?: (event: CucumberRunnerEvent) => void;
      gherkinDocuments?: (event: GherkinDocument) => void;
      pickles?: (event: Pickle) => void;
    },
    options?: { discoveryMode?: boolean }
  ): Promise<number> {
    const { requireModule, stepGlobs, featureGlobs, useImport, importGlobs, nodeOptions } =
      getExtensionConfig();
    const discoveryMode = options?.discoveryMode === true;
    const requireModuleArguments = discoveryMode
      ? []
      : requireModule.flatMap((m) => ['--require-module', m]);
    const stepArguments = discoveryMode
      ? []
      : useImport
        ? importGlobs.flatMap((g) => ['--import', g])
        : stepGlobs.flatMap((g) => ['--require', g]);
    const featureArguments = arguments_.length > 0 ? arguments_ : featureGlobs;
    const fullArguments = [
      ...requireModuleArguments,
      ...stepArguments,
      ...featureArguments,
      '--format',
      'message',
    ];
    const fireEvent = (event: CucumberRunnerEvent) => {
      if (eventCallback) {
        eventCallback(event);
      }
      this.onEventEmitter.fire(event);
    };
    return new Promise((resolve, reject) => {
      logDevelopment('cucumber-js ' + fullArguments.join(' '));
      logRun('cucumber-js ' + fullArguments.join(' '), run);

      const environment = { ...process.env };
      if (!discoveryMode && nodeOptions.length > 0) {
        environment.NODE_OPTIONS = [environment.NODE_OPTIONS, ...nodeOptions]
          .filter(Boolean)
          .join(' ');
      }
      const cucumberProcess = spawn('npx', ['cucumber-js', ...fullArguments], {
        cwd: this.rootPath,
        shell: true,
        env: environment,
      });

      cucumberProcess.stdout.on('data', (data) => {
        const lines = data.toString().split(/\r?\n/);
        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          const parsedJson = safeJsonParse(line);
          const cucumberEvent = parseCucumberEvent(parsedJson);

          if (cucumberEvent) {
            logDevelopment(cucumberEvent);
            fireEvent(cucumberEvent);
          } else {
            logRun(line, run);
          }
        }
      });

      cucumberProcess.stderr.on('data', (data) => {
        fireEvent({ type: 'stderr', data: data.toString() });
        logDevelopment(data.toString());
        logChannel(data.toString());
      });

      cucumberProcess.on('close', (code) => {
        fireEvent({ type: 'close', data: code ?? 0 });
        resolve(code ?? 0);
      });

      cucumberProcess.on('error', (error) => {
        fireEvent({ type: 'error', data: error });
        reject(error);
      });
    });
  }

  public async runCucumberWithTmpConfig(
    arguments_: string[] = [],
    run?: vscode.TestRun,
  eventCallback?: (event: CucumberRunnerEvent) => void,
  options?: { discoveryMode?: boolean }
  ): Promise<number> {
    // Try to generate a temporary config based on user's config
    const temporaryConfigPath = await cleanAndCopyCucumberConfigAsync(this.rootPath);

    const fullArguments = [...arguments_];

    if (temporaryConfigPath) {
      fullArguments.push('--config', path.basename(temporaryConfigPath));
    }

  return this.runCucumber(fullArguments, run, eventCallback, undefined, options);
  }
}
