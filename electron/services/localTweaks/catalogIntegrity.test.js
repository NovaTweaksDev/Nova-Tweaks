const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createTweakCatalog } = require('./catalog');

const resourcesRoot = path.resolve(__dirname, '../../../resources/tweaks');
const configsDir = path.join(resourcesRoot, 'configs');
const scriptsDir = path.join(resourcesRoot, 'scripts');

function getPowerShellParameters(source) {
  const paramMatch = /^\s*param\s*\(/im.exec(source);
  if (!paramMatch) return new Set();

  const start = paramMatch.index + paramMatch[0].lastIndexOf('(');
  let depth = 0;
  let end = -1;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    if (source[index] === ')') {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }

  assert.notEqual(end, -1, 'PowerShell parameter block must be balanced.');
  return new Set(
    [...source.slice(start + 1, end).matchAll(/\$([A-Za-z][A-Za-z0-9]*)/g)]
      .map((match) => match[1].toLowerCase())
  );
}

test('bundled tweak configs are canonical, unique and free of generated metadata', () => {
  const files = fs.readdirSync(configsDir)
    .filter((fileName) => fileName.endsWith('.json'))
    .sort();
  const ids = new Set();

  for (const fileName of files) {
    const config = JSON.parse(fs.readFileSync(path.join(configsDir, fileName), 'utf8'));
    assert.equal(fileName, `${config.id}.json`, `${fileName} must match its tweak id.`);
    assert.equal(ids.has(config.id), false, `Duplicate tweak id: ${config.id}`);
    assert.equal(Object.hasOwn(config, '__duplicateConfigFiles'), false, `${fileName} contains duplicate-loader metadata.`);
    assert.equal(Object.hasOwn(config.execution || {}, 'script_exists'), false, `${fileName} persists generated script state.`);
    ids.add(config.id);
  }

  const catalog = createTweakCatalog({ configsDir, scriptsDir });
  assert.equal(catalog.listTweaks().length, files.length);
});

test('bundled tweak scripts declare every configured execution parameter', () => {
  for (const fileName of fs.readdirSync(configsDir).filter((entry) => entry.endsWith('.json'))) {
    const config = JSON.parse(fs.readFileSync(path.join(configsDir, fileName), 'utf8'));
    const scriptPath = path.join(scriptsDir, config.id, config.execution.script);
    assert.equal(fs.existsSync(scriptPath), true, `${fileName} references a missing script.`);

    const declared = getPowerShellParameters(fs.readFileSync(scriptPath, 'utf8'));
    for (const [actionName, action] of Object.entries(config.execution.actions)) {
      const configured = [
        ...(action.args || [])
          .filter((entry) => /^-[A-Za-z][A-Za-z0-9]*$/.test(entry))
          .map((entry) => entry.slice(1)),
        ...(action.allowed_params || [])
      ];
      for (const parameter of configured) {
        assert.equal(
          declared.has(parameter.toLowerCase()),
          true,
          `${fileName} ${actionName} configures undeclared parameter -${parameter}.`
        );
      }
    }
  }
});
