function normalizeList(list) {
  const out = new Set();
  for (const item of list) {
    if (item == null) continue;
    const s = String(item).trim().toLowerCase();
    if (s) out.add(s);
  }
  return Array.from(out);
}

export function extractSkillsFromJob(skillsField) {
  if (!skillsField) return [];
  let raw = skillsField;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = raw.split(/[,;\n]+/);
    }
  }
  if (Array.isArray(raw)) return normalizeList(raw);
  if (typeof raw === "object" && raw.items && Array.isArray(raw.items)) {
    return normalizeList(raw.items);
  }
  return [];
}

export function extractSkillsFromCvSections(sections) {
  const skills = [];
  for (const s of sections) {
    const content = s?.content;
    if (content == null) continue;
    if (Array.isArray(content)) {
      skills.push(...content);
      continue;
    }
    if (typeof content === "string") {
      skills.push(...content.split(/[,;\n]+/));
      continue;
    }
    if (typeof content === "object") {
      if (Array.isArray(content.items)) {
        skills.push(...content.items);
      } else if (typeof content.text === "string") {
        skills.push(...content.text.split(/[,;\n]+/));
      }
    }
  }
  return normalizeList(skills);
}

export function computeCompatibilityScore(jobSkills, cvSkills) {
  const job = normalizeList(jobSkills);
  const cv = normalizeList(cvSkills);
  if (job.length === 0 || cv.length === 0) return 0;
  const cvSet = new Set(cv);
  const matches = job.filter((s) => cvSet.has(s)).length;
  return Math.round((matches / job.length) * 100);
}
