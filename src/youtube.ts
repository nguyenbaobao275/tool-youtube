export type ConnectedChannel = { id: string; title: string; handle?: string; thumbnail?: string; uploadEnabled: boolean }
export type AuthStatus = {
  configured: boolean
  connected: boolean
  redirectUri: string
  activeChannelId?: string
  channels: ConnectedChannel[]
}

export type YouTubeOverview = {
  syncedAt: string
  cached?: boolean
  warnings?: string[]
  channel: {
    id: string
    title: string
    handle?: string
    description?: string
    thumbnail?: string
    country?: string
    subscribers: number
    totalViews: number
    videoCount: number
  }
  shorts28: Record<string, number>
  shorts90: Record<string, number>
  daily: Array<{ day: string; views: number; engagedViews: number; subscribersGained: number }>
  countries: Array<{ country: string; views: number; engagedViews: number; estimatedMinutesWatched: number }>
  videos: Array<{ video: string; title: string; thumbnail?: string; views: number; engagedViews: number; averageViewDuration: number; subscribersGained: number; likes: number }>
}

export type UploadJob = {
  id: string
  channelId: string
  channelTitle: string
  title: string
  originalName: string
  size: number
  uploadedBytes: number
  progress: number
  status: 'queued' | 'uploading' | 'uploaded' | 'failed'
  privacyStatus: 'private' | 'unlisted' | 'public'
  requestedPublishAt?: string
  publishAt?: string
  warning?: string
  createdAt: string
  updatedAt: string
  videoId?: string
  youtubeUrl?: string
  studioUrl?: string
  error?: string
}

export type YouTubeSchedule = {
  syncedAt: string
  cached?: boolean
  channel: { id: string; title: string }
  videos: Array<{
    id: string
    title: string
    thumbnail?: string
    publishAt: string
    privacyStatus: 'private'
    studioUrl: string
  }>
  unscheduledPrivate: Array<{
    id: string
    title: string
    uploadedAt?: string
    studioUrl: string
  }>
}

export const API_ORIGIN = 'http://localhost:8787'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 25_000)
  let response: Response
  try {
    response = await fetch(`${API_ORIGIN}${url}`, { ...init, signal: controller.signal, cache: 'no-store' })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('YouTube phản hồi quá lâu. Hãy thử đồng bộ lại.', { cause: error })
    }
    throw new Error('Backend chưa chạy ở cổng 8787. Hãy chạy ứng dụng bằng lệnh: npm run dev', { cause: error })
  } finally {
    window.clearTimeout(timeout)
  }
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new Error('Backend chưa chạy. Hãy dừng terminal cũ và chạy lại: npm run dev')
  }
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Không thể kết nối máy chủ')
  return data as T
}

export const youtubeApi = {
  status: () => request<AuthStatus>('/api/auth/status'),
  setup: (clientId: string, clientSecret: string) => request<{ ok: boolean; redirectUri: string }>('/api/setup/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  }),
  overview: (refresh = false) => request<YouTubeOverview>(`/api/youtube/overview${refresh ? '?refresh=1' : ''}`),
  schedule: (refresh = false) => request<YouTubeSchedule>(`/api/youtube/schedule${refresh ? '?refresh=1' : ''}`),
  disconnect: () => request<{ ok: boolean }>('/api/auth/disconnect', { method: 'POST' }),
  activate: (channelId: string) => request<{ ok: boolean }>(`/api/channels/${encodeURIComponent(channelId)}/activate`, { method: 'POST' }),
  uploadPermissionUrl: (channelId: string) => `${API_ORIGIN}/api/auth/google?mode=upload&channelId=${encodeURIComponent(channelId)}`,
  uploadStatus: (jobId: string) => request<UploadJob>(`/api/uploads/${encodeURIComponent(jobId)}`),
  uploadVideo: (form: FormData, onProgress: (percent: number) => void) => new Promise<UploadJob>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_ORIGIN}/api/uploads`)
    xhr.timeout = 30 * 60 * 1000
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100))
    }
    xhr.onerror = () => reject(new Error('Không thể gửi video tới backend cục bộ.'))
    xhr.ontimeout = () => reject(new Error('Quá thời gian gửi video tới backend cục bộ.'))
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText) as UploadJob & { error?: string }
        if (xhr.status < 200 || xhr.status >= 300) reject(new Error(data.error || 'Không thể tạo lượt tải video.'))
        else resolve(data)
      } catch {
        reject(new Error('Backend trả về phản hồi không hợp lệ.'))
      }
    }
    xhr.send(form)
  }),
}
