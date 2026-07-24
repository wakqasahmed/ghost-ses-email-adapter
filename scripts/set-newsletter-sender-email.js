#!/usr/bin/env node
'use strict';

/**
 * Sets a newsletter's sender_email directly in Ghost's database, replacing an
 * ad hoc SQL UPDATE with a reviewed, dry-run-by-default operational script.
 *
 * Run this from Ghost's own installation directory (the one containing
 * `current/`), so it reuses Ghost's own installed `knex` and database driver
 * plus Ghost's own config file. It never installs a driver of its own.
 *
 * Usage:
 *   node set-newsletter-sender-email.js --newsletter <slug-or-id> --sender-email <email> [--yes] [--config path/to/config.json]
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
        } else {
            throw new Error(`Unrecognized argument: ${arg}`);
        }
    }

    if (!args.newsletter || !args.senderEmail) {
        throw new Error('Usage: node set-newsletter-sender-email.js --newsletter <slug-or-id> --sender-email <email> [--yes] [--config path]');
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.senderEmail)) {
        throw new Error(`--sender-email does not look like a valid email address: ${args.senderEmail}`);
    }

    return args;
}

function loadGhostConfig(configPath) {
    const resolvedPath = configPath
        ? path.resolve(configPath)
        : path.resolve(process.cwd(), `config.${process.env.NODE_ENV || 'production'}.json`);

    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Ghost config file not found at ${resolvedPath}. Run this from the Ghost installation root, or pass --config.`);
    }

    const config = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));

    if (!config.database || !config.database.client) {
        throw new Error(`${resolvedPath} has no database.client — is this a Ghost config file?`);
    }

    return config;
}

function loadGhostKnex() {
    // Reuse the knex Ghost itself installed under current/node_modules, so this
    // script never adds its own database dependency to the adapter package.
    const knexPath = path.resolve(process.cwd(), 'node_modules', 'knex');

    if (!fs.existsSync(knexPath)) {
        throw new Error('node_modules/knex not found. Run this from the Ghost installation root (the directory containing node_modules, alongside current/ or as current/ itself).');
    }

    return require(knexPath);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const config = loadGhostConfig(args.configPath);
    const knexFactory = loadGhostKnex();
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

main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
});
