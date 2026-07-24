const should = require('should');
const sinon = require('sinon');
const SESEmailProvider = require('../');
const EmailProviderBase = require('../EmailProviderBase');

describe('SES Email Provider Adapter', function () {
    let sesClient;
    let errorHandler;
    let sandbox;
    let SendRawEmailCommand;
    let lambdaClient;
    let LambdaClient;
    let InvokeCommand;
    let lambdaRequireCount;

    beforeEach(function () {
        sandbox = sinon.createSandbox();

        // Mock AWS SDK - SendRawEmailCommand constructor captures input
        SendRawEmailCommand = sandbox.stub().callsFake(function (input) {
            return {input};
        });

        InvokeCommand = sandbox.stub().callsFake(function (input) {
            return {input};
        });

        // Mock SES client
        sesClient = {
            send: sandbox.stub().resolves({MessageId: 'test-message-id-123'})
        };

        lambdaClient = {
            send: sandbox.stub().resolves({Payload: Buffer.from(JSON.stringify({messageId: 'lambda-message-id-123'}))})
        };
        LambdaClient = sandbox.stub().returns(lambdaClient);
        lambdaRequireCount = 0;

        errorHandler = sandbox.stub();

        // Mock the AWS SDK require
        const mockAwsSdk = {
            SESClient: sandbox.stub().returns(sesClient),
            SendRawEmailCommand
        };
        const mockLambdaSdk = {
            LambdaClient,
            InvokeCommand
        };

        const originalLoad = module.constructor._load;
        sandbox.stub(module.constructor, '_load').callsFake(function (request, parent) {
            if (request === '@aws-sdk/client-ses') {
                return mockAwsSdk;
            }
            if (request === '@aws-sdk/client-lambda') {
                lambdaRequireCount += 1;
                return mockLambdaSdk;
            }
            // Delegate to original for all other modules
            return originalLoad.apply(this, arguments);
        });
    });

    afterEach(function () {
        sandbox.restore();
    });

    describe('Constructor', function () {
        it('should extend EmailProviderBase', function () {
            const adapter = new SESEmailProvider({
                ses: {
                    region: 'us-east-1',
                    fromEmail: 'test@example.com'
                }
            });

            should.exist(adapter);
            adapter.should.be.instanceOf(EmailProviderBase);
        });

        it('should throw error if ses config is missing', function () {
            try {
                new SESEmailProvider({});
                throw new Error('Should have thrown an error');
            } catch (err) {
                err.message.should.match(/SES adapter requires region/);
            }
        });

        it('should throw error if region is missing', function () {
            try {
                new SESEmailProvider({
                    ses: {
                        fromEmail: 'test@example.com'
                    }
                });
                throw new Error('Should have thrown an error');
            } catch (err) {
                err.message.should.match(/SES adapter requires region/);
            }
        });

        it('should throw error if fromEmail is missing', function () {
            try {
                new SESEmailProvider({
                    ses: {
                        region: 'us-east-1'
                    }
                });
                throw new Error('Should have thrown an error');
            } catch (err) {
                err.message.should.match(/SES adapter requires fromEmail/);
            }
        });

        it('should create SES client with region only', function () {
            const adapter = new SESEmailProvider({
                ses: {
                    region: 'us-west-2',
                    fromEmail: 'test@example.com'
                }
            });

            should.exist(adapter);
        });

        it('should create SES client with credentials', function () {
            const adapter = new SESEmailProvider({
                ses: {
                    region: 'us-east-1',
                    accessKeyId: 'test-key-id',
                    secretAccessKey: 'test-secret-key',
                    fromEmail: 'test@example.com'
                }
            });

            should.exist(adapter);
        });

        it('should not serialize SES credentials', function () {
            const adapter = new SESEmailProvider({
                ses: {
                    region: 'us-east-1',
                    accessKeyId: 'test-access-key-id',
                    secretAccessKey: 'test-secret-access-key',
                    fromEmail: 'test@example.com'
                }
            });

            const serialized = `${JSON.stringify(adapter)} ${require('node:util').inspect(adapter)}`;

            serialized.should.not.containEql('test-access-key-id');
            serialized.should.not.containEql('test-secret-access-key');
        });

        it('should store errorHandler from config', function () {
            const adapter = new SESEmailProvider({
                ses: {
                    region: 'us-east-1',
                    fromEmail: 'test@example.com'
                },
                errorHandler
            });

            should.exist(adapter);
            // Error handler will be tested in send() error cases
        });

        it('should work without errorHandler (optional)', function () {
            const adapter = new SESEmailProvider({
                ses: {
                    region: 'us-east-1',
                    fromEmail: 'test@example.com'
                }
            });

            should.exist(adapter);
        });

        it('should resolve its regular AWS SDK dependency', function () {
            require('@aws-sdk/client-ses').should.have.property('SESClient');
        });

        it('should require the Lambda SDK only for Lambda transport', function () {
            new SESEmailProvider({
                ses: {
                    region: 'us-east-1',
                    fromEmail: 'test@example.com'
                }
            });

            lambdaRequireCount.should.equal(0);
        });

        it('should require a Lambda function name for Lambda transport', function () {
            (() => new SESEmailProvider({
                ses: {
                    region: 'us-east-1',
                    fromEmail: 'test@example.com',
                    transport: 'lambda'
                }
            })).should.throw(/Lambda transport requires functionName/);
        });

        it('should reject unknown transport values instead of silently sending direct', function () {
            (() => new SESEmailProvider({
                ses: {
                    region: 'us-east-1',
                    fromEmail: 'test@example.com',
                    transport: 'lamda'
                }
            })).should.throw(/transport must be 'direct' or 'lambda'/);
        });
    });

    describe('send()', function () {
        let adapter;
        let emailData;
        let sendOptions;

        beforeEach(function () {
            adapter = new SESEmailProvider({
                ses: {
                    region: 'us-east-1',
                    fromEmail: 'default@example.com',
                    configurationSet: 'test-config-set'
                },
                errorHandler
            });

            emailData = {
                subject: 'Test Email',
                html: '<p>Hello World</p>',
                plaintext: 'Hello World',
                from: 'test@example.com',
                replyTo: 'reply@example.com',
                emailId: 'test-email-123',
                recipients: [
                    {email: 'user1@example.com'},
                    {email: 'user2@example.com'}
                ],
                replacementDefinitions: []
            };

            sendOptions = {
                openTrackingEnabled: true,
                clickTrackingEnabled: true
            };
        });

        it('should send email via SES client', async function () {
            const result = await adapter.send(emailData, sendOptions);

            sesClient.send.calledOnce.should.be.true();
            lambdaRequireCount.should.equal(0);
            result.should.deepEqual({id: 'test-message-id-123'});
        });

        it('should build MIME email with correct headers', async function () {
            await adapter.send(emailData, sendOptions);

            const command = SendRawEmailCommand.firstCall.args[0];
            const rawMessage = command.RawMessage.Data.toString();

            rawMessage.should.match(/From: test@example.com/);
            rawMessage.should.match(/Subject: Test Email/);
            rawMessage.should.match(/Reply-To: reply@example.com/);
            rawMessage.should.match(/MIME-Version: 1.0/);
        });

        it('should build MIME email without reply-to if not provided', async function () {
            delete emailData.replyTo;

            await adapter.send(emailData, sendOptions);

            const command = SendRawEmailCommand.firstCall.args[0];
            const rawMessage = command.RawMessage.Data.toString();

            rawMessage.should.not.match(/Reply-To:/);
        });

        it('should include both HTML and plaintext in MIME', async function () {
            await adapter.send(emailData, sendOptions);

            const command = SendRawEmailCommand.firstCall.args[0];
            const rawMessage = command.RawMessage.Data.toString();

            rawMessage.should.match(/Content-Type: text\/plain/);
            rawMessage.should.match(/Hello=20World/); // plaintext (quoted-printable encoded)
            rawMessage.should.match(/Content-Type: text\/html/);
            rawMessage.should.match(/<p>Hello=20World<\/p>/); // html (quoted-printable encoded)
        });

        it('should use from address from email data', async function () {
            await adapter.send(emailData, sendOptions);

            const command = SendRawEmailCommand.firstCall.args[0];
            command.Source.should.equal('test@example.com');
        });

        it('should use default from address if not provided', async function () {
            delete emailData.from;

            await adapter.send(emailData, sendOptions);

            const command = SendRawEmailCommand.firstCall.args[0];
            command.Source.should.equal('default@example.com');
        });

        it('should send one recipient per SES request', async function () {
            emailData.recipients = [
                {email: 'user1@example.com', replacements: [{id: 'name', value: 'Alice'}]},
                {email: 'user2@example.com', replacements: [{id: 'name', value: 'Bob'}]}
            ];

            await adapter.send(emailData, sendOptions);

            sesClient.send.callCount.should.equal(2);
            SendRawEmailCommand.firstCall.args[0].Destinations.should.deepEqual(['user1@example.com']);
            SendRawEmailCommand.secondCall.args[0].Destinations.should.deepEqual(['user2@example.com']);
        });

        it('should include configuration set', async function () {
            await adapter.send(emailData, sendOptions);

            const command = SendRawEmailCommand.firstCall.args[0];
            command.ConfigurationSetName.should.equal('test-config-set');
        });

        it('should tag email with emailId', async function () {
            await adapter.send(emailData, sendOptions);

            const command = SendRawEmailCommand.firstCall.args[0];
            command.Tags.should.deepEqual([
                {
                    Name: 'email-id',
                    Value: 'test-email-123'
                }
            ]);
        });

        it('should tag with "unknown" if emailId not provided', async function () {
            delete emailData.emailId;

            await adapter.send(emailData, sendOptions);

            const command = SendRawEmailCommand.firstCall.args[0];
            command.Tags[0].Value.should.equal('unknown');
        });

        it('should retry only recipients that failed in the prior attempt', async function () {
            emailData.recipients = [
                {email: 'user1@example.com', replacements: [{id: 'name', value: 'Alice'}]},
                {email: 'user2@example.com', replacements: [{id: 'name', value: 'Bob'}]}
            ];

            sesClient.send.onFirstCall().resolves({MessageId: 'first-id'});
            sesClient.send.onSecondCall().rejects(new Error('temporary SES failure'));
            sesClient.send.onThirdCall().resolves({MessageId: 'second-id'});

            await adapter.send(emailData, sendOptions).should.be.rejected();
            await adapter.send(emailData, sendOptions);

            sesClient.send.callCount.should.equal(3);
            SendRawEmailCommand.getCall(0).args[0].Destinations.should.deepEqual(['user1@example.com']);
            SendRawEmailCommand.getCall(1).args[0].Destinations.should.deepEqual(['user2@example.com']);
            SendRawEmailCommand.getCall(2).args[0].Destinations.should.deepEqual(['user2@example.com']);
        });

        it('should retry only failed personalized recipients without an emailId', async function () {
            delete emailData.emailId;
            emailData.recipients = [
                {email: 'user1@example.com', replacements: [{id: 'name', value: 'Alice'}]},
                {email: 'user2@example.com', replacements: [{id: 'name', value: 'Bob'}]}
            ];

            sesClient.send.onFirstCall().resolves({MessageId: 'first-id'});
            sesClient.send.onSecondCall().rejects(new Error('temporary SES failure'));
            sesClient.send.onThirdCall().resolves({MessageId: 'second-id'});

            await adapter.send(emailData, sendOptions).should.be.rejected();
            await adapter.send(emailData, sendOptions);

            sesClient.send.callCount.should.equal(3);
            SendRawEmailCommand.getCall(2).args[0].Destinations.should.deepEqual(['user2@example.com']);
        });

        it('should retry only failed bulk batches', async function () {
            delete emailData.emailId;
            emailData.recipients = Array.from({length: 51}, (_, index) => ({email: `user${index + 1}@example.com`}));

            sesClient.send.onFirstCall().resolves({MessageId: 'first-batch'});
            sesClient.send.onSecondCall().rejects(new Error('temporary SES failure'));
            sesClient.send.onThirdCall().resolves({MessageId: 'second-batch'});

            await adapter.send(emailData, sendOptions).should.be.rejected();
            await adapter.send(emailData, sendOptions);

            sesClient.send.callCount.should.equal(3);
            SendRawEmailCommand.getCall(0).args[0].Destinations.length.should.equal(50);
            SendRawEmailCommand.getCall(2).args[0].Destinations.should.deepEqual(['user51@example.com']);
        });

        it('should coalesce concurrent sends with the same retry key', async function () {
            let resolveSend;
            sesClient.send.callsFake(function () {
                return new Promise(resolve => {
                    resolveSend = resolve;
                });
            });

            const firstSend = adapter.send(emailData, sendOptions);
            const secondSend = adapter.send(emailData, sendOptions);

            sesClient.send.calledOnce.should.be.true();
            resolveSend({MessageId: 'shared-message-id'});

            const [firstResult, secondResult] = await Promise.all([firstSend, secondSend]);

            sesClient.send.calledOnce.should.be.true();
            firstResult.should.deepEqual({id: 'shared-message-id'});
            secondResult.should.deepEqual({id: 'shared-message-id'});
        });

        it('should start a new send after an in-flight send has completed', async function () {
            await adapter.send(emailData, sendOptions);
            await adapter.send(emailData, sendOptions);

            sesClient.send.callCount.should.equal(2);
        });

        it('should evict the oldest partial retry state after the retry cache reaches its limit', async function () {
            emailData.recipients = [
                {email: 'sent@example.com', replacements: [{id: 'name', value: 'Sent'}]},
                {email: 'failed@example.com', replacements: [{id: 'name', value: 'Failed'}]}
            ];
            sesClient.send.onFirstCall().resolves({MessageId: 'sent-message-id'});
            sesClient.send.onSecondCall().rejects(new Error('temporary SES failure'));

            await adapter.send(emailData, sendOptions).should.be.rejected();

            sesClient.send.reset();
            let retrySendCount = 0;
            sesClient.send.callsFake(function () {
                retrySendCount += 1;

                if (retrySendCount % 2 === 1) {
                    return Promise.resolve({MessageId: 'partial-message-id'});
                }

                return Promise.reject(new Error('temporary SES failure'));
            });

            for (let index = 0; index < 1000; index += 1) {
                await adapter.send({
                    ...emailData,
                    emailId: `failed-retry-${index}`,
                    recipients: [
                        {email: `sent-retry-${index}@example.com`, replacements: [{id: 'name', value: 'Sent'}]},
                        {email: `failed-retry-${index}@example.com`, replacements: [{id: 'name', value: 'Failed'}]}
                    ]
                }, sendOptions).should.be.rejected();
            }

            sesClient.send.reset();
            sesClient.send.resolves({MessageId: 'retry-message-id'});

            await adapter.send(emailData, sendOptions);

            sesClient.send.callCount.should.equal(2);
            SendRawEmailCommand.getCall(0).args[0].Destinations.should.deepEqual(['sent@example.com']);
            SendRawEmailCommand.getCall(1).args[0].Destinations.should.deepEqual(['failed@example.com']);
        });

        it('should limit personalized direct sends to ten concurrent SES requests', async function () {
            emailData.recipients = Array.from({length: 11}, (_, index) => ({
                email: `user${index + 1}@example.com`,
                replacements: [{id: 'name', value: `User ${index + 1}`}]
            }));
            let activeSends = 0;
            let maxActiveSends = 0;

            const releaseSends = [];
            sesClient.send.callsFake(function () {
                activeSends += 1;
                maxActiveSends = Math.max(maxActiveSends, activeSends);
                return new Promise(resolve => releaseSends.push(function () {
                    activeSends -= 1;
                    resolve({MessageId: 'message-id'});
                }));
            });

            const sendPromise = adapter.send(emailData, sendOptions);

            maxActiveSends.should.equal(10);
            releaseSends.splice(0).forEach(release => release());
            for (let index = 0; index < 10 && releaseSends.length === 0; index += 1) {
                await Promise.resolve();
            }
            releaseSends.length.should.equal(1);
            releaseSends.splice(0).forEach(release => release());
            await sendPromise;
        });

        it('should select the configuration set that matches tracking preferences', async function () {
            adapter = new SESEmailProvider({
                ses: {
                    region: 'us-east-1',
                    fromEmail: 'default@example.com',
                    configurationSets: {
                        openAndClick: 'open-and-click',
                        openOnly: 'open-only',
                        clickOnly: 'click-only',
                        disabled: 'tracking-disabled'
                    }
                }
            });
            emailData.recipients = [{
                email: 'user1@example.com',
                replacements: [{id: 'name', value: 'Alice'}]
            }];

            await adapter.send(emailData, {openTrackingEnabled: true, clickTrackingEnabled: false});
            await adapter.send(emailData, {openTrackingEnabled: false, clickTrackingEnabled: true});
            await adapter.send(emailData, {openTrackingEnabled: false, clickTrackingEnabled: false});

            SendRawEmailCommand.getCall(0).args[0].ConfigurationSetName.should.equal('open-only');
            SendRawEmailCommand.getCall(1).args[0].ConfigurationSetName.should.equal('click-only');
            SendRawEmailCommand.getCall(2).args[0].ConfigurationSetName.should.equal('tracking-disabled');
        });

        it('should RFC 2047 encode non-ASCII header values without encoding ASCII values', async function () {
            emailData.recipients = [{
                email: 'user1@example.com',
                replacements: [{id: 'name', value: 'Alice'}]
            }];
            emailData.subject = 'Grüße 👋';
            emailData.from = 'Jörg <test@example.com>';
            emailData.replyTo = 'Réponse <reply@example.com>';

            await adapter.send(emailData, sendOptions);

            const rawMessage = SendRawEmailCommand.firstCall.args[0].RawMessage.Data.toString();
            rawMessage.should.match(/^Subject: =\?UTF-8\?B\?.+\?=$/m);
            rawMessage.should.match(/^From: =\?UTF-8\?B\?.+\?= <test@example\.com>$/m);
            rawMessage.should.match(/^Reply-To: =\?UTF-8\?B\?.+\?= <reply@example\.com>$/m);
            SendRawEmailCommand.firstCall.args[0].Source.should.equal(rawMessage.match(/^From: (.+)$/m)[1]);
        });

        it('should RFC 2047 encode the Source parameter for bulk sends', async function () {
            emailData.from = 'Jörg <test@example.com>';

            await adapter.send(emailData, sendOptions);

            const command = SendRawEmailCommand.firstCall.args[0];
            const rawMessage = command.RawMessage.Data.toString();
            command.Source.should.equal(rawMessage.match(/^From: (.+)$/m)[1]);
            command.Source.should.match(/^=\?UTF-8\?B\?.+\?= <test@example\.com>$/);
        });

        it('should sanitize recipient email addresses in bulk Bcc headers', async function () {
            emailData.recipients = [
                {email: 'member@example.com\r\nX-Injected: value'},
                {email: 'other@example.com'}
            ];

            await adapter.send(emailData, sendOptions);

            const rawMessage = SendRawEmailCommand.firstCall.args[0].RawMessage.Data.toString();
            const bccHeader = rawMessage.match(/^Bcc: ([\s\S]*?)\r\nSubject:/m)[1];

            bccHeader.should.equal('member@example.comX-Injected: value, other@example.com');
            rawMessage.should.not.match(/^X-Injected:/m);
        });

        it('should fold long bulk Bcc headers below the RFC 5322 line limit', async function () {
            emailData.recipients = Array.from({length: 50}, (_, index) => ({
                email: `member-${index}-${'long-local-part'.repeat(4)}@example.com`
            }));

            await adapter.send(emailData, sendOptions);

            const rawMessage = SendRawEmailCommand.firstCall.args[0].RawMessage.Data.toString();
            const bccHeader = rawMessage.match(/^Bcc:.*(?:\r\n [^\r\n]*)*/m)[0];

            bccHeader.should.containEql('\r\n ');
            bccHeader.split('\r\n').forEach(line => Buffer.byteLength(line).should.be.belowOrEqual(900));
        });

        it('should fold long RFC 2047 encoded subject values into valid encoded words', async function () {
            emailData.recipients = [{
                email: 'user1@example.com',
                replacements: [{id: 'name', value: 'Alice'}]
            }];
            emailData.subject = 'こんにちは'.repeat(20);

            await adapter.send(emailData, sendOptions);

            const rawMessage = SendRawEmailCommand.firstCall.args[0].RawMessage.Data.toString();
            const subject = rawMessage.match(/^Subject: ([\s\S]*?)\r\nDate:/m)[1];
            const encodedWords = subject.match(/=\?UTF-8\?B\?[^?]+\?=/g);

            encodedWords.length.should.be.above(1);
            encodedWords.forEach(word => word.length.should.be.belowOrEqual(75));
            subject.should.containEql('\r\n ');
            encodedWords
                .map(word => Buffer.from(word.slice(10, -2), 'base64').toString('utf8'))
                .join('')
                .should.equal(emailData.subject);
        });

        it('should keep long UTF-8 MIME headers within the line limit without folding Source', async function () {
            emailData.recipients = [{
                email: 'user1@example.com',
                replacements: [{id: 'name', value: 'Alice'}]
            }];
            emailData.subject = 'こんにちは'.repeat(20);
            emailData.from = `${'Jörg '.repeat(20)}<test@example.com>`;
            emailData.replyTo = `${'Réponse '.repeat(20)}<reply@example.com>`;

            await adapter.send(emailData, sendOptions);

            const command = SendRawEmailCommand.firstCall.args[0];
            const rawMessage = command.RawMessage.Data.toString();

            ['Subject', 'From', 'Reply-To'].forEach((headerName) => {
                const headerLines = rawMessage.match(new RegExp(`^${headerName}:.*(?:\\r\\n [^\\r\\n]*)*`, 'm'))[0].split('\r\n');
                headerLines.forEach(line => line.length.should.be.belowOrEqual(76));
            });

            command.Source.should.match(/^[\x00-\x7F]+$/);
            command.Source.should.not.match(/[\r\n]/);
        });

        it('should throw EmailError on SES API error', async function () {
            const sesError = new Error('MessageRejected');
            sesError.name = 'MessageRejected';
            sesError.code = 'MessageRejected';
            sesError.$metadata = {httpStatusCode: 400};

            sesClient.send.rejects(sesError);

            try {
                await adapter.send(emailData, sendOptions);
                throw new Error('Should have thrown EmailError');
            } catch (err) {
                err.name.should.equal('EmailError');
                err.statusCode.should.equal(400);
                err.message.should.match(/MessageRejected/);
                err.code.should.equal('BULK_EMAIL_SEND_FAILED');
            }
        });

        it('should call errorHandler on send failure', async function () {
            const sesError = new Error('Service Error');
            sesError.$metadata = {httpStatusCode: 500};

            sesClient.send.rejects(sesError);

            try {
                await adapter.send(emailData, sendOptions);
            } catch (err) {
                errorHandler.calledOnce.should.be.true();
                errorHandler.firstCall.args[0].should.have.property('name', 'EmailError');
            }
        });

        it('should not call errorHandler if not provided', async function () {
            const adapterWithoutHandler = new SESEmailProvider({
                ses: {
                    region: 'us-east-1',
                    fromEmail: 'test@example.com'
                }
            });

            sesClient.send.rejects(new Error('Test error'));

            try {
                await adapterWithoutHandler.send(emailData, sendOptions);
            } catch (err) {
                // Should not throw additional errors
                err.name.should.equal('EmailError');
            }
        });

        it('should redact recipient PII from every Ghost-visible error field', async function () {
            const recipientEmail = 'private.member@example.com';
            const sesError = new Error(`Sensitive error with ${recipientEmail}`);
            sesError.$metadata = {httpStatusCode: 400};

            sesClient.send.rejects(sesError);

            try {
                await adapter.send(emailData, sendOptions);
            } catch (err) {
                err.message.should.not.containEql(recipientEmail);
                err.context.should.not.containEql(recipientEmail);
                err.errorDetails.should.not.containEql(recipientEmail);
                JSON.stringify(err).should.not.containEql(recipientEmail);
                err.errorDetails.should.match(/recipientCount/);
            }
        });

        ['müller@example.com', 'user@[192.168.1.1]'].forEach(function (recipientEmail) {
            it(`should redact known recipient PII for ${recipientEmail}`, async function () {
                emailData.recipients = [{email: recipientEmail}];
                const sesError = new Error(`Sensitive error with ${recipientEmail}`);
                sesError.$metadata = {httpStatusCode: 400};

                sesClient.send.rejects(sesError);

                try {
                    await adapter.send(emailData, sendOptions);
                } catch (err) {
                    err.message.should.not.containEql(recipientEmail);
                    err.context.should.not.containEql(recipientEmail);
                    err.errorDetails.should.not.containEql(recipientEmail);
                    JSON.stringify(err).should.not.containEql(recipientEmail);
                }
            });
        });

        it('should truncate error messages longer than 2000 chars', async function () {
            const longMessage = 'x'.repeat(3000);
            const sesError = new Error(longMessage);
            sesError.$metadata = {httpStatusCode: 400};

            sesClient.send.rejects(sesError);

            try {
                await adapter.send(emailData, sendOptions);
            } catch (err) {
                err.message.length.should.be.belowOrEqual(2000);
            }
        });

        it('should default to status 500 if no HTTP status in error', async function () {
            const sesError = new Error('Unknown error');
            // No $metadata property

            sesClient.send.rejects(sesError);

            try {
                await adapter.send(emailData, sendOptions);
            } catch (err) {
                err.statusCode.should.equal(500);
            }
        });
    });

    describe('getMaximumRecipients()', function () {
        it('should return 1 so Ghost retries one recipient at a time', function () {
            const adapter = new SESEmailProvider({
                ses: {
                    region: 'us-east-1',
                    fromEmail: 'test@example.com'
                }
            });

            const maxRecipients = adapter.getMaximumRecipients();

            maxRecipients.should.equal(1);
        });
    });

    describe('Lambda transport', function () {
        const lambdaConfig = {
            region: 'us-east-1',
            fromEmail: 'default@example.com',
            transport: 'lambda',
            lambda: {
                functionName: 'ghost-ses-sender',
                region: 'eu-west-1'
            }
        };
        const emailData = {
            subject: 'Test Email',
            html: '<p>Hello World</p>',
            plaintext: 'Hello World',
            from: 'test@example.com',
            emailId: 'test-email-123',
            recipients: [{email: 'user@example.com'}]
        };

        it('should invoke Lambda synchronously and return its MessageId', async function () {
            const adapter = new SESEmailProvider({ses: lambdaConfig});

            const result = await adapter.send(emailData);

            result.should.deepEqual({id: 'lambda-message-id-123'});
            sesClient.send.called.should.be.false();
            lambdaRequireCount.should.be.above(0);
            LambdaClient.calledWith({region: 'eu-west-1'}).should.be.true();
            InvokeCommand.firstCall.args[0].should.containEql({
                FunctionName: 'ghost-ses-sender',
                InvocationType: 'RequestResponse'
            });
            const payload = JSON.parse(InvokeCommand.firstCall.args[0].Payload.toString());
            payload.should.containEql({
                source: 'test@example.com',
                destinations: ['user@example.com']
            });
            Buffer.from(payload.rawMessage, 'base64').toString().should.match(/Subject: Test Email/);
        });

        it('should use Lambda for personalized sends', async function () {
            const adapter = new SESEmailProvider({ses: lambdaConfig});
            const personalizedData = {
                ...emailData,
                recipients: [{
                    email: 'user@example.com',
                    replacements: [{id: 'name', value: 'Ada'}]
                }],
                replacementDefinitions: [{id: 'name', token: '%%{name}%%'}],
                html: '<p>Hello %%{name}%%</p>'
            };

            await adapter.send(personalizedData);

            lambdaClient.send.calledOnce.should.be.true();
            const payload = JSON.parse(InvokeCommand.firstCall.args[0].Payload.toString());
            Buffer.from(payload.rawMessage, 'base64').toString().should.containEql('Hello=20Ada');
        });

        it('should surface invoke failures as redacted EmailErrors', async function () {
            const adapter = new SESEmailProvider({ses: lambdaConfig});
            lambdaClient.send.rejects(new Error('Lambda denied user@example.com'));

            await adapter.send(emailData).should.be.rejectedWith(/Lambda denied \[redacted\]/);
        });

        it('should surface FunctionError payloads as redacted EmailErrors, restoring code and status from the handler suffix', async function () {
            const adapter = new SESEmailProvider({ses: lambdaConfig});
            // Runtime-faithful payload: only errorType/errorMessage survive Lambda error serialization
            lambdaClient.send.resolves({
                FunctionError: 'Unhandled',
                $metadata: {httpStatusCode: 200},
                Payload: Buffer.from(JSON.stringify({
                    errorType: 'MessageRejected',
                    errorMessage: 'SES rejected user@example.com [ses code=MessageRejected status=400]'
                }))
            });

            try {
                await adapter.send(emailData);
                throw new Error('expected send to reject');
            } catch (err) {
                err.name.should.equal('EmailError');
                err.statusCode.should.equal(400);
                err.message.should.match(/SES rejected \[redacted\]/);
                err.message.should.not.containEql('[ses code=');
            }
        });

        it('should never report the invoke HTTP 200 as the failure status when the suffix is absent', async function () {
            const adapter = new SESEmailProvider({ses: lambdaConfig});
            lambdaClient.send.resolves({
                FunctionError: 'Unhandled',
                $metadata: {httpStatusCode: 200},
                Payload: Buffer.from(JSON.stringify({
                    errorType: 'Error',
                    errorMessage: 'boom'
                }))
            });

            try {
                await adapter.send(emailData);
                throw new Error('expected send to reject');
            } catch (err) {
                err.name.should.equal('EmailError');
                err.statusCode.should.equal(500);
            }
        });

        it('should treat a success response without messageId as a failure', async function () {
            const adapter = new SESEmailProvider({ses: lambdaConfig});
            lambdaClient.send.resolves({
                $metadata: {httpStatusCode: 200},
                Payload: Buffer.from(JSON.stringify({ok: true}))
            });

            await adapter.send(emailData).should.be.rejectedWith(/returned no messageId/);
        });

        it('should treat a null success payload as a failure, not a TypeError', async function () {
            const adapter = new SESEmailProvider({ses: lambdaConfig});
            // A handler returning undefined serializes as the JSON string "null"
            lambdaClient.send.resolves({
                $metadata: {httpStatusCode: 200},
                Payload: Buffer.from('null')
            });

            await adapter.send(emailData).should.be.rejectedWith(/returned no messageId/);
        });

        it('should report the 6 MB payload guard as a non-retryable 413', async function () {
            const adapter = new SESEmailProvider({ses: lambdaConfig});
            const oversizedData = {
                ...emailData,
                html: 'x'.repeat(6 * 1024 * 1024)
            };

            try {
                await adapter.send(oversizedData);
                throw new Error('expected send to reject');
            } catch (err) {
                err.name.should.equal('EmailError');
                err.statusCode.should.equal(413);
            }
        });

        it('should fail before invoking Lambda when the request payload exceeds 6 MB', async function () {
            const adapter = new SESEmailProvider({ses: lambdaConfig});
            const oversizedData = {
                ...emailData,
                html: 'x'.repeat(6 * 1024 * 1024)
            };

            await adapter.send(oversizedData).should.be.rejectedWith(/6 MB/);
            lambdaClient.send.called.should.be.false();
        });
    });

    describe('getTargetDeliveryWindow()', function () {
        it('should return 3600 seconds (1 hour)', function () {
            const adapter = new SESEmailProvider({
                ses: {
                    region: 'us-east-1',
                    fromEmail: 'test@example.com'
                }
            });

            const deliveryWindow = adapter.getTargetDeliveryWindow();

            deliveryWindow.should.equal(3600);
        });
    });

    describe('Adapter Contract', function () {
        it('should have required send method', function () {
            const adapter = new SESEmailProvider({
                ses: {
                    region: 'us-east-1',
                    fromEmail: 'test@example.com'
                }
            });

            adapter.should.have.property('send');
            adapter.send.should.be.a.Function();
        });

        it('should have the complete email provider contract', function () {
            const adapter = new SESEmailProvider({
                ses: {
                    region: 'us-east-1',
                    fromEmail: 'test@example.com'
                }
            });

            adapter.requiredFns.should.be.an.Array();
            adapter.requiredFns.should.deepEqual(['send', 'getMaximumRecipients', 'getTargetDeliveryWindow']);
        });
    });

    describe('Personalization Detection', function () {
        let adapter;
        let emailData;

        beforeEach(function () {
            adapter = new SESEmailProvider({
                ses: {
                    region: 'us-east-1',
                    fromEmail: 'test@example.com',
                    configurationSet: 'test-config'
                }
            });

            emailData = {
                subject: 'Test Newsletter',
                html: '<p>Hello %%{name}%%</p>',
                plaintext: 'Hello %%{name}%%',
                from: 'test@example.com',
                emailId: 'test-email-123',
                recipients: []
            };
        });

        it('should send list-unsubscribe tokens per recipient with one-click headers', async function () {
            emailData.html = '<p><a href="%%{list_unsubscribe}%%">Unsubscribe</a></p>';
            emailData.plaintext = 'Unsubscribe: %%{list_unsubscribe}%%';
            emailData.replacementDefinitions = [{id: 'list_unsubscribe', token: '%%{list_unsubscribe}%%'}];
            emailData.recipients = [
                {
                    email: 'user1@example.com',
                    replacements: [{id: 'list_unsubscribe', value: 'https://unsubscribe.example.com/one'}]
                },
                {
                    email: 'user2@example.com',
                    replacements: [{id: 'list_unsubscribe', value: 'https://unsubscribe.example.com/two'}]
                }
            ];

            await adapter.send(emailData);

            sesClient.send.callCount.should.equal(2);

            const firstMessage = SendRawEmailCommand.getCall(0).args[0].RawMessage.Data.toString();
            const secondMessage = SendRawEmailCommand.getCall(1).args[0].RawMessage.Data.toString();
            firstMessage.should.containEql('https://unsubscribe.example.com/one');
            firstMessage.should.match(/^List-Unsubscribe: <https:\/\/unsubscribe\.example\.com\/one>$/m);
            firstMessage.should.match(/^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);
            secondMessage.should.containEql('https://unsubscribe.example.com/two');
            secondMessage.should.match(/^List-Unsubscribe: <https:\/\/unsubscribe\.example\.com\/two>$/m);
        });

        it('should use personalized path when name token present', async function () {
            // list_unsubscribe + name token (personalization)
            emailData.recipients = [
                {
                    email: 'user1@example.com',
                    replacements: [
                        {id: 'list_unsubscribe', value: 'https://unsubscribe.com'},
                        {id: 'name', value: 'Alice'}
                    ]
                },
                {
                    email: 'user2@example.com',
                    replacements: [
                        {id: 'list_unsubscribe', value: 'https://unsubscribe.com'},
                        {id: 'name', value: 'Bob'}
                    ]
                }
            ];

            await adapter.send(emailData);

            // Should send TWO personalized emails
            sesClient.send.callCount.should.equal(2);

            // Verify To headers (not BCC)
            const call1Args = sesClient.send.getCall(0).args[0];
            const message1 = Buffer.from(call1Args.input.RawMessage.Data).toString();
            message1.should.match(/^To: user1@example\.com$/m);

            const call2Args = sesClient.send.getCall(1).args[0];
            const message2 = Buffer.from(call2Args.input.RawMessage.Data).toString();
            message2.should.match(/^To: user2@example\.com$/m);
        });

        it('should use bulk path when recipients have no replacements', async function () {
            emailData.recipients = [
                {email: 'user1@example.com', replacements: []},
                {email: 'user2@example.com', replacements: []}
            ];

            await adapter.send(emailData);

            // Should send ONE bulk email
            sesClient.send.callCount.should.equal(1);
        });

        it('should use personalized path when email token present', async function () {
            emailData.recipients = [
                {
                    email: 'user1@example.com',
                    replacements: [
                        {id: 'list_unsubscribe', value: 'https://unsubscribe.com'},
                        {id: 'email', value: 'user1@example.com'}
                    ]
                }
            ];

            await adapter.send(emailData);

            // Should send personalized email
            sesClient.send.callCount.should.equal(1);

            const callArgs = sesClient.send.getCall(0).args[0];
            const message = Buffer.from(callArgs.input.RawMessage.Data).toString();
            message.should.match(/^To: user1@example\.com$/m);
        });

        it('should preserve dollar replacement values literally', async function () {
            emailData.html = '<p>%%{name}%%</p>';
            emailData.plaintext = '%%{name}%%';
            emailData.replacementDefinitions = [{id: 'name', token: '%%{name}%%'}];
            emailData.recipients = [
                {
                    email: 'user1@example.com',
                    replacements: [{id: 'name', value: '$& $` $\' $$'}]
                }
            ];

            await adapter.send(emailData);

            const message = SendRawEmailCommand.getCall(0).args[0].RawMessage.Data.toString();
            message.should.containEql('$&=20$`=20$\'=20$$');
        });

        it('should not expose recipient emails in SES tags', async function () {
            emailData.recipients = [{
                email: 'user.name+tag@example.com',
                replacements: [{id: 'name', value: 'Alice'}]
            }];

            await adapter.send(emailData);

            SendRawEmailCommand.getCall(0).args[0].Tags.should.deepEqual([
                {Name: 'email-id', Value: 'test-email-123'}
            ]);
        });
    });
});
