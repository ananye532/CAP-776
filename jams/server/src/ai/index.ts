import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';

/**
 * Optional AI layer. Everything returned here is stored and displayed as "AI-generated" and
 * never overwrites user-entered or imported data. When ANTHROPIC_API_KEY is not set, the
 * routes report AI as unavailable and the app falls back to keyword extraction.
 */
export const jobExtractionSchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string(),
  remote_type: z.enum(['remote', 'hybrid', 'onsite', 'unknown']),
  employment_type: z.string(),
  experience_min: z.number().nullable(),
  experience_max: z.number().nullable(),
  salary_min: z.number().nullable(),
  salary_max: z.number().nullable(),
  currency: z.string(),
  skills: z.array(z.string()),
  required_skills: z.array(z.string()),
  preferred_skills: z.array(z.string()),
  education: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(z.string()),
  role_summary: z.string(),
  potential_interview_topics: z.array(z.string()),
});
export type JobExtraction = z.infer<typeof jobExtractionSchema>;

export const resumeComparisonSchema = z.object({
  matched_skills: z.array(z.string()),
  missing_or_unclear_skills: z.array(z.string()),
  relevant_experience: z.array(z.string()),
  keywords_to_consider: z.array(z.string()),
  notes: z.string(),
});
export type ResumeComparison = z.infer<typeof resumeComparisonSchema>;

let client: Anthropic | null = null;
export function aiAvailable() {
  return !!config.ANTHROPIC_API_KEY;
}
function getClient() {
  if (!config.ANTHROPIC_API_KEY) throw new AppError(503, 'ai_unavailable', 'AI features are not configured. Set ANTHROPIC_API_KEY on the server.');
  client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 2 });
  return client;
}

const SYSTEM = `You extract structured information from job-search documents for a personal job tracker.
Only report what the text states. Use empty strings, empty arrays, or null when the text does not say.
Do not guess salaries, experience, or company names. Do not judge the candidate's chances of being hired.`;

async function parse<T extends z.ZodType>(schema: T, prompt: string): Promise<z.infer<T>> {
  const anthropic = getClient();
  try {
    const response = await anthropic.messages.parse({
      model: config.AI_MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      output_config: { format: zodOutputFormat(schema), effort: 'low' },
    });
    if (response.stop_reason === 'refusal') throw new AppError(422, 'ai_refused', 'The AI service declined to process this text.');
    if (response.stop_reason === 'max_tokens') throw new AppError(502, 'ai_truncated', 'The AI response was cut off. Try a shorter text.');
    if (!response.parsed_output) throw new AppError(502, 'ai_bad_output', 'The AI service returned an unexpected response.');
    return response.parsed_output as z.infer<T>;
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new AppError(503, 'ai_unavailable', 'The AI API key was rejected.');
    if (e instanceof Anthropic.RateLimitError) throw new AppError(429, 'ai_rate_limited', 'The AI service is rate limited. Try again shortly.');
    if (e instanceof Anthropic.APIError) throw new AppError(502, 'ai_error', 'The AI service returned an error. Try again later.');
    throw new AppError(502, 'ai_error', 'Could not reach the AI service.');
  }
}

export function extractJob(description: string) {
  return parse(jobExtractionSchema, `Extract structured fields from this job description.\n\n<job_description>\n${description}\n</job_description>`);
}

export function compareResume(resumeText: string, jobText: string) {
  return parse(
    resumeComparisonSchema,
    `Compare the resume with the job description. List skills from the job that the resume clearly shows, skills that are missing or unclear, resume experience relevant to the job, and job keywords the resume does not use. This is a checklist for the candidate, not a hiring prediction.\n\n<resume>\n${resumeText}\n</resume>\n\n<job_description>\n${jobText}\n</job_description>`,
  );
}
