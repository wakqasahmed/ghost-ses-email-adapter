require('should');
const sinon = require('sinon');
const SESSuppressionProvider = require('../SESSuppressionProvider');

describe('SES Suppression Provider', function () {
    let sandbox;
    let sesClient;
    let SESv2Client;

    beforeEach(function () {
        sandbox = sinon.createSandbox();
        sesClient = {send: sandbox.stub()};
        SESv2Client = sandbox.stub().returns(sesClient);
        const originalLoad = module.constructor._load;

        sandbox.stub(module.constructor, '_load').callsFake(function (request, parent) {
            if (request === '@aws-sdk/client-sesv2') {
                return {
                    SESv2Client,
                    GetSuppressedDestinationCommand: sandbox.stub().callsFake(input => ({input})),
                    DeleteSuppressedDestinationCommand: sandbox.stub().callsFake(input => ({input}))
                };
            }

            return originalLoad.apply(this, arguments);
        });
    });

    afterEach(function () {
        sandbox.restore();
    });

    function createProvider() {
        return new SESSuppressionProvider({ses: {region: 'us-east-1'}});
    }

    it('requires a region', function () {
        (() => new SESSuppressionProvider({})).should.throw('SES suppression adapter requires region in configuration');
    });

    it('uses the default AWS credential chain when credentials are omitted', function () {
        createProvider();
        sinon.assert.calledOnceWithExactly(SESv2Client, {region: 'us-east-1'});
    });

    it('uses configured AWS credentials when both are provided', function () {
        new SESSuppressionProvider({
            region: 'us-east-1',
            accessKeyId: 'test-access-key',
            secretAccessKey: 'test-secret-key'
        });

        sinon.assert.calledOnceWithExactly(SESv2Client, {
            region: 'us-east-1',
            credentials: {accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key'}
        });
    });

    it('declares Ghost suppression adapter methods', function () {
        createProvider().requiredFns.should.deepEqual(['getSuppressionData', 'getBulkSuppressionData', 'removeEmail']);
    });

    it('maps a bounce suppression to a failed delivery', async function () {
        sesClient.send.resolves({
            SuppressedDestination: {
                Reason: 'BOUNCE',
                LastUpdateTime: new Date('2026-07-23T10:00:00.000Z')
            }
        });

        const result = await createProvider().getSuppressionData('member@example.com');

        result.should.deepEqual({
            suppressed: true,
            info: {reason: 'fail', timestamp: new Date('2026-07-23T10:00:00.000Z')}
        });
        sinon.assert.calledOnceWithExactly(sesClient.send, {input: {EmailAddress: 'member@example.com'}});
    });

    it('maps a complaint suppression to spam', async function () {
        sesClient.send.resolves({
            SuppressedDestination: {Reason: 'COMPLAINT', LastUpdateTime: new Date('2026-07-23T10:00:00.000Z')}
        });

        const result = await createProvider().getSuppressionData('member@example.com');

        result.info.reason.should.equal('spam');
    });

    it('returns unsuppressed when SES has no destination', async function () {
        sesClient.send.rejects({name: 'NotFoundException'});

        const result = await createProvider().getSuppressionData('member@example.com');

        result.should.deepEqual({suppressed: false, info: null});
    });

    it('propagates SES lookup failures instead of treating them as unsuppressed', async function () {
        const error = new Error('Access denied');
        error.name = 'AccessDeniedException';
        sesClient.send.rejects(error);

        await createProvider().getSuppressionData('member@example.com').should.be.rejectedWith(error);
    });

    it('returns results in input order for bulk lookups', async function () {
        sesClient.send.onFirstCall().resolves({SuppressedDestination: {Reason: 'BOUNCE'}});
        sesClient.send.onSecondCall().rejects({name: 'NotFoundException'});

        const result = await createProvider().getBulkSuppressionData(['bounce@example.com', 'clear@example.com']);

        result.should.deepEqual([{suppressed: true, info: {reason: 'fail', timestamp: undefined}}, {suppressed: false, info: null}]);
    });

    it('removes a suppressed destination', async function () {
        sesClient.send.resolves({});

        const result = await createProvider().removeEmail('member@example.com');

        result.should.equal(true);
        sinon.assert.calledOnceWithExactly(sesClient.send, {input: {EmailAddress: 'member@example.com'}});
    });

    it('returns false when removing a missing or inaccessible destination', async function () {
        sesClient.send.rejects({name: 'NotFoundException'});
        (await createProvider().removeEmail('member@example.com')).should.equal(false);
    });
});
