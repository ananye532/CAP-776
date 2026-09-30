import { describe, it, expect } from 'vitest';
import { canTransition, nextStatuses, shouldApplyImportedStatus } from '../../src/domain/status.js';

describe('status state machine', () => {
  it('allows forward moves including skipping stages', () => {
    expect(canTransition('applied', 'screening').ok).toBe(true);
    expect(canTransition('applied', 'interview').ok).toBe(true);
    expect(canTransition('saved', 'applied').ok).toBe(true);
  });

  it('blocks backward moves unless forced', () => {
    const r = canTransition('interview', 'applied');
    expect(r.ok).toBe(false);
    expect(canTransition('interview', 'applied', { force: true }).ok).toBe(true);
  });

  it('allows outcomes from open statuses', () => {
    expect(canTransition('screening', 'rejected').ok).toBe(true);
    expect(canTransition('offer', 'withdrawn').ok).toBe(true);
    expect(canTransition('applied', 'ghosted').ok).toBe(true);
  });

  it('only allows accepting an offer', () => {
    expect(canTransition('interview', 'accepted').ok).toBe(false);
    expect(canTransition('offer', 'accepted').ok).toBe(true);
  });

  it('treats rejected and accepted as closed', () => {
    expect(canTransition('rejected', 'interview').ok).toBe(false);
    expect(canTransition('accepted', 'rejected').ok).toBe(false);
    expect(canTransition('rejected', 'archived').ok).toBe(true);
  });

  it('revives ghosted applications on a late reply but not to pre-application', () => {
    expect(canTransition('ghosted', 'interview').ok).toBe(true);
    expect(canTransition('ghosted', 'saved').ok).toBe(false);
  });

  it('rejects no-op transitions and ghosting unsubmitted applications', () => {
    expect(canTransition('applied', 'applied').ok).toBe(false);
    expect(canTransition('saved', 'ghosted').ok).toBe(false);
  });

  it('lists next statuses', () => {
    const next = nextStatuses('applied');
    expect(next).toContain('interview');
    expect(next).toContain('rejected');
    expect(next).not.toContain('saved');
    expect(next).not.toContain('accepted');
  });

  it('never lets imports move backwards or reopen', () => {
    expect(shouldApplyImportedStatus('interview', 'applied')).toBe(false);
    expect(shouldApplyImportedStatus('rejected', 'applied')).toBe(false);
    expect(shouldApplyImportedStatus('applied', 'rejected')).toBe(true);
    expect(shouldApplyImportedStatus('applied', 'archived')).toBe(false);
  });
});
