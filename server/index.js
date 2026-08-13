import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { Transform } from 'node:stream'
import express from 'express'
import { google } from 'googleapis'
import multer from 'multer'

const app = express()
const port = Number(process.env.PORT || 8787)
const host = process.env.HOST || '127.0.0.1'
const appOrigin = process.env.APP_ORIGIN || 'http://localhost:5173'
const dataDir = path.resolve(process.env.SHORTFLOW_DATA_DIR || '.data')
const tokenPath = path.join(dataDir, 'google-token.json')
const connectionsPath = path.join(dataDir, 'youtube-connections.json')
const oauthConfigPath = path.join(dataDir, 'google-oauth.json')
const uploadsDir = path.join(dataDir, 'uploads')
const oauthStates = new Map()
const overviewCache = new Map()
const scheduleCache = new Map()
const uploadJobs = new Map()
let storageQueue = Promise.resolve()
let uploadQueue = Promise.resolve()
let localOAuthConfig = {}

const READ_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
]
const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload'
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 2 * 1024 * 1024 * 1024)
const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'])

await fs.mkdir(uploadsDir, { recursive: true })

const uploadMiddleware = multer({
  dest: uploadsDir,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 12 },
  fileFilter: (_req, file, callback) => callback(null, VIDEO_MIME_TYPES.has(file.mimetype)),
})

function scopesOf(connection) {
  return new Set([
    ...(Array.isArray(connection?.scopes) ? connection.scopes : []),
    ...String(connection?.token?.scope || '').split(/\s+/),
  ].filter(Boolean))
}

function canUpload(connection) {
  return scopesOf(connection).has(UPLOAD_SCOPE)
}

function parseBoolean(value) {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return null
}

function validateUploadMetadata(body = {}) {
  const title = String(body.title || '').trim()
  const description = String(body.description || '').trim()
  const defaultLanguage = String(body.defaultLanguage || '').trim()
  const tags = String(body.tags || '').split(',').map(tag => tag.trim()).filter(Boolean)
  const selfDeclaredMadeForKids = parseBoolean(body.selfDeclaredMadeForKids)
  const containsSyntheticMedia = parseBoolean(body.containsSyntheticMedia)
  const privacyStatus = ['private', 'unlisted', 'public'].includes(body.privacyStatus) ? body.privacyStatus : null
  const requestedPublishAt = String(body.publishAt || '').trim()
  const publishDate = requestedPublishAt ? new Date(requestedPublishAt) : null
  const publishAt = publishDate && !Number.isNaN(publishDate.getTime()) ? publishDate.toISOString() : null
  const errors = []
  if (!title || title.length > 100) errors.push('Tiêu đề phải có từ 1 đến 100 ký tự.')
  if (description.length > 5000) errors.push('Mô tả không được vượt quá 5.000 ký tự.')
  if (tags.join(',').length > 450) errors.push('Tổng độ dài thẻ tag không được vượt quá 450 ký tự.')
  if (defaultLanguage && !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(defaultLanguage)) errors.push('Mã ngôn ngữ không hợp lệ.')
  if (selfDeclaredMadeForKids === null) errors.push('Bạn phải chọn video có dành cho trẻ em hay không.')
  if (containsSyntheticMedia === null) errors.push('Bạn phải khai báo nội dung tổng hợp/AI.')
  if (!privacyStatus) errors.push('Chế độ hiển thị video không hợp lệ.')
  if (requestedPublishAt && !publishAt) errors.push('Ngày giờ hẹn đăng không hợp lệ.')
  if (publishAt && privacyStatus !== 'private') errors.push('Video hẹn giờ phải được tải lên ở chế độ Private.')
  if (publishAt && publishDate.getTime() <= Date.now() + 60_000) errors.push('Thời gian hẹn đăng phải cách hiện tại ít nhất 1 phút.')
  return { errors, value: { title, description, defaultLanguage, tags, selfDeclaredMadeForKids, containsSyntheticMedia, privacyStatus, publishAt } }
}

function publicUploadJob(job) {
  const safe = { ...job }
  delete safe.tempPath
  return safe
}

function updateUploadProgress(job, uploadedBytes) {
  job.uploadedBytes = Math.min(uploadedBytes, job.size)
  job.progress = job.size ? Math.min(99, Math.round(job.uploadedBytes / job.size * 100)) : 0
  job.updatedAt = new Date().toISOString()
}

