import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { adminApi, ApiError } from '../api';
import { useDebouncedCallback } from './useDebouncedCallback';
import type {
  EventDetail,
  MotionConfig,
  MotionStyle,
  EnterAnimation,
  LeaveAnimation,
} from '@rtpa/shared';

const MOTION_STYLES: MotionStyle[] = ['drift', 'current', 'orbit', 'mosaic'];
const ENTER_ANIMS: EnterAnimation[] = ['flyInEdge', 'scalePop', 'fadeGrow', 'spinIn', 'dropBounce'];
const LEAVE_ANIMS: LeaveAnimation[] = ['driftOffEdge', 'shrinkFade', 'spinOut', 'slideAway'];

export function DisplayTab({ event }: { event: EventDetail }) {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<MotionConfig>(event.motionConfig);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const pushConfig = useDebouncedCallback((cfg: MotionConfig) => {
    setSaving(true);
    adminApi
      .setMotion(event.id, cfg)
      .then((updatedEvent) => {
        queryClient.setQueryData(['admin', 'event', event.id], updatedEvent);
        setSaveError(null);
      })
      .catch((err) =>
        setSaveError(err instanceof ApiError ? `Save failed (${err.status})` : 'Save failed'),
      )
      .finally(() => setSaving(false));
  }, 350);

  function update(next: MotionConfig) {
    setConfig(next);
    pushConfig(next);
  }

  return (
    <div className="display-tab" data-testid="display-tab">
      <div className="display-tab__header">
        <h2>Display settings</h2>
        <button
          type="button"
          onClick={() => window.open(`/e/${event.code}/display`, '_blank', 'noopener')}
        >
          Open display
        </button>
        <span className="display-tab__status" aria-live="polite">
          {saving ? 'Saving…' : 'Saved'}
        </span>
        {saveError && (
          <span role="alert" className="save-error">
            {saveError}
          </span>
        )}
      </div>

      <fieldset>
        <legend>Motion-style mix</legend>
        {MOTION_STYLES.map((s) => (
          <label key={s}>
            {s}
            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={config.motionWeights[s]}
              aria-label={`motion weight ${s}`}
              onChange={(e) =>
                update({
                  ...config,
                  motionWeights: { ...config.motionWeights, [s]: Number(e.target.value) },
                })
              }
            />
          </label>
        ))}
      </fieldset>

      <label>
        Overall speed
        <input
          type="range"
          min={0.25}
          max={3}
          step={0.25}
          value={config.speed}
          aria-label="overall speed"
          onChange={(e) => update({ ...config, speed: Number(e.target.value) })}
        />
      </label>

      <label>
        Max on canvas
        <input
          type="number"
          min={1}
          max={200}
          value={config.maxOnCanvas}
          aria-label="max on canvas"
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) update({ ...config, maxOnCanvas: n });
          }}
        />
      </label>

      <fieldset>
        <legend>Dwell timeout</legend>
        <label>
          Dwell timeout enabled
          <input
            type="checkbox"
            checked={config.dwell.enabled}
            onChange={(e) =>
              update({ ...config, dwell: { ...config.dwell, enabled: e.target.checked } })
            }
          />
        </label>
        {config.dwell.enabled && (
          <>
            <label>
              Dwell duration (ms)
              <input
                type="number"
                min={1000}
                step={1000}
                value={config.dwell.durationMs}
                aria-label="dwell duration"
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isNaN(n))
                    update({ ...config, dwell: { ...config.dwell, durationMs: n } });
                }}
              />
            </label>
            <label>
              Dwell variance (ms)
              <input
                type="number"
                min={0}
                step={1000}
                value={config.dwell.varianceMs}
                aria-label="dwell variance"
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isNaN(n))
                    update({ ...config, dwell: { ...config.dwell, varianceMs: n } });
                }}
              />
            </label>
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>Enter-animation weights</legend>
        {ENTER_ANIMS.map((a) => (
          <label key={a}>
            {a}
            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={config.enterWeights[a]}
              aria-label={`enter weight ${a}`}
              onChange={(e) =>
                update({
                  ...config,
                  enterWeights: { ...config.enterWeights, [a]: Number(e.target.value) },
                })
              }
            />
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Leave-animation weights</legend>
        {LEAVE_ANIMS.map((a) => (
          <label key={a}>
            {a}
            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={config.leaveWeights[a]}
              aria-label={`leave weight ${a}`}
              onChange={(e) =>
                update({
                  ...config,
                  leaveWeights: { ...config.leaveWeights, [a]: Number(e.target.value) },
                })
              }
            />
          </label>
        ))}
      </fieldset>

      <label>
        Base size
        <input
          type="range"
          min={80}
          max={800}
          step={10}
          value={config.baseSize}
          aria-label="base size"
          onChange={(e) => update({ ...config, baseSize: Number(e.target.value) })}
        />
      </label>

      <label>
        Size variance
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={config.sizeVariance}
          aria-label="size variance"
          onChange={(e) => update({ ...config, sizeVariance: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
