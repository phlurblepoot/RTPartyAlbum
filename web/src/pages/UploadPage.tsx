import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Photo, PublicEvent, Theme } from '../api/types';
import { connectSocket, joinEventRoom } from '../lib/socket';
import { getPublicEvent, uploadFiles, ApiError } from '../api/client';
import { getDeviceId } from '../lib/deviceId';
import { themeToCssVars, backgroundStyle } from '../lib/themeCss';
import { useUploaderName } from '../lib/useUploaderName';
import { downscaleImage } from '../lib/downscaleImage';
import { classifyFile, validateFiles } from '../lib/validateUpload';
import { readVideoDurationSec } from '../lib/videoDuration';
import { DEFAULT_MEDIA_LIMITS, type MediaLimits } from '@rtpa/shared';
import './UploadPage.css';

interface Contribution {
  id: string;
  thumbUrl: string;
}

/**
 * Map a failed upload's ApiError to a friendly, guest-facing message.
 * Keyed off the parsed server error `code`, with HTTP-status fallbacks.
 */
function uploadErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'uploads_closed':
        return 'Uploads just closed — sorry!';
      case 'too_many_uploads':
        return 'Slow down a moment — too many uploads at once. Try again shortly.';
      case 'photo_too_large':
      case 'video_too_large':
        return "That file is too big — it didn't make it.";
      case 'unsupported_type':
        return "That file type isn't supported.";
      default:
        if (err.status === 403) return 'Uploads just closed — sorry!';
        if (err.status === 429) return 'Slow down a moment — try again shortly.';
        if (err.status === 413) return "That file is too big — it didn't make it.";
        return 'Something went wrong. Please try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function rejectionMessage(
  file: File,
  reason: 'bad-type' | 'too-large',
  limits: MediaLimits,
): string {
  if (reason === 'bad-type') return `${file.name} isn't a supported photo or video`;
  const cap = classifyFile(file) === 'video' ? limits.videoMaxBytes : limits.photoMaxBytes;
  return `${file.name} is too large (max ${formatMb(cap)})`;
}

/**
 * Videos over the duration cap are still accepted — the server keeps the first N
 * seconds — but the guest should know before it uploads. Unknown durations pass.
 */
async function longVideoNotices(files: File[], maxSec: number): Promise<string[]> {
  const videos = files.filter((f) => classifyFile(f) === 'video');
  const durations = await Promise.all(videos.map((f) => readVideoDurationSec(f)));
  return videos.flatMap((f, i) => {
    const d = durations[i];
    return d !== null && d > maxSec + 0.5
      ? [`${f.name} is longer than ${maxSec}s — only the first ${maxSec} seconds will be shown.`]
      : [];
  });
}