async function processUpload(job, metadata) {
  job.status = 'uploading'
  job.updatedAt = new Date().toISOString()
  try {
    const auth = await authorizedClient(job.channelId)
    if (!auth) throw new Error('Kênh đã bị ngắt kết nối.')
    const youtube = google.youtube({ version: 'v3', auth })
    let uploadedBytes = 0
    const progressStream = new Transform({
      transform(chunk, _encoding, callback) {
        uploadedBytes += chunk.length
        updateUploadProgress(job, uploadedBytes)
        callback(null, chunk)
      },
    })
    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      notifySubscribers: false,
      requestBody: {
        snippet: {
          title: metadata.title,
          description: metadata.description,
          tags: metadata.tags.length ? metadata.tags : undefined,
          categoryId: '22',
          defaultLanguage: metadata.defaultLanguage || undefined,
        },
        status: {
          privacyStatus: metadata.privacyStatus,
          publishAt: metadata.publishAt || undefined,
          selfDeclaredMadeForKids: metadata.selfDeclaredMadeForKids,
          containsSyntheticMedia: metadata.containsSyntheticMedia,
        },
      },
      media: {
        mimeType: job.mimeType,
        body: createReadStream(job.tempPath).pipe(progressStream),
      },
    })
    if (!response.data.id) throw new Error('YouTube không trả về mã video.')
    job.status = 'uploaded'
    job.progress = 100
    job.uploadedBytes = job.size
    job.videoId = response.data.id
    job.youtubeUrl = `https://youtu.be/${response.data.id}`
    job.studioUrl = `https://studio.youtube.com/video/${response.data.id}/edit`
    job.privacyStatus = response.data.status?.privacyStatus || metadata.privacyStatus
    job.publishAt = response.data.status?.publishAt || undefined
    if (metadata.publishAt && !job.publishAt) {
      job.warning = 'YouTube đã nhận video nhưng không xác nhận lịch đăng. Hãy kiểm tra lại trong Studio.'
    }
    job.updatedAt = new Date().toISOString()
    overviewCache.delete(job.channelId)
    scheduleCache.delete(job.channelId)
  } catch (error) {
    console.error('YouTube upload failed:', error.message)
    job.status = 'failed'
    job.error = error?.response?.data?.error?.message || error.message || 'Không thể tải video lên YouTube.'
    job.updatedAt = new Date().toISOString()
  } finally {
    try { await fs.unlink(job.tempPath) } catch { /* temporary file already removed */ }
    delete job.tempPath
  }
}

function receiveVideo(req, res, next) {
  uploadMiddleware.single('video')(req, res, error => {
    if (!error) return next()
    error.status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    next(error)
  })
}

async function hasRecognizedVideoSignature(file) {
  if (!file?.path) return false
  const handle = await fs.open(file.path, 'r')
  try {
    const header = Buffer.alloc(16)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    if (bytesRead < 4) return false
    const isIsoMedia = bytesRead >= 8 && header.subarray(4, 8).toString('ascii') === 'ftyp'
    const isEbml = header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3
    return isIsoMedia || isEbml
  } finally {
    await handle.close()
  }
}

try { localOAuthConfig = JSON.parse(await fs.readFile(oauthConfigPath, 'utf8')) } catch { /* configured later */ }

