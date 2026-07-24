# Lambda send transport

Use this transport when Ghost must not have direct SES permissions, such as when SES is managed in a shared AWS account. Ghost invokes one Lambda function; that function's execution role sends through SES.

## Deploy the reference handler

Copy [`examples/lambda-ses-sender/index.js`](../examples/lambda-ses-sender/index.js) into a Node.js 20 Lambda deployment package and install its dependency:

```bash
npm install @aws-sdk/client-ses
```

Set the Lambda handler to `index.handler` and deploy it in the SES region. The handler returns SES's `MessageId`; when SES rejects a send, it rethrows the error with a `[ses code=... status=...]` suffix on the message. That suffix matters: the Lambda runtime serializes only an error's type and message, and the adapter parses the suffix to restore the SES error code and HTTP status (without it, failures are reported with status 500). A custom handler must preserve this contract — and must return `{messageId}` on success, or the adapter treats the send as failed.

## Grant the two IAM permissions

Give the Ghost runtime role permission to invoke only this function:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "lambda:InvokeFunction",
    "Resource": "arn:aws:lambda:eu-west-1:123456789012:function:ghost-ses-sender"
  }]
}
```

Give the Lambda execution role permission to send from the verified identity:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "ses:SendRawEmail",
    "Resource": "arn:aws:ses:eu-west-1:123456789012:identity/news@example.com",
    "Condition": {
      "StringEquals": {
        "ses:FromAddress": "news@example.com"
      }
    }
  }]
}
```

`ses:SendRawEmail` does not support IAM configuration-set restrictions. If a configuration set must be fixed, set `CONFIGURATION_SET=ghost-track-open-and-click` on the reference Lambda; its built-in guard rejects other configuration sets before calling SES.

For a cross-account function, also add a resource-based policy to the Lambda function that allows the Ghost runtime role to invoke it.

## Configure Ghost

Set `transport` to `lambda`; `lambda.region` is optional and otherwise uses `ses.region`.

```json
{
  "adapters": {
    "email": {
      "active": "ses",
      "ses": {
        "region": "eu-west-1",
        "fromEmail": "news@example.com",
        "transport": "lambda",
        "lambda": {
          "functionName": "arn:aws:lambda:eu-west-1:123456789012:function:ghost-ses-sender"
        }
      }
    }
  }
}
```

Credentials are optional. If `accessKeyId` and `secretAccessKey` are omitted, the Lambda client uses the AWS SDK default credential provider chain.

## Verify

Send a test newsletter to an SES mailbox simulator address. Confirm that Ghost records the returned provider MessageId and that CloudWatch logs show one Lambda invocation. Test with a non-production configuration set first.
