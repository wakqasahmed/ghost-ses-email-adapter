#!/usr/bin/env node
'use strict';

/**
 * Sets a newsletter's sender_email directly in Ghost's database, replacing an
 * ad hoc SQL UPDATE with a reviewed, dry-run-by-default operational script.
 *
 * Run this from Ghost's installation root (the directory containing both
 * `config.<env>.json` and `current/`) — a standard Ghost install splits the
 * config file (install root) from `node_modules` (inside `current/`), so this
 * script reuses Ghost's own installed `knex` and database driver from either
 * location rather than installing a driver of its own.
 *
 * Usage:
 *   node set-newsletter-sender-email.js --newsletter <slug-or-id> --sender-email <email> [--yes] [--config path/to/config.json] [--ghost-dir path]
 *
 * Without --yes, this only prints what would change.
 */

const path = require('node:path');
const fs = require('node:fs');

function parseArgs(argv) {
    const args = {yes: false};

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];

        if (arg === '--yes') {
            args.yes = true;
        } else if (arg === '--newsletter') {
            args.newsletter = argv[++i];
        } else if (arg === '--sender-email') {
            args.senderEmail = argv[++i];
        } else if (arg === '--config') {
            args.configPath = argv[++i];
        } else if (arg === '--ghost-dir') {
            args.ghostDir = argv[++i];
        } else {
            throw new Error(`Unrecognized argument: ${arg}`);
        }
    }

    if (!args.newsletter || !args.senderEmail) {
        throw new Error('Usage: node set-newsletter-sender-email.js --newsletter <slug-or-id> --sender-email <email> [--yes] [--config path] [--ghost-dir path]');
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.senderEmail)) {
        throw new Error(`--sender-email does not look like a valid email address: ${args.senderEmail}`);
    }

    return args;
}

function loadGhostConfig(ghostDir, configPath) {
    const resolvedPath = configPath
        ? path.resolve(configPath)
        : path.resolve(ghostDir, `config.${process.env.NODE_ENV || 'production'}.json`);

    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Ghost config file not found at ${resolvedPath}. Run this from the Ghost installation root, or pass --config.`);
    }

    const config = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));

    if (!config.database || !config.database.client) {
        throw new Error(`${resolvedPath} has no database.client — is this a Ghost config file?`);
    }

    return config;
}

function findGhostKnexPath(ghostDir) {
    // A Ghost install root keeps node_modules inside current/; running the
    // script from current/ itself (or a non-standard single-directory layout)
    // means node_modules is a direct child instead. Try both before giving up.
    const candidates = [
        path.resolve(ghostDir, 'node_modules', 'knex'),
        path.resolve(ghostDir, 'current', 'node_modules', 'knex')
    ];

    return candidates.find(candidate => fs.existsSync(candidate));
}

function loadGhostKnex(ghostDir) {
    // Reuse the knex Ghost itself already has installed, so this script never
    // adds its own database dependency to the adapter package.
    const knexPath = findGhostKnexPath(ghostDir);

    if (!knexPath) {
        throw new Error(`knex not found under ${ghostDir}/node_modules or ${ghostDir}/current/node_modules. Run this from the Ghost installation root (the directory containing config.*.json and current/), or pass --ghost-dir.`);
    }

    return require(knexPath);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const ghostDir = path.resolve(args.ghostDir || process.cwd());
    const config = loadGhostConfig(ghostDir, args.configPath);
    const knexFactory = loadGhostKnex(ghostDir);
    const db = knexFactory({
        client: config.database.client,
        connection: config.database.connection,
        useNullAsDefault: true
    });

    try {
        const newsletter = await db('newsletters')
            .where('id', args.newsletter)
            .orWhere('slug', args.newsletter)
            .first(['id', 'name', 'slug', 'sender_email']);

        if (!newsletter) {
            throw new Error(`No newsletter found with id or slug "${args.newsletter}"`);
        }

        console.log(`Newsletter: ${newsletter.name} (${newsletter.slug})`);
        console.log(`Current sender_email: ${newsletter.sender_email || '(empty)'}`);
        console.log(`New sender_email:     ${args.senderEmail}`);

        if (!args.yes) {
            console.log('\nDry run only — no changes made. Re-run with --yes to apply.');
            return;
        }

        if (newsletter.sender_email === args.senderEmail) {
            console.log('\nAlready set to this value — nothing to do.');
            return;
        }

        await db('newsletters')
            .where('id', newsletter.id)
            .update({sender_email: args.senderEmail, updated_at: new Date()});

        console.log('\nUpdated. This writes the address directly and does not run Ghost\'s own email format validation or its (self-host-only) verification flow — confirm the address is correct and that your bulk email provider (e.g. SES) has it verified before sending.');
    } finally {
        await db.destroy();
    }
}

module.exports = {parseArgs, loadGhostConfig, findGhostKnexPath};

if (require.main === module) {
    main().catch((err) => {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
    });
}
