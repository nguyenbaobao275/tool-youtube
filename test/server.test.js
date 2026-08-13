import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

let baseUrl
let server
let tempDir
let helpers

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shortflow-test-'))
  process.env.NODE_ENV = 'test'
  process.env.SHORTFLOW_DATA_DIR = tempDir
  helpers = await import('../server/index.js')
  await new Promise(resolve => {
    server = helpers.app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`
      resolve()
    })
  })
})

after(async () => {
  await new Promise(resolve => server.close(resolve))
  await fs.rm(tempDir, { recursive: true, force: true })
})

test('normalizeStore removes invalid entries and repairs active channel', () => {
  const valid = { channel: { id: 'UC1', title: 'One' }, token: { access_token: 'x' } }
  assert.deepEqual(helpers.normalizeStore({ activeId: 'missing', items: [valid, {}, null] }), {
    version: 1,
    activeId: 'UC1',
    items: [valid],
  })
})

test('analytics table helpers keep Shorts rows and sum metrics', () => {
  const report = {
    columnHeaders: [{ name: 'creatorContentType' }, { name: 'views' }],
    rows: [['SHORTS', 12], ['VIDEO_ON_DEMAND', 5], ['SHORTS', 8]],
  }
  const rows = helpers.shortsRows(report)
  assert.equal(rows.length, 2)
  assert.deepEqual(helpers.sumRows(rows, ['views']), { views: 20 })
})

test('connection store writes atomically and can replace an existing file', async () => {
  const first = { version: 1, activeId: 'UC1', items: [{ channel: { id: 'UC1', title: 'One' }, token: { access_token: 'one' } }] }
  const second = { version: 1, activeId: 'UC2', items: [{ channel: { id: 'UC2', title: 'Two' }, token: { access_token: 'two' } }] }
  await helpers.writeConnections(first)
  await helpers.writeConnections(second)
  assert.deepEqual(await helpers.readConnections(), second)
})

test('health endpoint is local-safe and returns JSON', async () => {
  const response = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'http://localhost:5173' } })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.match(response.headers.get('content-type'), /application\/json/)
  assert.equal((await response.json()).ok, true)
})

test('mutating requests reject foreign origins', async () => {
  const response = await fetch(`${baseUrl}/api/setup/google`, {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: 'x', clientSecret: 'y' }),
  })
  assert.equal(response.status, 403)
  assert.equal((await response.json()).error, 'Origin không được phép.')
})

test('malformed JSON returns a JSON error', async () => {
  const response = await fetch(`${baseUrl}/api/setup/google`, {
    method: 'POST',
    headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
    body: '{bad json',
  })
  assert.equal(response.status, 400)
  assert.match(response.headers.get('content-type'), /application\/json/)
  assert.equal((await response.json()).error, 'JSON không hợp lệ.')
})

test('upload metadata validator accepts explicit safe declarations', () => {
  const result = helpers.validateUploadMetadata({
    title: 'A useful Short',
    description: 'Original content',
    tags: 'shorts, english',
    defaultLanguage: 'en-US',
    selfDeclaredMadeForKids: 'false',
    containsSyntheticMedia: 'true',
    privacyStatus: 'private',
  })
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.value.tags, ['shorts', 'english'])
  assert.equal(result.value.selfDeclaredMadeForKids, false)
  assert.equal(result.value.containsSyntheticMedia, true)
})

test('upload metadata validator accepts a future schedule only with private visibility', () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const base = {
    title: 'Scheduled Short',
    selfDeclaredMadeForKids: 'false',
    containsSyntheticMedia: 'false',
    publishAt: future,
  }
  const valid = helpers.validateUploadMetadata({ ...base, privacyStatus: 'private' })
  assert.deepEqual(valid.errors, [])
  assert.equal(valid.value.publishAt, future)

  const publicSchedule = helpers.validateUploadMetadata({ ...base, privacyStatus: 'public' })
  assert.match(publicSchedule.errors.join(' '), /Private/)
})

test('upload metadata validator rejects a schedule in the past', () => {
  const result = helpers.validateUploadMetadata({
    title: 'Past Short',
    selfDeclaredMadeForKids: 'false',
    containsSyntheticMedia: 'false',
    privacyStatus: 'private',
    publishAt: new Date(Date.now() - 60_000).toISOString(),
  })
  assert.match(result.errors.join(' '), /ít nhất 1 phút/)
})

test('upload metadata validator rejects missing declarations, privacy and oversized title', () => {
  const result = helpers.validateUploadMetadata({ title: 'x'.repeat(101) })
  assert.equal(result.errors.length, 4)
  assert.match(result.errors.join(' '), /Tiêu đề/)
  assert.match(result.errors.join(' '), /trẻ em/)
  assert.match(result.errors.join(' '), /tổng hợp/)
  assert.match(result.errors.join(' '), /hiển thị/)
})

test('upload endpoint rejects a request without a connected channel', async () => {
  const form = new FormData()
  form.append('channelId', 'UC-missing')
  form.append('title', 'A safe title')
  form.append('selfDeclaredMadeForKids', 'false')
  form.append('containsSyntheticMedia', 'false')
  form.append('privacyStatus', 'private')
  const response = await fetch(`${baseUrl}/api/uploads`, {
    method: 'POST',
    headers: { Origin: 'http://localhost:5173' },
    body: form,
  })
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /chọn file|Kênh chưa được kết nối/i)
})
