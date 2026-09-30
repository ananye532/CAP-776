/**
 * Deterministic keyword-based skill extraction. Used when no AI provider is configured and as a
 * baseline. Results are labelled "keyword match" in the UI: presence of a word is not proof that
 * the skill is required.
 */
export interface SkillDef {
  name: string;
  category: string;
  patterns: RegExp[];
}

const d = (name: string, category: string, ...patterns: (string | RegExp)[]): SkillDef => ({
  name,
  category,
  patterns: (patterns.length ? patterns : [name]).map((p) =>
    p instanceof RegExp ? p : new RegExp(`(?<![a-z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i'),
  ),
});

export const SKILL_DICTIONARY: SkillDef[] = [
  d('SQL', 'Data', /(?<![a-z])(sql|mysql|postgresql|postgres|t-sql|pl\/sql)(?![a-z])/i),
  d('Python', 'Programming'),
  d('R', 'Programming', /(?<![a-z0-9])R(?![a-z0-9#+])(?=\s*(,|\/|and|or|programming|language|studio|\)))/),
  d('Excel', 'Data', /(?<![a-z])(ms[- ]?)?excel(?![a-z])/i),
  d('Power BI', 'BI', /power\s?bi/i),
  d('Tableau', 'BI'),
  d('Looker', 'BI'),
  d('Statistics', 'Data', /statistic(s|al)/i),
  d('Machine Learning', 'Data', /machine learning|\bml\b/i),
  d('Deep Learning', 'Data'),
  d('Pandas', 'Data'),
  d('NumPy', 'Data', /numpy/i),
  d('Spark', 'Data', /(apache )?spark|pyspark/i),
  d('Airflow', 'Data'),
  d('dbt', 'Data', /(?<![a-z])dbt(?![a-z])/i),
  d('Snowflake', 'Data'),
  d('BigQuery', 'Data', /big\s?query/i),
  d('ETL', 'Data', /(?<![a-z])(etl|elt)(?![a-z])/i),
  d('Data Visualization', 'Data', /data visuali[sz]ation/i),
  d('A/B Testing', 'Data', /a\/b test/i),
  d('AWS', 'Cloud', /(?<![a-z])aws(?![a-z])|amazon web services/i),
  d('Azure', 'Cloud'),
  d('GCP', 'Cloud', /(?<![a-z])gcp(?![a-z])|google cloud/i),
  d('Docker', 'DevOps'),
  d('Kubernetes', 'DevOps', /kubernetes|k8s/i),
  d('Git', 'DevOps', /(?<![a-z])git(?![a-z])|github|gitlab/i),
  d('CI/CD', 'DevOps', /ci\/cd|continuous integration/i),
  d('Linux', 'DevOps'),
  d('JavaScript', 'Programming', /javascript|(?<![a-z])js(?![a-z])/i),
  d('TypeScript', 'Programming'),
  d('React', 'Frontend', /react(\.js|js)?(?![a-z])/i),
  d('Node.js', 'Backend', /node(\.js|js)?(?![a-z])/i),
  d('Java', 'Programming', /(?<![a-z])java(?![a-z])/i),
  d('Go', 'Programming', /(?<![a-z])golang(?![a-z])|(?<![a-z])go(?= (language|developer|engineer))/i),
  d('C++', 'Programming', /c\+\+/i),
  d('C#', 'Programming', /c#|\.net/i),
  d('REST APIs', 'Backend', /rest(ful)?\s?api/i),
  d('GraphQL', 'Backend'),
  d('Microservices', 'Backend', /micro-?services/i),
  d('MongoDB', 'Data', /mongo(db)?/i),
  d('Redis', 'Backend'),
  d('Kafka', 'Data'),
  d('HTML', 'Frontend'),
  d('CSS', 'Frontend'),
  d('Figma', 'Design'),
  d('Product Management', 'Product', /product management|product roadmap/i),
  d('Agile', 'Process', /agile|scrum/i),
  d('JIRA', 'Process', /jira/i),
  d('Stakeholder Management', 'Business', /stakeholder/i),
  d('Communication', 'Business', /communication skills|verbal and written/i),
  d('Google Analytics', 'Analytics', /google analytics|(?<![a-z])ga4(?![a-z])/i),
  d('Mixpanel', 'Analytics'),
  d('Amplitude', 'Analytics'),
  d('SAS', 'Data', /(?<![a-z])sas(?![a-z])/),
  d('SPSS', 'Data', /spss/i),
  d('Financial Modeling', 'Finance', /financial model/i),
  d('LLMs', 'AI', /(?<![a-z])llms?(?![a-z])|large language model/i),
  d('NLP', 'AI', /(?<![a-z])nlp(?![a-z])|natural language processing/i),
];

export function normalizeSkillName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function canonicalSkill(name: string): { name: string; category: string | null } {
  const n = normalizeSkillName(name);
  const def = SKILL_DICTIONARY.find((s) => normalizeSkillName(s.name) === n || s.patterns.some((p) => p.test(name) && name.length <= s.name.length + 6));
  return def ? { name: def.name, category: def.category } : { name: name.trim(), category: null };
}

export interface ExtractedSkill {
  name: string;
  category: string;
  kind: 'required' | 'preferred' | 'mentioned';
}

const PREFERRED_HEADER = /(preferred|nice to have|good to have|bonus|plus|desirable)/i;
const REQUIRED_HEADER = /(requirements?|required|must have|qualifications|what you('| wi)ll need|you have|skills)/i;

/**
 * Extracts dictionary skills from free text. Lines under a "preferred / nice to have" heading are
 * tagged preferred; lines under "requirements / must have" are tagged required; everything else is
 * "mentioned".
 */
export function extractSkills(text: string | null | undefined): ExtractedSkill[] {
  if (!text) return [];
  const found = new Map<string, ExtractedSkill>();
  let section: ExtractedSkill['kind'] = 'mentioned';
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length < 60 && /:$|^#+\s|^[A-Z][A-Za-z '’]+$/.test(trimmed)) {
      if (PREFERRED_HEADER.test(trimmed)) section = 'preferred';
      else if (REQUIRED_HEADER.test(trimmed)) section = 'required';
      else section = 'mentioned';
    }
    const lineKind: ExtractedSkill['kind'] = PREFERRED_HEADER.test(trimmed) && section !== 'preferred' ? 'preferred' : section;
    for (const def of SKILL_DICTIONARY) {
      if (def.patterns.some((p) => p.test(line))) {
        const prev = found.get(def.name);
        const rank = { required: 2, preferred: 1, mentioned: 0 };
        if (!prev || rank[lineKind] > rank[prev.kind]) found.set(def.name, { name: def.name, category: def.category, kind: lineKind });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Compares a profile/resume skill list with job skills. Purely set arithmetic; no judgement. */
export function compareSkills(profile: string[], job: { name: string; kind: string }[]) {
  const have = new Set(profile.map(normalizeSkillName));
  const matched = job.filter((s) => have.has(normalizeSkillName(s.name)));
  const missing = job.filter((s) => !have.has(normalizeSkillName(s.name)));
  return { matched, missing };
}
