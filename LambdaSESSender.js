const MAX_REQUEST_PAYLOAD_BYTES = 6 * 1024 * 1024;

class LambdaSESSender {
    #lambdaClient;
    #functionName;

    constructor(sesConfig) {
        const {LambdaClient} = require('@aws-sdk/client-lambda');
        const clientConfig = {region: sesConfig.lambda.region || sesConfig.region};

        if (sesConfig.accessKeyId && sesConfig.secretAccessKey) {
            clientConfig.credentials = {
                accessKeyId: sesConfig.accessKeyId,
                secretAccessKey: sesConfig.secretAccessKey
            };
        }

        this.#lambdaClient = new LambdaClient(clientConfig);
        this.#functionName = sesConfig.lambda.functionName;
    }

    async sendRawEmail({source, destinations, rawMessage, configurationSetName, tags}) {
        const {InvokeCommand} = require('@aws-sdk/client-lambda');
        const payload = Buffer.from(JSON.stringify({
            source,
            destinations,
            rawMessage: rawMessage.toString('base64'),
            configurationSetName,
            tags
        }));

        if (payload.length > MAX_REQUEST_PAYLOAD_BYTES) {
            throw new Error('Lambda RequestResponse payload exceeds the 6 MB limit');
        }

        const response = await this.#lambdaClient.send(new InvokeCommand({
            FunctionName: this.#functionName,
            InvocationType: 'RequestResponse',
            Payload: payload
        }));

        const responsePayload = Buffer.from(response.Payload || []).toString();
        const result = responsePayload ? JSON.parse(responsePayload) : {};

        if (response.FunctionError) {
            const error = new Error(result.errorMessage || result.message || 'Lambda SES sender failed');
            error.name = result.errorType || response.FunctionError;
            error.code = result.code;
            error.$metadata = {httpStatusCode: result.statusCode || response.$metadata?.httpStatusCode};
            throw error;
        }

        return {messageId: result.messageId};
    }
}

module.exports = LambdaSESSender;
