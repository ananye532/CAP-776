import { describe, it, expect } from 'vitest';
import {
  normalizeCompanyName,
  canonicalCompanyDisplay,
  normalizeJobTitle,
  normalizeUrl,
  normalizeStatus,
  normalizeRemoteType,
  parseSalaryAmount,
  parseExperienceRange,
} from '../../src/domain/normalize.js';

describe('company normalization', () => {
  it('collapses legal and regional suffixes', () => {
    expect(normalizeCompanyName('Google LLC')).toBe('google');
    expect(normalizeCompanyName('Google')).toBe('google');
    expect(normalizeCompanyName('Google India')).toBe('google');
    expect(normalizeCompanyName('Google India Pvt. Ltd.')).toBe('google');
    expect(normalizeCompanyName('Tata Consultancy Services Limited')).toBe('tata consultancy services');
  });
  it('does not merge genuinely different names', () => {
    expect(normalizeCompanyName('Google Cloud')).not.toBe(normalizeCompanyName('Google'));
    expect(normalizeCompanyName('Razorpay')).not.toBe(normalizeCompanyName('RazorpayX'));
  });
  it('keeps a single-word name even if it looks like a suffix', () => {
    expect(normalizeCompanyName('Company')).toBe('company');
  });
  it('produces a display name preserving casing', () => {
    expect(canonicalCompanyDisplay('Google LLC')).toBe('Google');
    expect(canonicalCompanyDisplay('Flipkart Internet Pvt. Ltd.')).toBe('Flipkart Internet');
  });
});

describe('job title normalization', () => {
  it('strips work-mode decorations', () => {
    expect(normalizeJobTitle('Data Analyst')).toBe('data analyst');
    expect(normalizeJobTitle('Data Analyst - Remote')).toBe('data analyst');
    expect(normalizeJobTitle('Data Analyst (Remote)')).toBe('data analyst');
    expect(normalizeJobTitle('Data Analyst | Bengaluru')).toBe('data analyst');
  });
  it('expands abbreviations', () => {
    expect(normalizeJobTitle('Sr. Data Analyst')).toBe('senior data analyst');
  });
  it('keeps meaningful qualifiers', () => {
    expect(normalizeJobTitle('Product Manager - Growth')).toBe('product manager growth');
  });
});

describe('url normalization', () => {
  it('drops tracking params and www', () => {
    expect(normalizeUrl('https://www.linkedin.com/jobs/view/123/?trk=abc&refId=x')).toBe('linkedin.com/jobs/view/123');
    expect(normalizeUrl('https://in.linkedin.com/jobs/view/123')).toBe('linkedin.com/jobs/view/123');
    expect(normalizeUrl('not a url')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('status normalization', () => {
  it('maps common phrases and preserves the source status', () => {
    expect(normalizeStatus('Application Submitted')).toMatchObject({ status: 'applied', sourceStatus: 'Application Submitted' });
    expect(normalizeStatus('Applied')).toMatchObject({ status: 'applied', method: 'exact' });
    expect(normalizeStatus('Not Selected').status).toBe('rejected');
    expect(normalizeStatus('Application viewed').status).toBe('viewed');
    expect(normalizeStatus('Shortlisted for interview').status).toBe('interview');
  });
  it('honours user mappings first', () => {
    expect(normalizeStatus('Recruiter Action', { userMapping: { 'Recruiter Action': 'screening' } })).toMatchObject({
      status: 'screening',
      method: 'user_mapping',
    });
  });
  it('flags unrecognized statuses instead of guessing', () => {
    expect(normalizeStatus('Pending xyz')).toMatchObject({ status: null, method: 'unrecognized' });
  });
  it('uses default when empty', () => {
    expect(normalizeStatus('', { defaultStatus: 'applied' })).toMatchObject({ status: 'applied', method: 'default' });
  });
});

describe('misc parsing', () => {
  it('parses remote type', () => {
    expect(normalizeRemoteType('Hybrid')).toBe('hybrid');
    expect(normalizeRemoteType(null, 'Bengaluru (Remote)')).toBe('remote');
    expect(normalizeRemoteType(null)).toBe('unknown');
  });
  it('parses salary amounts', () => {
    expect(parseSalaryAmount('12,00,000')).toBe(1200000);
    expect(parseSalaryAmount('15 LPA')).toBe(1500000);
    expect(parseSalaryAmount('$120k')).toBe(120000);
    expect(parseSalaryAmount('competitive')).toBeNull();
  });
  it('parses experience ranges', () => {
    expect(parseExperienceRange('3-5 years')).toEqual({ min: 3, max: 5 });
    expect(parseExperienceRange('2+ yrs')).toEqual({ min: 2, max: null });
  });
});
