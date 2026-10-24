// Scope detection is local and uses only scopes from approved knowledge.
// It never grants authority to instructions found in a customer's email.
export function recommendMailScope(subject: string, message: string, ports: string[], relatedPorts: string[] = []) {
  const normalize = (value: string) => value.toUpperCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const scopes = [...new Set(ports.map(port => port.trim().toUpperCase()).filter(port => port && port !== 'ALL'))].sort();
  // Quoted history must not decide the scope of a new question.
  const current = message.split(/\n(?:On .+wrote:|From:|_{5,}|-{5,}Original Message)/i)[0].split('\n').filter(line => !line.trimStart().startsWith('>')).join('\n');
  const text = ` ${normalize(subject + '\n' + current)} `;
  const names = (scope: string) => scope.split(/[,;/|]+/).map(normalize).filter(Boolean);
  const mentioned = [...new Set(scopes.flatMap(names))].filter(name =>
    [name, name.replace(/PORT$/, ' PORT').trim()].some(alias => text.includes(` ${alias} `)));
  // A KB scope can list several supported ports. Match its members, preserving
  // the exact approved label for retrieval. Never guess between overlapping scopes.
  const candidates = scopes.filter(scope => mentioned.length > 0 && mentioned.every(name => names(scope).includes(name)));
  const related = [...new Set(relatedPorts.map(port=>port.trim().toUpperCase()).filter(port=>scopes.includes(port)))];
  const compatible = related.filter(port => !mentioned.length || candidates.includes(port));
  const tentative = candidates.length !== 1 && compatible.length === 1 ? compatible[0] : '';
  const scope = candidates.length === 1 ? candidates[0] : tentative || 'ALL';
  return { scope, candidates, scopes, needsReview: candidates.length !== 1,
    reason: candidates.length === 1 ? `Suggested ${scope} from the email subject and current message.` : tentative ? `Related approved KB articles suggest ${scope}. This is a tentative match; confirm the scope before using specific procedures.` : mentioned.length ? `The mentioned ports match multiple or conflicting KB scopes. Using general guidance; select a scope or ask for clarification.` : 'No clear port or scope in this email. Using general guidance; the draft can ask for missing details.' };
}