app.disable('x-powered-by')
app.use(express.json({ limit: '32kb' }))
app.use((req, res, next) => {
  const origin = req.headers.origin
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cache-Control', 'no-store')
  if (origin === appOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  }
  if (origin && origin !== appOrigin && req.method !== 'GET') {
    return res.status(403).json({ error: 'Origin không được phép.' })
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

function configured() {
  return Boolean(
    (process.env.GOOGLE_CLIENT_ID || localOAuthConfig.clientId) &&
    (process.env.GOOGLE_CLIENT_SECRET || localOAuthConfig.clientSecret),
  )
}

const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

function oauthClient() {
  if (!configured()) throw new Error('Google OAuth chưa được cấu hình trong file .env')
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID || localOAuthConfig.clientId,
    process.env.GOOGLE_CLIENT_SECRET || localOAuthConfig.clientSecret,
    process.env.GOOGLE_REDIRECT_URI || localOAuthConfig.redirectUri || `http://localhost:${port}/api/auth/google/callback`,
  )
}

async function channelFromToken(token) {
  const auth = oauthClient()
  auth.setCredentials(token)
  const youtube = google.youtube({ version: 'v3', auth })
  const response = await youtube.channels.list({ part: ['snippet'], mine: true })
  const item = response.data.items?.[0]
  if (!item) throw new Error('Tài khoản Google này không có kênh YouTube.')
  return {
    id: item.id,
    title: item.snippet?.title || 'YouTube Channel',
    handle: item.snippet?.customUrl,
    thumbnail: item.snippet?.thumbnails?.default?.url,
  }
}

async function readConnections() {
  try {
    return normalizeStore(JSON.parse(await fs.readFile(connectionsPath, 'utf8')))
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('Không thể đọc kho kết nối YouTube:', error.message)
      throw new Error('File kết nối YouTube bị lỗi. Hãy khôi phục .data/youtube-connections.json hoặc kết nối lại kênh.', { cause: error })
    }
  }
  try {
    const token = JSON.parse(await fs.readFile(tokenPath, 'utf8'))
    const channel = await channelFromToken(token)
    const store = { version: 1, activeId: channel.id, items: [{ channel, token }] }
    await writeConnections(store)
    try { await fs.unlink(tokenPath) } catch { /* already migrated */ }
    return store
  } catch {
    return { version: 1, activeId: null, items: [] }
  }
}

function normalizeStore(value) {
  const items = Array.isArray(value?.items) ? value.items.filter(item =>
    item?.channel?.id && typeof item.channel.id === 'string' && item?.token && typeof item.token === 'object',
  ) : []
  const activeId = items.some(item => item.channel.id === value?.activeId) ? value.activeId : items[0]?.channel.id || null
  return { version: 1, activeId, items }
}

async function writeConnections(store) {
  await fs.mkdir(dataDir, { recursive: true })
  const tempPath = `${connectionsPath}.${process.pid}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(normalizeStore(store), null, 2), { encoding: 'utf8', mode: 0o600 })
  await fs.rename(tempPath, connectionsPath)
}

async function mutateConnections(mutator) {
  const operation = storageQueue.then(async () => {
    const store = await readConnections()
    const result = await mutator(store)
    await writeConnections(store)
    return result
  })
  storageQueue = operation.catch(() => undefined)
  return operation
}

async function authorizedClient(channelId) {
  const store = await readConnections()
  const connection = store.items.find(item => item.channel.id === (channelId || store.activeId))
  const token = connection?.token
  if (!token) return null
  const auth = oauthClient()
  auth.setCredentials(token)
  auth.on('tokens', async next => {
    const merged = { ...token, ...next, refresh_token: next.refresh_token || token.refresh_token }
    await mutateConnections(latest => {
      const target = latest.items.find(item => item.channel.id === connection.channel.id)
      if (target) target.token = merged
    })
  })
  return auth
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => {
    const index = part.indexOf('=')
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))]
  }))
}

function isoDate(daysAgo = 0) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - daysAgo)
  return date.toISOString().slice(0, 10)
}

async function analyticsQuery(auth, params) {
  const analytics = google.youtubeAnalytics({ version: 'v2', auth })
  const response = await analytics.reports.query({
    ids: 'channel==MINE',
    startDate: isoDate(params.days || 28),
    endDate: isoDate(1),
    ...params,
    days: undefined,
  })
  return response.data
}

function rowsAsObjects(report) {
  const headers = report.columnHeaders || []
  return (report.rows || []).map(row => Object.fromEntries(headers.map((header, index) => [header.name, row[index]])))
}

function shortsRows(report) {
  return rowsAsObjects(report).filter(row => row.creatorContentType === 'SHORTS')
}

function sumRows(rows, fields) {
  return Object.fromEntries(fields.map(field => [field, rows.reduce((sum, row) => sum + Number(row[field] || 0), 0)]))
}

async function safeAnalytics(auth, label, params, warnings) {
  try {
    return await analyticsQuery(auth, params)
  } catch (error) {
    warnings.push(`${label}: ${error.message}`)
    console.warn(`YouTube Analytics query skipped (${label}):`, error.message)
    return { columnHeaders: [], rows: [] }
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true, configured: configured() }))

app.get('/api/auth/status', asyncRoute(async (_req, res) => {
  const store = configured() ? await readConnections() : { activeId: null, items: [] }
  res.json({
    configured: configured(),
    connected: store.items.length > 0,
    activeChannelId: store.activeId,
    channels: store.items.map(item => ({ ...item.channel, uploadEnabled: canUpload(item) })),
    redirectUri: process.env.GOOGLE_REDIRECT_URI || localOAuthConfig.redirectUri || `http://localhost:${port}/api/auth/google/callback`,
  })
}))

