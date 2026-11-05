import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  useDeleteInboxUpload,
  useGetInbox,
  useGetInboxMedia,
  useGetInboxStats,
  useGetTelegramStatus,
  useHealthCheck,
  useSendUploads,
  getGetInboxQueryKey,
  getGetInboxMediaQueryKey,
  getGetInboxStatsQueryKey,
  getGetTelegramStatusQueryKey,
  getHealthCheckQueryKey,
} from '@workspace/api-client-react';
import type { UploadItem } from '@workspace/api-client-react';
import {
  ArrowRight, Check, CheckCircle2, CircleHelp, Clock3,
  CloudUpload, FileImage, FileVideo, Film, Image, LoaderCircle, Menu, MessageCircle,
  Plus, RefreshCw, Search, Send, ShieldCheck, Trash2, TriangleAlert, X,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();
const MAX_FILE = 50 * 1024 * 1024;
const MAX_BATCH = 80 * 1024 * 1024;
const MAX_FILES = 20;

type FileOutcome = {
  status: 'sent' | 'failed' | 'unknown';
  message: string;
};
type StagedFile = { id: string; file: File; outcome?: FileOutcome };

const VIDEO_EXTENSIONS = new Set(['.3gp', '.avi', '.m4v', '.mkv', '.mov', '.mp4', '.mpeg', '.mpg', '.webm']);
const IMAGE_EXTENSIONS = new Set(['.avif', '.bmp', '.gif', '.heic', '.heif', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp']);

function mediaKind(file: File): 'photo' | 'video' | null {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (file.type === 'image/svg+xml' || extension === '.svg') return null;
  if (file.type.startsWith('video/') || VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (file.type.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) return 'photo';
  return null;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('fil-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileNav, setMobileNav] = useState(false);
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <Link href="/" className="brand" onClick={() => setMobileNav(false)} data-testid="link-brand">
          <span className="brand-symbol"><Send size={18} strokeWidth={2.4} /></span>
          <span><strong>telegram drop</strong><small>shared media, safely sent</small></span>
        </Link>
        <div className="nav-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          <Link href="/" className={`nav-link ${location === '/' ? 'active' : ''}`} onClick={() => setMobileNav(false)} data-testid="link-upload">
            <CloudUpload size={18} /><span>Magpadala</span><span className="nav-index">01</span>
          </Link>
          <Link href="/inbox" className={`nav-link ${location === '/inbox' ? 'active' : ''}`} onClick={() => setMobileNav(false)} data-testid="link-inbox">
            <Image size={18} /><span>Mga ipinadala</span><span className="nav-index">02</span>
          </Link>
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-note">
          <span className="note-mark"><ShieldCheck size={16} /></span>
          <p>Private by design</p>
          <small>Hindi namin iniimbak ang bot token sa browser.</small>
        </div>
        <div className="sidebar-footer"><span className="status-dot" /> Team workspace <span className="footer-version">v1.0</span></div>
      </aside>
      {mobileNav && <button aria-label="Close navigation" className="mobile-scrim" onClick={() => setMobileNav(false)} />}
      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMobileNav(true)} data-testid="button-menu"><Menu size={20} /></button>
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{location === '/inbox' ? 'Sent media' : 'New drop'}</strong></div>
          <div className="topbar-right"><span className="topbar-chip"><span className="status-dot" /> Secure connection</span><span className="avatar">T</span></div>
        </header>
        {children}
      </main>
    </div>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`status-pill ${ok ? 'is-good' : 'is-warn'}`}><span className="status-dot" />{label}</span>;
}

function TelegramHealth() {
  const queryClient = useQueryClient();
  const { data: status, isLoading, isError, refetch, isFetching } = useGetTelegramStatus();
  const { data: health, isError: healthError, isLoading: healthLoading } = useHealthCheck();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetTelegramStatusQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getHealthCheckQueryKey() });
    void refetch();
  };
  const allGood = !!status?.configured && !!status.chatConfigured && !!status.botConnected && !!status.destinationAccessible;
  const checks = [
    ['Bot token', status?.configured],
    ['Destination chat', status?.chatConfigured && status?.destinationAccessible],
    ['Bot connection', status?.botConnected],
  ] as const;
  return (
    <section className="connection-card" aria-label="Telegram connection status" data-testid="status-telegram">
      <div className="connection-top">
        <div className="connection-icon"><MessageCircle size={18} /></div>
        <div className="connection-copy"><strong>Telegram destination</strong><span>{isLoading ? 'Sinusuri ang koneksyon…' : allGood ? 'Handa na para magpadala' : 'Kailangan ng pagsusuri'}</span></div>
        <StatusPill ok={!isLoading && allGood} label={isLoading ? 'Checking' : allGood ? 'Connected' : 'Check setup'} />
      </div>
      <div className="connection-checks">
        {checks.map(([label, okay]) => <span key={label} className={`check-item ${okay ? 'check-ok' : ''}`}><span className="tiny-check">{okay ? <Check size={11} /> : <span />}</span>{label}</span>)}
        <span className="check-item check-muted"><span className="tiny-check"><Check size={11} /></span>Server {health?.status || (healthLoading ? 'checking' : healthError ? 'unavailable' : 'unknown')}</span>
      </div>
      {!allGood && status?.diagnostic && <p className="diagnostic"><TriangleAlert size={14} />{status.diagnostic}</p>}
      {isError && <p className="diagnostic"><TriangleAlert size={14} />Hindi maabot ang Telegram status. Tingnan ang koneksyon at subukan muli.</p>}
      <button className="refresh-link" onClick={refresh} disabled={isFetching} data-testid="button-refresh-status"><RefreshCw size={13} className={isFetching ? 'spin' : ''} /> Suriin muli</button>
    </section>
  );
}

