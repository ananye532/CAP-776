import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';

export type SearchHit = {
  type: 'application' | 'job' | 'company' | 'contact' | 'note' | 'document' | 'resume' | 'skill';
  id: string;
  title: string;
  subtitle: string | null;
  link: string;
  /** Where the term matched, e.g. "description". */
  matched: string;
};

/**
 * Global search across the user's records. Uses ILIKE backed by pg_trgm GIN indexes, so partial
 * words ("pyth") match. Each entity type is capped so one type cannot crowd out the rest.
 */
export async function globalSearch(userId: string, q: string, perType = 6): Promise<{ query: string; hits: SearchHit[] }> {
  const term = q.trim().slice(0, 100);
  if (term.length < 2) return { query: term, hits: [] };
  const like = `%${term.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const res = await db.execute<SearchHit>(sql`
    (select 'application' as type, a.id::text as id, j.title as title, c.name as subtitle, '/applications/' || a.id as link,
       case when j.title ilike ${like} then 'title' when c.name ilike ${like} then 'company' when j.description ilike ${like} then 'job description' else 'skill' end as matched
     from applications a join jobs j on j.id = a.job_id left join companies c on c.id = j.company_id
     where a.user_id = ${userId} and (j.title ilike ${like} or c.name ilike ${like} or j.description ilike ${like}
       or exists (select 1 from job_skills js join skills s on s.id = js.skill_id where js.job_id = j.id and s.name ilike ${like}))
     order by a.last_activity_at desc limit ${perType})
    union all
    (select 'job', j.id::text, j.title, c.name, '/jobs/' || j.id,
       case when j.title ilike ${like} then 'title' when c.name ilike ${like} then 'company' when j.description ilike ${like} then 'job description' else 'skill' end
     from jobs j left join companies c on c.id = j.company_id
     where j.user_id = ${userId} and not exists (select 1 from applications a where a.job_id = j.id)
       and (j.title ilike ${like} or c.name ilike ${like} or j.description ilike ${like}
       or exists (select 1 from job_skills js join skills s on s.id = js.skill_id where js.job_id = j.id and s.name ilike ${like}))
     order by j.created_at desc limit ${perType})
    union all
    (select 'company', c.id::text, c.name, c.industry, '/companies/' || c.id, 'name'
     from companies c where c.user_id = ${userId} and (c.name ilike ${like} or array_to_string(c.aliases, ' ') ilike ${like})
     order by c.name limit ${perType})
    union all
    (select 'contact', ct.id::text, ct.name, coalesce(ct.role, '') || coalesce(' · ' || c.name, ''), '/contacts?open=' || ct.id,
       case when ct.name ilike ${like} then 'name' when ct.email ilike ${like} then 'email' else 'notes' end
     from contacts ct left join companies c on c.id = ct.company_id
     where ct.user_id = ${userId} and (ct.name ilike ${like} or ct.email ilike ${like} or ct.role ilike ${like} or ct.notes ilike ${like})
     order by ct.name limit ${perType})
    union all
    (select 'note', n.id::text, left(n.body, 90),
       case when n.application_id is not null then 'Application note' when n.company_id is not null then 'Company note' when n.contact_id is not null then 'Contact note' else 'Job note' end,
       coalesce('/applications/' || n.application_id, '/companies/' || n.company_id, '/contacts?open=' || n.contact_id, '/jobs/' || n.job_id), 'note'
     from notes n where n.user_id = ${userId} and n.body ilike ${like}
     order by n.created_at desc limit ${perType})
    union all
    (select 'document', d.id::text, d.title, replace(d.type::text, '_', ' '), '/documents?open=' || d.id,
       case when d.title ilike ${like} then 'title' else 'content' end
     from documents d where d.user_id = ${userId} and (d.title ilike ${like} or d.content ilike ${like})
     order by d.updated_at desc limit ${perType})
    union all
    (select 'resume', r.id::text, r.name || ' ' || r.version, r.target_role, '/resumes?open=' || r.id,
       case when r.name ilike ${like} then 'name' when array_to_string(r.skills, ' ') ilike ${like} then 'skills' else 'content' end
     from resumes r where r.user_id = ${userId} and (r.name ilike ${like} or r.text_content ilike ${like} or array_to_string(r.skills, ' ') ilike ${like} or r.target_role ilike ${like})
     limit ${perType})
    union all
    (select 'skill', s.id::text, s.name,
       (select count(distinct j.id)::text || ' jobs' from job_skills js join jobs j on j.id = js.job_id where js.skill_id = s.id and j.user_id = ${userId}),
       '/jobs?skill=' || s.normalized_name, 'skill'
     from skills s where s.name ilike ${like}
       and exists (select 1 from job_skills js join jobs j on j.id = js.job_id where js.skill_id = s.id and j.user_id = ${userId})
     limit ${perType})`);
  return { query: term, hits: res.rows };
}