app.post('/api/setup/google', asyncRoute(async (req, res) => {
  const clientId = String(req.body?.clientId || '').trim()
  const clientSecret = String(req.body?.clientSecret || '').trim()
  if (!clientId.endsWith('.apps.googleusercontent.com')) {
    return res.status(400).json({ error: 'Client ID không hợp lệ. Giá trị phải kết thúc bằng .apps.googleusercontent.com' })
  }
  if (clientSecret.length < 10) return res.status(400).json({ error: 'Client Secret không hợp lệ.' })
  localOAuthConfig = { clientId, clientSecret, redirectUri: `http://localhost:${port}/api/auth/google/callback` }
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(oauthConfigPath, JSON.stringify(localOAuthConfig, null, 2), { encoding: 'utf8', mode: 0o600 })
  res.json({ ok: true, redirectUri: localOAuthConfig.redirectUri })
}))

app.get('/api/auth/google', asyncRoute(async (req, res) => {
  try {
    for (const [key, intent] of oauthStates) if (intent.expiresAt < Date.now()) oauthStates.delete(key)
    const mode = req.query.mode === 'upload' ? 'upload' : 'connect'
    const channelId = mode === 'upload' ? String(req.query.channelId || '') : null
    if (mode === 'upload') {
      const store = await readConnections()
      if (!store.items.some(item => item.channel.id === channelId)) {
        return res.status(404).send('Kênh chưa được kết nối.')
      }
    }
    const state = crypto.randomBytes(24).toString('hex')
    oauthStates.set(state, { expiresAt: Date.now() + 10 * 60 * 1000, mode, channelId })
    res.setHeader('Set-Cookie', `oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`)
    const url = oauthClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'select_account consent',
      include_granted_scopes: true,
      state,
      scope: mode === 'upload' ? [...READ_SCOPES, UPLOAD_SCOPE] : READ_SCOPES,
    })
    res.redirect(url)
  } catch (error) {
    res.status(500).send(error.message)
  }
}))

app.get('/api/auth/google/callback', asyncRoute(async (req, res) => {
  if (req.query.error) {
    return res.redirect(`${appOrigin}/?oauth_error=${encodeURIComponent(String(req.query.error))}`)
  }
  const cookieState = parseCookies(req).oauth_state
  const intent = oauthStates.get(req.query.state)
  if (!req.query.code || !cookieState || cookieState !== req.query.state || !intent || intent.expiresAt < Date.now()) {
    return res.status(400).send('OAuth state không hợp lệ hoặc đã hết hạn.')
  }
  oauthStates.delete(req.query.state)
  try {
    const auth = oauthClient()
    const { tokens } = await auth.getToken(req.query.code)
    auth.setCredentials(tokens)
    const tokenInfo = tokens.access_token ? await auth.getTokenInfo(tokens.access_token) : null
    const grantedScopes = tokenInfo?.scopes || String(tokens.scope || '').split(/\s+/).filter(Boolean)
    if (intent.mode === 'upload' && !grantedScopes.includes(UPLOAD_SCOPE)) {
      return res.redirect(`${appOrigin}/?oauth_error=${encodeURIComponent('Google chưa cấp quyền youtube.upload. Hãy thử lại và chấp nhận quyền đăng video.')}`)
    }
    const channel = await channelFromToken(tokens)
    if (intent.channelId && channel.id !== intent.channelId) {
      return res.redirect(`${appOrigin}/?oauth_error=${encodeURIComponent('Bạn đã chọn sai kênh Google. Hãy cấp quyền bằng đúng kênh đang dùng.')}`)
    }
    await mutateConnections(store => {
      const existing = store.items.find(item => item.channel.id === channel.id)
      if (existing) {
        existing.channel = channel
        existing.token = { ...existing.token, ...tokens, refresh_token: tokens.refresh_token || existing.token.refresh_token }
        existing.scopes = [...new Set([...scopesOf(existing), ...grantedScopes])]
      } else {
        store.items.push({ channel, token: tokens, scopes: [...new Set(grantedScopes)] })
      }
      store.activeId = channel.id
    })
    overviewCache.delete(channel.id)
    scheduleCache.delete(channel.id)
    res.setHeader('Set-Cookie', 'oauth_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0')
    res.redirect(`${appOrigin}/?${intent.mode === 'upload' ? 'upload_permission=1' : 'connected=1'}`)
  } catch (error) {
    res.status(500).send(`Không thể kết nối YouTube: ${error.message}`)
  }
}))

