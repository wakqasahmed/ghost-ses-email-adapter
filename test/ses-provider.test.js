const should = require('should');
const sinon = require('sinon');
const SESEmailProvider = require('../');
const EmailProviderBase = require('../EmailProviderBase');

describe('SES Email Provider Adapter', function () {
    let sesClient;
    let errorHandler;
    let sandbox;
    let SendRawEmailCommand;

    beforeEach(function () {
        sandbox = sinon.createSandbox();

        // Mock AWS SDK - SendRawEmailCommand constructor captures input
        SendRawEmailCommand = sandbox.stub().callsFake(function (input) {
            return {input};
        });

        // Mock SES client
        sesClient = {
            send: sandbox.stub().resolves({MessageId: 'test-message-id-123'})
        };

        errorHandler = sandbox.stub();

        // Mock the AWS SDK require
        const mockAwsSdk = {
            SESClient: sandbox.stub().returns(sesClient),
            SendRawEmailCommand
        };

        const originalLoad = module.constructor._load;
        sandbox.stub(module.constructor, '_load').callsFake(function (request, parent) {
            if (request === '@aws-sdk/client-ses') {
                return mockAwsSdk;
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

        it('should have requiredFns array with send', function () {
            const adapter = new SESEmailProvider({
                ses: {
                    region: 'us-east-1',
                    fromEmail: 'test@example.com'
                }
            });

            adapter.requiredFns.should.be.an.Array();
            adapter.requiredFns.should.containEql('send');
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
