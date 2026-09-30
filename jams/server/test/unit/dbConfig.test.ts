import { describe, expect, it } from 'vitest';
import { cleanDatabaseUrl } from '../../src/config.js';
import { diagnose } from '../../src/vercel.js';

const url = 'postgresql://user:pw@ep-x.neon.tech/neondb?sslmode=require';

describe('cleanDatabaseUrl', () => {
  it('accepts a bare URL', () => expect(cleanDatabaseUrl(url)).toBe(url));
  it('trims whitespace and surrounding quotes', () => {
    expect(cleanDatabaseUrl(`  "${url}"\n`)).toBe(url);
    expect(cleanDatabaseUrl(`'${url}'`)).toBe(url);
  });
  it("strips Neon's psql command wrapper", () => expect(cleanDatabaseUrl(`psql '${url}'`)).toBe(url));
  it('treats blank values as unset', () => {
    expect(cleanDatabaseUrl('')).toBeUndefined();
    expect(cleanDatabaseUrl('   ')).toBeUndefined();
    expect(cleanDatabaseUrl(undefined)).toBeUndefined();
  });
});

describe('diagnose', () => {
  it('classifies common connection failures without leaking the error text', () => {
    const secret = 'password authentication failed for user "neondb_owner" pw=hunter2';
    const d = diagnose(Object.assign(new Error(secret), { code: '28P01' }));
    expect(d.reason).toBe('auth_failed');
    expect(JSON.stringify(d)).not.toMatch(/hunter2|neondb_owner/);
    expect(diagnose(Object.assign(new Error('x'), { code: 'ENOTFOUND' })).reason).toBe('host_not_found');
    expect(diagnose(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })).reason).toBe('unreachable');
    expect(diagnose(new Error('The server does not support SSL connections')).reason).toBe('ssl');
  });

  it('unwraps Drizzle query errors to the driver error', () => {
    const wrapped = new Error('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"', { cause: Object.assign(new Error('x'), { code: '28P01' }) });
    expect(diagnose(wrapped).reason).toBe('auth_failed');
  });
});
