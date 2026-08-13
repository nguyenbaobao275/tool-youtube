import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3, Bell, CalendarDays, Check, ChevronRight, CircleHelp,
  Clock3, ExternalLink, FileText, Gauge, Grid2X2, LayoutDashboard, Lightbulb,
  LoaderCircle, LogOut, Menu, MoreHorizontal, Play, Plus, RefreshCw, Search, Settings,
  ShieldCheck, Sparkles, TrendingUp, UploadCloud, Users, X,
} from 'lucide-react'
import { initialShorts, stages, type ShortItem } from './data'
import { API_ORIGIN, youtubeApi, type AuthStatus, type ConnectedChannel, type UploadJob, type YouTubeOverview, type YouTubeSchedule } from './youtube'

type Page = 'Tổng quan' | 'Nội dung' | 'Lịch đăng' | 'Kênh' | 'Phân tích' | 'YPP Tracker'

const nav: { label: Page; icon: typeof Grid2X2 }[] = [
  { label: 'Tổng quan', icon: LayoutDashboard },
  { label: 'Nội dung', icon: FileText },
  { label: 'Lịch đăng', icon: CalendarDays },
  { label: 'Kênh', icon: Play },
  { label: 'Phân tích', icon: BarChart3 },
  { label: 'YPP Tracker', icon: Gauge },
]

