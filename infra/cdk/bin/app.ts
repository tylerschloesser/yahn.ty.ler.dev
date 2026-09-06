#!/usr/bin/env node
import { App } from 'aws-cdk-lib'
import { AppStack } from '../lib/app-stack.js'
import { ACCOUNT, REGION, ROOT_DOMAIN } from '../lib/config.js'
import { GithubOidcStack } from '../lib/github-oidc-stack.js'
import { SharedStack } from '../lib/shared-stack.js'

/**
 * The wildcard certificate created by `YahnSharedStack`, hard-coded rather than
 * read from SSM or imported from a CloudFormation export.
 *
 * This is the one place Epoch 2's two-phase bootstrap is visible, and that is
 * the point of putting it here. `YahnSharedStack` has to be deployed and its
 * certificate has to reach `ISSUED` before any `YahnAppStack` can reference it;
 * a token would hide that ordering rather than remove it. An `Fn::ImportValue`
 * would be worse still: it couples every preview stack to the shared one and
 * blocks deleting a preview while the export is in use.
 *
 * Recreating the certificate means editing this line — the same one-line edit
 * an SSM parameter would have needed, minus an untested dynamic-reference path
 * inside CloudFront's `ViewerCertificate`.
 */
const CERTIFICATE_ARN =
  'arn:aws:acm:us-east-1:063257577013:certificate/e9c66fa9-93e2-44c4-9a83-ff63d6f71470'

const env = { account: ACCOUNT, region: REGION }
const app = new App()

new GithubOidcStack(app, 'YahnGithubOidcStack', { env })
new SharedStack(app, 'YahnSharedStack', { env })

new AppStack(app, 'YahnAppStack-prod', {
  env,
  domainName: ROOT_DOMAIN,
  certificateArn: CERTIFICATE_ARN,
  retainData: true,
})

/**
 * Preview stacks are opt-in per synth: `cdk deploy YahnAppStack-pr-7 -c pr=7`.
 *
 * Selecting them by context rather than instantiating a fixed set means the app
 * never has to know which PRs are open, and `cdk destroy` names a stack that is
 * actually in the app — so a typo is an error rather than a no-op. The numeric
 * guard is what makes the stack name unforgeable from a context value.
 */
const pr = app.node.tryGetContext('pr') as unknown
if (pr !== undefined) {
  const n = String(pr)
  if (!/^[0-9]+$/.test(n)) {
    throw new Error(`context 'pr' must be a PR number, got: ${n}`)
  }
  new AppStack(app, `YahnAppStack-pr-${n}`, {
    env,
    domainName: `pr-${n}.${ROOT_DOMAIN}`,
    certificateArn: CERTIFICATE_ARN,
    // A preview's enrichment table is deleted with its stack: `cleanup.yml`
    // removes preview stacks on a cron, and a retained table would pile up
    // invisibly.
    retainData: false,
  })
}