app.post('/api/auth/disconnect', asyncRoute(async (_req, res) => {
  const store = await readConnections()
  const removedId = store.activeId
  await mutateConnections(latest => {
    const targetIndex = latest.items.findIndex(item => item.channel.id === removedId)
    if (targetIndex >= 0) latest.items.splice(targetIndex, 1)
    latest.activeId = latest.items[0]?.channel.id || null
  })
  overviewCache.delete(removedId)
  scheduleCache.delete(removedId)
  res.json({ ok: true })
}))

app.post('/api/channels/:channelId/activate', asyncRoute(async (req, res) => {
  const store = await readConnections()
  if (!store.items.some(item => item.channel.id === req.params.channelId)) {
    return res.status(404).json({ error: 'Kênh chưa được kết nối.' })
  }
  await mutateConnections(latest => { latest.activeId = req.params.channelId })
  res.json({ ok: true })
}))

app.get('/api/uploads', (_req, res) => {
  const jobs = [...uploadJobs.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20)
    .map(publicUploadJob)
  res.json({ jobs })
})

app.get('/api/uploads/:jobId', (req, res) => {
  const job = uploadJobs.get(req.params.jobId)
  if (!job) return res.status(404).json({ error: 'Không tìm thấy lượt tải video.' })
  res.json(publicUploadJob(job))
})

app.post('/api/uploads', receiveVideo, asyncRoute(async (req, res) => {
  const cleanup = async () => {
    if (req.file?.path) try { await fs.unlink(req.file.path) } catch { /* already removed */ }
  }
  const channelId = String(req.body?.channelId || '')
  const { errors, value } = validateUploadMetadata(req.body)
  if (!req.file) errors.push('Hãy chọn file MP4, MOV, WebM hoặc MKV hợp lệ.')
  else if (!await hasRecognizedVideoSignature(req.file)) errors.push('Nội dung file không đúng định dạng video MP4/MOV/WebM/MKV.')
  const store = await readConnections()
  const connection = store.items.find(item => item.channel.id === channelId)
  if (!connection) errors.push('Kênh chưa được kết nối.')
  else if (!canUpload(connection)) errors.push('Kênh chưa cấp quyền đăng video.')
  if (errors.length) {
    await cleanup()
    return res.status(400).json({ error: errors.join(' ') })
  }

  const now = new Date().toISOString()
  const job = {
    id: crypto.randomUUID(),
    channelId,
    channelTitle: connection.channel.title,
    title: value.title,
    originalName: path.basename(req.file.originalname),
    mimeType: req.file.mimetype,
    size: req.file.size,
    uploadedBytes: 0,
    progress: 0,
    status: 'queued',
    privacyStatus: value.privacyStatus,
    requestedPublishAt: value.publishAt || undefined,
    createdAt: now,
    updatedAt: now,
    tempPath: req.file.path,
  }
  uploadJobs.set(job.id, job)
  while (uploadJobs.size > 50) {
    const oldestCompleted = [...uploadJobs.values()].find(item => ['uploaded', 'failed'].includes(item.status))
    if (!oldestCompleted) break
    uploadJobs.delete(oldestCompleted.id)
  }
  uploadQueue = uploadQueue.then(() => processUpload(job, value)).catch(error => {
    console.error('Upload queue failed:', error)
  })
  res.status(202).json(publicUploadJob(job))
}))

