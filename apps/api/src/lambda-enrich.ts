import { streamHandle } from 'hono/aws-lambda'
import { createEnrichApp } from './enrich/app.ts'

/**
 * `streamHandle`, not `handle`. It wraps the app in
 * `awslambda.streamifyResponse` and pipes the `Response` body to the Lambda
 * response stream, so the same Hono primitives the read API uses work here —
 * no hand-rolled `streamifyResponse`.
 *
 * `awslambda` is a global the Lambda runtime injects, so this module is only
 * ever loaded there. `src/server.ts` reaches `createEnrichApp()` directly.
 */
export const handler = streamHandle(createEnrichApp())