function formatNumber(value: number) {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}K` : value.toString()
}

function defaultVietnamSchedule() {
  const date = new Date(Date.now() + 60 * 60 * 1000)
  date.setUTCMinutes(Math.ceil(date.getUTCMinutes() / 5) * 5, 0, 0)
  const vietnam = new Date(date.getTime() + 7 * 60 * 60 * 1000)
  return vietnam.toISOString().slice(0, 16)
}

function vietnamDateTimeToIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return ''
  const [, year, month, day, hour, minute] = match
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 7, Number(minute))).toISOString()
}

function formatVietnamDateTime(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value))
}

export default function App() {
  const [page, setPage] = useState<Page>('Tổng quan')
  const [shorts, setShorts] = useState<ShortItem[]>(() => {
    try {
      const saved = window.localStorage.getItem('shortflow-shorts-v2')
      return saved ? JSON.parse(saved) as ShortItem[] : initialShorts
    } catch {
      return initialShorts
    }
  })
  const [showNew, setShowNew] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [youtube, setYoutube] = useState<YouTubeOverview | null>(null)
  const [youtubeLoading, setYoutubeLoading] = useState(true)
  const [youtubeError, setYoutubeError] = useState('')
  const [youtubeSchedule, setYoutubeSchedule] = useState<YouTubeSchedule | null>(null)
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [scheduleError, setScheduleError] = useState('')
  const requestId = useRef(0)
  const scheduleRequestId = useRef(0)

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2500)
  }

  useEffect(() => {
    window.localStorage.setItem('shortflow-shorts-v2', JSON.stringify(shorts))
  }, [shorts])

  const loadYouTube = useCallback(async (refresh = false) => {
    const currentRequest = ++requestId.current
    setYoutubeLoading(true)
    setYoutubeError('')
    try {
      const status = await youtubeApi.status()
      setAuth(status)
      const overview = status.connected ? await youtubeApi.overview(refresh) : null
      if (currentRequest !== requestId.current) return
      setYoutube(overview)
    } catch (error) {
      if (currentRequest === requestId.current) setYoutubeError(error instanceof Error ? error.message : 'Không thể tải dữ liệu YouTube')
    } finally {
      if (currentRequest === requestId.current) setYoutubeLoading(false)
    }
  }, [])

  const loadSchedule = useCallback(async (refresh = false) => {
    const currentRequest = ++scheduleRequestId.current
    setScheduleLoading(true)
    setScheduleError('')
    try {
      const result = await youtubeApi.schedule(refresh)
      if (currentRequest === scheduleRequestId.current) setYoutubeSchedule(result)
    } catch (error) {
      if (currentRequest === scheduleRequestId.current) setScheduleError(error instanceof Error ? error.message : 'Không thể đồng bộ lịch YouTube')
    } finally {
      if (currentRequest === scheduleRequestId.current) setScheduleLoading(false)
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauthError = params.get('oauth_error')
    const uploadPermission = params.has('upload_permission')
    if (params.has('connected') || uploadPermission || oauthError) window.history.replaceState({}, '', window.location.pathname)
    // Initial synchronization with the local backend is intentionally triggered on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadYouTube().then(() => {
      if (oauthError) setYoutubeError(oauthError === 'access_denied' ? 'Bạn đã hủy cấp quyền Google.' : `Google OAuth: ${oauthError}`)
      if (uploadPermission) {
        setShowUpload(true)
        notify('Đã cấp quyền đăng video cho kênh')
      }
    })
  }, [loadYouTube])

  useEffect(() => {
    if (page !== 'Lịch đăng' || !auth?.connected) return
    // Synchronize the selected channel when the real YouTube calendar is opened.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSchedule()
  }, [page, auth?.connected, auth?.activeChannelId, loadSchedule])

  const disconnect = async () => {
    if (!window.confirm(`Gỡ kênh ${youtube?.channel.title || ''} khỏi ShortFlow? Token của kênh này sẽ bị xóa khỏi máy.`)) return
    await youtubeApi.disconnect()
    await loadYouTube(true)
    notify('Đã gỡ kênh khỏi ShortFlow')
  }

  const activateChannel = async (channelId: string) => {
    if (channelId === auth?.activeChannelId) return
    setYoutubeLoading(true)
    try {
      await youtubeApi.activate(channelId)
      await loadYouTube()
      setPage('Tổng quan')
      notify('Đã chuyển kênh')
    } catch (error) {
      setYoutubeError(error instanceof Error ? error.message : 'Không thể chuyển kênh')
      setYoutubeLoading(false)
    }
  }

  const addShort = (item: Omit<ShortItem, 'id' | 'score' | 'owner' | 'color' | 'date'>) => {
    setShorts(prev => [{ ...item, id: Date.now(), owner: 'TÔI', color: '#e99346', date: 'Chưa đặt' }, ...prev])
    setShowNew(false)
    setPage('Nội dung')
    notify('Đã tạo Short mới trong cột Ý tưởng')
  }

  const activeChannel = auth?.channels.find(channel => channel.id === auth.activeChannelId)

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand"><span className="brand-mark"><Play size={17} fill="currentColor" /></span><span>ShortFlow</span><b>STUDIO</b></div>
        <button className="close-side" onClick={() => setSidebarOpen(false)}><X /></button>
        <nav>
          <p className="nav-label">KHÔNG GIAN LÀM VIỆC</p>
          {nav.map(({ label, icon: Icon }) => (
            <button key={label} className={page === label ? 'active' : ''} onClick={() => { setPage(label); setSidebarOpen(false) }}>
              <Icon size={19} /><span>{label}</span>{label === 'Nội dung' && <em>{shorts.length}</em>}
            </button>
          ))}
          <p className="nav-label channel-label">KÊNH CỦA BẠN <a href={`${API_ORIGIN}/api/auth/google`} title="Thêm kênh YouTube" aria-label="Thêm kênh YouTube"><Plus size={15} /></a></p>
          {auth?.channels?.length ? auth.channels.map(channel => <button className={`channel-nav ${channel.id === auth.activeChannelId ? 'selected' : ''}`} key={channel.id} onClick={() => void activateChannel(channel.id)}>
            {channel.thumbnail ? <img src={channel.thumbnail} alt="" /> : <i style={{ background: '#e99346' }}>{channel.title.slice(0, 1)}</i>}<span>{channel.title}</span><small></small>
          </button>) : <button className="channel-nav" onClick={() => setPage('Tổng quan')}><i style={{ background: '#555963' }}>+</i><span>Chưa kết nối</span></button>}
        </nav>
        <div className="sidebar-bottom">
          <button><CircleHelp size={18} />Trung tâm trợ giúp</button>
          <button><Settings size={18} />Cài đặt</button>
          <div className="user-card"><span>SF</span><div><strong>Không gian cá nhân</strong><small>Dữ liệu lưu trên máy</small></div><MoreHorizontal size={18} /></div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <button className="menu-btn" onClick={() => setSidebarOpen(true)}><Menu /></button>
          <div className="search"><Search size={18} /><input placeholder="Tìm kiếm nội dung, kênh..." /><kbd>⌘ K</kbd></div>
          <div className="top-actions">{youtube?.channel.thumbnail && <img className="connected-avatar" src={youtube.channel.thumbnail} alt="" />}<button className="icon-btn"><Bell size={19} /><i /></button><button className="primary" onClick={() => activeChannel ? setShowUpload(true) : notify('Hãy kết nối kênh YouTube trước')}><UploadCloud size={18} />Đăng video</button></div>
        </header>
        <div className="content">
          {!auth?.connected && <ConnectYouTube status={auth} loading={youtubeLoading} error={youtubeError} onConfigured={loadYouTube} />}
          {auth?.connected && youtubeLoading && <LoadingYouTube />}
          {auth?.connected && !youtubeLoading && youtubeError && <ApiError message={youtubeError} onRetry={loadYouTube} />}
          {auth?.connected && youtube && <LiveBar data={youtube} onRefresh={() => void loadYouTube(true)} onDisconnect={disconnect} />}
          {auth?.connected && youtube?.warnings?.length ? <div className="partial-warning"><CircleHelp /><span><b>Một phần Analytics chưa tải được.</b> Dữ liệu kênh còn lại vẫn sử dụng bình thường.</span><details><summary>Chi tiết</summary>{youtube.warnings.map(warning => <p key={warning}>{warning}</p>)}</details></div> : null}
          {auth?.connected && youtube && page === 'Tổng quan' && <LiveDashboard data={youtube} shorts={shorts} changePage={setPage} />}
          {page === 'Nội dung' && <ContentBoard shorts={shorts} setShorts={setShorts} onNew={() => setShowNew(true)} />}
          {page === 'Lịch đăng' && <Schedule data={youtubeSchedule} loading={scheduleLoading} error={scheduleError} onRefresh={() => void loadSchedule(true)} />}
          {auth?.connected && youtube && page === 'Kênh' && <LiveChannel data={youtube} />}
          {auth?.connected && youtube && page === 'Phân tích' && <LiveAnalytics data={youtube} />}
          {auth?.connected && youtube && page === 'YPP Tracker' && <LiveYpp data={youtube} />}
        </div>
      </main>
      {showNew && <NewShortModal channelName={youtube?.channel.title || 'Kênh của tôi'} onClose={() => setShowNew(false)} onSubmit={addShort} />}
      {showUpload && activeChannel && <UploadVideoModal channel={activeChannel} onClose={() => setShowUpload(false)} onUploaded={() => { void loadYouTube(true); void loadSchedule(true) }} />}
      {toast && <div className="toast"><Check size={17} />{toast}</div>}
    </div>
  )
}

function ConnectYouTube({ status, loading, error, onConfigured }: { status: AuthStatus | null; loading: boolean; error: string; onConfigured: () => void }) {
  const [showSetup, setShowSetup] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [setupError, setSetupError] = useState('')
  if (loading) return <LoadingYouTube />
  const saveSetup = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setSetupError('')
    try {
      await youtubeApi.setup(clientId, clientSecret)
      await onConfigured()
      setShowSetup(false)
    } catch (setupFailure) {
      setSetupError(setupFailure instanceof Error ? setupFailure.message : 'Không thể lưu cấu hình')
    } finally {
      setSaving(false)
    }
  }
  return <section className="connect-screen">
    <div className="connect-visual"><span><Play fill="currentColor" /></span><i className="orbit o1" /><i className="orbit o2" /><i className="orbit o3" /></div>
    <p className="eyebrow">DỮ LIỆU THẬT · CHỈ MÌNH BẠN</p>
    <h1>Kết nối kênh YouTube của bạn</h1>
    <p>ShortFlow chỉ yêu cầu quyền đọc để đồng bộ số liệu kênh và YouTube Shorts. Tool không thể chỉnh sửa hay xóa video.</p>
    {!status?.configured && <div className="setup-warning"><Settings /><div><b>Cần cấu hình Google OAuth một lần</b><span>Tạo OAuth Client loại Web application trong Google Cloud, sau đó nhập thông tin ngay tại đây.</span></div></div>}
    {error && <div className="api-error-inline">{error}</div>}
    {!status?.configured && !showSetup && <button className="setup-button" onClick={() => setShowSetup(true)}><Settings />Thiết lập kết nối Google</button>}
    {!status?.configured && showSetup && <form className="oauth-setup" onSubmit={saveSetup}>
      <div className="setup-title"><div><b>Thông tin OAuth Client</b><span>Thông tin chỉ được lưu trong thư mục <code>.data</code> trên máy bạn.</span></div><a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Mở Google Cloud <ExternalLink /></a></div>
      <label>Authorized redirect URI<div className="copy-field"><code>{status?.redirectUri || 'http://localhost:8787/api/auth/google/callback'}</code></div></label>
      <label>Client ID<input value={clientId} onChange={event => setClientId(event.target.value)} placeholder="123456789-abc.apps.googleusercontent.com" autoComplete="off" /></label>
      <label>Client Secret<input type="password" value={clientSecret} onChange={event => setClientSecret(event.target.value)} placeholder="GOCSPX-..." autoComplete="new-password" /></label>
      {setupError && <p className="setup-error">{setupError}</p>}
      <div className="setup-actions"><button type="button" className="outline" onClick={() => setShowSetup(false)}>Hủy</button><button className="primary" disabled={saving || !clientId || !clientSecret}>{saving ? <LoaderCircle className="spin" /> : <Check />}Lưu cấu hình</button></div>
    </form>}
    {status?.configured && <a className="google-connect" href={`${API_ORIGIN}/api/auth/google`}><span className="google-g">G</span>Kết nối với Google</a>}
    <div className="permission-list"><span><Check />Đọc thông tin và thống kê kênh</span><span><Check />Đọc YouTube Analytics</span><span><ShieldCheck />Token chỉ lưu trên máy này</span></div>
  </section>
}

function LoadingYouTube() {
  return <div className="loading-state"><LoaderCircle /><b>Đang đồng bộ dữ liệu YouTube...</b><span>Analytics có thể mất vài giây.</span></div>
}

function ApiError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="api-error"><div><b>Không thể tải dữ liệu kênh</b><p>{message}</p></div><button className="outline" onClick={onRetry}><RefreshCw />Thử lại</button></div>
}

function LiveBar({ data, onRefresh, onDisconnect }: { data: YouTubeOverview; onRefresh: () => void; onDisconnect: () => void }) {
  return <div className="live-bar"><div className="live-channel">{data.channel.thumbnail ? <img src={data.channel.thumbnail} alt="" /> : <span className="channel-fallback">{data.channel.title.slice(0, 1)}</span>}<span><b>{data.channel.title}</b><small><i /> Đã kết nối · dữ liệu thật</small></span></div><span className="sync-time">{data.cached ? 'Bản lưu · ' : ''}Đồng bộ {new Date(data.syncedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span><button onClick={onRefresh} title="Đồng bộ dữ liệu mới" aria-label="Đồng bộ dữ liệu mới"><RefreshCw /></button><button onClick={onDisconnect} title="Gỡ kênh khỏi ShortFlow" aria-label="Gỡ kênh khỏi ShortFlow"><LogOut /></button></div>
}

function LiveDashboard({ data, shorts, changePage }: { data: YouTubeOverview; shorts: ShortItem[]; changePage: (p: Page) => void }) {
  const netSubs = Number(data.shorts28.subscribersGained || 0) - Number(data.shorts28.subscribersLost || 0)
  const engagedRate = data.shorts28.views ? Number(data.shorts28.engagedViews || 0) / Number(data.shorts28.views) * 100 : 0
  const yppViews = Number(data.shorts90.engagedViews || data.shorts90.views || 0)
  const subProgress = Math.min(data.channel.subscribers / 1000 * 100, 100)
  const viewProgress = Math.min(yppViews / 10_000_000 * 100, 100)
  return <>
    <section className="page-heading"><div><p>DỮ LIỆU SHORTS · 28 NGÀY</p><h1>{data.channel.title}</h1><h3>Tổng quan hiệu suất Shorts từ YouTube Analytics API.</h3></div><button className="outline" onClick={() => changePage('Phân tích')}><BarChart3 />Xem phân tích<ChevronRight /></button></section>
    <section className="metrics-grid">
      <Metric label="SHORTS VIEWS" value={formatNumber(Number(data.shorts28.views || 0))} delta={formatNumber(Number(data.shorts28.engagedViews || 0))} note="engaged views" icon={<Play />} theme="orange" />
      <Metric label="SUBSCRIBER HIỆN TẠI" value={formatNumber(data.channel.subscribers)} delta={netSubs >= 0 ? `+${netSubs}` : `${netSubs}`} note="ròng từ Shorts" icon={<Users />} theme="purple" />
      <Metric label="PHÚT XEM SHORTS" value={formatNumber(Number(data.shorts28.estimatedMinutesWatched || 0))} delta={formatDuration(Number(data.shorts28.averageViewDuration || 0))} note="xem trung bình" icon={<Clock3 />} theme="green" />
      <Metric label="TỶ LỆ ENGAGED" value={`${engagedRate.toFixed(1)}%`} delta={formatNumber(Number(data.shorts28.likes || 0))} note="lượt thích" icon={<TrendingUp />} theme="blue" />
    </section>
    <section className="dashboard-grid">
      <div className="card live-videos"><CardTitle title="Top video · 90 ngày" subtitle="Video có nhiều lượt xem nhất trên kênh" action="Phân tích đầy đủ" onClick={() => changePage('Phân tích')} />{data.videos.slice(0, 5).map((video, i) => <div className="video-row" key={video.video}><b className="rank">{i + 1}</b>{video.thumbnail ? <img src={video.thumbnail} alt="" /> : <span className="video-placeholder"><Play /></span>}<div><b>{video.title}</b><span>{formatNumber(Number(video.views))} lượt xem · +{formatNumber(Number(video.subscribersGained || 0))} đăng ký</span></div><strong>{formatDuration(Number(video.averageViewDuration || 0))}</strong><a href={`https://youtube.com/watch?v=${video.video}`} target="_blank" rel="noreferrer"><ExternalLink /></a></div>)}{!data.videos.length && <div className="empty-state"><Play /><b>Chưa có dữ liệu video trong 90 ngày</b><span>Thông tin sẽ xuất hiện sau khi YouTube Analytics xử lý lượt xem.</span></div>}</div>
      <div className="card ypp-card"><CardTitle title="Tiến độ YPP Shorts" subtitle="Ước tính từ dữ liệu API" action="Chi tiết" onClick={() => changePage('YPP Tracker')} /><div className="live-goal"><Goal value={formatNumber(data.channel.subscribers)} total="1K" label="Người đăng ký" progress={subProgress} color="#7b87eb" /><Goal value={formatNumber(yppViews)} total="10M" label="Engaged views · 90 ngày" progress={viewProgress} color="#42a88b" /></div><p className="ypp-caveat"><CircleHelp />Số đủ điều kiện chính thức vẫn cần kiểm tra tại tab Earn trong YouTube Studio.</p></div>
    </section>
    <section className="dashboard-grid lower"><div className="card"><CardTitle title="Pipeline cá nhân" subtitle={`${shorts.length} ý tưởng và Shorts đang quản lý`} action="Mở pipeline" onClick={() => changePage('Nội dung')} /><div className="pipeline-list">{shorts.slice(0, 4).map(item => <PipelineItem key={item.id} item={item} />)}{!shorts.length && <div className="empty-state compact-empty"><Lightbulb /><b>Pipeline đang trống</b><span>Nhấn “Tạo Short mới” để thêm ý tưởng đầu tiên.</span></div>}</div></div><CountryCard data={data} /></section>
  </>
}