export default function UploadPage() {
  const { code = '' } = useParams<{ code: string }>();
  const { name, setName } = useUploaderName();
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [rejections, setRejections] = useState<string[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [uploadStep, setUploadStep] = useState<{ index: number; total: number } | null>(null);
  const [namePrompt, setNamePrompt] = useState(false);

  const eventQuery = useQuery({
    queryKey: ['public-event', code],
    queryFn: () => getPublicEvent(code),
  });

  const event = eventQuery.data;

  // Live event state: when the host pauses/resumes/ends uploads, changes the media
  // limits, or edits the theme, an open page updates in place instead of letting
  // the guest pick files only to be told "uploads closed" after the fact.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!code) return;
    const key = ['public-event', code];
    const socket = connectSocket();
    const refetch = () => void queryClient.invalidateQueries({ queryKey: key });
    const leaveRoom = joinEventRoom(socket, code, refetch);
    const onEvent = (next: PublicEvent) => queryClient.setQueryData(key, next);
    const onTheme = (theme: Theme) =>
      queryClient.setQueryData<PublicEvent>(key, (prev) => (prev ? { ...prev, theme } : prev));
    socket.on('event:updated', onEvent);
    socket.on('theme:updated', onTheme);
    return () => {
      leaveRoom();
      socket.off('event:updated', onEvent);
      socket.off('theme:updated', onTheme);
    };
  }, [code, queryClient]);

  const pageStyle = useMemo(() => {
    if (!event) return {};
    return {
      ...themeToCssVars(event.theme.tokens),
      ...backgroundStyle(event.theme.tokens),
      fontFamily: 'var(--rtpa-font)',
    };
  }, [event]);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || !event) return;
    setUploadErrors([]);

    // Validate against the host's current limits (falls back to the defaults if
    // an older server didn't send them).
    const limits = event.mediaLimits ?? DEFAULT_MEDIA_LIMITS;
    const picked = Array.from(fileList);
    const { accepted, rejected } = validateFiles(picked, limits);

    // Replace (don't accumulate) so each pick shows only its own rejections,
    // symmetric with how uploadError is cleared above.
    setRejections(rejected.map((r) => rejectionMessage(r.file, r.reason, limits)));
    setNotices([]);

    if (accepted.length === 0) return;

    // A non-empty name is required to upload (it's shown alongside the media).
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNamePrompt(true);
      return;
    }
    setNamePrompt(false);

    setNotices(await longVideoNotices(accepted, limits.videoMaxDurationSec));

    const prepared = await Promise.all(accepted.map((f) => downscaleImage(f)));

    // One request per file: a single bad or oversized file no longer sinks the
    // whole pick, each success shows up as soon as it lands, and a flaky party
    // connection only has to retry one file's worth of bytes.
    setUploading(true);
    setProgress(0);
    const total = prepared.length;
    const failures: string[] = [];
    try {
      for (let i = 0; i < total; i += 1) {
        const file = prepared[i];
        setUploadStep({ index: i, total });
        try {
          const photos = await uploadFiles(code, {
            uploaderName: trimmedName,
            deviceId: getDeviceId(),
            files: [file],
            onProgress: (fraction) => setProgress((i + fraction) / total),
          });
          const next: Contribution[] = photos.map((p: Photo) => ({
            id: p.id,
            thumbUrl: p.thumbUrl,
          }));
          setContributions((prev) => [...next, ...prev]);
        } catch (err) {
          const message = uploadErrorMessage(err);
          failures.push(total > 1 ? `${file.name}: ${message}` : message);
          // Closed or rate-limited: the remaining files would fail the same way.
          const errCode = err instanceof ApiError ? err.code : null;
          const status = err instanceof ApiError ? err.status : 0;
          if (errCode === 'uploads_closed' || status === 403 || status === 429) {
            const skipped = total - i - 1;
            if (skipped > 0) failures.push(`${skipped} more not sent.`);
            break;
          }
        }
      }
    } finally {
      setUploadErrors(failures);
      setUploading(false);
      setUploadStep(null);
    }
  }

  if (eventQuery.isLoading) {
    return (
      <div className="rtpa-upload rtpa-upload--state" data-testid="upload-page">
        <p data-testid="upload-loading">Loading the party… {code}</p>
      </div>
    );
  }

  if (eventQuery.isError || !event) {
    const notFound = eventQuery.error instanceof ApiError && eventQuery.error.status === 404;
    return (
      <div className="rtpa-upload rtpa-upload--state" data-testid="upload-page">
        <p data-testid="upload-error">
          {notFound
            ? "We can't find that party — double-check the link or QR code."
            : 'Something went wrong loading the party. Please try again.'}
        </p>
      </div>
    );
  }

  const closed = !event.uploadEnabled || event.status === 'ended';

  return (
    <div className="rtpa-upload" data-testid="upload-page" style={pageStyle}>
      <header className="rtpa-upload__header">
        <h1 className="rtpa-upload__title">{event.name}</h1>
        <p className="rtpa-upload__note">
          📸 Please be responsible — your name shows with what you add, and the host can remove
          anything.
        </p>
      </header>

      {closed ? (
        <section className="rtpa-upload__closed" data-testid="upload-closed">
          <p>Uploads are closed for this party. Thanks for celebrating! 🎉</p>
        </section>
      ) : (
        <section className="rtpa-upload__body">
          <label className="rtpa-upload__field">
            <span>Your name</span>
            <input
              type="text"
              value={name}
              placeholder="e.g. Robin"
              onChange={(e) => {
                setName(e.target.value);
                if (e.target.value.trim()) setNamePrompt(false);
              }}
            />
          </label>

          {namePrompt && (
            <p className="rtpa-upload__toast" role="alert" data-testid="name-prompt">
              Please add your name first so people know who shared this.
            </p>
          )}

          <label className="rtpa-upload__add">
            <span className="rtpa-upload__add-label">＋ Add photos / videos</span>
            <input
              type="file"
              aria-label="Add photos / videos"
              accept="image/*,video/*,.heic,.heif,.avif"
              multiple
              className="rtpa-upload__file-input"
              disabled={uploading}
              onChange={(e) => {
                void handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>

          {uploading && uploadStep && uploadStep.total > 1 && (
            <p className="rtpa-upload__step" aria-live="polite" data-testid="upload-step">
              Uploading {uploadStep.index + 1} of {uploadStep.total}…
            </p>
          )}

          {uploading && (
            <div
              className="rtpa-upload__progress"
              data-testid="upload-progress"
              role="progressbar"
              aria-label="Upload progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
            >
              <div
                className="rtpa-upload__progress-bar"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          )}

          {uploadErrors.map((message, i) => (
            <p className="rtpa-upload__toast" role="alert" key={`${message}-${i}`}>
              {message}
            </p>
          ))}

          {notices.map((message, i) => (
            <p className="rtpa-upload__notice" role="status" key={`${message}-${i}`}>
              {message}
            </p>
          ))}

          {rejections.map((message, i) => (
            <p className="rtpa-upload__toast" role="alert" key={`${message}-${i}`}>
              {message}
            </p>
          ))}

          {contributions.length > 0 && (
            <div className="rtpa-upload__success" data-testid="upload-success">
              <p>✅ Added to the party!</p>
              <div className="rtpa-upload__strip" data-testid="contribution-strip">
                {contributions.map((c) => (
                  <img key={c.id} src={c.thumbUrl} alt="Your contribution" />
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
