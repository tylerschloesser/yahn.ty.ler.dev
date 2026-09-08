/**
 * The site's CDK app.
 *
 * Stack *knowledge* — which domain, which zone, which account, how many
 * Lambdas, how they're bundled — lives here and nowhere inside
 * `@tylerschloesser/cdk-core`. `defineSiteStacks()` composes the five stacks
 * (`YahnShared`, `YahnPreview`, `YahnSite`, `YahnGithubOidc`, and
 * `Yahn-pr-<n>` when synthesized with `-c pr=<n>`) out of the same constructs
 * a consumer could wire by hand.
 *
 * `Yahn-pr-<n>` takes no construct reference to `YahnPreview` — it reads the
 * shared preview infrastructure (distribution ARN, KVS ARN, bucket name) from
 * the SSM parameters `YahnPreview` publishes, which is what lets it deploy
 * with `--exclusively` without touching the shared stacks on every PR.
 */

import { fileURLToPath } from 'node:url'
import { App, CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'
import { CachePolicies, defineSiteStacks } from '@tylerschloesser/cdk-core'

const API_ENTRY = fileURLToPath(new URL('../../../apps/api/src/lambda.ts', import.meta.url))
const EVENTS_ENTRY = fileURLToPath(new URL('../../../apps/api/src/lambda-enrich.ts', import.meta.url))
const WEB_DIST = fileURLToPath(new URL('../../../apps/web/dist', import.meta.url))

/**
 * The two backend Lambdas, built identically in `YahnSite` and in every PR
 * stack — a preview running different code would prove nothing about what
 * `main` is about to do. `defineSiteStacks` calls this once per scope and
 * adds the function URL itself, taking `RESPONSE_STREAM` from the `streaming`
 * flag on `backends` below.
 */
function backendFunctions(scope: Construct): Record<string, lambda.Function> {
  // The only prod-versus-preview signal this factory gets: `defineSiteStacks`
  // calls it once for `YahnSite` and once per `Yahn-pr-<n>`, and the stack
  // name is the one thing that differs between those calls.
  const isProd = Stack.of(scope).stackName === 'YahnSite'
  const dataPolicy = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY

  /**
   * Where a generated enrichment lives so it is generated once.
   *
   * `pk=ITEM#<id>` / `sk=ENRICH#<kind>#<generatedAt>#<inputKey>` — see
   * `apps/api/src/enrich/store.ts` and `.claude/rules/api.md` for why that
   * shape and not the two simpler ones that were tried and rejected.
   *
   * On-demand billing because the traffic is one write per new thread version
   * and a handful of reads. A preview's table dies with its stack; prod's is
   * retained because it holds summaries that cost real money to regenerate.
   */
  const table = new dynamodb.TableV2(scope, 'EnrichTable', {
    partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
    billing: dynamodb.Billing.onDemand(),
    timeToLiveAttribute: 'expiresAt',
    removalPolicy: dataPolicy,
  })

  /**
   * Imported by name, never created here and never a plaintext env var — an
   * env var would put the key in the CloudFormation template. `fromSecretNameV2`
   * so rotating the secret needs no redeploy. Deliberately not thai.ler.dev's
   * secret: a shared key would couple two unrelated projects' quota and blast
   * radius.
   */
  const secret = secretsmanager.Secret.fromSecretNameV2(scope, 'AnthropicSecret', 'yahn-ty-ler-dev/anthropic')

  // Explicit and stack-owned, so a PR stack's delete takes its log groups
  // with it. cdk-core's constructs create none of their own, and its
  // sweeper only reclaims implicit `/aws/lambda/<prefix>-pr-*` groups, which
  // these — named by id, not by convention — are not.
  const apiLogs = new logs.LogGroup(scope, 'ApiLogs', {
    retention: isProd ? logs.RetentionDays.TWO_YEARS : logs.RetentionDays.ONE_WEEK,
    removalPolicy: dataPolicy,
  })
  const eventsLogs = new logs.LogGroup(scope, 'EventsLogs', {
    retention: isProd ? logs.RetentionDays.TWO_YEARS : logs.RetentionDays.ONE_WEEK,
    removalPolicy: dataPolicy,
  })

  const api = new NodejsFunction(scope, 'ApiFn', {
    entry: API_ENTRY,
    runtime: lambda.Runtime.NODEJS_24_X,
    architecture: lambda.Architecture.ARM_64,
    handler: 'handler',
    // 512, and 1024 was tried and rejected — see `.claude/rules/cdk.md`. The
    // item endpoint is latency-bound on Firebase, not CPU-bound here, so more
    // vCPU buys about 11% for 74% more GB-ms.
    memorySize: 512,
    timeout: Duration.seconds(30),
    logGroup: apiLogs,
    bundling: {
      target: 'node24',
      // The Node 24 runtime ships AWS SDK v3, so bundling a second copy would
      // cost cold start for nothing. @yahn/hn and @yahn/schema are workspace
      // *source* consumed through `exports` maps, and esbuild must bundle
      // them — so no other externals here, and no `depsLockFilePath`.
      externalModules: ['@aws-sdk/*'],
      sourceMap: true,
    },
    environment: {
      NODE_OPTIONS: '--enable-source-maps',
    },
  })

  const events = new NodejsFunction(scope, 'EventsFn', {
    entry: EVENTS_ENTRY,
    runtime: lambda.Runtime.NODEJS_24_X,
    architecture: lambda.Architecture.ARM_64,
    handler: 'handler',
    // Not inherited from `api`: cost is memory x duration, and this function
    // spends most of its wall clock blocked on a model call, so paying for
    // more vCPU across a stream buys nothing on the part that dominates.
    memorySize: 512,
    // A model call is not a 30s workload, but CloudFront gives up on the
    // origin long before this fires (its `readTimeout` is the real deadline)
    // — this is the outer bound on a stream still making progress, not the SLA.
    timeout: Duration.minutes(5),
    logGroup: eventsLogs,
    bundling: {
      target: 'node24',
      externalModules: ['@aws-sdk/*'],
      sourceMap: true,
    },
    environment: {
      NODE_OPTIONS: '--enable-source-maps',
      ENRICH_TABLE_NAME: table.tableName,
      ANTHROPIC_SECRET_ID: secret.secretName,
      // The only place the real provider is selected. Everywhere else —
      // `pnpm dev`, `pnpm verify`, `pnpm e2e` — it is unset and defaults to
      // `fake`, which is what keeps those three credential-free.
      MODEL_PROVIDER: 'anthropic',
    },
  })

  table.grantReadWriteData(events)
  secret.grantRead(events)

  new CfnOutput(scope, 'EnrichTableName', { value: table.tableName })

  return { api, events }
}

defineSiteStacks(new App(), {
  env: { account: '063257577013', region: 'us-east-1' },
  stackPrefix: 'Yahn',
  domain: 'yahn.ty.ler.dev',
  zone: { hostedZoneId: 'Z038502736IM0QLQT7VFN', zoneName: 'ty.ler.dev' },
  webDist: WEB_DIST,
  // The routing half of the backends contract, shared by the prod and
  // preview distributions so the two cannot disagree about which path is
  // whose. A CloudFront Function cannot change which behavior was selected,
  // so these patterns are also what `apps/web`'s fetches and Vite's dev proxy
  // have to match, and they must not overlap — cdk-core's preview router
  // refuses a prefix of another backend's pattern.
  backends: {
    api: {
      pathPattern: '/api/*',
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      // A factory, not a policy instance, because `backends` is built before
      // any stack exists — `Site` calls this once per backend with itself as
      // scope. The origin decides (`.claude/rules/api.md`); previews ignore
      // it and stay `CACHING_DISABLED`.
      cachePolicy: (scope) => CachePolicies.originDecides(scope),
      // The package hard-codes `compress: false` for every backend. A 718KB
      // item JSON wants brotli, and the policy already keys on
      // `Accept-Encoding`, so this backend overrides it.
      behaviorOverrides: { compress: true },
    },
    // Keeps the package defaults: `ALLOW_ALL` so the POST-through-OAC
    // question stays re-testable without a redeploy, and `compress: false` —
    // measured a no-op on `text/event-stream`, see `.claude/rules/cdk.md`.
    events: { pathPattern: '/events/*', streaming: true },
  },
  functions: backendFunctions,
  // Both prefixes are written out rather than defaulted: they also exist in the
  // Google OAuth client's authorized redirect URIs, where a mismatch is a
  // `redirect_uri_mismatch` at Google with nothing in any AWS log.
  auth: {
    domainPrefix: 'yahn-ty-ler-dev',
    preview: { domainPrefix: 'yahn-ty-ler-dev-preview' },
  },
  github: {
    repo: 'tylerschloesser/yahn.ty.ler.dev',
    roleName: 'yahn-github-deploy',
    ownerId: '2300885',
    repoId: '1358400324',
  },
})
