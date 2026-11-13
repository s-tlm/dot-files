// Jira settings shared by the credential loader, the REST client and dispatch.
export const SETTINGS_TEMPLATE = Object.freeze({ email: '', site: '', board: null, project: '', storyPointsField: '' });

// The site receives Basic auth, so only an exact Jira Cloud origin is accepted.
export function validateSite(site) {
  const match = typeof site === 'string' && /^https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.atlassian\.net\/?$/.exec(site);
  if (!match) throw new Error('Malformed site. Set site to your Jira Cloud URL, such as https://example.atlassian.net, without a path, port, query or credentials.');
  return `https://${match[1]}.atlassian.net`;
}

export function validateBoard(board) {
  if (!Number.isSafeInteger(board) || board <= 0) throw new Error('Malformed board. Set board to your Jira board ID as a positive whole number.');
  return board;
}

export function validateProject(project) {
  if (typeof project !== 'string' || !/^[A-Z][A-Z0-9_]{1,9}$/.test(project)) throw new Error('Malformed project. Set project to your Jira project key, such as TEAM.');
  return project;
}

export function validateStoryPointsField(field) {
  if (typeof field !== 'string' || !/^customfield_[1-9]\d*$/.test(field)) throw new Error('Malformed storyPointsField. Set storyPointsField to your story points field ID, such as customfield_10000.');
  return field;
}

export function validateSettings({ site, board, project, storyPointsField } = {}) {
  return {
    site: validateSite(site),
    board: validateBoard(board),
    project: validateProject(project),
    storyPointsField: validateStoryPointsField(storyPointsField),
  };
}
