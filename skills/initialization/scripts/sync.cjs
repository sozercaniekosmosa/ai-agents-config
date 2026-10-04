/**
 * Isolated Git Sync script for central .agents repository (sozercaniekosmosa/ai-agents-config)
 * Does NOT touch parent project's .git repository.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_URL = 'https://github.com/sozercaniekosmosa/ai-agents-config.git';
const AGENTS_DIR = path.resolve(__dirname, '../../..');
const PROJECT_ROOT = path.resolve(AGENTS_DIR, '..');
const PARENT_GITIGNORE = path.join(PROJECT_ROOT, '.gitignore');

function ensureParentGitignore() {
  if (!fs.existsSync(PROJECT_ROOT)) return;
  const entry = '.agents/.git';
  if (fs.existsSync(PARENT_GITIGNORE)) {
    const content = fs.readFileSync(PARENT_GITIGNORE, 'utf-8');
    if (!content.includes(entry)) {
      fs.appendFileSync(PARENT_GITIGNORE, `\n# Prevent .agents git metadata leaking to project git\n${entry}\n`);
      console.log(`[sync] Added ${entry} to parent .gitignore`);
    }
  } else {
    fs.writeFileSync(PARENT_GITIGNORE, `# Prevent .agents git metadata leaking to project git\n${entry}\n`);
    console.log(`[sync] Created parent .gitignore with ${entry}`);
  }
}

function runGit(args) {
  const gitDir = path.join(AGENTS_DIR, '.git');
  const cmd = `git --git-dir="${gitDir}" --work-tree="${AGENTS_DIR}" ${args}`;
  try {
    return execSync(cmd, { encoding: 'utf-8', cwd: AGENTS_DIR });
  } catch (err) {
    console.error(`[sync err] ${err.message}`);
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.error(err.stderr);
    process.exit(1);
  }
}

function initGitIfNeeded() {
  const gitDir = path.join(AGENTS_DIR, '.git');
  if (!fs.existsSync(gitDir)) {
    console.log('[sync] Initializing git repo in .agents...');
    execSync(`git init "${AGENTS_DIR}"`, { encoding: 'utf-8' });
    runGit(`remote add origin ${REPO_URL}`);
    runGit('branch -M main');
  }
}

const action = process.argv[2] || 'pull';
const message = process.argv.slice(3).join(' ') || 'Update agent config & skills';

ensureParentGitignore();
initGitIfNeeded();

if (action === 'pull') {
  console.log('[sync] Fetching and pulling latest changes from central repo...');
  runGit('fetch origin main');
  runGit('pull origin main --rebase');
  console.log('[sync] Successfully updated local .agents config & skills!');
} else if (action === 'push') {
  console.log('[sync] Staging and pushing local changes to central repo...');
  runGit('add .');
  runGit(`commit -m "${message}"`);
  runGit('push origin main');
  console.log('[sync] Successfully pushed changes to central repo!');
} else {
  console.error('[sync] Unknown action. Use "pull" or "push".');
  process.exit(1);
}