app.get('/api/youtube/schedule', asyncRoute(async (req, res) => {
  const store = await readConnections()
  const activeId = store.activeId
  const cached = activeId ? scheduleCache.get(activeId) : null
  if (req.query.refresh !== '1' && cached && cached.expiresAt > Date.now()) {
    return res.json({ ...cached.data, cached: true })
  }
  const auth = await authorizedClient()
  if (!auth) return res.status(401).json({ error: 'not_connected' })
  const youtube = google.youtube({ version: 'v3', auth })
  const channelResponse = await youtube.channels.list({ part: ['snippet', 'contentDetails'], mine: true })
  const channel = channelResponse.data.items?.[0]
  const uploadsPlaylistId = channel?.contentDetails?.relatedPlaylists?.uploads
  if (!channel || !uploadsPlaylistId) return res.status(404).json({ error: 'Không tìm thấy danh sách video của kênh.' })

  const videoIds = []
  let pageToken
  do {
    const page = await youtube.playlistItems.list({
      part: ['contentDetails'],
      playlistId: uploadsPlaylistId,
      maxResults: 50,
      pageToken,
    })
    videoIds.push(...(page.data.items || []).map(item => item.contentDetails?.videoId).filter(Boolean))
    pageToken = page.data.nextPageToken || undefined
  } while (pageToken && videoIds.length < 200)

  const videos = []
  for (let index = 0; index < videoIds.length; index += 50) {
    const response = await youtube.videos.list({
      part: ['snippet', 'status'],
      id: videoIds.slice(index, index + 50),
    })
    videos.push(...(response.data.items || []))
  }
  const scheduled = videos
    .filter(video => video.status?.privacyStatus === 'private' && video.status?.publishAt)
    .map(video => ({
      id: video.id,
      title: video.snippet?.title || 'Video chưa có tiêu đề',
      thumbnail: video.snippet?.thumbnails?.medium?.url || video.snippet?.thumbnails?.default?.url,
      publishAt: video.status.publishAt,
      privacyStatus: video.status.privacyStatus,
      studioUrl: `https://studio.youtube.com/video/${video.id}/edit`,
    }))
    .sort((a, b) => a.publishAt.localeCompare(b.publishAt))
  const recentCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
  const unscheduledPrivate = videos
    .filter(video => video.status?.privacyStatus === 'private' && !video.status?.publishAt && new Date(video.snippet?.publishedAt || 0).getTime() >= recentCutoff)
    .map(video => ({
      id: video.id,
      title: video.snippet?.title || 'Video chưa có tiêu đề',
      uploadedAt: video.snippet?.publishedAt,
      studioUrl: `https://studio.youtube.com/video/${video.id}/edit`,
    }))
  const payload = {
    syncedAt: new Date().toISOString(),
    cached: false,
    channel: { id: channel.id, title: channel.snippet?.title || 'YouTube Channel' },
    videos: scheduled,
    unscheduledPrivate,
  }
  if (activeId) scheduleCache.set(activeId, { data: payload, expiresAt: Date.now() + 60_000 })
  res.json(payload)
}))

