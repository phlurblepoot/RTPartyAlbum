import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Photo } from '../api/types';
import { getPublicEvent, uploadFiles, ApiError } from '../api/client';
import { getDeviceId } from '../lib/deviceId';
import { themeToCssVars, backgroundStyle } from '../lib/themeCss';
import { useUploaderName } from '../lib/useUploaderName';
import { downscaleImage } from '../lib/downscaleImage';
import { validateFiles } from '../lib/validateUpload';
import { DEFAULT_MEDIA_LIMITS } from '@rtpa/shared';
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
      default:
        if (err.status === 403) return 'Uploads just closed — sorry!';
        if (err.status === 429) return 'Slow down a moment — try again shortly.';
        if (err.status === 413) return "That file is too big — it didn't make it.";
        return 'Something went wrong. Please try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}

function rejectionMessage(name: string, reason: 'bad-type' | 'too-large'): string {
  return reason === 'too-large'
    ? `${name} is too large`
    : `${name} isn't a supported photo or video`;
}

export default function UploadPage() {
  const { code = '' } = useParams<{ code: string }>();
  const { name, setName } = useUploaderName();
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [rejections, setRejections] = useState<string[]>([]);
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

    const picked = Array.from(fileList);
    const { accepted, rejected } = validateFiles(picked, DEFAULT_MEDIA_LIMITS);

    // Replace (don't accumulate) so each pick shows only its own rejections,
    // symmetric with how uploadError is cleared above.
    setRejections(rejected.map((r) => rejectionMessage(r.file.name, r.reason)));

    if (accepted.length === 0) return;

    // A non-empty name is required to upload (it's shown alongside the media).
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNamePrompt(true);
      return;
    }
    setNamePrompt(false);

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