function CountryCard({ data }: { data: YouTubeOverview }) {
  const total = data.countries.reduce((sum, row) => sum + Number(row.views || 0), 0)
  const names = typeof Intl.DisplayNames !== 'undefined' ? new Intl.DisplayNames(['vi'], { type: 'region' }) : null
  return <div className="card country-card"><CardTitle title="Viewer theo quốc gia" subtitle="Tỷ trọng trong các quốc gia API trả về · Shorts · 90 ngày" />{data.countries.slice(0, 6).map(row => { const percent = total ? Number(row.views) / total * 100 : 0; return <div className="country-row" key={row.country}><span>{names?.of(row.country) || row.country}</span><div className="country-progress"><i style={{ width: `${percent}%` }} /></div><b>{formatNumber(Number(row.views))}</b><small>{percent.toFixed(1)}%</small></div> })}{!data.countries.length && <p className="empty-copy">Chưa đủ dữ liệu địa lý. YouTube có thể ẩn báo cáo khi lượng người xem còn thấp.</p>}</div>
}

function LiveChannel({ data }: { data: YouTubeOverview }) {
  return <><section className="page-heading compact"><div><p>KÊNH ĐÃ KẾT NỐI</p><h1>{data.channel.title}</h1><h3>Dữ liệu công khai hiện tại từ YouTube Data API.</h3></div><div className="heading-actions"><a className="primary link-button" href={`${API_ORIGIN}/api/auth/google`}><Plus />Thêm kênh</a><a className="outline link-button" href={`https://youtube.com/channel/${data.channel.id}`} target="_blank" rel="noreferrer">Mở YouTube<ExternalLink /></a></div></section><article className="card real-channel-card"><div className="real-channel-head">{data.channel.thumbnail ? <img src={data.channel.thumbnail} alt={data.channel.title} /> : <span className="large-fallback">{data.channel.title.slice(0, 1)}</span>}<div><h2>{data.channel.title}</h2><p>{data.channel.handle || data.channel.id}</p><span>{data.channel.country ? `Quốc gia kênh: ${data.channel.country}` : 'Chưa đặt quốc gia kênh'}</span></div></div><div className="real-channel-stats"><div><b>{formatNumber(data.channel.subscribers)}</b><span>Người đăng ký</span></div><div><b>{formatNumber(data.channel.totalViews)}</b><span>Tổng lượt xem</span></div><div><b>{formatNumber(data.channel.videoCount)}</b><span>Tổng video</span></div></div>{data.channel.description && <p className="channel-description">{data.channel.description}</p>}</article></>
}

