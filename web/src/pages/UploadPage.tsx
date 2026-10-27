import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Photo } from '../api/types';
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
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [namePrompt, setNamePrompt] = useState(false);

  const eventQuery = useQuery({
    queryKey: ['public-event', code],
    queryFn: () => getPublicEvent(code),
  });

  const event = eventQuery.data;

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
    setUploadError(null);

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

    setUploading(true);
    setProgress(0);
    try {
      const photos = await uploadFiles(code, {
        uploaderName: trimmedName,
        deviceId: getDeviceId(),
        files: prepared,
        onProgress: (fraction) => setProgress(fraction),
      });
      const next: Contribution[] = photos.map((p: Photo) => ({
        id: p.id,
        thumbUrl: p.thumbUrl,
      }));
      setContributions((prev) => [...next, ...prev]);
    } catch (err) {
      setUploadError(uploadErrorMessage(err));
    } finally {
      setUploading(false);
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

          {uploadError && (
            <p className="rtpa-upload__toast" role="alert">
              {uploadError}
            </p>
          )}

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
