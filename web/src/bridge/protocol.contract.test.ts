// Contract test: the C# bridge's real responses (fixtures written by
// engine/Magnate.Bridge.Tests/ContractFixtureTests.cs) must match protocol.ts
// exactly — every key known, every required key present, every literal union
// respected. The TypeScript compiler API reads protocol.ts so the types are the
// single source; nothing here restates a DTO.
//
// Regenerate fixtures after a DTO change:
//   MAGNATE_UPDATE_FIXTURES=1 dotnet test engine/Magnate.Bridge.Tests --filter ContractFixtureTests

import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUTATING_METHODS } from './protocol';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, '__fixtures__');
const protocolPath = join(here, 'protocol.ts');

const program = ts.createProgram([protocolPath], {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  noEmit: true,
  skipLibCheck: true,
});
const checker = program.getTypeChecker();
const source = program.getSourceFile(protocolPath);
if (!source) throw new Error('protocol.ts not found by the compiler');

function declaration(name: string): ts.InterfaceDeclaration | ts.TypeAliasDeclaration {
  const decl = source!.statements.find(
    (s): s is ts.InterfaceDeclaration | ts.TypeAliasDeclaration =>
      (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) && s.name.text === name,
  );
  if (!decl) throw new Error(`protocol.ts has no ${name}`);
  return decl;
}

const methodsDecl = declaration('Methods');
const methodsType = checker.getTypeAtLocation(methodsDecl.name);
const snapshotType = checker.getTypeAtLocation(declaration('SnapshotDto').name);
const eventType = checker.getTypeAtLocation(declaration('GameEventDto').name);
const errorType = checker.getTypeAtLocation(declaration('BridgeError').name);

function propertyType(type: ts.Type, name: string): ts.Type | undefined {
  const symbol = type.getProperty(name);
  return symbol ? checker.getTypeOfSymbolAtLocation(symbol, methodsDecl) : undefined;
}