function LiveAnalytics({ data }: { data: YouTubeOverview }) {
  const max = Math.max(...data.daily.map(row => Number(row.views)), 1)
  return <><section className="page-heading compact"><div><p>YOUTUBE ANALYTICS · SHORTS</p><h1>Viewer nước ngoài</h1><h3>Theo dõi thị trường và nội dung tạo tăng trưởng thật.</h3></div><span className="real-data-pill"><i />Dữ liệu API</span></section><section className="analytics-grid"><div className="card chart-card"><CardTitle title="Shorts views theo ngày" subtitle="28 ngày gần nhất" /><div className="big-number">{formatNumber(Number(data.shorts28.views || 0))} <span>{formatNumber(Number(data.shorts28.engagedViews || 0))} engaged</span></div><div className="bar-chart live-chart">{data.daily.map((row, i) => <i key={row.day} title={`${row.day}: ${formatNumber(Number(row.views))} views`} style={{ height: `${Math.max(Number(row.views) / max * 100, 2)}%` }}><span>{i % 7 === 0 ? row.day.slice(5).replace('-', '/') : ''}</span></i>)}</div></div><CountryCard data={data} /></section><div className="card top-table"><CardTitle title="Hiệu suất video" subtitle="Top 10 video trong 90 ngày" /><div className="table-scroll"><table><thead><tr><th>Video</th><th>Views</th><th>Engaged</th><th>Thời lượng xem TB</th><th>Subscribers</th><th>Likes</th></tr></thead><tbody>{data.videos.map(video => <tr key={video.video}><td><div className="table-video">{video.thumbnail && <img src={video.thumbnail} alt="" />}<a href={`https://youtube.com/watch?v=${video.video}`} target="_blank" rel="noreferrer">{video.title}</a></div></td><td>{formatNumber(Number(video.views))}</td><td>{formatNumber(Number(video.engagedViews || 0))}</td><td>{formatDuration(Number(video.averageViewDuration || 0))}</td><td>+{formatNumber(Number(video.subscribersGained || 0))}</td><td>{formatNumber(Number(video.likes || 0))}</td></tr>)}</tbody></table></div></div></>
}

