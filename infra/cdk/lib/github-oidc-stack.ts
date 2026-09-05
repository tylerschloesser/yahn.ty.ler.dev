import { CfnOutput, Duration, Stack } from 'aws-cdk-lib'
import type { StackProps } from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import type { Construct } from 'constructs'

/**
 * The trust GitHub Actions assumes to deploy this repo.
 *
 * Deployed **locally, once, and never from CI**: this is the stack that grants
 * CI its own credentials, so a workflow that deployed it would have to already
 * hold them.
 */
export class GithubOidcStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props)

    // Imported, never created. Exactly one GitHub OIDC provider can exist per
    // account and this one already does — ThaiLerDevGithubOidcStack made it.
    // `new iam.OpenIdConnectProvider(...)` here fails the first deploy with
    // "provider with this URL already exists".
    const providerArn = `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`

    const role = new iam.Role(this, 'GithubDeployRole', {
      roleName: 'yahn-ty-ler-dev-github-deploy',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(providerArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        // Both `sub` forms, because which one GitHub emits is a property of the
        // repo, not of this policy: repos created after 2026-07-15 get the
        // immutable `owner@<ownerId>/<repo>@<repoId>` form, and the legacy form
        // is what every older repo and most documentation still shows. Keeping
        // both means the trust survives GitHub flipping the default either way.
        //
        // `pull_request` is here so pr-preview.yml can deploy a preview stack.
        // A PR from a fork still gets nothing: GitHub refuses `id-token: write`
        // to fork PRs, so the workflow cannot mint a token to present at all.
        StringLike: {
          'token.actions.githubusercontent.com:sub': [
            'repo:tylerschloesser@2300885/yahn.ty.ler.dev@1358400324:ref:refs/heads/main',
            'repo:tylerschloesser@2300885/yahn.ty.ler.dev@1358400324:pull_request',
            'repo:tylerschloesser/yahn.ty.ler.dev:ref:refs/heads/main',
            'repo:tylerschloesser/yahn.ty.ler.dev:pull_request',
          ],
        },
      }),
    })

    // The role's only power is to become the CDK bootstrap roles. Every actual
    // permission — S3, CloudFront, Lambda, Route53 — belongs to those, so this
    // role grants nothing on its own and needs no revision when a stack grows.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [
          `arn:aws:iam::${this.account}:role/cdk-hnb659fds-*-${this.account}-${this.region}`,
        ],
      }),
    )

    // The exception to "only sts:AssumeRole", and the reason it is worth making
    // one. `cleanup.yml` sweeps up preview stacks whose PR has closed, and it
    // talks to CloudFormation *directly* rather than through CDK — the stack
    // list comes from AWS, not from the app, so there is nothing to synthesize
    // against. Direct calls run as this role, which otherwise cannot see a
    // stack at all.
    //
    // Scoping `DeleteStack` to `YahnAppStack-pr-*` makes IAM enforce what the
    // workflow's prefix filter and `^[0-9]+$` guard merely assert. A bug in
    // that shell loop — or a rewrite of it — still cannot reach
    // `YahnAppStack-prod`, `ThaiLerDevSiteStack`, or `CDKToolkit`. That is the
    // guard worth having, because it is the one that cannot be edited away by
    // someone touching only the workflow.
    //
    // `ListStacks` supports no resource-level permissions, hence the `*`; it is
    // read-only and returns names, which is exactly what the sweep needs.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudformation:ListStacks'],
        resources: ['*'],
      }),
    )

    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudformation:DescribeStacks', 'cloudformation:DeleteStack'],
        resources: [
          `arn:aws:cloudformation:${this.region}:${this.account}:stack/YahnAppStack-pr-*`,
        ],
      }),
    )

    new CfnOutput(this, 'GithubDeployRoleArn', { value: role.roleArn })
  }
}
