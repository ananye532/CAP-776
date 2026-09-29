import type { ApplicationStatus } from './enums.js';

/**
 * Application status state machine.
 *
 * Progress statuses are ordered. Moving forward may skip stages (e.g. Applied -> Interview),
 * because real processes skip steps. Moving backward among progress statuses is a correction and
 * requires `force`. Outcome statuses (rejected/withdrawn/ghosted/accepted) are reachable from any
 * open status. Ghosted is not final: a company that replies later moves the application forward.
 */
export const PROGRESS_ORDER: ApplicationStatus[] = [
  'saved',
  'ready_to_apply',
  'applied',
  'viewed',
  'recruiter_contacted',
  'screening',
  'assessment',
  'interview',
  'final_interview',
  'offer',
  'accepted',
];

export const PRE_APPLICATION: ReadonlySet<ApplicationStatus> = new Set(['saved', 'ready_to_apply']);
export const CLOSED_STATUSES: ReadonlySet<ApplicationStatus> = new Set(['accepted', 'rejected', 'withdrawn', 'archived']);
/** Applications that are submitted and still in play. */
export const ACTIVE_STATUSES: ReadonlySet<ApplicationStatus> = new Set([
  'applied',
  'viewed',
  'recruiter_contacted',
  'screening',
  'assessment',
  'interview',
  'final_interview',
  'offer',
]);
/** Statuses that count as a meaningful response from the employer. "Viewed" is not a response. */
export const RESPONSE_STATUSES: ReadonlySet<ApplicationStatus> = new Set([
  'recruiter_contacted',
  'screening',
  'assessment',
  'interview',
  'final_interview',
  'offer',
  'accepted',
  'rejected',
]);
export const INTERVIEW_STATUSES: ReadonlySet<ApplicationStatus> = new Set(['interview', 'final_interview', 'offer', 'accepted']);
export const FINAL_INTERVIEW_STATUSES: ReadonlySet<ApplicationStatus> = new Set(['final_interview', 'offer', 'accepted']);
export const OFFER_STATUSES: ReadonlySet<ApplicationStatus> = new Set(['offer', 'accepted']);

export function progressIndex(status: ApplicationStatus): number {
  return PROGRESS_ORDER.indexOf(status);
}

export function isSubmitted(status: ApplicationStatus): boolean {
  return !PRE_APPLICATION.has(status);
}

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

export function canTransition(from: ApplicationStatus, to: ApplicationStatus, opts: { force?: boolean } = {}): TransitionCheck {
  if (from === to) return { ok: false, reason: 'Application is already in this status.' };
  if (opts.force) return { ok: true };

  // Archiving is always allowed; un-archiving requires an explicit correction.
  if (to === 'archived') return { ok: true };
  if (from === 'archived') return { ok: false, reason: 'Archived applications must be restored explicitly.' };

  if (from === 'accepted') return { ok: false, reason: 'Accepted offers are final. Use a correction to change it.' };
  if (from === 'rejected' || from === 'withdrawn') {
    return { ok: false, reason: `Application is ${from}. Use a correction to reopen it.` };
  }

  if (to === 'rejected' || to === 'withdrawn') return { ok: true };
  if (to === 'ghosted') {
    return isSubmitted(from) ? { ok: true } : { ok: false, reason: 'Only submitted applications can be marked as ghosted.' };
  }
  if (to === 'accepted' && from !== 'offer') return { ok: false, reason: 'Only an offer can be accepted.' };

  if (from === 'ghosted') {
    // A late reply revives the application; any submitted progress status is valid.
    return isSubmitted(to) ? { ok: true } : { ok: false, reason: 'Cannot move a submitted application back to pre-application.' };
  }

  const fi = progressIndex(from);
  const ti = progressIndex(to);
  if (ti > fi) return { ok: true };
  return { ok: false, reason: 'Moving an application backwards is a correction. Confirm to proceed.' };
}

/** Statuses the UI should offer as next steps from `from` (without force). */
export function nextStatuses(from: ApplicationStatus): ApplicationStatus[] {
  const all: ApplicationStatus[] = [...PROGRESS_ORDER, 'rejected', 'withdrawn', 'ghosted', 'archived'];
  return all.filter((to) => canTransition(from, to).ok);
}

/**
 * Whether an imported status should update an existing application. Imports never move an
 * application backwards or reopen a closed one; they only record the source status.
 */
export function shouldApplyImportedStatus(current: ApplicationStatus, incoming: ApplicationStatus): boolean {
  if (current === incoming) return false;
  const check = canTransition(current, incoming);
  if (!check.ok) return false;
  if (incoming === 'archived') return false;
  return true;
}
