import { CfnOutput, Stack } from 'aws-cdk-lib'
import type { StackProps } from 'aws-cdk-lib'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as route53 from 'aws-cdk-lib/aws-route53'
import type { Construct } from 'constructs'
import { HOSTED_ZONE_ID, ROOT_DOMAIN, ZONE_NAME } from './config.js'

/**
 * Everything a preview stack must not have to create for itself.
 *
 * Today that is one certificate. Issuing an ACM certificate is the slow,
 * variable part of standing up a distribution — minutes, and occasionally much
 * longer — so every `YahnAppStack-pr-<N>` shares this one rather than waiting
 * for its own. The wildcard covers every single-label preview subdomain
 * (`pr-7.yahn.ty.ler.dev`); the apex entry covers production.
 *
 * Its ARN is hard-coded in `bin/app.ts` rather than exported: a CloudFormation
 * export would couple every preview stack to this one and block deleting a
 * preview while the export is in use.
 */
export class SharedStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props)

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: HOSTED_ZONE_ID,
      zoneName: ZONE_NAME,
    })

    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: ROOT_DOMAIN,
      subjectAlternativeNames: [`*.${ROOT_DOMAIN}`],
      validation: acm.CertificateValidation.fromDns(zone),
    })

    // Read this, then paste it into CERTIFICATE_ARN in bin/app.ts.
    new CfnOutput(this, 'CertificateArn', {
      value: certificate.certificateArn,
    })
  }
}
