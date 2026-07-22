const should = require('should');
const sinon = require('sinon');
const SESAnalyticsProvider = require('../SESAnalyticsProvider');

describe('SES Analytics Provider', function () {
    let sandbox;
    let sqsClient;
    let SQSClient;

    beforeEach(function () {
        sandbox = sinon.createSandbox();
        sqsClient = {send: sandbox.stub()};

        SQSClient = sandbox.stub().returns(sqsClient);
        const originalLoad = module.constructor._load;
        sandbox.stub(module.constructor, '_load').callsFake(function (request, parent) {
            if (request === '@aws-sdk/client-sqs') {
                return {
                    SQSClient,
                    ReceiveMessageCommand: sandbox.stub().callsFake(input => ({input})),
                    DeleteMessageCommand: sandbox.stub().callsFake(input => ({input}))
                };
            }

            return originalLoad.apply(this, arguments);
        });
    });

    afterEach(function () {
        sandbox.restore();
    });

    function queueMessage(body) {
        sqsClient.send.onFirstCall().resolves({
            Messages: [{
                MessageId: 'sqs-message-1',
                ReceiptHandle: 'receipt-1',
                Body: JSON.stringify(body)
            }]
        });
        sqsClient.send.onThirdCall().resolves({});
    }

    function createProvider() {
        return new SESAnalyticsProvider({
            ses: {
                queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/ghost-events',
                region: 'us-east-1'
            }
        });
    }

    it('uses the default AWS credential chain when credentials are omitted', function () {
        createProvider();

        sinon.assert.calledOnceWithExactly(SQSClient, {region: 'us-east-1'});
    });

    it('uses configured AWS credentials when both are provided', function () {
        new SESAnalyticsProvider({
            ses: {
                queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/ghost-events',
                region: 'us-east-1',
                accessKeyId: 'test-access-key',
                secretAccessKey: 'test-secret-key'
            }
        });

        sinon.assert.calledOnceWithExactly(SQSClient, {
            region: 'us-east-1',
            credentials: {
                accessKeyId: 'test-access-key',
                secretAccessKey: 'test-secret-key'
            }
        });
    });

    it('maps a delivery notification to Ghost analytics events', async function () {
        queueMessage({
            Type: 'Notification',
            Message: JSON.stringify({
                eventType: 'Delivery',
                mail: {
                    messageId: 'ses-message-1',
                    tags: {'email-id': ['ghost-email-1']}
                },
                delivery: {
                    timestamp: '2026-07-22T10:00:00.000Z',
                    recipients: ['member@example.com']
                }
            })
        });

        const provider = createProvider();
        const batchHandler = sinon.stub().resolves();

        await provider.fetchLatest(batchHandler);

        sinon.assert.calledOnceWithExactly(batchHandler, [{
            id: 'sqs-message-1:0',
            type: 'delivered',
            emailId: 'ghost-email-1',
            providerId: 'ses-message-1',
            recipientEmail: 'member@example.com',
            timestamp: new Date('2026-07-22T10:00:00.000Z')
        }]);
        sqsClient.send.callCount.should.equal(3);
    });

    it('maps a bounce notification to a failed event', async function () {
        queueMessage({
            eventType: 'Bounce',
            mail: {
                messageId: 'ses-message-2',
                tags: {'email-id': ['ghost-email-2']}
            },
            bounce: {
                feedbackId: 'bounce-1',
                bounceType: 'Permanent',
                timestamp: '2026-07-22T10:01:00.000Z',
                bouncedRecipients: [{
                    emailAddress: 'member@example.com',
                    status: '5.1.1',
                    diagnosticCode: 'smtp; 550 user unknown'
                }]
            }
        });
        const batchHandler = sinon.stub().resolves();

        await createProvider().fetchLatest(batchHandler);

        sinon.assert.calledOnceWithExactly(batchHandler, [{
            id: 'bounce-1:0',
            type: 'failed',
            severity: 'permanent',
            error: {
                code: '5.1.1',
                message: 'smtp; 550 user unknown',
                enhandedCode: '5.1.1'
            },
            emailId: 'ghost-email-2',
            providerId: 'ses-message-2',
            recipientEmail: 'member@example.com',
            timestamp: new Date('2026-07-22T10:01:00.000Z')
        }]);
    });

    it('maps a complaint notification to a complained event', async function () {
        queueMessage({
            eventType: 'Complaint',
            mail: {
                messageId: 'ses-message-3',
                tags: {'email-id': ['ghost-email-3']}
            },
            complaint: {
                feedbackId: 'complaint-1',
                timestamp: '2026-07-22T10:02:00.000Z',
                complainedRecipients: [{emailAddress: 'member@example.com'}]
            }
        });
        const batchHandler = sinon.stub().resolves();

        await createProvider().fetchLatest(batchHandler);

        sinon.assert.calledOnceWithExactly(batchHandler, [{
            id: 'complaint-1:0',
            type: 'complained',
            emailId: 'ghost-email-3',
            providerId: 'ses-message-3',
            recipientEmail: 'member@example.com',
            timestamp: new Date('2026-07-22T10:02:00.000Z')
        }]);
    });

    it('maps an open notification with one recipient to an opened event', async function () {
        queueMessage({
            eventType: 'Open',
            mail: {
                messageId: 'ses-message-4',
                destination: ['member@example.com'],
                tags: {'email-id': ['ghost-email-4']}
            },
            open: {timestamp: '2026-07-22T10:03:00.000Z'}
        });
        const batchHandler = sinon.stub().resolves();

        await createProvider().fetchLatest(batchHandler);

        sinon.assert.calledOnceWithExactly(batchHandler, [{
            id: 'sqs-message-1:0',
            type: 'opened',
            emailId: 'ghost-email-4',
            providerId: 'ses-message-4',
            recipientEmail: 'member@example.com',
            timestamp: new Date('2026-07-22T10:03:00.000Z')
        }]);
    });

    it('skips an open notification that cannot identify one recipient', async function () {
        queueMessage({
            eventType: 'Open',
            mail: {
                messageId: 'ses-message-4',
                destination: ['first@example.com', 'second@example.com'],
                tags: {'email-id': ['ghost-email-4']}
            },
            open: {timestamp: '2026-07-22T10:03:00.000Z'}
        });
        const batchHandler = sinon.stub().resolves();

        await createProvider().fetchLatest(batchHandler);

        sinon.assert.notCalled(batchHandler);
    });

    it('skips supplementary click notifications without calling the batch handler', async function () {
        queueMessage({
            eventType: 'Click',
            mail: {
                messageId: 'ses-message-5',
                tags: {'email-id': ['ghost-email-5']}
            },
            click: {timestamp: '2026-07-22T10:04:00.000Z'}
        });
        const batchHandler = sinon.stub().resolves();

        await createProvider().fetchLatest(batchHandler);

        sinon.assert.notCalled(batchHandler);
    });

    it('skips malformed messages without calling the batch handler', async function () {
        sqsClient.send.onFirstCall().resolves({
            Messages: [{
                MessageId: 'sqs-message-1',
                ReceiptHandle: 'receipt-1',
                Body: '{not-json'
            }]
        });
        sqsClient.send.onThirdCall().resolves({});
        const batchHandler = sinon.stub().resolves();

        await createProvider().fetchLatest(batchHandler);

        sinon.assert.notCalled(batchHandler);
        sqsClient.send.callCount.should.equal(3);
    });

    it('skips unknown event types without calling the batch handler', async function () {
        queueMessage({
            eventType: 'Send',
            mail: {
                messageId: 'ses-message-6',
                tags: {'email-id': ['ghost-email-6']}
            }
        });
        const batchHandler = sinon.stub().resolves();

        await createProvider().fetchLatest(batchHandler);

        sinon.assert.notCalled(batchHandler);
    });
});