function UploadPage() {
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [caption, setCaption] = useState('');
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const sendUploads = useSendUploads();
  const { data: telegramStatus, isLoading: statusLoading } = useGetTelegramStatus();
  const telegramReady = !!telegramStatus?.configured
    && !!telegramStatus.chatConfigured
    && !!telegramStatus.botConnected
    && !!telegramStatus.destinationAccessible;
  const totalBytes = staged.reduce((sum, entry) => sum + entry.file.size, 0);
  const allOutcome = staged.length > 0 && staged.every((entry) => entry.outcome);
  const sendable = staged.filter((entry) => !entry.outcome || entry.outcome.status === 'failed');
  const acceptedFiles = (fileList: FileList | File[]) => {
    const candidates = Array.from(fileList);
    let message = '';
    const good: File[] = [];
    for (const file of candidates) {
      if (!mediaKind(file)) {
        message = `${file.name}: image o video lang ang puwedeng ipadala.`;
      } else if (file.size > MAX_FILE) {
        message = `${file.name}: lampas sa 50 MB na limit.`;
      } else good.push(file);
    }
    const existing = staged.reduce((sum, entry) => sum + entry.file.size, 0);
    const slots = MAX_FILES - staged.length;
    const admitted: File[] = [];
    let batch = existing;
    for (const file of good) {
      if (admitted.length >= slots) { message = `Hanggang ${MAX_FILES} file lang sa isang drop.`; break; }
      if (batch + file.size > MAX_BATCH) { message = 'Lampas sa 80 MB ang kabuuang laki ng batch.'; continue; }
      admitted.push(file);
      batch += file.size;
    }
    if (admitted.length) setStaged((current) => [...current, ...admitted.map((file) => ({ id: crypto.randomUUID(), file }))]);
    setNotice(message);
    if (fileInput.current) fileInput.current.value = '';
  };
  const removeFile = (index: number) => setStaged((current) => current.filter((_, i) => i !== index));
  const submit = () => {
    if (!sendable.length || sendUploads.isPending || !telegramReady) return;
    setNotice('');
    const batch = sendable;
    const batchIds = new Set(batch.map((entry) => entry.id));
    sendUploads.mutate({ data: { files: batch.map((entry) => entry.file), caption: caption.trim() || undefined } }, {
      onSuccess: (result) => {
        const outcomes = new Map<number, FileOutcome>();
        result.sent.forEach((item) => {
          if (typeof item.batchIndex === 'number') {
            outcomes.set(item.batchIndex, { status: 'sent', message: 'Naipadala sa Telegram.' });
          }
        });
        result.failed.forEach((item) => {
          outcomes.set(item.batchIndex, {
            status: item.delivered === true ? 'sent' : item.delivered === false ? 'failed' : 'unknown',
            message: item.error,
          });
        });
        setStaged((current) => current.map((entry) => {
          const index = batch.findIndex((item) => item.id === entry.id);
          return index < 0 ? entry : {
            ...entry,
            outcome: outcomes.get(index) ?? {
              status: 'unknown',
              message: 'Walang kumpirmasyon para sa file na ito. Tingnan muna ang Telegram bago muling ipadala.',
            },
          };
        }));
        void queryClient.invalidateQueries({ queryKey: getGetInboxQueryKey({ limit: 100 }) });
        void queryClient.invalidateQueries({ queryKey: getGetInboxStatsQueryKey() });
        const confirmed = [...outcomes.values()].filter((outcome) => outcome.status === 'sent').length;
        const rejected = [...outcomes.values()].filter((outcome) => outcome.status === 'failed').length;
        const unknown = [...outcomes.values()].filter((outcome) => outcome.status === 'unknown').length;
        setNotice([
          `${confirmed} kumpirmadong naipadala`,
          rejected ? `${rejected} hindi tinanggap — puwedeng subukang muli` : '',
          unknown ? `${unknown} walang kumpirmasyon — tingnan muna ang Telegram bago muling ipadala` : '',
        ].filter(Boolean).join(' · ') + '.');
      },
      onError: (error) => {
        const message = (error as { error?: string }).error || (error instanceof Error ? error.message : 'Hindi naipadala ang batch. Subukan muli.');
        const statusCode = (error as { status?: number }).status;
        const definitelyNotSent = [400, 413, 429, 503].includes(statusCode ?? 0);
        setStaged((current) => current.map((entry) => batchIds.has(entry.id) ? {
          ...entry,
          outcome: {
            status: definitelyNotSent ? 'failed' : 'unknown',
            message: definitelyNotSent ? message : `${message} Tingnan muna ang Telegram bago muling ipadala.`,
          },
        } : entry));
        setNotice(definitelyNotSent
          ? 'Hindi tinanggap ang batch. Maaari mong ayusin ang problema at subukang muli.'
          : 'Walang kumpirmasyon sa delivery. Tingnan muna ang Telegram bago muling ipadala.');
      },
    });
  };
  const clearSent = () => setStaged((current) => current.filter((entry) => entry.outcome?.status !== 'sent'));
  const allowUncertainRetry = (id: string) => setStaged((current) => current.map((entry) => entry.id === id
    ? { ...entry, outcome: { status: 'failed', message: 'Manwal na pinili ang muling pagpapadala. Maaaring madoble kung naipadala na ito.' } }
    : entry));
  const remainingCaption = 1024 - caption.length;
  return (
    <div className="page-content upload-page">
      <div className="page-heading">
        <div><div className="eyebrow"><span className="eyebrow-line" /> SHARED MEDIA DROP</div><h1>Ipadala sa<br className="mobile-break" /> <em>isang tap.</em></h1><p className="page-intro">Pumili ng mga larawan o video. Lahat ng ipinadala ay makikita ng team sa iisang inbox.</p></div>
        <div className="heading-aside"><span className="drop-number">01</span><span>UPLOAD<br />& SEND</span></div>
      </div>
      <TelegramHealth />
      <div className="upload-layout">
        <section className="upload-panel">
          <div className="section-heading"><div><span className="section-kicker">01 — SELECT MEDIA</span><h2>Idagdag ang files</h2></div><span className="file-count">{staged.length} / {MAX_FILES}</span></div>
          <div className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); acceptedFiles(e.dataTransfer.files); }}>
            <input ref={fileInput} className="file-input" type="file" accept="image/*,video/*,.heic,.heif,.tif,.tiff,.avif,.3gp,.avi,.mkv,.webm" multiple onChange={(e) => e.target.files && acceptedFiles(e.target.files)} data-testid="input-media-files" />
            <div className="drop-art"><span className="drop-art-ring"><CloudUpload size={26} /></span><span className="art-spark spark-one" /><span className="art-spark spark-two" /></div>
            <h3>I-drop ang media dito</h3><p>o pumili mula sa iyong device</p>
            <button className="button button-secondary browse-button" onClick={() => fileInput.current?.click()} data-testid="button-browse"><Plus size={16} /> Pumili ng files</button>
          <div className="drop-limits"><span>JPG, PNG, GIF, MP4</span><i /> hanggang 50 MB bawat file <i /> 20 files / 80 MB bawat batch</div>
          </div>
          {notice && <div className={`inline-notice ${sendUploads.isError ? 'notice-error' : ''}`} role="status" data-testid="status-upload-notice"><CircleHelp size={15} />{notice}<button aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={15} /></button></div>}
          {staged.length > 0 && <div className="staged-area">
            <div className="staged-heading"><span>Mga napiling file <b>{staged.length}</b></span><span>{formatBytes(totalBytes)} / 80 MB</span></div>
            <ul className="file-list">
              {staged.map(({ file, outcome }, index) => <li className={`file-row ${outcome?.status === 'sent' ? 'file-sent' : outcome?.status === 'failed' ? 'file-failed' : ''}`} key={staged[index].id} data-testid={`file-row-${index}`}>
                <span className={`file-type-icon ${mediaKind(file) === 'video' ? 'video-icon' : ''}`}>{mediaKind(file) === 'video' ? <FileVideo size={17} /> : <FileImage size={17} />}</span>
                <span className="file-meta"><strong title={file.name}>{file.name}</strong><small>{formatBytes(file.size)}{outcome && <span className="file-outcome"> · {outcome.message}</span>}</small></span>
                {outcome?.status === 'sent'
                  ? <CheckCircle2 className="outcome-icon success" size={17} />
                  : outcome?.status === 'unknown'
                    ? <button className="retry-uncertain" onClick={() => allowUncertainRetry(staged[index].id)} aria-label={`Retry ${file.name} even though delivery is uncertain`} data-testid={`button-retry-uncertain-${index}`}>Retry anyway</button>
                    : outcome?.status === 'failed'
                      ? <button className="remove-file" onClick={() => removeFile(index)} aria-label={`Remove failed file ${file.name}`} data-testid={`button-remove-file-${index}`}><X size={16} /></button>
                      : <button className="remove-file" onClick={() => removeFile(index)} aria-label={`Remove ${file.name}`} data-testid={`button-remove-file-${index}`}><X size={16} /></button>}
              </li>)}
            </ul>
            <div className="batch-meter"><span style={{ width: `${Math.min(100, totalBytes / MAX_BATCH * 100)}%` }} /></div>
          </div>}
          <div className="caption-field">
            <div className="caption-label"><label htmlFor="caption">Caption <span>(optional)</span></label><span className={remainingCaption < 60 ? 'caption-warning' : ''}>{caption.length.toLocaleString()} / 1,024</span></div>
            <textarea id="caption" value={caption} maxLength={1024} onChange={(e) => setCaption(e.target.value)} placeholder="Magdagdag ng maikling mensahe sa team…" data-testid="input-caption" />
          </div>
          <div className="send-row">
            <div className="send-note"><ShieldCheck size={15} /><span>Direktang ipinapadala sa inyong Telegram chat. Maaaring lumampas sa 15 segundo depende sa laki at koneksyon.</span></div>
            <button className="button button-primary send-button" disabled={!sendable.length || sendUploads.isPending || totalBytes > MAX_BATCH || !telegramReady} onClick={submit} data-testid="button-send">
              {sendUploads.isPending ? <><LoaderCircle className="spin" size={17} /> Ipinapadala…</> : sendable.some((entry) => entry.outcome?.status === 'failed')
                ? <><RefreshCw size={16} /> Subukang muli ang {sendable.length} file <ArrowRight size={16} /></>
                : <><Send size={16} /> Ipadala sa Telegram <ArrowRight size={16} /></>}
            </button>
            {!statusLoading && !telegramReady && <p className="send-blocked" role="status">Hindi muna maipapadala hangga’t hindi handa ang bot at destination chat.</p>}
          </div>
          {allOutcome && staged.some((entry) => entry.outcome?.status === 'sent') && <button className="text-action clear-sent" onClick={clearSent} data-testid="button-clear-sent">Alisin ang matagumpay na naipadala <ArrowRight size={14} /></button>}
        </section>
        <aside className="side-column">
          <div className="how-card"><span className="section-kicker">HOW IT WORKS</span><div className="steps">
            <div className="step"><span>1</span><div><strong>Pumili ng media</strong><small>Mga larawan at video mula sa device mo.</small></div></div>
            <div className="step"><span>2</span><div><strong>Ipadala nang sabay</strong><small>Bawat file ay may sariling resulta.</small></div></div>
            <div className="step"><span>3</span><div><strong>Hanapin sa inbox</strong><small>Balikan at i-preview anumang oras.</small></div></div>
          </div><Link href="/inbox" className="text-action inbox-link" data-testid="link-view-inbox">Buksan ang sent inbox <ArrowRight size={14} /></Link></div>
          <div className="limits-card"><div className="limits-title"><CircleHelp size={15} /><strong>Mga limit</strong></div><p>1–20 files bawat batch. 50 MB bawat file, hanggang 80 MB lahat-lahat.</p><p>Ang malalaking larawan ay ipinapadala bilang dokumento para mapanatili ang kalidad.</p></div>
        </aside>
      </div>
    </div>
  );
}

