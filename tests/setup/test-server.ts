import { createServer } from 'http'
import next from 'next'
import { parse } from 'url'

export async function createTestServer() {
  const app = next({
    dev: false,
    dir: process.cwd(),
  })

  await app.prepare()

  const handle = app.getRequestHandler()

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true)
    handle(req, res, parsedUrl)
  })

  return server
}