app.get('/api/youtube/overview', async (_req, res) => {
  try {
    const store = await readConnections()
    const activeId = store.activeId
    const cached = activeId ? overviewCache.get(activeId) : null
    if (_req.query.refresh !== '1' && cached && cached.expiresAt > Date.now()) {
      return res.json({ ...cached.data, cached: true })
    }
    const auth = await authorizedClient()
    if (!auth) return res.status(401).json({ error: 'not_connected' })
    const youtube = google.youtube({ version: 'v3', auth })
    const channelResponse = await youtube.channels.list({ part: ['snippet', 'statistics', 'contentDetails'], mine: true })
    const channel = channelResponse.data.items?.[0]
    if (!channel) return res.status(404).json({ error: 'Tài khoản Google này không có kênh YouTube.' })

    const warnings = []
    const [summary28Report, summary90Report, daily28Report, daily90Report, countries, topVideos] = await Promise.all([
      safeAnalytics(auth, 'Tổng quan 28 ngày', { days: 28, dimensions: 'creatorContentType', metrics: 'engagedViews,views,estimatedMinutesWatched,averageViewDuration' }, warnings),
      safeAnalytics(auth, 'Tổng quan 90 ngày', { days: 90, dimensions: 'creatorContentType', metrics: 'engagedViews,views,estimatedMinutesWatched,averageViewDuration' }, warnings),
      safeAnalytics(auth, 'Theo ngày 28 ngày', { days: 28, dimensions: 'day,creatorContentType', metrics: 'engagedViews,views,subscribersGained,subscribersLost,likes,comments,shares', sort: 'day' }, warnings),
      safeAnalytics(auth, 'Theo ngày 90 ngày', { days: 90, dimensions: 'day,creatorContentType', metrics: 'engagedViews,views,estimatedMinutesWatched,subscribersGained', sort: 'day' }, warnings),
      safeAnalytics(auth, 'Quốc gia', { days: 90, dimensions: 'country,creatorContentType', metrics: 'engagedViews,views,estimatedMinutesWatched', sort: '-views', maxResults: 200 }, warnings),
      safeAnalytics(auth, 'Top videos', { days: 90, dimensions: 'video', metrics: 'engagedViews,views,estimatedMinutesWatched,averageViewDuration,subscribersGained,likes', sort: '-views', maxResults: 50 }, warnings),
    ])

    const daily28 = shortsRows(daily28Report)
    const daily90 = shortsRows(daily90Report)
    const summary28 = shortsRows(summary28Report)[0] || {}
    const summary90 = shortsRows(summary90Report)[0] || {}
    const shorts28 = {
      ...sumRows(daily28, ['subscribersGained', 'subscribersLost', 'likes', 'comments', 'shares']),
      ...summary28,
    }
    const shorts90 = {
      ...sumRows(daily90, ['subscribersGained']),
      ...summary90,
    }
    const topRows = rowsAsObjects(topVideos).slice(0, 10)
    const videoIds = topRows.map(row => row.video).filter(Boolean)
    const videosResponse = videoIds.length ? await youtube.videos.list({ part: ['snippet', 'statistics'], id: videoIds }) : { data: { items: [] } }
    const videoMap = new Map((videosResponse.data.items || []).map(video => [video.id, video]))
    const videos = topRows.map(row => {
      const meta = videoMap.get(row.video)
      return { ...row, title: meta?.snippet?.title || row.video, thumbnail: meta?.snippet?.thumbnails?.medium?.url, publishedAt: meta?.snippet?.publishedAt }
    })

    const payload = {
      syncedAt: new Date().toISOString(),
      cached: false,
      warnings,
      channel: {
        id: channel.id,
        title: channel.snippet?.title,
        handle: channel.snippet?.customUrl,
        description: channel.snippet?.description,
        thumbnail: channel.snippet?.thumbnails?.high?.url || channel.snippet?.thumbnails?.default?.url,
        country: channel.snippet?.country,
        subscribers: Number(channel.statistics?.subscriberCount || 0),
        totalViews: Number(channel.statistics?.viewCount || 0),
        videoCount: Number(channel.statistics?.videoCount || 0),
      },
      shorts28,
      shorts90,
      daily: daily28,
      countries: shortsRows(countries),
      videos,
    }
    if (activeId) overviewCache.set(activeId, { data: payload, expiresAt: Date.now() + 60_000 })
    res.json(payload)
  } catch (error) {
    console.error(error)
    const status = error?.code === 401 ? 401 : 500
    res.status(status).json({ error: error.message || 'Không thể tải dữ liệu YouTube.' })
  }
})

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError) return res.status(400).json({ error: 'JSON không hợp lệ.' })
  if (error?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `Video vượt quá giới hạn ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB của ShortFlow.` })
  }
  if (error?.status && error.status < 500) return res.status(error.status).json({ error: error.message || 'Yêu cầu tải video không hợp lệ.' })
  console.error(error)
  res.status(500).json({ error: 'Lỗi máy chủ nội bộ.' })
})

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, host, () => {
    console.log(`ShortFlow API đang chạy tại http://${host}:${port}`)
    if (!configured()) console.log('Chưa có Google OAuth credentials. Mở giao diện để cấu hình.')
  })
}

export { app, normalizeStore, readConnections, rowsAsObjects, shortsRows, sumRows, validateUploadMetadata, writeConnections }