function LiveYpp({ data }: { data: YouTubeOverview }) {
  const yppViews = Number(data.shorts90.engagedViews || data.shorts90.views || 0)
  const subProgress = Math.min(data.channel.subscribers / 1000 * 100, 100)
  const viewProgress = Math.min(yppViews / 10_000_000 * 100, 100)
  const overall = Math.min(subProgress, viewProgress)
  return <><section className="page-heading compact"><div><p>KIẾM TIỀN · DỮ LIỆU THẬT</p><h1>YPP Tracker</h1><h3>Ước tính tiến độ Shorts dựa trên kênh đã kết nối.</h3></div><a className="outline link-button" href="https://studio.youtube.com/channel/UC/monetization" target="_blank" rel="noreferrer">Mở tab Earn<ExternalLink /></a></section><section className="ypp-layout"><div className="card ypp-hero"><span className="eyebrow">DOANH THU QUẢNG CÁO</span><h2>Ước tính hoàn thành {overall.toFixed(1)}%</h2><p>Bạn cần đạt đồng thời hai điều kiện dưới đây và vượt qua bước xét duyệt chính sách của YouTube.</p><div className="goal-row"><Goal value={formatNumber(data.channel.subscribers)} total="1,000" label="Người đăng ký" progress={subProgress} color="#7b87eb" /><Goal value={formatNumber(yppViews)} total="10M" label="Engaged views Shorts · 90 ngày" progress={viewProgress} color="#42a88b" /></div><div className="prediction"><CircleHelp />API Analytics có thể khác số “valid public Shorts views” trong YouTube Studio. Tab Earn là nguồn quyết định cuối cùng.</div></div><div className="card readiness"><CardTitle title="Số liệu 90 ngày" subtitle="Chỉ nội dung creatorContentType=SHORTS" /><div className="readiness-score"><strong>{formatNumber(yppViews)}</strong></div><div className="check-row"><Play /><span>Views báo cáo</span><b>{formatNumber(Number(data.shorts90.views || 0))}</b></div><div className="check-row"><Users /><span>Subscriber tăng</span><b>+{formatNumber(Number(data.shorts90.subscribersGained || 0))}</b></div><div className="check-row"><Clock3 /><span>Phút xem</span><b>{formatNumber(Number(data.shorts90.estimatedMinutesWatched || 0))}</b></div></div></section></>
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${Math.round(seconds % 60).toString().padStart(2, '0')}`
}

function Metric({ label, value, delta, note, icon, theme }: { label: string; value: string; delta: string; note: string; icon: React.ReactNode; theme: string }) {
  return <div className="card metric"><div className={`metric-icon ${theme}`}>{icon}</div><span>{label}</span><strong>{value}</strong><p><b>{delta}</b> {note}</p></div>
}

function CardTitle({ title, subtitle, action, onClick }: { title: string; subtitle: string; action?: string; onClick?: () => void }) {
  return <div className="card-title"><div><h2>{title}</h2><p>{subtitle}</p></div>{action && <button onClick={onClick}>{action}<ChevronRight size={16} /></button>}</div>
}

function PipelineItem({ item }: { item: ShortItem }) {
  const step = stages.indexOf(item.stage)
  return <div className="pipeline-row"><span className="mini-thumb" style={{ background: `linear-gradient(145deg, ${item.color}, #20212a)` }}><Play fill="white" /></span><div className="pipeline-copy"><b>{item.title}</b><span><i style={{ background: item.color }} />{item.channel}</span></div><div className="stage"><span>{item.stage}</span><div>{stages.slice(1).map((_, index) => <i key={index} className={index < step ? 'done' : index === step ? 'current' : ''} />)}</div></div><span className="avatar">{item.owner}</span><button><MoreHorizontal /></button></div>
}

function ContentBoard({ shorts, setShorts, onNew }: { shorts: ShortItem[]; setShorts: React.Dispatch<React.SetStateAction<ShortItem[]>>; onNew: () => void }) {
  const advance = (item: ShortItem) => {
    const index = stages.indexOf(item.stage)
    if (index < stages.length - 1) setShorts(prev => prev.map(s => s.id === item.id ? { ...s, stage: stages[index + 1] } : s))
  }
  return <>
    <section className="page-heading compact"><div><p>SHORTS PRODUCTION</p><h1>Pipeline nội dung</h1><h3>Đưa mỗi ý tưởng từ bản nháp đến màn hình người xem.</h3></div><button className="primary" onClick={onNew}><Plus size={18} />Tạo Short mới</button></section>
    <div className="board-tools"><div className="filter active">Tất cả <b>{shorts.length}</b></div><div className="filter">Của tôi</div><div className="filter">Cần duyệt</div><button><Search size={17} />Tìm kiếm</button></div>
    <section className="kanban">
      {stages.map(stage => <div className="kanban-col" key={stage}><div className="kanban-head"><span><i className={`dot d${stages.indexOf(stage)}`} />{stage}</span><b>{shorts.filter(s => s.stage === stage).length}</b><MoreHorizontal size={18} /></div>
        {shorts.filter(s => s.stage === stage).map(item => <article className="short-card" key={item.id}><div className="short-preview" style={{ background: `linear-gradient(150deg, ${item.color}, #21232c)` }}><span>9:16</span><Play fill="white" /></div><h3>{item.title}</h3><p><i style={{ background: item.color }} />{item.channel}</p>{item.warning && <div className="warning"><ShieldCheck size={14} />{item.warning}</div>}<footer><span className={item.score == null ? 'score pending' : item.score < 75 ? 'score low' : 'score'}>{item.score == null ? 'Chưa đánh giá' : `${item.score} điểm`}</span><span>{item.owner}</span><button title="Chuyển bước tiếp theo" onClick={() => advance(item)}><ChevronRight /></button></footer></article>)}
        {stage === 'Ý tưởng' && <button className="add-card" onClick={onNew}><Plus size={17} />Thêm ý tưởng</button>}
      </div>)}
    </section>
  </>
}

function vietnamCalendarDate(timestamp: number) {
  const shifted = new Date(timestamp + 7 * 60 * 60 * 1000)
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()))
}