function describeValue(value: unknown): string {
  const text = JSON.stringify(value);
  return text === undefined ? 'undefined' : text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/** Validate a JSON value against a TypeScript type; push human-readable problems. */
function validate(value: unknown, type: ts.Type, path: string, errors: string[]): void {
  const flags = type.flags;
  if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return;
  if (type.isUnion()) {
    const members = type.types.filter((t) => !(t.flags & ts.TypeFlags.Undefined));
    for (const member of members) {
      const attempt: string[] = [];
      validate(value, member, path, attempt);
      if (attempt.length === 0) return;
    }
    // Report the closest object member's problems for readability.
    const objectMember = members.find((m) => m.flags & ts.TypeFlags.Object && !checker.isArrayType(m));
    if (objectMember && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      validate(value, objectMember, path, errors);
    } else {
      errors.push(`${path}: ${describeValue(value)} is not ${checker.typeToString(type)}`);
    }
    return;
  }
  if (value === null) {
    if (!(flags & ts.TypeFlags.Null)) errors.push(`${path}: null is not ${checker.typeToString(type)}`);
    return;
  }
  if (flags & ts.TypeFlags.StringLiteral) {
    if (value !== (type as ts.StringLiteralType).value) errors.push(`${path}: ${describeValue(value)} is not '${(type as ts.StringLiteralType).value}'`);
    return;
  }
  if (flags & ts.TypeFlags.NumberLiteral) {
    if (value !== (type as ts.NumberLiteralType).value) errors.push(`${path}: ${describeValue(value)} is not ${(type as ts.NumberLiteralType).value}`);
    return;
  }
  if (flags & ts.TypeFlags.BooleanLiteral) {
    const expected = (type as unknown as { intrinsicName: string }).intrinsicName === 'true';
    if (value !== expected) errors.push(`${path}: ${describeValue(value)} is not ${expected}`);
    return;
  }
  if (flags & (ts.TypeFlags.String | ts.TypeFlags.TemplateLiteral)) {
    if (typeof value !== 'string') errors.push(`${path}: ${describeValue(value)} is not a string`);
    return;
  }
  if (flags & ts.TypeFlags.Number) {
    if (typeof value !== 'number') errors.push(`${path}: ${describeValue(value)} is not a number`);
    return;
  }
  if (flags & ts.TypeFlags.Boolean) {
    if (typeof value !== 'boolean') errors.push(`${path}: ${describeValue(value)} is not a boolean`);
    return;
  }
  if (checker.isArrayType(type)) {
    if (!Array.isArray(value)) {
      errors.push(`${path}: ${describeValue(value)} is not an array`);
      return;
    }
    const element = checker.getTypeArguments(type as ts.TypeReference)[0];
    value.forEach((item, i) => validate(item, element, `${path}[${i}]`, errors));
    return;
  }
  if (flags & ts.TypeFlags.Object) {
    if (typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${path}: ${describeValue(value)} is not an object`);
      return;
    }
    const record = value as Record<string, unknown>;
    const indexInfos = checker.getIndexInfosOfType(type);
    for (const [key, item] of Object.entries(record)) {
      const prop = propertyType(type, key);
      if (prop) validate(item, prop, `${path}.${key}`, errors);
      else if (indexInfos.length > 0) validate(item, indexInfos[0].type, `${path}.${key}`, errors);
      else errors.push(`${path}.${key}: unknown key (not in ${checker.typeToString(type)})`);
    }
    for (const symbol of checker.getPropertiesOfType(type)) {
      const optional = (symbol.flags & ts.SymbolFlags.Optional) !== 0;
      if (!optional && !(symbol.name in record)) errors.push(`${path}.${symbol.name}: missing required key`);
    }
    return;
  }
  errors.push(`${path}: unsupported type ${checker.typeToString(type)}`);
}

interface Fixture {
  method: string;
  args: unknown;
  envelope: { ok: boolean; result?: unknown; error?: unknown; revision: number; hud?: unknown; events?: unknown };
}

interface MethodManifest {
  name: string;
  mutates: boolean;
  requiresGame: boolean;
}

const fixtureFiles = readdirSync(fixtureDir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
const fixtures: Fixture[] = fixtureFiles.map((f) => JSON.parse(readFileSync(join(fixtureDir, f), 'utf8')) as Fixture);
const manifest: MethodManifest[] = JSON.parse(readFileSync(join(fixtureDir, '_methods.json'), 'utf8')) as MethodManifest[];
const tsMethods = checker.getPropertiesOfType(methodsType).map((s) => s.name);

describe('bridge contract fixtures', () => {
  it('cover every C# method, and every C# method is in the Methods map', () => {
    expect(fixtures.length).toBeGreaterThan(50);
    const missingInTs = manifest.map((m) => m.name).filter((name) => !tsMethods.includes(name));
    expect(missingInTs).toEqual([]);
    // Methods the TS map declares but this bridge build does not register: only other workstreams' methods.
    const extraInTs = tsMethods.filter((name) => !manifest.some((m) => m.name === name));
    expect(extraInTs.filter((name) => name !== 'cityLayout')).toEqual([]);
  });

  it('MUTATING_METHODS matches the C# [BridgeMethod(Mutates = true)] flags', () => {
    const mutating = manifest.filter((m) => m.mutates).map((m) => m.name).sort();
    expect([...MUTATING_METHODS].sort()).toEqual(mutating);
  });

  for (const fixture of fixtures) {
    it(`${fixture.method} matches protocol.ts`, () => {
      const errors: string[] = [];
      const entry = methodsType.getProperty(fixture.method);
      expect(entry, `Methods has no '${fixture.method}'`).toBeDefined();
      const methodType = checker.getTypeOfSymbolAtLocation(entry!, methodsDecl);
      const argsType = propertyType(methodType, 'args')!;
      const resultType = propertyType(methodType, 'result')!;
      if (fixture.method !== 'loadGame') validate(fixture.args, argsType, 'args', errors);
      const envelope = fixture.envelope;
      if (envelope.ok) {
        validate(envelope.result, resultType, 'result', errors);
      } else {
        validate(envelope.error, errorType, 'error', errors);
      }
      if (envelope.hud !== undefined) validate(envelope.hud, snapshotType, 'hud', errors);
      if (envelope.events !== undefined) {
        if (!Array.isArray(envelope.events)) errors.push('events: not an array');
        else envelope.events.forEach((e, i) => validate(e, eventType, `events[${i}]`, errors));
      }
      expect(errors).toEqual([]);
    });
  }
});

describe('binary save exports (worker → engine-host JSExports)', () => {
  const binary = JSON.parse(readFileSync(join(fixtureDir, '_binary.json'), 'utf8')) as { saveMeta: unknown; inspect: unknown };

  it('LastSaveMeta() is a SaveMetaDto', () => {
    const errors: string[] = [];
    validate(binary.saveMeta, checker.getTypeAtLocation(declaration('SaveMetaDto').name), 'saveMeta', errors);
    expect(errors).toEqual([]);
  });

  it('InspectSave() is an InspectResultDto carrying the client document', () => {
    const errors: string[] = [];
    validate(binary.inspect, checker.getTypeAtLocation(declaration('InspectResultDto').name), 'inspect', errors);
    expect(errors).toEqual([]);
    expect(typeof (binary.inspect as { client?: unknown }).client).toBe('string');
  });
});
