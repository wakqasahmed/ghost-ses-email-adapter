# SES analytics setup

This guide sends SES configuration-set events to SNS, then to SQS, for `SESAnalyticsProvider` to consume. Run these steps in the same AWS Region as the configuration set and SQS queue. They are operator instructions only; this package never creates AWS resources.

## Ghost integration status

The current interim Ghost 6.x patch in this repository activates the SES **email** provider only. Stock Ghost 6.x hardcodes its Mailgun analytics provider, and that patch does not add an analytics adapter type. Issue [#5](https://github.com/wakqasahmed/ghost-ses-email-adapter/issues/5) similarly proposes only email-provider wiring.

`SESAnalyticsProvider` implements Ghost's existing analytics-provider contract: `fetchLatest(batchHandler, options)`, passing Ghost batches with `type`, `emailId`, `providerId`, `recipientEmail`, and `timestamp`. It requires a separate, #25252-equivalent analytics adapter-manager wiring change before Ghost can instantiate it from `emailAnalytics.ses` automatically.

Until that exists, SES sending works with the interim email patch, but this poller is not activated by stock Ghost or by issue #5 alone.

## Important accuracy constraint

Ghost identifies an analytics event by both the newsletter `emailId` and the recipient email. SES publishes the `email-id` message tag set by `SESEmailProvider`, so deliveries, bounces, and complaints can be matched. An SES Open record does not itself include a recipient address; the provider accepts it only when `mail.destination` has exactly one recipient. It skips multi-recipient Open records rather than marking every destination as opened.

For reliable per-recipient SES opens and complaints, SES must send one message per recipient. The current `SESEmailProvider` uses BCC bulk sending when a newsletter has no personalization, so a sender change is still needed for complete SES open attribution. Ghost's `/r/` redirect already records link clicks independently; SES Click events are deliberately supplementary and are not sent to Ghost's analytics processor because Ghost has no `clicked` provider event type.

## Console setup

1. In Amazon SQS, create a **Standard** queue in the SES region. Set the receive-message wait time to 20 seconds and visibility timeout to at least 60 seconds. Copy its queue URL and ARN.
2. In Amazon SNS, create a Standard topic in that region. Subscribe the SQS queue to it using the queue ARN. Allow the topic to call `sqs:SendMessage` on that queue (the console can add this queue policy when creating the subscription).
3. In Amazon SES, create a configuration set, for example `ghost-analytics`.
4. Add an SNS event destination to that configuration set. Select the topic from step 2 and select: Delivery, Bounce, Complaint, Open, and Click.
5. Set `adapters.email.ses.configurationSet` to that configuration-set name. SES only publishes events for sends associated with this configuration set.
6. Give the Ghost runtime identity `sqs:ReceiveMessage`, `sqs:DeleteMessage`, and `sqs:GetQueueAttributes` for this one queue. Prefer an IAM role or another AWS SDK default credential source over static keys.

## AWS CLI setup

Set placeholders before running any command. Do not paste production credentials into configuration files or shell history.

```bash
export AWS_REGION=eu-west-1
export TOPIC_NAME=ghost-ses-events
export QUEUE_NAME=ghost-ses-events
export CONFIGURATION_SET=ghost-analytics
```

Create the SNS topic and SQS queue, then fetch their identifiers:

```bash
TOPIC_ARN="$(aws sns create-topic --region "$AWS_REGION" --name "$TOPIC_NAME" --query TopicArn --output text)"
QUEUE_URL="$(aws sqs create-queue --region "$AWS_REGION" --queue-name "$QUEUE_NAME" --attributes ReceiveMessageWaitTimeSeconds=20,VisibilityTimeout=60 --query QueueUrl --output text)"
QUEUE_ARN="$(aws sqs get-queue-attributes --region "$AWS_REGION" --queue-url "$QUEUE_URL" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)"
```

Create `queue-policy.json`, replacing the two placeholders:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {"Service": "sns.amazonaws.com"},
      "Action": "sqs:SendMessage",
      "Resource": "QUEUE_ARN",
      "Condition": {"ArnEquals": {"aws:SourceArn": "TOPIC_ARN"}}
    }
  ]
}
```

Replace `QUEUE_ARN` and `TOPIC_ARN` with their values, then attach it and subscribe the queue:

```bash
aws sqs set-queue-attributes --region "$AWS_REGION" --queue-url "$QUEUE_URL" --attributes Policy="$(cat queue-policy.json)"
aws sns subscribe --region "$AWS_REGION" --topic-arn "$TOPIC_ARN" --protocol sqs --notification-endpoint "$QUEUE_ARN"
```

Create the configuration set and its SNS event destination:

```bash
aws sesv2 create-configuration-set --region "$AWS_REGION" --configuration-set-name "$CONFIGURATION_SET"
aws sesv2 create-configuration-set-event-destination \
  --region "$AWS_REGION" \
  --configuration-set-name "$CONFIGURATION_SET" \
  --event-destination-name ghost-sqs \
  --event-destination '{"Enabled":true,"MatchingEventTypes":["DELIVERY","BOUNCE","COMPLAINT","OPEN","CLICK"],"SnsDestination":{"TopicArn":"'"$TOPIC_ARN"'"}}'
```

## Configuration

Keep the configuration set on the existing email adapter and add the SQS settings at `emailAnalytics.ses`. Static credentials are optional; omitting both allows the AWS SDK default credential provider chain to resolve credentials.

```json
{
  "adapters": {
    "email": {
      "active": "ses",
      "ses": {
        "region": "eu-west-1",
        "fromEmail": "news@example.com",
        "configurationSet": "ghost-analytics"
      }
    }
  },
  "emailAnalytics": {
    "ses": {
      "queueUrl": "https://sqs.eu-west-1.amazonaws.com/123456789012/ghost-ses-events",
      "region": "eu-west-1"
    }
  }
}
```

When analytics adapter wiring is available, configure it to instantiate `SESAnalyticsProvider` with the `emailAnalytics.ses` object. The provider long-polls up to 10 SQS messages for 20 seconds, acknowledges a message only after Ghost accepts its mapped events, and deletes malformed or unsupported messages after logging them so they do not poison the queue.

For a manual end-to-end check after that wiring exists, send to SES mailbox simulator addresses, inspect the SQS queue for the expected event, then confirm Ghost’s newsletter analytics. Use a non-production configuration set and queue for this check.