function vietnamDateKey(value: string) {
  const shifted = new Date(new Date(value).getTime() + 7 * 60 * 60 * 1000)
  return shifted.toISOString().slice(0, 10)
}

function calendarDateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function Schedule({ data, loading, error, onRefresh }: { data: YouTubeSchedule | null; loading: boolean; error: string; onRefresh: () => void }) {
  const [today] = useState(() => vietnamCalendarDate(Date.now()))
  const [weekOffset, setWeekOffset] = useState(0)
  const weekStart = new Date(today)
  const mondayOffset = (weekStart.getUTCDay() + 6) % 7
  weekStart.setUTCDate(weekStart.getUTCDate() - mondayOffset + weekOffset * 7)
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart)
    date.setUTCDate(date.getUTCDate() + index)
    return date
  })
  const weekEnd = days[6]
  const sameMonth = weekStart.getUTCMonth() === weekEnd.getUTCMonth()
  const weekLabel = sameMonth
    ? `${weekStart.getUTCDate()} – ${weekEnd.getUTCDate()} tháng ${weekStart.getUTCMonth() + 1}, ${weekStart.getUTCFullYear()}`
    : `${weekStart.getUTCDate()}/${weekStart.getUTCMonth() + 1} – ${weekEnd.getUTCDate()}/${weekEnd.getUTCMonth() + 1}, ${weekEnd.getUTCFullYear()}`
  const todayKey = calendarDateKey(today)

  return <><section className="page-heading compact"><div><p>XUẤT BẢN · DỮ LIỆU THẬT</p><h1>Lịch đăng Shorts</h1><h3>{data ? `${data.videos.length} video đang hẹn giờ trên ${data.channel.title}` : 'Đồng bộ lịch xuất bản trực tiếp từ YouTube.'}</h3></div><div className="heading-actions"><button className="outline" onClick={() => setWeekOffset(0)}>Tuần này</button><button className="outline" disabled={loading} onClick={onRefresh}><RefreshCw className={loading ? 'spin' : ''} />Đồng bộ</button></div></section>
    {error && <ApiError message={error} onRetry={onRefresh} />}
    {data?.unscheduledPrivate?.length ? <div className="schedule-warning"><CircleHelp /><div><b>{data.unscheduledPrivate.length} video Private gần đây chưa có lịch Public.</b><span>{data.unscheduledPrivate.map((video, index) => <span key={video.id}>{index > 0 && ' · '}<a href={video.studioUrl} target="_blank" rel="noreferrer">{video.title}</a></span>)}</span></div></div> : null}
    <div className="card calendar"><div className="calendar-head"><button aria-label="Tuần trước" onClick={() => setWeekOffset(offset => offset - 1)}>‹</button><h2>{weekLabel}</h2><button aria-label="Tuần sau" onClick={() => setWeekOffset(offset => offset + 1)}>›</button></div><div className="week-grid">{days.map((day, index) => {
      const key = calendarDateKey(day)
      const events = data?.videos.filter(video => vietnamDateKey(video.publishAt) === key) || []
      return <div className={`day ${key === todayKey ? 'today' : ''}`} key={key}><header><span>{['T2','T3','T4','T5','T6','T7','CN'][index]}</span><b>{day.getUTCDate()}</b></header>{events.map(video => <a className="calendar-event youtube-event" href={video.studioUrl} target="_blank" rel="noreferrer" key={video.id}>{video.thumbnail && <img src={video.thumbnail} alt="" />}<time>{new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(new Date(video.publishAt))}</time><b>{video.title}</b><span>{data?.channel.title} · Private đến giờ đăng</span></a>)}</div>
    })}</div>{loading && <div className="calendar-loading"><LoaderCircle className="spin" />Đang đồng bộ lịch YouTube…</div>}{!loading && data && !data.videos.length && <div className="calendar-empty"><CalendarDays /><b>Không có video đang hẹn giờ</b><span>Chỉ các video có lịch Public trên kênh đang chọn mới xuất hiện tại đây.</span></div>}</div></>
}

