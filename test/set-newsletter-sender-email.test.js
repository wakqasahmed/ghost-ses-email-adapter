require('should');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {parseArgs, loadGhostConfig, findGhostKnexPath} = require('../scripts/set-newsletter-sender-email');

describe('set-newsletter-sender-email script', function () {
    describe('parseArgs()', function () {
        it('parses newsletter and sender-email', function () {
            const args = parseArgs(['--newsletter', 'default-newsletter', '--sender-email', 'news@example.com']);

            args.newsletter.should.equal('default-newsletter');
            args.senderEmail.should.equal('news@example.com');
            args.yes.should.equal(false);
        });

        it('parses --yes, --config, and --ghost-dir', function () {
            const args = parseArgs([
                '--newsletter', 'nl1',
                '--sender-email', 'news@example.com',
                '--yes',
                '--config', '/tmp/ghost/config.production.json',
                '--ghost-dir', '/tmp/ghost'
            ]);

            args.yes.should.equal(true);
            args.configPath.should.equal('/tmp/ghost/config.production.json');
            args.ghostDir.should.equal('/tmp/ghost');
        });

        it('rejects a missing --newsletter or --sender-email', function () {
            (() => parseArgs(['--sender-email', 'news@example.com'])).should.throw(/Usage:/);
            (() => parseArgs(['--newsletter', 'nl1'])).should.throw(/Usage:/);
        });

        it('rejects an invalid email address', function () {
            (() => parseArgs(['--newsletter', 'nl1', '--sender-email', 'not-an-email'])).should.throw(/valid email address/);
        });

        it('rejects an unrecognized flag', function () {
            (() => parseArgs(['--newsletter', 'nl1', '--sender-email', 'a@b.com', '--bogus'])).should.throw(/Unrecognized argument/);
        });
    });

    describe('loadGhostConfig()', function () {
        let tmpDir;

        beforeEach(function () {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-config-test-'));
        });

        afterEach(function () {
            fs.rmSync(tmpDir, {recursive: true, force: true});
        });

        it('reads database config from config.production.json in the given directory', function () {
            fs.writeFileSync(
                path.join(tmpDir, 'config.production.json'),
                JSON.stringify({database: {client: 'sqlite3', connection: {filename: 'x.db'}}})
            );

            const config = loadGhostConfig(tmpDir);

            config.database.client.should.equal('sqlite3');
        });

        it('throws a clear error when the config file is missing', function () {
            (() => loadGhostConfig(tmpDir)).should.throw(/Ghost config file not found/);
        });

        it('throws when the file exists but has no database config', function () {
            fs.writeFileSync(path.join(tmpDir, 'config.production.json'), JSON.stringify({}));

            (() => loadGhostConfig(tmpDir)).should.throw(/has no database.client/);
        });

        it('honors an explicit --config path over the directory default', function () {
            const explicitPath = path.join(tmpDir, 'custom.json');
            fs.writeFileSync(explicitPath, JSON.stringify({database: {client: 'mysql2', connection: {}}}));

            const config = loadGhostConfig(tmpDir, explicitPath);

            config.database.client.should.equal('mysql2');
        });
    });

    describe('findGhostKnexPath()', function () {
        let tmpDir;

        beforeEach(function () {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-knex-test-'));
        });

        afterEach(function () {
            fs.rmSync(tmpDir, {recursive: true, force: true});
        });

        it('finds knex directly under the given directory (single-directory layout)', function () {
            fs.mkdirSync(path.join(tmpDir, 'node_modules', 'knex'), {recursive: true});

            findGhostKnexPath(tmpDir).should.equal(path.join(tmpDir, 'node_modules', 'knex'));
        });

        it('finds knex under current/node_modules (standard Ghost install layout)', function () {
            fs.mkdirSync(path.join(tmpDir, 'current', 'node_modules', 'knex'), {recursive: true});

            findGhostKnexPath(tmpDir).should.equal(path.join(tmpDir, 'current', 'node_modules', 'knex'));
        });

        it('returns undefined when knex is not found in either location', function () {
            (findGhostKnexPath(tmpDir) === undefined).should.be.true();
        });
    });
});
