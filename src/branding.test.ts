import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

const brandingFiles = [
  'package.json',
  'package-lock.json',
  'README.md',
  'src/shared/branding.ts',
  'src/main/index.ts',
  'src/renderer/index.html',
  'src/renderer/src/App.tsx',
  'src/renderer/src/ui/ControlOverlay.tsx',
  'native/system-audio-helper/Sources/SystemAudioHelper/main.swift'
];

const retiredBrandPatterns = [/Spectra Drift/, /spectra-drift/, /dev\.codex\.spectra-drift/];

const requiredBrandSnippets: Record<string, string[]> = {
  'package.json': ['"name": "shadow-spectrum"', '"appId": "dev.codex.shadow-spectrum"', '"productName": "Shadow Spectrum"'],
  'README.md': ['# Shadow Spectrum'],
  'src/shared/branding.ts': ['Shadow Spectrum', 'shadow-spectrum-settings', 'spectra-drift-settings'],
  'src/main/index.ts': ['APP_NAME', 'APP_ID'],
  'src/renderer/index.html': ['<title>Shadow Spectrum</title>'],
  'src/renderer/src/App.tsx': ['settingsStorageKey', 'legacySettingsStorageKeys'],
  'src/renderer/src/ui/ControlOverlay.tsx': ['APP_NAME'],
  'native/system-audio-helper/Sources/SystemAudioHelper/main.swift': ['dev.codex.shadow-spectrum.system-audio.samples']
};

function isAllowedLegacyMigrationReference(file: string, line: string, pattern: RegExp): boolean {
  return file === 'src/shared/branding.ts' && pattern.source === 'spectra-drift' && line.includes('spectra-drift-settings');
}

describe('Shadow Spectrum branding', () => {
  it('removes retired Spectra Drift identity strings from known branding surfaces', () => {
    const offenders = brandingFiles.flatMap((file) => {
      const contents = readFileSync(resolve(root, file), 'utf8');
      return contents
        .split('\n')
        .flatMap((line, index) =>
          retiredBrandPatterns
            .filter((pattern) => pattern.test(line) && !isAllowedLegacyMigrationReference(file, line, pattern))
            .map((pattern) => `${file}:${index + 1}: ${pattern.source}`)
        );
    });

    expect(offenders).toEqual([]);
  });

  it('uses the Shadow Spectrum identity across known branding surfaces', () => {
    for (const [file, snippets] of Object.entries(requiredBrandSnippets)) {
      const contents = readFileSync(resolve(root, file), 'utf8');
      for (const snippet of snippets) {
        expect(contents, `${file} should contain ${snippet}`).toContain(snippet);
      }
    }
  });
});
