import type { EmailClassification } from './enums.js';

export interface EmailInput {
  from?: string | null;
  subject: string;
  body: string;
}

export interface EmailClassificationResult {
  classification: EmailClassification;
  /** 0..1. Anything below REVIEW_THRESHOLD is shown as "needs review" and never auto-applied. */
  confidence: number;
  matched: string[];
  suggestedCompany: string | null;
}

export const REVIEW_THRESHOLD = 0.75;

const RULES: { cls: EmailClassification; patterns: RegExp[]; weight: number }[] = [
  { cls: 'offer', weight: 1, patterns: [/offer letter/i, /pleased to (extend|offer)/i, /\boffer of employment\b/i, /compensation (details|package)/i] },
  {
    cls: 'rejection',
    weight: 1,
    patterns: [
      /regret to inform/i,
      /unfortunately/i,
      /not (be )?moving forward/i,
      /decided to (proceed|move forward) with other candidates/i,
      /not (been )?selected/i,
      /position has been filled/i,
    ],
  },
  { cls: 'interview_invitation', weight: 1, patterns: [/interview/i, /schedule (a|your) (call|conversation)/i, /calendly|calendar invite/i, /availability for/i] },
  { cls: 'assessment_invitation', weight: 1, patterns: [/assessment/i, /coding (test|challenge)/i, /hackerrank|codility|hackerearth|testgorilla/i, /take[- ]home/i] },
  { cls: 'application_viewed', weight: 0.8, patterns: [/(application|profile|resume) (was )?viewed/i, /viewed your (application|profile)/i] },
  {
    cls: 'application_received',
    weight: 0.9,
    patterns: [/application (was )?(received|submitted|sent)/i, /thank you for (applying|your application)/i, /we have received your application/i],
  },
  { cls: 'recruiter_outreach', weight: 0.8, patterns: [/came across your profile/i, /opportunity (at|with)/i, /would you be (open|interested)/i, /i('| a)m a recruiter/i] },
];

/** Keyword classifier. Deliberately conservative: conflicting signals lower confidence. */
export function classifyEmail(input: EmailInput): EmailClassificationResult {
  const text = `${input.subject}\n${input.body}`;
  const scores = new Map<EmailClassification, { hits: number; matched: string[] }>();
  for (const rule of RULES) {
    const matched = rule.patterns.filter((p) => p.test(text)).map((p) => p.source);
    if (matched.length) scores.set(rule.cls, { hits: matched.length * rule.weight, matched });
  }
  if (!scores.size) return { classification: 'unknown', confidence: 0, matched: [], suggestedCompany: guessCompany(input) };

  // "Unfortunately ... interview" is a rejection after interview, not an invitation.
  if (scores.has('rejection') && scores.has('interview_invitation')) scores.get('interview_invitation')!.hits *= 0.4;

  const ranked = [...scores.entries()].sort((a, b) => b[1].hits - a[1].hits);
  const [bestCls, best] = ranked[0];
  const second = ranked[1]?.[1].hits ?? 0;
  const margin = (best.hits - second) / best.hits;
  const strength = Math.min(1, best.hits / 3);
  const confidence = Math.round((0.3 + 0.45 * strength + 0.2 * margin) * 100) / 100;
  return { classification: bestCls, confidence: Math.min(confidence, 0.95), matched: best.matched, suggestedCompany: guessCompany(input) };
}

function guessCompany(input: EmailInput): string | null {
  const m =
    input.subject.match(/(?:at|with|from)\s+([A-Z][\w&.\- ]{1,40}?)(?:\s*[-–|:,!]|$)/) ??
    input.body.match(/(?:at|with|from|join)\s+([A-Z][\w&.\-]+(?:\s[A-Z][\w&.\-]+){0,3})/);
  if (m) return m[1].trim();
  const domain = input.from?.match(/@([a-z0-9-]+)\./i)?.[1];
  if (domain && !/gmail|yahoo|outlook|hotmail|linkedin|naukri|greenhouse|lever|workday|myworkday|ashby|smartrecruiters/i.test(domain)) {
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  }
  return null;
}

export const EMAIL_CLASS_TO_STATUS: Partial<Record<EmailClassification, import('./enums.js').ApplicationStatus>> = {
  application_received: 'applied',
  application_viewed: 'viewed',
  recruiter_outreach: 'recruiter_contacted',
  assessment_invitation: 'assessment',
  interview_invitation: 'interview',
  rejection: 'rejected',
  offer: 'offer',
};