function UploadVideoModal({ channel, onClose, onUploaded }: { channel: ConnectedChannel; onClose: () => void; onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [language, setLanguage] = useState('en-US')
  const [madeForKids, setMadeForKids] = useState('false')
  const [synthetic, setSynthetic] = useState('false')
  const [privacy, setPrivacy] = useState('private')
  const [scheduleAt, setScheduleAt] = useState(defaultVietnamSchedule)
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const [localProgress, setLocalProgress] = useState(0)
  const [job, setJob] = useState<UploadJob | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [currentTime, setCurrentTime] = useState(() => Date.now())
  const pollTimer = useRef<number | null>(null)

  useEffect(() => {
    const validationTimer = window.setInterval(() => setCurrentTime(Date.now()), 30_000)
    return () => {
      window.clearInterval(validationTimer)
      if (pollTimer.current) window.clearTimeout(pollTimer.current)
    }
  }, [])

  const poll = async (jobId: string) => {
    try {
      const next = await youtubeApi.uploadStatus(jobId)
      setJob(next)
      if (next.status === 'uploaded') {
        setSubmitting(false)
        onUploaded()
      } else if (next.status === 'failed') {
        setSubmitting(false)
        setError(next.error || 'YouTube từ chối video.')
      } else {
        pollTimer.current = window.setTimeout(() => void poll(jobId), 1500)
      }
    } catch (pollError) {
      setSubmitting(false)
      setError(pollError instanceof Error ? pollError.message : 'Không thể kiểm tra tiến độ upload.')
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!file || !rightsConfirmed || submitting) return
    setSubmitting(true)
    setError('')
    setLocalProgress(0)
    const form = new FormData()
    form.append('video', file)
    form.append('channelId', channel.id)
    form.append('title', title.trim())
    form.append('description', description.trim())
    form.append('tags', tags)
    form.append('defaultLanguage', language)
    form.append('selfDeclaredMadeForKids', madeForKids)
    form.append('containsSyntheticMedia', synthetic)
    const scheduled = privacy === 'scheduled'
    form.append('privacyStatus', scheduled ? 'private' : privacy)
    if (scheduled) form.append('publishAt', vietnamDateTimeToIso(scheduleAt))
    try {
      const created = await youtubeApi.uploadVideo(form, setLocalProgress)
      setJob(created)
      void poll(created.id)
    } catch (uploadError) {
      setSubmitting(false)
      setError(uploadError instanceof Error ? uploadError.message : 'Không thể tải video.')
    }
  }

  if (!channel.uploadEnabled) {
    return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal upload-modal" onMouseDown={event => event.stopPropagation()}><header><div><span><UploadCloud /></span><div><h2>Cấp quyền đăng video</h2><p>Kênh {channel.title}</p></div></div><button type="button" onClick={onClose}><X /></button></header><div className="upload-permission"><ShieldCheck /><div><b>ShortFlow cần thêm một quyền riêng</b><p>Google sẽ chỉ cấp quyền tải video lên; quyền đọc hiện tại vẫn được giữ nguyên. Mặc định app chọn Private để bạn kiểm tra trước.</p><a className="primary" href={youtubeApi.uploadPermissionUrl(channel.id)}>Cấp quyền qua Google <ExternalLink /></a></div></div></section></div>
  }

  const finished = job?.status === 'uploaded'
  const scheduledIso = privacy === 'scheduled' ? vietnamDateTimeToIso(scheduleAt) : ''
  const scheduleValid = privacy !== 'scheduled' || Boolean(scheduledIso && new Date(scheduledIso).getTime() > currentTime + 60_000)
  const valid = Boolean(file && title.trim() && title.trim().length <= 100 && rightsConfirmed && scheduleValid)
  return <div className="modal-backdrop" onMouseDown={() => { if (!submitting) onClose() }}><form className="modal upload-modal" onMouseDown={event => event.stopPropagation()} onSubmit={submit}><header><div><span><UploadCloud /></span><div><h2>Đăng video lên YouTube</h2><p>{channel.title} · mặc định Private để kiểm duyệt</p></div></div><button type="button" disabled={submitting} onClick={onClose}><X /></button></header><div className="upload-form-body">
    {!job && <>
      <label className="file-drop">File video<input type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv" onChange={event => { const next = event.target.files?.[0] || null; setFile(next); if (next && !title) setTitle(next.name.replace(/\.[^.]+$/, '')) }} />{file ? <span><b>{file.name}</b><small>{(file.size / 1024 / 1024).toFixed(1)} MB</small></span> : <span><UploadCloud /><b>Chọn MP4, MOV, WebM hoặc MKV</b><small>Tối đa 2 GB trong bản local này</small></span>}</label>
      <label>Tiêu đề <small>{title.length}/100</small><input value={title} maxLength={100} onChange={event => setTitle(event.target.value)} placeholder="Tiêu đề tiếng Anh cho viewer quốc tế" /></label>
      <label>Mô tả <small>{description.length}/5000</small><textarea value={description} maxLength={5000} onChange={event => setDescription(event.target.value)} placeholder="Mô tả, nguồn và hashtag..." /></label>
      <div className="upload-fields"><label>Ngôn ngữ<select value={language} onChange={event => setLanguage(event.target.value)}><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="">Không đặt</option></select></label><label>Dành cho trẻ em?<select value={madeForKids} onChange={event => setMadeForKids(event.target.value)}><option value="false">Không</option><option value="true">Có</option></select></label><label>Nội dung AI/tổng hợp?<select value={synthetic} onChange={event => setSynthetic(event.target.value)}><option value="false">Không</option><option value="true">Có</option></select></label></div>
      <label>Chế độ hiển thị<select value={privacy} onChange={event => setPrivacy(event.target.value)}><option value="private">Private — chỉ mình bạn</option><option value="scheduled">Scheduled — hẹn giờ công khai</option><option value="unlisted">Unlisted — ai có link đều xem được</option><option value="public">Public — đăng ngay công khai</option></select></label>
      {privacy === 'scheduled' && <label>Ngày giờ công khai · Việt Nam (UTC+7)<input type="datetime-local" value={scheduleAt} onChange={event => setScheduleAt(event.target.value)} />{!scheduleValid && <span className="field-error">Thời gian phải cách hiện tại ít nhất 1 phút.</span>}</label>}
      <label>Tags<input value={tags} onChange={event => setTags(event.target.value)} placeholder="shorts, facts, english" /></label>
      <label className="check-label"><input type="checkbox" checked={rightsConfirmed} onChange={event => setRightsConfirmed(event.target.checked)} /><span>Tôi xác nhận có quyền sử dụng video, nhạc và mọi tài nguyên trong file này.</span></label>
      <div className="private-note"><ShieldCheck />Khuyến nghị dùng <b>Private</b> để kiểm tra xử lý và bản quyền trước. Project chưa qua API audit có thể bị YouTube ép về Private.</div>
    </>}
    {job && <div className={`upload-progress-state ${job.status}`}><span>{finished ? <Check /> : job.status === 'failed' ? <X /> : <LoaderCircle className="spin" />}</span><h3>{finished ? job.publishAt ? 'Đã tải và hẹn giờ thành công' : 'Đã tải video lên YouTube' : job.status === 'failed' ? 'Upload thất bại' : job.status === 'queued' ? 'Đang chờ tới lượt' : 'Đang gửi lên YouTube'}</h3><p>{job.originalName}</p>{job.publishAt && <p className="scheduled-time"><Clock3 /> Công khai lúc {formatVietnamDateTime(job.publishAt)} (UTC+7)</p>}{job.warning && <p className="upload-warning">{job.warning}</p>}<div className="upload-progress"><i style={{ width: `${job.progress}%` }} /></div><b>{job.progress}%</b>{finished && <div className="result-links"><a className="outline" href={job.youtubeUrl} target="_blank" rel="noreferrer">Mở YouTube <ExternalLink /></a><a className="primary" href={job.studioUrl} target="_blank" rel="noreferrer">Kiểm tra trong Studio <ExternalLink /></a></div>}</div>}
    {submitting && !job && <div className="local-progress"><span>Đang chép file vào ShortFlow…</span><b>{localProgress}%</b><i><em style={{ width: `${localProgress}%` }} /></i></div>}
    {error && <p className="upload-error">{error}</p>}
  </div><footer><button type="button" className="outline" disabled={submitting} onClick={onClose}>{finished ? 'Đóng' : 'Hủy'}</button>{!job && <button className="primary" disabled={!valid || submitting}>{submitting ? <LoaderCircle className="spin" /> : <UploadCloud />}Upload video</button>}</footer></form></div>
}

function Goal({ value, total, label, progress, color }: { value: string; total: string; label: string; progress: number; color: string }) { return <div className="goal"><span>{label}</span><b>{value} <small>/ {total}</small></b><div className="progress"><i style={{ width: `${progress}%`, background: color }} /></div><p>{Math.min(progress, 100).toFixed(1)}% hoàn thành</p></div> }

function NewShortModal({ channelName, onClose, onSubmit }: { channelName: string; onClose: () => void; onSubmit: (item: Omit<ShortItem, 'id' | 'score' | 'owner' | 'color' | 'date'>) => void }) {
  const [title, setTitle] = useState('')
  const channel = channelName
  const valid = useMemo(() => title.trim().length > 5, [title])
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onMouseDown={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); if (valid) onSubmit({ title, channel, stage: 'Ý tưởng' }) }}><header><div><span><Lightbulb /></span><div><h2>Tạo Short mới</h2><p>Bắt đầu bằng một ý tưởng rõ ràng.</p></div></div><button type="button" onClick={onClose}><X /></button></header><label>Ý tưởng hoặc tiêu đề<textarea autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Ví dụ: 3 sai lầm tiền bạc phổ biến ở tuổi 20..." /></label><label>Kênh<select value={channel} disabled><option>{channel}</option></select></label><div className="ai-suggest"><Sparkles /><div><b>ShortFlow AI</b><p>Sau khi tạo, AI có thể giúp phát triển hook, kịch bản 60 giây và shot list.</p></div></div><footer><button type="button" className="outline" onClick={onClose}>Hủy</button><button className="primary" disabled={!valid}>Tạo nội dung <ChevronRight /></button></footer></form></div>
}
