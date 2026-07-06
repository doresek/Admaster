// tests/retention/no-bypass.test.ts — structural non-bypassability (doc §4.1):
// lib/retention/sender.ts is the ONLY retention module allowed to import the
// provider pipe (lib/whatsapp); nothing under lib/retention or
// app/api/retention may reach a provider around the compliance gate.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsFilesUnder(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const PROVIDER_IMPORT = /from\s+['"]@\/lib\/whatsapp|from\s+['"].*\/lib\/whatsapp|require\(['"].*lib\/whatsapp/;

describe('the compliance gate cannot be bypassed', () => {
  it('only lib/retention/sender.ts imports the provider pipe', () => {
    const files = [
      ...tsFilesUnder(join(ROOT, 'lib', 'retention')),
      ...tsFilesUnder(join(ROOT, 'app', 'api', 'retention')),
    ];
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) =>
      !f.endsWith(`${join('lib', 'retention', 'sender.ts')}`) &&
      PROVIDER_IMPORT.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('lib/retention exports no raw-send function around the gate', () => {
    const index = readFileSync(join(ROOT, 'lib', 'retention', 'index.ts'), 'utf8');
    expect(index).not.toMatch(/sendRaw|rawSend/);
    // the sender is exported, and the sender gates internally — asserted in sender.test.ts
    expect(index).toMatch(/sendSeriesTouch/);
  });

  it("the sender's provider call is inside the allowed-verdict branch (source shape)", () => {
    const sender = readFileSync(join(ROOT, 'lib', 'retention', 'sender.ts'), 'utf8');
    // The gate verdict must be computed before any provider dispatch.
    const gateIdx = sender.indexOf('checkSendAllowed');
    const dispatchIdx = sender.indexOf('sendWhatsAppFn(');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(dispatchIdx).toBeGreaterThan(gateIdx);
    // A refusal returns before dispatch:
    expect(sender.indexOf("outcome: 'refused'")).toBeLessThan(dispatchIdx);
  });
});
