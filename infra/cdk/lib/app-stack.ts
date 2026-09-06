import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib'
import type { StackProps } from 'aws-cdk-lib'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as targets from 'aws-cdk-lib/aws-route53-targets'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import type { Construct } from 'constructs'
import { HOSTED_ZONE_ID, ZONE_NAME } from './config.js'

interface AppStackProps extends StackProps {
  /** Fully-qualified, e.g. 'yahn.ty.ler.dev' or 'pr-7.yahn.ty.ler.dev'. */
  domainName: string
  /** The shared wildcard cert from YahnSharedStack, hard-coded in bin/app.ts. */
  certificateArn: string
}

export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props)

    const currentDir = dirname(fileURLToPath(import.meta.url))
    const webDist = join(currentDir, '../../../apps/web/dist')

    if (!existsSync(webDist)) {
      throw new Error(
        'apps/web/dist not found — run `pnpm build` first',
      )
    }

    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Both prod and previews: the bucket holds only rebuildable build output.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })

    const apiEntry = join(currentDir, '../../../apps/api/src/lambda.ts')

    // One function, inline in this stack rather than a separate lib/api.ts:
    // there is no DynamoDB table, no worker function and no secret here, and
    // attaching the function URL origin adds a resource policy scoped to the
    // distribution's ARN, so the distribution needs the function — a split
    // would be a dependency cycle.
    const fn = new nodejs.NodejsFunction(this, 'Function', {
      entry: apiEntry,
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'handler',
      // 512, and 1024 was tried and rejected — see `.claude/rules/cdk.md`.
      // The item endpoint is latency-bound on Firebase, not CPU-bound here, so
      // more vCPU buys about 11% for 74% more GB-ms.
      memorySize: 512,
      timeout: Duration.seconds(30),
      bundling: {
        target: 'node24',
        // The Node 24 runtime ships AWS SDK v3; bundling a second copy would
        // cost megabytes of cold start for no benefit.
        //
        // @yahn/hn and @yahn/schema are NOT external — they are workspace
        // *source* consumed through `exports` maps, and esbuild must bundle
        // them, so no depsLockFilePath and no wildcard beyond @aws-sdk here.
        externalModules: ['@aws-sdk/*'],
        sourceMap: true,
      },
      environment: {
        // Makes the bundled source maps show up in stack traces.
        NODE_OPTIONS: '--enable-source-maps',
      },
    })

    // AWS_IAM, not NONE: the only caller is CloudFront's origin access
    // control, which signs each origin request with SigV4. Hitting the
    // function URL directly returns 403.
    const fnUrl = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    })

    // The enrichment function. A second function rather than a second route on
    // the first, because `invokeMode` is a property of the function URL and is
    // **fixed at creation** — a buffered URL cannot be promoted to a streaming
    // one, it has to be replaced.
    //
    // Memory is deliberately NOT inherited from the read function: cost is
    // memory x duration, and this one spends most of its wall clock blocked on
    // a model call, so paying for more vCPU across a 60s stream buys nothing on
    // the part that dominates. See `.claude/rules/cdk.md`.
    const enrichFn = new nodejs.NodejsFunction(this, 'EnrichFunction', {
      entry: join(currentDir, '../../../apps/api/src/lambda-enrich.ts'),
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'handler',
      memorySize: 512,
      // A model call is not a 30s workload. CloudFront gives up on the origin
      // long before this fires (see `readTimeout` below), so this is the outer
      // bound on a stream that is still making progress, not the SLA.
      timeout: Duration.minutes(5),
      bundling: {
        target: 'node24',
        externalModules: ['@aws-sdk/*'],
        sourceMap: true,
      },
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
      },
    })

    const enrichFnUrl = enrichFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    })

    // Imported, not created: this is the shared wildcard cert from
    // YahnSharedStack, so preview stacks never wait on issuance.
    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'Certificate',
      props.certificateArn,
    )

    // Client-side routes are rewritten to index.html here rather than through
    // distribution-wide `errorResponses`, because those apply to *every*
    // behavior — a 403 or 404 from `/api/*` would come back as the HTML shell
    // with status 200. This is scoped to the default behavior, and only
    // rewrites extensionless paths, so a genuinely missing asset still 404s
    // instead of silently returning HTML.
    const spaFallback = new cloudfront.Function(this, 'SpaFallback', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request
  var uri = request.uri
  if (uri.indexOf('.') === -1) {
    request.uri = '/index.html'
  }
  return request
}
`),
    })

    // The origin decides: handlers send `public, max-age=30,
    // stale-while-revalidate=300` on feeds, `max-age=60` on items, and
    // `no-store` on every non-2xx. `defaultTtl: 0` is what makes CloudFront
    // honor that rather than override it, and `maxTtl` is the ceiling on an
    // origin that misbehaves. This is the deliberate difference from a plain
    // site stack, which would use CACHING_DISABLED here.
    const apiCachePolicy = new cloudfront.CachePolicy(this, 'ApiCachePolicy', {
      minTtl: Duration.seconds(0),
      defaultTtl: Duration.seconds(0),
      maxTtl: Duration.minutes(5),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
    })

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      additionalBehaviors: {
        // Ordered before `/api/*`: CloudFront matches the most specific path
        // pattern, but keeping the pair adjacent and specific-first is what
        // makes the split legible.
        //
        // `CACHING_DISABLED`, because a stream has nothing to cache and a
        // cached SSE body would be served to the next viewer as a replay.
        // `ALLOW_ALL` so the method is not the thing that decides the request
        // shape — whether a body survives origin access control's SigV4
        // signing is measured, not assumed.
        //
        // `compress: false` is a hypothesis under test, not a settled fact:
        // gzip wants a complete body and buffering is precisely what streaming
        // must avoid. `/api/v1/spike-compressed/*` below is the same origin
        // with `compress: true`, so one deploy answers it.
        '/api/v1/enrich/*': {
          origin: origins.FunctionUrlOrigin.withOriginAccessControl(enrichFnUrl, {
            // The time CloudFront waits for the first origin byte *and* between
            // subsequent packets. 60s is the ceiling without a quota increase,
            // so a stream that goes quiet for longer than this is cut off at
            // the edge no matter what the Lambda timeout says — which is why
            // the producer has to emit keepalives while the model thinks.
            readTimeout: Duration.seconds(60),
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          compress: false,
        },
        // TEMPORARY, for the Epoch 4 streaming spike only: identical to the
        // behavior above except `compress: true`, so both can be measured
        // against the same deployed origin in one preview rather than two.
        // Delete once the compression question is recorded in cdk.md.
        '/api/v1/spike-compressed/*': {
          origin: origins.FunctionUrlOrigin.withOriginAccessControl(enrichFnUrl, {
            readTimeout: Duration.seconds(60),
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          compress: true,
        },
        '/api/*': {
          origin: origins.FunctionUrlOrigin.withOriginAccessControl(fnUrl),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: apiCachePolicy,
          // Must exclude `host` and *only* `host`.
          //
          // Origin access control signs each origin request with SigV4 over
          // the Lambda function URL's hostname, so forwarding the viewer's
          // domain would invalidate the signature. But the deny list is
          // applied to the final outbound header set — which by then includes
          // the `Authorization` header OAC itself just added. Denying
          // `authorization` here strips CloudFront's own signature and the
          // function URL answers 403 without ever invoking the function.
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          compress: true,
        },
      },
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        functionAssociations: [
          {
            function: spaFallback,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      domainNames: [props.domainName],
      certificate,
      defaultRootObject: 'index.html',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      enableIpv6: true,
    })

    // `FunctionUrlOrigin.withOriginAccessControl` grants only
    // `lambda:InvokeFunctionUrl`. Since around October 2025 Lambda also
    // requires `lambda:InvokeFunction` on new function URLs, and without it
    // every request through CloudFront is answered 403 by the function URL's
    // auth layer — before the function is ever invoked, so nothing appears in
    // its logs. See aws/aws-cdk#35872.
    fn.addPermission('AllowCloudFrontInvokeFunction', {
      principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
    })

    // Same grant, same reason, for the streaming function. Omitting it fails
    // exactly the same way: 403 from the function URL's auth layer, and
    // nothing whatsoever in the function's logs.
    enrichFn.addPermission('AllowCloudFrontInvokeFunction', {
      principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
    })

    const source = s3deploy.Source.asset(webDist)

    // Files whose names are stable across builds, so they can never be cached
    // hard. There is no service worker here, so this is just the HTML shell.
    const UNVERSIONED = ['*.html']

    const deployAssets = new s3deploy.BucketDeployment(this, 'DeployAssets', {
      sources: [source],
      destinationBucket: bucket,
      exclude: UNVERSIONED,
      prune: true,
      cacheControl: [
        s3deploy.CacheControl.setPublic(),
        s3deploy.CacheControl.maxAge(Duration.days(365)),
        s3deploy.CacheControl.immutable(),
      ],
    })

    const deployHtml = new s3deploy.BucketDeployment(this, 'DeployHtml', {
      sources: [source],
      destinationBucket: bucket,
      exclude: ['*'],
      include: UNVERSIONED,
      // Not optional: `true` would delete every hashed asset the deployment
      // above just uploaded, since this deployment only includes HTML.
      prune: false,
      cacheControl: [s3deploy.CacheControl.noCache()],
      distribution,
      distributionPaths: ['/*'],
    })

    deployHtml.node.addDependency(deployAssets)

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: HOSTED_ZONE_ID,
      zoneName: ZONE_NAME,
    })

    // CDK appends the zone name to a non-absolute `recordName`, so the record
    // name is `props.domainName` with the zone suffix stripped — e.g. `yahn`
    // or `pr-7.yahn` for zone `ty.ler.dev`.
    if (!props.domainName.endsWith(`.${ZONE_NAME}`)) {
      throw new Error(
        `domainName ${props.domainName} is not inside the hosted zone ${ZONE_NAME}`,
      )
    }
    const recordName = props.domainName.slice(0, -(ZONE_NAME.length + 1))

    const target = route53.RecordTarget.fromAlias(
      new targets.CloudFrontTarget(distribution),
    )

    new route53.ARecord(this, 'ARecord', {
      recordName,
      zone,
      target,
    })

    new route53.AaaaRecord(this, 'AaaaRecord', {
      recordName,
      zone,
      target,
    })

    new CfnOutput(this, 'SiteUrl', { value: `https://${props.domainName}` })
    new CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
    })
    new CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName,
    })
    new CfnOutput(this, 'BucketName', { value: bucket.bucketName })
    new CfnOutput(this, 'EnrichFunctionName', { value: enrichFn.functionName })
  }
}