function MediaCard({ item, onDelete }: { item: UploadItem; onDelete: (item: UploadItem) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const { data: media, isLoading, isError, refetch } = useGetInboxMedia(item.id, {
    query: { enabled: showPreview, queryKey: getGetInboxMediaQueryKey(item.id), staleTime: 5 * 60 * 1000 },
  });
  const mediaUrl = useMemo(() => media ? URL.createObjectURL(media) : '', [media]);
  useEffect(() => () => { if (mediaUrl) URL.revokeObjectURL(mediaUrl); }, [mediaUrl]);
  const isVideo = item.mediaType === 'video';
  return (
    <article className="media-card" data-testid={`card-media-${item.id}`}>
      <div className="media-preview">
        {!showPreview && <button className="preview-trigger" onClick={() => setShowPreview(true)} aria-label={`Load preview for ${item.fileName}`} data-testid={`button-preview-${item.id}`}><span className="preview-mark">{isVideo ? <Film size={20} /> : <Image size={20} />}</span><strong>I-preview</strong><small>Stream mula sa Telegram</small></button>}
        {isLoading && <div className="media-loading"><span className="skeleton-block" /><span className="skeleton-label" /></div>}
        {isError && <div className="media-unavailable"><TriangleAlert size={22} /><span>Hindi ma-load ang preview</span><button onClick={() => void refetch()}>Subukan muli</button></div>}
        {!isLoading && !isError && mediaUrl && (isVideo ? <video src={mediaUrl} controls preload="metadata" aria-label={`Preview ${item.fileName}`} /> : <img src={mediaUrl} alt={item.fileName} loading="lazy" />)}
        {!isLoading && !isError && !mediaUrl && <div className="media-unavailable"><FileImage size={23} /><span>Walang preview</span></div>}
        <span className="media-type-badge">{isVideo ? <><Film size={12} /> VIDEO</> : <><Image size={12} /> PHOTO</>}</span>
      </div>
      <div className="media-card-body">
        <div className="media-title-row"><h3 title={item.fileName}>{item.fileName}</h3><button className="delete-icon" aria-label={`Remove ${item.fileName} from website inbox`} onClick={() => setConfirming(true)} data-testid={`button-delete-${item.id}`}><Trash2 size={16} /></button></div>
        {item.caption && <p className="media-caption">{item.caption}</p>}
        <div className="media-card-foot"><span><Clock3 size={13} />{formatDate(item.sentAt)}</span><span>{formatBytes(item.sizeBytes)}</span></div>
      </div>
      {confirming && <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby={`confirm-title-${item.id}`}>
        <div className="confirm-box"><span className="confirm-icon"><Trash2 size={18} /></span><h3 id={`confirm-title-${item.id}`}>Alisin sa website inbox?</h3><p>Hindi nito buburahin ang mensahe sa Telegram. Mawawala lang ang item sa listahang ito.</p><div className="confirm-actions"><button className="button button-quiet" onClick={() => setConfirming(false)} data-testid={`button-cancel-delete-${item.id}`}>Kanselahin</button><button className="button button-danger" onClick={() => { onDelete(item); setConfirming(false); }} data-testid={`button-confirm-delete-${item.id}`}>Alisin sa inbox</button></div></div>
      </div>}
    </article>
  );
}

function InboxPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const queryClient = useQueryClient();
  const inboxParams = useMemo(() => ({ limit: 100, search: debouncedSearch || undefined }), [debouncedSearch]);
  const { data: inbox, isLoading, isError, refetch, isFetching } = useGetInbox(inboxParams, { query: { queryKey: getGetInboxQueryKey(inboxParams) } });
  const { data: stats, isLoading: statsLoading } = useGetInboxStats();
  const deleteUpload = useDeleteInboxUpload();
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);
  const remove = (item: UploadItem) => {
    setDeleteError('');
    deleteUpload.mutate({ uploadId: item.id }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetInboxQueryKey(inboxParams) });
        void queryClient.invalidateQueries({ queryKey: getGetInboxStatsQueryKey() });
      },
      onError: (error) => setDeleteError(error instanceof Error ? error.message : 'Hindi naalis ang item. Subukan muli.'),
    });
  };
  const items = inbox?.items ?? [];
  return (
    <div className="page-content inbox-page">
      <div className="page-heading inbox-heading">
        <div><div className="eyebrow"><span className="eyebrow-line" /> TEAM ARCHIVE</div><h1>Sent <em>inbox.</em></h1><p className="page-intro">Mga larawang at video na ipinadala sa Telegram chat ng team.</p></div>
        <Link href="/" className="button button-primary heading-cta" data-testid="link-new-drop"><Plus size={16} /> Bagong drop</Link>
      </div>
      <div className="stats-strip">
        <div className="stat-block"><span className="stat-label">TOTAL SENT</span><strong>{statsLoading ? <span className="stat-skeleton" /> : stats?.totalSent ?? '—'}</strong><small>media items</small></div>
        <div className="stat-divider" />
        <div className="stat-block"><span className="stat-label">SENT TODAY</span><strong>{statsLoading ? <span className="stat-skeleton" /> : stats?.sentToday ?? '—'}</strong><small>media items</small></div>
        <div className="stats-annotation"><span className="annotation-line" /> Shared with your team</div>
      </div>
      <div className="inbox-toolbar">
        <div className="toolbar-title"><div><span className="section-kicker">YOUR LIBRARY</span><h2>Mga ipinadala <span>{items.length}</span></h2></div></div>
        <div className="inbox-actions">
          <label className="search-field"><Search size={17} /><input type="search" placeholder="Maghanap ng media…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search sent media" data-testid="input-inbox-search" />{search && <button onClick={() => setSearch('')} aria-label="Clear search" data-testid="button-clear-search"><X size={14} /></button>}</label>
          <button className="icon-button refresh-inbox" aria-label="Refresh inbox" onClick={() => void refetch()} disabled={isFetching} data-testid="button-refresh-inbox"><RefreshCw size={16} className={isFetching ? 'spin' : ''} /></button>
        </div>
      </div>
      {deleteError && <div className="inline-notice notice-error" role="alert"><TriangleAlert size={15} />{deleteError}<button aria-label="Dismiss error" onClick={() => setDeleteError('')}><X size={15} /></button></div>}
      {deleteUpload.isPending && <div className="delete-progress"><LoaderCircle size={14} className="spin" /> Inaalis ang media item…</div>}
      {isLoading ? <div className="media-grid">{[0, 1, 2, 3].map((n) => <div className="media-skeleton" key={n}><div /><span /><i /></div>)}</div>
        : isError ? <div className="state-card error-state"><span className="state-icon"><TriangleAlert size={21} /></span><h3>Hindi ma-load ang inbox</h3><p>May problema sa pagkuha ng ipinadalang media.</p><button className="button button-secondary" onClick={() => void refetch()} data-testid="button-retry-inbox"><RefreshCw size={15} /> Subukan muli</button></div>
        : items.length ? <div className="media-grid">{items.map((item) => <MediaCard key={item.id} item={item} onDelete={remove} />)}</div>
        : <div className="state-card empty-state"><span className="empty-stack"><Image size={23} /><Film size={17} /></span><span className="section-kicker">{search ? 'NO MATCHES' : 'A QUIET INBOX'}</span><h3>{search ? 'Walang nakita.' : 'Wala pang ipinapadala.'}</h3><p>{search ? 'Subukan ang ibang pangalan ng file o keyword.' : 'Kapag may ipinadala ka, dito mo ito makikita at mapapanood.'}</p>{search ? <button className="text-action" onClick={() => setSearch('')} data-testid="button-reset-search">I-clear ang paghahanap <ArrowRight size={14} /></button> : <Link href="/" className="button button-primary" data-testid="link-first-drop"><CloudUpload size={16} /> Magsimula ng drop</Link>}</div>}
      <div className="inbox-footnote"><ShieldCheck size={14} /><span>Ang pag-alis rito ay hindi nagtatanggal ng mensahe sa Telegram.</span><span className="footnote-divider" /><span>Streamed securely from your team chat.</span></div>
    </div>
  );
}

function Router() {
  return <RoutedErrorBoundary><AppShell><Switch><Route path="/" component={UploadPage} /><Route path="/inbox" component={InboxPage} /><Route component={NotFound} /></Switch></AppShell></RoutedErrorBoundary>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
