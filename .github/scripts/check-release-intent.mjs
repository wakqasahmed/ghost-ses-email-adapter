import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const baseSha = process.env.BASE_SHA;
const headSha = process.env.HEAD_SHA;
const labels = JSON.parse(process.env.PR_LABELS || '[]');
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

if (!baseSha || !headSha) {
    throw new Error('BASE_SHA and HEAD_SHA are required.');
}

const changedFiles = execFileSync('git', ['diff', '--name-only', `${baseSha}...${headSha}`], {
    cwd: repositoryRoot,
    encoding: 'utf8'
}).trim().split('\n').filter(Boolean);

const hasChangeset = changedFiles.some(file =>
    file.startsWith('.changeset/') && file.endsWith('.md') && file !== '.changeset/README.md'
);
const hasNoChangesetLabel = labels.includes('no-changeset');
const isReleaseExempt = file =>
    file.startsWith('.github/') ||
    file.startsWith('test/') ||
    file.startsWith('docs/') ||
    file === 'CONTRIBUTING.md' ||
    file === 'LICENSE';
const releaseRelevantFiles = changedFiles.filter(file => !isReleaseExempt(file));

if (releaseRelevantFiles.length === 0 || hasChangeset || hasNoChangesetLabel) {
    process.exit(0);
}

console.error('This PR changes publishable package files without release intent.');
console.error('Add a Changeset or apply the no-changeset label with reviewer approval.');
console.error(`Release-relevant files:\n${releaseRelevantFiles.map(file => `- ${file}`).join('\n')}`);
process.exit(1);
