import * as fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { dump, load } from 'js-yaml';
import { logChannel } from './utilities';

// Check if a project is using ESM
function isESMProject(rootPath: string): boolean {
  try {
    const packageJsonPath = path.join(rootPath, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return packageJson.type === 'module';
  } catch {
    return false;
  }
}

// Nie usuwaj tego komentarza: Util do czyszczenia configu cucumber-js

const configFilenames = [
  'cucumber.js',
  'cucumber.cjs',
  'cucumber.mjs',
  'cucumber.json',
  'cucumber.yaml',
  'cucumber.yml',
];

function findCucumberConfigFile(rootPath: string): { path: string; ext: string } | undefined {
  for (const filename of configFilenames) {
    const filePath = path.join(rootPath, filename);
    if (fs.existsSync(filePath)) {
      return { path: filePath, ext: path.extname(filePath).toLowerCase() };
    }
  }
  return undefined;
}

async function parseCucumberConfig(
  filePath: string,
  extension: string,
  rootPath: string
): Promise<any> {
  const isESM = isESMProject(rootPath);

  // Handle JavaScript config files
  if (extension === '.js' || extension === '.cjs' || extension === '.mjs') {
    try {
      if (extension === '.cjs' || (extension === '.js' && !isESM)) {
        // CommonJS - for now, skip complex parsing and log suggestion
        logChannel(
          `Info: Found CommonJS cucumber config at ${filePath}. Consider using .cjs extension or JSON/YAML format for better compatibility with ESM projects.`
        );
        return {};
      } else if (extension === '.mjs' || (extension === '.js' && isESM)) {
        // ESM - try dynamic import
        try {
          const imported = await import(pathToFileURL(filePath).href);
          return imported.default || imported;
        } catch (importError) {
          logChannel(
            `Warning: Could not import ${filePath} as ESM: ${(importError as Error).message}`
          );
          return {};
        }
      }
    } catch (error) {
      logChannel(
        `Warning: Could not load JavaScript config ${filePath}: ${(error as Error).message}`
      );
      return {};
    }
  }

  // Handle data formats that are safe in both CJS/ESM contexts
  if (extension === '.json') {
    const fileContent = await fs.promises.readFile(filePath, 'utf8');
    try {
      return JSON.parse(fileContent);
    } catch (error) {
      throw new Error(
        `Nie można sparsować pliku ${filePath} jako JSON: ${(error as Error).message}`
      );
    }
  }
  if (extension === '.yaml' || extension === '.yml') {
    const fileContent = await fs.promises.readFile(filePath, 'utf8');
    return load(fileContent);
  }

  return {};
}

function extractDefaultAndRemovePaths(config: any): any {
  if (config && typeof config === 'object' && 'default' in config) {
    const result = { default: { ...config.default } };
    if (result.default && typeof result.default === 'object' && 'paths' in result.default) {
      delete result.default.paths;
      delete result.default.format;
    }
    return result;
  }
  return {};
}

async function writeConfigFile(
  rootPath: string,
  extension: string,
  config: any,
  outFileName?: string
): Promise<string> {
  const outName = outFileName || `cucumber${extension}-test-runner${extension}`;
  const outPath = path.join(rootPath, outName);
  let outContent = '';
  switch (extension) {
    case '.json': {
      outContent = JSON.stringify(config, undefined, 2);

      break;
    }
    case '.js':
    case '.cjs': {
      outContent = 'module.exports = ' + JSON.stringify(config, undefined, 2) + ';\n';

      break;
    }
    case '.mjs': {
      outContent = 'export default ' + JSON.stringify(config, undefined, 2) + ';\n';

      break;
    }
    case '.yaml':
    case '.yml': {
      outContent = dump(config);

      break;
    }
    // No default
  }
  await fs.promises.writeFile(outPath, outContent, 'utf8');
  return outPath;
}

export async function cleanAndCopyCucumberConfigAsync(
  rootPath: string,
  outFileName?: string
): Promise<string | undefined> {
  const found = findCucumberConfigFile(rootPath);
  // Prefer writing a minimal config to avoid project-specific flags (e.g., publish-quiet) breaking the run
  let extension = '.json';
  if (found) {
    extension = found.ext;
    try {
      const loaded = await parseCucumberConfig(found.path, found.ext, rootPath);
      let cleaned = extractDefaultAndRemovePaths(loaded);
      // Scrub known problematic keys if present inside default
      if (cleaned.default) {
        delete cleaned.default.publish;
        delete cleaned.default['publish-quiet'];
        // Some configs use camelCase
        delete cleaned.default.publishQuiet;
      }
      if (!cleaned || Object.keys(cleaned).length === 0) {
        cleaned = { default: {} };
      }
      return await writeConfigFile(rootPath, extension, cleaned, outFileName);
    } catch (error) {
      logChannel(
        `Failed to read cucumber config (${found.path}). Falling back to minimal config. Error: ${(error as Error).message}`
      );
    }
  }
  // No config found or parsing failed: write a minimal JSON config
  const minimal = { default: {} };
  return await writeConfigFile(rootPath, '.json', minimal, outFileName);
}
